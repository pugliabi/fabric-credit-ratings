import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useTarget } from '../../../db/target.ts';
import { closeDb, db, transaction, type Db, type Params } from '../lib/db.ts';
import { LOCK_MS, MAX_FAILURES, afterFailure, type AttemptRow } from '../lib/lockout.ts';
import { clearAttempt, getAttempts, recordFailures } from './attempts.ts';

vi.mock(import('../lib/db.ts'), async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, transaction: vi.fn(real.transaction) as typeof real.transaction };
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Call {
  text: string;
  params: Params;
}

const verb = (call: Call) => call.text.trim().split(/\s/, 1)[0];

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

/** mssql sends strings as nvarchar, which makes SQL Server convert the varchar key column and scan the table. */
function expectVarcharKeys(calls: readonly Call[]): void {
  for (const { text } of calls) {
    const keys = text.match(/@k\d+|@key/g) ?? [];
    expect(keys.length).toBeGreaterThan(0);
    expect(text.match(/CAST\((@k\d+|@key) AS varchar\(100\)\)/g)).toHaveLength(keys.length);
  }
}

describe('recordFailures', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const stored: AttemptRow = { failures: 3, windowStart: new Date(now.getTime() - 60_000), lockedUntil: null };

  it('locks one key at a time, in key order, and writes it in the same transaction', async () => {
    const { calls, fake } = recorder((params) => (params.key === 'login:ann' ? [stored] : []));
    vi.mocked(transaction).mockImplementationOnce((work) => work(fake));
    const outside = vi.spyOn(db, 'query').mockRejectedValue(new Error('Queried outside the transaction.'));

    const rows = await recordFailures(['login:ann', 'ip:10.0.0.1'], now);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(outside).not.toHaveBeenCalled();
    expect(calls.map((call) => [verb(call), call.params.key])).toEqual([
      ['SELECT', 'ip:10.0.0.1'],
      ['MERGE', 'ip:10.0.0.1'],
      ['SELECT', 'login:ann'],
      ['MERGE', 'login:ann'],
    ]);
    for (const read of calls.filter((call) => verb(call) === 'SELECT')) {
      expect(read.text).toMatch(/FROM login_attempts WITH \(UPDLOCK, HOLDLOCK\)/);
    }
    expect(calls.filter((call) => verb(call) === 'MERGE').map((call) => call.params)).toEqual([
      { key: 'ip:10.0.0.1', failures: 1, windowStart: now, lockedUntil: null },
      { key: 'login:ann', failures: 4, windowStart: stored.windowStart, lockedUntil: null },
    ]);
    expect(rows).toEqual(
      new Map([
        ['ip:10.0.0.1', afterFailure(undefined, now)],
        ['login:ann', afterFailure(stored, now)],
      ]),
    );
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
  const logins = ['a', 'b', 'c'].map((name) => `login:itest-race-${name}-${stamp}`);

  beforeAll(() => {
    useTarget([]);
  });

  afterAll(async () => {
    for (const key of [ip, ...logins]) await clearAttempt(db, key);
    await closeDb();
  });

  it('counts parallel failures on shared keys one at a time and stops at the lock', { timeout: 120_000 }, async () => {
    const now = new Date();
    const calls = MAX_FAILURES * logins.length;
    const results = await Promise.all(
      Array.from({ length: calls }, (_, i) => recordFailures([logins[i % logins.length] ?? '', ip], now)),
    );
    const ipCounts = results.map((rows) => rows.get(ip)?.failures ?? 0).sort((a, b) => a - b);
    expect(ipCounts).toEqual([
      ...Array.from({ length: MAX_FAILURES }, (_, i) => i + 1),
      ...Array<number>(calls - MAX_FAILURES).fill(MAX_FAILURES),
    ]);
    const locked = { failures: MAX_FAILURES, windowStart: now, lockedUntil: new Date(now.getTime() + LOCK_MS) };
    const stored = await getAttempts(db, [ip, ...logins]);
    for (const key of [ip, ...logins]) expect(stored.get(key), key).toEqual(locked);
  });
});
