import type { Cookie } from '@azure/functions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../lib/config.ts';
import { DatabaseUnavailableError } from '../lib/db.ts';
import type { UserCtx } from '../lib/http.ts';
import { LOCK_MS, MAX_FAILURES, type AttemptRow } from '../lib/lockout.ts';
import { dummyHash, verifyPassword } from '../lib/password.ts';
import { clearedCookie, hashToken } from '../lib/session.ts';
import { clearAttempt, getAttempts, releaseAttempt, reserveAttempt } from '../repo/attempts.ts';
import { createSession, deleteSession, pruneExpiredSessions } from '../repo/sessions.ts';
import { findUserByLogin, type UserRecord } from '../repo/users.ts';
import './auth.ts';

type Handler = (ctx: UserCtx) => Promise<unknown>;

const handlers = vi.hoisted(() => new Map<string, Handler>());

vi.mock(import('../lib/http.ts'), () => ({
  route: (name: string, _method: string, _path: string, _access: string, handler: Handler) => {
    handlers.set(name, handler);
  },
}));
vi.mock(import('../lib/password.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  dummyHash: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock(import('../repo/attempts.ts'), () => ({
  clearAttempt: vi.fn(),
  getAttempts: vi.fn(),
  releaseAttempt: vi.fn(),
  reserveAttempt: vi.fn(),
}));
vi.mock(import('../repo/sessions.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  pruneExpiredSessions: vi.fn(),
}));
vi.mock(import('../repo/users.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  findUserByLogin: vi.fn(),
}));

const IP = '10.0.0.1';
const LOGIN_KEY = 'login:ann';
const IP_KEY = `ip:${IP}`;
const PASSWORD = 'a-long-enough-password';
const user: UserRecord = { id: 7, login: 'ann', displayName: 'Ann', role: 'rater', active: true, passwordHash: 'stored' };
const config = { cookieSecure: false } as Config;
const warn = vi.fn();

const reserved = (failures: number): AttemptRow => ({ failures, windowStart: new Date(), lockedUntil: null });
const ipRow = reserved(3);

function login(body: Record<string, unknown>): { result: Promise<unknown>; cookies: Cookie[] } {
  const handler = handlers.get('login');
  if (!handler) throw new Error('login was not registered.');
  const cookies: Cookie[] = [];
  const result = handler({ body, ip: IP, config, cookies, log: { warn } } as unknown as UserCtx);
  return { result, cookies };
}

const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0] ?? 0;

function expectNoWritesAfterReserve(cookies: Cookie[]): void {
  expect(clearAttempt).not.toHaveBeenCalled();
  expect(releaseAttempt).not.toHaveBeenCalled();
  expect(pruneExpiredSessions).not.toHaveBeenCalled();
  expect(createSession).not.toHaveBeenCalled();
  expect(cookies).toEqual([]);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAttempts).mockResolvedValue(new Map());
  vi.mocked(reserveAttempt).mockResolvedValue({
    locked: false,
    rows: new Map([
      [LOGIN_KEY, reserved(1)],
      [IP_KEY, ipRow],
    ]),
  });
  vi.mocked(findUserByLogin).mockResolvedValue(user);
  vi.mocked(verifyPassword).mockResolvedValue(true);
  vi.mocked(dummyHash).mockResolvedValue('dummy');
  vi.mocked(releaseAttempt).mockResolvedValue(undefined);
});

describe('login', () => {
  it('answers 401 for a login that cannot exist, before touching the database', async () => {
    const { result, cookies } = login({ login: 'not a login', password: PASSWORD });

    await expect(result).rejects.toMatchObject({ status: 401, message: 'Wrong login or password.' });
    expect(getAttempts).not.toHaveBeenCalled();
    expect(reserveAttempt).not.toHaveBeenCalled();
    expect(findUserByLogin).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(cookies).toEqual([]);
  });

  it('answers 429 from the lock-free look at a locked key, reserving nothing and checking no password', async () => {
    const locked = { failures: MAX_FAILURES, windowStart: new Date(), lockedUntil: new Date(Date.now() + LOCK_MS) };
    vi.mocked(getAttempts).mockResolvedValue(new Map([[IP_KEY, locked]]));

    const { result } = login({ login: 'Ann', password: PASSWORD });

    await expect(result).rejects.toMatchObject({ status: 429 });
    expect(getAttempts).toHaveBeenCalledWith(expect.anything(), [LOGIN_KEY, IP_KEY]);
    expect(reserveAttempt).not.toHaveBeenCalled();
    expect(findUserByLogin).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it('answers 429, checking no password, when a key locked between the look and the reserve', async () => {
    vi.mocked(reserveAttempt).mockResolvedValue({ locked: true, rows: new Map() });

    const { result, cookies } = login({ login: 'ann', password: PASSWORD });

    await expect(result).rejects.toMatchObject({ status: 429 });
    expect(findUserByLogin).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
    expectNoWritesAfterReserve(cookies);
  });

  it('reserves the attempt on both keys before looking up the user or checking the password', async () => {
    const { result } = login({ login: 'Ann', password: PASSWORD });
    await result;

    expect(reserveAttempt).toHaveBeenCalledWith([LOGIN_KEY, IP_KEY], expect.any(Date));
    expect(order(vi.mocked(getAttempts))).toBeLessThan(order(vi.mocked(reserveAttempt)));
    expect(order(vi.mocked(reserveAttempt))).toBeLessThan(order(vi.mocked(findUserByLogin)));
    expect(order(vi.mocked(findUserByLogin))).toBeLessThan(order(vi.mocked(verifyPassword)));
  });

  it('writes nothing after the reserve for a wrong password', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);

    const { result, cookies } = login({ login: 'ann', password: 'wrong-password' });

    await expect(result).rejects.toMatchObject({ status: 401, message: 'Wrong login or password.' });
    expect(verifyPassword).toHaveBeenCalledWith('wrong-password', 'stored');
    expectNoWritesAfterReserve(cookies);
  });

  it('refuses an inactive user who knows the password, writing nothing after the reserve', async () => {
    vi.mocked(findUserByLogin).mockResolvedValue({ ...user, active: false });

    const { result, cookies } = login({ login: 'ann', password: PASSWORD });

    await expect(result).rejects.toMatchObject({ status: 401, message: 'Wrong login or password.' });
    expectNoWritesAfterReserve(cookies);
  });

  it('checks an unknown login against the dummy hash and writes nothing after the reserve', async () => {
    vi.mocked(findUserByLogin).mockResolvedValue(undefined);

    const { result, cookies } = login({ login: 'ann', password: PASSWORD });

    await expect(result).rejects.toMatchObject({ status: 401, message: 'Wrong login or password.' });
    expect(verifyPassword).toHaveBeenCalledWith(PASSWORD, 'dummy');
    expectNoWritesAfterReserve(cookies);
  });

  it('clears the login key, then hands back the IP attempt, then starts the session', async () => {
    const { result, cookies } = login({ login: 'ann', password: PASSWORD });

    expect(await result).toEqual({ id: 7, login: 'ann', displayName: 'Ann', role: 'rater' });
    expect(clearAttempt).toHaveBeenCalledWith(expect.anything(), LOGIN_KEY);
    expect(releaseAttempt).toHaveBeenCalledWith(expect.anything(), IP_KEY, ipRow);
    expect(createSession).toHaveBeenCalledWith(expect.anything(), expect.any(String), 7, expect.any(Date));
    expect(order(vi.mocked(verifyPassword))).toBeLessThan(order(vi.mocked(clearAttempt)));
    expect(order(vi.mocked(clearAttempt))).toBeLessThan(order(vi.mocked(releaseAttempt)));
    expect(order(vi.mocked(releaseAttempt))).toBeLessThan(order(vi.mocked(createSession)));
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({ name: 'fcr_session', httpOnly: true });
  });

  it('still logs in, with a warning, when handing back the IP attempt fails', async () => {
    vi.mocked(releaseAttempt).mockRejectedValue(new Error('connection reset'));

    const { result, cookies } = login({ login: 'ann', password: PASSWORD });

    expect(await result).toMatchObject({ id: 7 });
    expect(warn).toHaveBeenCalledWith('Releasing the IP attempt failed', expect.any(Error));
    expect(createSession).toHaveBeenCalled();
    expect(cookies).toHaveLength(1);
  });
});

describe('logout', () => {
  function logout(cookie?: string): { result: Promise<unknown>; cookies: Cookie[] } {
    const handler = handlers.get('logout');
    if (!handler) throw new Error('logout was not registered.');
    const cookies: Cookie[] = [];
    const request = { headers: new Headers(cookie ? { cookie } : {}) };
    const result = handler({ request, config, cookies, log: { warn } } as unknown as UserCtx);
    return { result, cookies };
  }

  it('ends the server session and clears the cookie', async () => {
    const { result, cookies } = logout('fcr_session=the-token');

    expect(await result).toBeUndefined();
    expect(deleteSession).toHaveBeenCalledWith(expect.anything(), hashToken('the-token'));
    expect(cookies).toEqual([clearedCookie(false)]);
  });

  it('still clears the cookie when ending the server session fails, and lets the failure through', async () => {
    const down = new DatabaseUnavailableError('The database is paused.');
    vi.mocked(deleteSession).mockRejectedValue(down);

    const { result, cookies } = logout('fcr_session=the-token');

    await expect(result).rejects.toBe(down);
    expect(cookies).toEqual([clearedCookie(false)]);
  });

  it('clears the cookie without touching the database when there is no session cookie', async () => {
    const { result, cookies } = logout();

    expect(await result).toBeUndefined();
    expect(deleteSession).not.toHaveBeenCalled();
    expect(cookies).toEqual([clearedCookie(false)]);
  });
});
