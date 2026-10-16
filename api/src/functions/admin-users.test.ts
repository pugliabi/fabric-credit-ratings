import sql from 'mssql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminUser, SessionUser } from '../../../src/domain/api-types.ts';
import type { Config } from '../lib/config.ts';
import { db, transaction, type Db } from '../lib/db.ts';
import type { UserCtx } from '../lib/http.ts';
import { hashPassword } from '../lib/password.ts';
import { hashToken } from '../lib/session.ts';
import { deleteUserSessions } from '../repo/sessions.ts';
import {
  countActiveAdminsLocked,
  createUser,
  findUserById,
  findUserByLogin,
  listUsers,
  updateUser,
  type UserRecord,
} from '../repo/users.ts';
import './admin-users.ts';

type Handler = (ctx: UserCtx) => Promise<unknown>;

const handlers = vi.hoisted(() => new Map<string, Handler>());

vi.mock(import('../lib/http.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  route: (name: string, _method: string, _path: string, _access: string, handler: Handler) => {
    handlers.set(name, handler);
  },
}));
vi.mock(import('../lib/db.ts'), async (importOriginal) => ({ ...(await importOriginal()), transaction: vi.fn() }));
vi.mock(import('../lib/password.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  hashPassword: vi.fn(),
}));
vi.mock(import('../repo/sessions.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  deleteUserSessions: vi.fn(),
}));
vi.mock(import('../repo/users.ts'), () => ({
  countActiveAdminsLocked: vi.fn(),
  createUser: vi.fn(),
  findUserById: vi.fn(),
  findUserByLogin: vi.fn(),
  listUsers: vi.fn(),
  updateUser: vi.fn(),
}));

const admin: SessionUser = { id: 1, login: 'admin', displayName: 'Admin', role: 'admin' };
const adminRecord: UserRecord = { ...admin, active: true, passwordHash: 'unused' };
const otherAdmin: UserRecord = { ...adminRecord, id: 2, login: 'other', displayName: 'Other' };
const rater: UserRecord = { ...adminRecord, id: 7, login: 'rater', displayName: 'Rater', role: 'rater' };
const users: AdminUser[] = [{ ...admin, active: true, createdAt: '2026-10-15T00:00:00.000Z', lastScoredRound: null }];
const config = { cookieSecure: false } as Config;
const tx: Db = { query: () => Promise.reject(new Error('The repo functions are mocked.')) };
const committed = vi.fn();
const NEW_PASSWORD = 'a-long-enough-password';

function call(
  name: string,
  params: Record<string, string>,
  body: Record<string, unknown>,
  cookie?: string,
): Promise<unknown> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered.`);
  const request = { headers: new Headers(cookie ? { cookie } : {}) };
  return handler({ params, body, user: admin, config, request } as unknown as UserCtx);
}

/** What mssql rejects with when the server refuses a statement. */
function sqlError(number: number): sql.RequestError {
  return new sql.RequestError(Object.assign(new Error(`SQL Server error ${number}`), { info: { number } }));
}

function expectAscending(order: number[]): void {
  expect(order).toEqual([...order].sort((a, b) => a - b));
}

/** When the mock was first called. Throws if it never was, so an order check can't pass vacuously. */
const firstCall = (fn: { mock: { invocationCallOrder: number[] } }) => {
  const [first] = fn.mock.invocationCallOrder;
  if (first === undefined) throw new Error('Expected the mock to have been called.');
  return first;
};

/** Answers findUserById from `rows` by id; `inTx` overrides what the transaction's reads see. */
function usersById(rows: UserRecord[], inTx: Record<number, UserRecord | undefined> = {}): void {
  vi.mocked(findUserById).mockImplementation(async (from, id) =>
    from === tx && id in inTx ? inTx[id] : rows.find((row) => row.id === id),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(transaction).mockImplementation(async (work) => {
    const value = await work(tx);
    committed();
    return value;
  });
  vi.mocked(hashPassword).mockResolvedValue('hashed');
  vi.mocked(countActiveAdminsLocked).mockResolvedValue(2);
  usersById([adminRecord, otherAdmin, rater]);
  vi.mocked(listUsers).mockResolvedValue(users);
});

describe('adminUserUpdate', () => {
  it('hashes, then in one transaction locks the count, re-reads caller and user, updates, ends sessions', async () => {
    const result = await call('adminUserUpdate', { id: '2' }, { role: 'rater', password: NEW_PASSWORD });

    expect(hashPassword).toHaveBeenCalledWith(NEW_PASSWORD);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(countActiveAdminsLocked).toHaveBeenCalledWith(tx);
    expect(vi.mocked(findUserById).mock.calls).toEqual([
      [expect.anything(), 2],
      [tx, admin.id],
      [tx, 2],
    ]);
    expect(vi.mocked(findUserById).mock.calls[0]?.[0]).toBe(db);
    expect(updateUser).toHaveBeenCalledWith(tx, 2, {
      displayName: undefined,
      role: 'rater',
      active: undefined,
      passwordHash: 'hashed',
    });
    expect(deleteUserSessions).toHaveBeenCalledWith(tx, 2, '');
    const [preRead = 0, actorRead = 0, targetRead = 0] = vi.mocked(findUserById).mock.invocationCallOrder;
    expectAscending([
      preRead,
      firstCall(vi.mocked(hashPassword)),
      firstCall(vi.mocked(transaction)),
      firstCall(vi.mocked(countActiveAdminsLocked)),
      actorRead,
      targetRead,
      firstCall(vi.mocked(updateUser)),
      firstCall(vi.mocked(deleteUserSessions)),
      firstCall(committed),
      firstCall(vi.mocked(listUsers)),
    ]);
    expect(result).toEqual(users);
  });

  it('refuses with 403, writing nothing, when the caller lost admin rights while waiting for the lock', async () => {
    for (const actor of [{ ...adminRecord, role: 'rater' as const }, { ...adminRecord, active: false }, undefined]) {
      usersById([adminRecord, otherAdmin, rater], { [admin.id]: actor });

      await expect(call('adminUserUpdate', { id: '7' }, { password: NEW_PASSWORD })).rejects.toMatchObject({
        status: 403,
        message: 'Only admins can do that.',
      });
    }
    expect(updateUser).not.toHaveBeenCalled();
    expect(deleteUserSessions).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();
  });

  it('disables another admin while a second admin stays active, ending their sessions', async () => {
    await call('adminUserUpdate', { id: '2' }, { active: false }, 'fcr_session=own-token');

    expect(updateUser).toHaveBeenCalledWith(tx, 2, {
      displayName: undefined,
      role: undefined,
      active: false,
      passwordHash: undefined,
    });
    expect(deleteUserSessions).toHaveBeenCalledWith(tx, 2, '');
    expect(committed).toHaveBeenCalledTimes(1);
  });

  it('decides on the locked count: refuses with 409, writing nothing, to demote the last active admin', async () => {
    vi.mocked(countActiveAdminsLocked).mockResolvedValue(1);

    await expect(call('adminUserUpdate', { id: '2' }, { role: 'rater' })).rejects.toMatchObject({
      status: 409,
      message: 'Keep at least one active admin. Make another user an admin first.',
    });
    expect(countActiveAdminsLocked).toHaveBeenCalledWith(tx);
    expect(updateUser).not.toHaveBeenCalled();
    expect(deleteUserSessions).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();
  });

  it('refuses with 409, writing nothing, when the caller removes their own admin access', async () => {
    await expect(call('adminUserUpdate', { id: '1' }, { active: false })).rejects.toMatchObject({
      status: 409,
      message: 'You cannot remove your own admin access. Ask another admin to make this change.',
    });
    expect(updateUser).not.toHaveBeenCalled();
    expect(deleteUserSessions).not.toHaveBeenCalled();
  });

  it('answers 404, writing nothing, when the user is gone by the time the transaction reads it', async () => {
    usersById([adminRecord, rater], { [rater.id]: undefined });

    await expect(call('adminUserUpdate', { id: '7' }, { active: false })).rejects.toMatchObject({
      status: 404,
      message: 'That user does not exist.',
    });
    expect(findUserById).toHaveBeenLastCalledWith(tx, 7);
    expect(updateUser).not.toHaveBeenCalled();
    expect(deleteUserSessions).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown or non-numeric id before hashing or opening a transaction', async () => {
    await expect(call('adminUserUpdate', { id: 'abc' }, { password: NEW_PASSWORD })).rejects.toMatchObject({
      status: 404,
      message: 'That user does not exist.',
    });
    expect(findUserById).not.toHaveBeenCalled();

    await expect(call('adminUserUpdate', { id: '99' }, { password: NEW_PASSWORD })).rejects.toMatchObject({
      status: 404,
    });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('answers 404 for an id that only parses as a number, without looking it up', async () => {
    for (const id of ['1e1', '0x7', '7.0', '-7', ' 7', '7 ', '', '1234567890']) {
      await expect(call('adminUserUpdate', { id }, { displayName: 'Renamed' })).rejects.toMatchObject({
        status: 404,
        message: 'That user does not exist.',
      });
    }
    expect(findUserById).not.toHaveBeenCalled();
  });

  it('refuses a weak password with 400 before hashing or opening a transaction', async () => {
    await expect(call('adminUserUpdate', { id: '7' }, { password: 'short' })).rejects.toMatchObject({
      status: 400,
      message: 'Use at least 10 characters.',
    });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("keeps the caller's own session when they reset their own password", async () => {
    await call('adminUserUpdate', { id: '1' }, { password: NEW_PASSWORD }, 'fcr_session=own-token');

    expect(updateUser).toHaveBeenCalledWith(tx, 1, expect.objectContaining({ passwordHash: 'hashed' }));
    expect(deleteUserSessions).toHaveBeenCalledWith(tx, 1, hashToken('own-token'));
  });

  it('ends every session of a user who is deactivated, hashing nothing', async () => {
    await call('adminUserUpdate', { id: '7' }, { active: false }, 'fcr_session=own-token');

    expect(updateUser).toHaveBeenCalledWith(tx, 7, {
      displayName: undefined,
      role: undefined,
      active: false,
      passwordHash: undefined,
    });
    expect(deleteUserSessions).toHaveBeenCalledWith(tx, 7, '');
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it('leaves sessions alone for a rename', async () => {
    await call('adminUserUpdate', { id: '7' }, { displayName: '  Renamed  ' });

    expect(updateUser).toHaveBeenCalledWith(tx, 7, expect.objectContaining({ displayName: 'Renamed' }));
    expect(deleteUserSessions).not.toHaveBeenCalled();
  });
});

describe('adminUserCreate', () => {
  const body = { login: 'New.Rater', displayName: 'New Rater', role: 'rater', password: NEW_PASSWORD };

  it('creates the user with a hashed password and returns the user list', async () => {
    expect(await call('adminUserCreate', {}, body)).toEqual(users);
    expect(findUserByLogin).toHaveBeenCalledWith(expect.anything(), 'new.rater');
    expect(createUser).toHaveBeenCalledWith(expect.anything(), {
      login: 'new.rater',
      displayName: 'New Rater',
      role: 'rater',
      passwordHash: 'hashed',
    });
  });

  it('answers 409 naming the login when a concurrent create took it first', async () => {
    for (const number of [2601, 2627]) {
      vi.mocked(createUser).mockRejectedValueOnce(sqlError(number));
      await expect(call('adminUserCreate', {}, body)).rejects.toMatchObject({
        status: 409,
        message: 'The login new.rater is taken.',
      });
    }
  });

  it('passes other database errors through', async () => {
    const error = sqlError(1205);
    vi.mocked(createUser).mockRejectedValue(error);
    await expect(call('adminUserCreate', {}, body)).rejects.toBe(error);
  });
});
