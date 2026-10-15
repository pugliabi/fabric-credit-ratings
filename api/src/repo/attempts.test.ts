import sql from 'mssql';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useTarget } from '../../../db/target.ts';
import { closeDb, db, transaction, varchar, type Db, type Param, type Params } from '../lib/db.ts';
import { LOCK_MS, MAX_FAILURES, afterFailure, type AttemptRow } from '../lib/lockout.ts';
import { clearAttempt, getAttempts, releaseAttempt, reserveAttempt } from './attempts.ts';

vi.mock(import('../lib/db.ts'), async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, transaction: vi.fn(real.transaction) as typeof real.transaction };
});

afterEach(() => {
  vi.mocked(transaction).mockReset();
  vi.restoreAllMocks();
});

interface Call {
  text: string;
  params: Params;
}

const verb = (call: Call) => call.text.trim().split(/\s/, 1)[0];

/** The string inside a varchar() parameter. */
const unwrap = (param: Param | undefined) =>
  param !== null && typeof param === 'object' && !(param instanceof Date) ? param.value : param;

/** A Db that records statements; SELECTs return what `answer` gives for their parameters. */
function recorder(answer: (params: Params) => object[] = () => []): { calls: Call[]; fake: Db } {
  const calls: Call[] = [];
  const fake: Db = {
    query<T>(text: string, params: Params = {}): Promise<T[]> {
      calls.push({ text, params });
      return Promise.resolve((verb({ text, params }) === 'SELECT' ? answer(params) : []) as T[]);
    },
  };
  return { calls, fake };
}

/** A plain string binds as nvarchar, which makes SQL Server convert the varchar key column and scan the table. */
function expectVarcharKeys(calls: readonly Call[]): void {
  for (const { text, params } of calls) {
    const keys = text.match(/@k\d+|@key/g) ?? [];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(params[key.slice(1)]).toStrictEqual(varchar(expect.any(String)));
  }
}

/** What mssql rejects with when the server picks a statement as the deadlock victim. */
function serverError(number: number): sql.RequestError {
  return new sql.RequestError(Object.assign(new Error(`Server error ${number}.`), { info: { number } }), 'EREQUEST');
}

describe('reserveAttempt', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const stored: AttemptRow = { failures: 3, windowStart: new Date(now.getTime() - 60_000), lockedUntil: null };
  const locked: AttemptRow = {
    failures: MAX_FAILURES,
    windowStart: new Date(now.getTime() - 60_000),
    lockedUntil: new Date(now.getTime() + 60_000),
  };

  it('locks every key in key order before it writes any, all in one transaction', async () => {
    const { calls, fake } = recorder((params) => (unwrap(params.key) === 'login:ann' ? [stored] : []));
    vi.mocked(transaction).mockImplementationOnce((work) => work(fake));
    const outside = vi.spyOn(db, 'query').mockRejectedValue(new Error('Queried outside the transaction.'));

    const reservation = await reserveAttempt(['login:ann', 'ip:10.0.0.1', 'login:ann'], now);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(outside).not.toHaveBeenCalled();
    expect(calls.map((call) => [verb(call), unwrap(call.params.key)])).toEqual([
      ['SELECT', 'ip:10.0.0.1'],
      ['SELECT', 'login:ann'],
      ['MERGE', 'ip:10.0.0.1'],
      ['MERGE', 'login:ann'],
    ]);
    for (const read of calls.filter((call) => verb(call) === 'SELECT')) {
      expect(read.text).toMatch(/FROM login_attempts WITH \(UPDLOCK, HOLDLOCK\)/);
    }
    expect(calls.filter((call) => verb(call) === 'MERGE').map((call) => call.params)).toEqual([
      { key: varchar('ip:10.0.0.1'), failures: 1, windowStart: now, lockedUntil: null },
      { key: varchar('login:ann'), failures: 4, windowStart: stored.windowStart, lockedUntil: null },
    ]);
    expect(reservation).toEqual({
      locked: false,
      rows: new Map([
        ['ip:10.0.0.1', afterFailure(undefined, now)],
        ['login:ann', afterFailure(stored, now)],
      ]),
    });
    expectVarcharKeys(calls);
  });

  it('writes nothing and reports locked when any key is already locked', async () => {
    const { calls, fake } = recorder((params) => (unwrap(params.key) === 'login:ann' ? [locked] : []));
    vi.mocked(transaction).mockImplementationOnce((work) => work(fake));

    const reservation = await reserveAttempt(['login:ann', 'ip:10.0.0.1'], now);

    expect(calls.map((call) => [verb(call), unwrap(call.params.key)])).toEqual([
      ['SELECT', 'ip:10.0.0.1'],
      ['SELECT', 'login:ann'],
    ]);
    expect(reservation).toEqual({ locked: true, rows: new Map() });
  });

  it('runs the transaction again when the server picks it as a deadlock victim', async () => {
    const { fake } = recorder();
    vi.mocked(transaction)
      .mockRejectedValueOnce(serverError(1205))
      .mockRejectedValueOnce(serverError(1205))
      .mockImplementationOnce((work) => work(fake));

    const reservation = await reserveAttempt(['ip:10.0.0.1'], now);

    expect(transaction).toHaveBeenCalledTimes(3);
    expect(reservation.locked).toBe(false);
  });

  it('also runs it again when the deadlock surfaces as an aborted transaction', async () => {
    const { fake } = recorder();
    const aborted = new sql.TransactionError('Transaction has been aborted.', 'EABORT');
    Object.defineProperty(aborted, 'originalError', { value: serverError(1205) });
    vi.mocked(transaction)
      .mockRejectedValueOnce(aborted)
      .mockImplementationOnce((work) => work(fake));

    expect((await reserveAttempt(['ip:10.0.0.1'], now)).locked).toBe(false);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('gives up after two retries', async () => {
    const third = serverError(1205);
    vi.mocked(transaction)
      .mockRejectedValueOnce(serverError(1205))
      .mockRejectedValueOnce(serverError(1205))
      .mockRejectedValueOnce(third);

    await expect(reserveAttempt(['ip:10.0.0.1'], now)).rejects.toBe(third);
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['a duplicate key', serverError(2627)],
    ['a lost connection', new sql.ConnectionError('Connection is closed.', 'ECONNCLOSED')],
    ['a plain error', new Error('Something else.')],
  ])('does not retry %s', async (_, error) => {
    vi.mocked(transaction).mockRejectedValueOnce(error);

    await expect(reserveAttempt(['ip:10.0.0.1'], now)).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

describe('releaseAttempt', () => {
  it('takes one failure back only from the window it was reserved in, and only if there is one to take', async () => {
    const { calls, fake } = recorder();
    const reserved: AttemptRow = { failures: 4, windowStart: new Date('2026-10-15T11:59:00Z'), lockedUntil: null };

    await releaseAttempt(fake, 'ip:10.0.0.1', reserved);

    expect(calls.map(verb)).toEqual(['UPDATE']);
    const [update] = calls;
    expect(update?.text).toMatch(/failures = failures - 1/);
    expect(update?.text).toMatch(/WHERE attempt_key = @key AND window_start = @windowStart AND failures > 0/);
    expect(update?.params).toEqual({
      key: varchar('ip:10.0.0.1'),
      windowStart: reserved.windowStart,
      max: MAX_FAILURES,
    });
    expectVarcharKeys(calls);
  });
});

describe('getAttempts and clearAttempt', () => {
  it('compare keys as varchar so the key index can seek', async () => {
    const { calls, fake } = recorder();
    await getAttempts(fake, ['login:ann', 'ip:10.0.0.1']);
    await clearAttempt(fake, 'login:ann');
    expect(calls.map(verb)).toEqual(['SELECT', 'DELETE']);
    expectVarcharKeys(calls);
  });
});

describe.skipIf(!process.env.FCR_DB_TESTS)('login attempts against the dev database', () => {
  const stamp = Date.now().toString(36);
  const ip = `ip:itest-race-${stamp}`;
  const login = `login:itest-race-${stamp}`;
  const tripIp = `ip:itest-trip-${stamp}`;
  const tripLogins = Array.from({ length: MAX_FAILURES }, (_, i) => `login:itest-trip-${i}-${stamp}`);

  beforeAll(() => {
    useTarget([]);
  });

  afterAll(async () => {
    for (const key of [ip, login, tripIp, ...tripLogins]) await clearAttempt(db, key);
    await closeDb();
  });

  it('lets exactly the allowed number of parallel attempts through, then locks', { timeout: 120_000 }, async () => {
    const now = new Date();
    const calls = 3 * MAX_FAILURES;
    const results = await Promise.all(Array.from({ length: calls }, () => reserveAttempt([login, ip], now)));

    const through = results.filter((reservation) => !reservation.locked);
    expect(through).toHaveLength(MAX_FAILURES);
    const counts = (key: string) => through.map(({ rows }) => rows.get(key)?.failures ?? 0).sort((a, b) => a - b);
    const oneToMax = Array.from({ length: MAX_FAILURES }, (_, i) => i + 1);
    expect(counts(ip)).toEqual(oneToMax);
    expect(counts(login)).toEqual(oneToMax);
    for (const reservation of results.filter(({ locked }) => locked)) expect(reservation.rows.size).toBe(0);

    const lockedRow = { failures: MAX_FAILURES, windowStart: now, lockedUntil: new Date(now.getTime() + LOCK_MS) };
    const stored = await getAttempts(db, [ip, login]);
    expect(stored.get(ip)).toEqual(lockedRow);
    expect(stored.get(login)).toEqual(lockedRow);
  });

  it('hands a reserved attempt back, lifting the lock that attempt set', { timeout: 120_000 }, async () => {
    const now = new Date();
    for (const tripLogin of tripLogins.slice(0, -1)) await reserveAttempt([tripLogin, tripIp], now);
    const before = (await getAttempts(db, [tripIp])).get(tripIp);
    expect(before).toEqual({ failures: MAX_FAILURES - 1, windowStart: now, lockedUntil: null });

    const reservation = await reserveAttempt([tripLogins.at(-1) ?? '', tripIp], now);
    const reserved = reservation.rows.get(tripIp);
    if (!reserved) throw new Error('The reservation did not count the IP.');
    expect(reserved.lockedUntil).toEqual(new Date(now.getTime() + LOCK_MS));
    await releaseAttempt(db, tripIp, reserved);

    expect((await getAttempts(db, [tripIp])).get(tripIp)).toEqual(before);
  });
});
