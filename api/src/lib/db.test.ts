import sql from 'mssql';
import { TimeoutError as PoolTimeoutError } from 'tarn';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  DatabaseUnavailableError,
  closeDb,
  db,
  isConnectionError,
  sqlErrorNumber,
  transaction,
  varchar,
  type Db,
} from './db.ts';

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class {
    getToken() {
      return Promise.resolve({ token: 'unit-test', expiresOnTimestamp: Date.now() + 60 * 60_000 });
    }
  },
}));

// The members these tests stub. The mssql typings overload them with callback forms that vi.spyOn can't follow.
interface PoolMembers {
  connect(): Promise<unknown>;
  readonly connected: boolean;
}
interface RequestMembers {
  query(text: string): Promise<{ recordset: unknown[] }>;
}
interface TransactionMembers {
  begin(): Promise<unknown>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

const pools = sql.ConnectionPool.prototype as unknown as PoolMembers;
const requests = sql.Request.prototype as unknown as RequestMembers;
const transactions = sql.Transaction.prototype as unknown as TransactionMembers;

const noConnection = () => new sql.ConnectionError('Failed to connect in 30000ms.', 'ETIMEOUT');

let connect: Mock<PoolMembers['connect']>;
let query: Mock<RequestMembers['query']>;
let begin: Mock<TransactionMembers['begin']>;
let commit: Mock<TransactionMembers['commit']>;
let rollback: Mock<TransactionMembers['rollback']>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('SQL_SERVER', 'unit-test.invalid');
  vi.stubEnv('SQL_DATABASE', 'unit-test');
  connect = vi.spyOn(pools, 'connect').mockResolvedValue(undefined);
  vi.spyOn(pools, 'connected', 'get').mockReturnValue(true);
  query = vi.spyOn(requests, 'query').mockResolvedValue({ recordset: [] });
  begin = vi.spyOn(transactions, 'begin').mockResolvedValue(undefined);
  commit = vi.spyOn(transactions, 'commit').mockResolvedValue(undefined);
  rollback = vi.spyOn(transactions, 'rollback').mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await closeDb();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('db.query', () => {
  it('retries a warm pool that cannot get a connection, then succeeds', async () => {
    await db.query('SELECT 1');
    query.mockClear();
    query.mockRejectedValueOnce(noConnection());
    const started = Date.now();
    const outcome = db.query('SELECT 1').catch((failure: unknown) => failure);
    await vi.runAllTimersAsync();
    expect(await outcome).toEqual([]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBe(2_000);
  });

  it('retries when the pool timed out waiting for a connection', async () => {
    await db.query('SELECT 1');
    query.mockClear();
    query.mockRejectedValueOnce(new PoolTimeoutError('operation timed out for an unknown reason'));
    const outcome = db.query('SELECT 1').catch((failure: unknown) => failure);
    await vi.runAllTimersAsync();
    expect(await outcome).toEqual([]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('reports a pool acquire timeout as a connection error', () => {
    expect(isConnectionError(new PoolTimeoutError())).toBe(true);
  });

  it('does not retry a statement the server rejected', async () => {
    const error = new sql.RequestError("Invalid object name 'dbo.nope'.", 'EREQUEST');
    query.mockRejectedValue(error);
    const outcome = db.query('SELECT 1 FROM dbo.nope').catch((failure: unknown) => failure);
    await vi.runAllTimersAsync();
    expect(await outcome).toBe(error);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry delays run out', async () => {
    await db.query('SELECT 1');
    query.mockClear();
    const error = noConnection();
    query.mockRejectedValue(error);
    const started = Date.now();
    const outcome = db.query('SELECT 1').catch((failure: unknown) => failure);
    await vi.runAllTimersAsync();
    expect(await outcome).toBe(error);
    expect(query).toHaveBeenCalledTimes(4);
    expect(Date.now() - started).toBe(17_000);
  });

  it('stops retrying once another attempt could run past the wait budget', async () => {
    const error = noConnection();
    query.mockRejectedValueOnce(error).mockImplementationOnce(() => {
      vi.setSystemTime(Date.now() + 120_000);
      return Promise.reject(error);
    });
    const outcome = db.query('SELECT 1').catch((failure: unknown) => failure);
    await vi.runAllTimersAsync();
    expect(await outcome).toBe(error);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('reports a database that never answers as unavailable without retrying again', async () => {
    const last = noConnection();
    connect.mockRejectedValue(last);
    const outcome = db.query('SELECT 1').catch((failure: unknown) => failure);
    await vi.runAllTimersAsync();
    const error = await outcome;
    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect(error).toMatchObject({ name: 'DatabaseUnavailableError', cause: last });
    expect(isConnectionError(error)).toBe(true);
    expect(connect).toHaveBeenCalledTimes(4);
    expect(query).not.toHaveBeenCalled();
  });

  it('listens for pool errors before connecting', async () => {
    let listeners = -1;
    connect.mockImplementation(function (this: sql.ConnectionPool) {
      listeners = this.listenerCount('error');
      return Promise.resolve(this);
    });
    await db.query('SELECT 1');
    expect(listeners).toBe(1);
  });

  it('gives a stalled login time to fail as ETIMEOUT before the pool times out the acquire', async () => {
    let config: sql.config | undefined;
    connect.mockImplementation(function (this: sql.ConnectionPool) {
      config = (this as unknown as { config: sql.config }).config;
      return Promise.resolve(this);
    });
    await db.query('SELECT 1');
    // 15 s is mssql's default connectionTimeout.
    const connectTimeout = config?.connectionTimeout ?? 15_000;
    expect(config?.pool?.acquireTimeoutMillis).toBeGreaterThan(connectTimeout);
    expect(config?.pool?.createTimeoutMillis).toBeGreaterThan(connectTimeout);
  });

  it('binds dates as datetime2, text as fixed-length nvarchar, and varchar() values as varchar', async () => {
    const at = new Date('2026-10-15T12:00:00.123Z');
    const essay = 'x'.repeat(4_001);
    const longKey = 'k'.repeat(8_001);
    await db.query('SELECT 1', {
      at,
      label: 'Round 1',
      essay,
      key: varchar('2026-q3'),
      longKey: varchar(longKey),
      none: varchar(null),
      count: 3,
    });
    const { parameters } = query.mock.contexts[0] as sql.Request;
    expect(parameters.at).toMatchObject({ type: sql.DateTime2, value: at });
    expect(parameters.label).toMatchObject({ type: sql.NVarChar, length: 4_000, value: 'Round 1' });
    expect(parameters.essay).toMatchObject({ type: sql.NVarChar, length: sql.MAX, value: essay });
    expect(parameters.key).toMatchObject({ type: sql.VarChar, length: 8_000, value: '2026-q3' });
    expect(parameters.longKey).toMatchObject({ type: sql.VarChar, length: sql.MAX, value: longKey });
    expect(parameters.none).toMatchObject({ type: sql.VarChar, length: 8_000, value: null });
    expect(parameters.count?.type).toBe(sql.Int);
  });

  it('binds varchar() values as varchar inside a transaction too', async () => {
    await transaction((tx) => tx.query('SELECT 1', { key: varchar('2026-q3'), label: 'Round 1' }));
    const { parameters } = query.mock.contexts[0] as sql.Request;
    expect(parameters.key).toMatchObject({ type: sql.VarChar, length: 8_000, value: '2026-q3' });
    expect(parameters.label).toMatchObject({ type: sql.NVarChar, length: 4_000, value: 'Round 1' });
  });
});

describe('sqlErrorNumber', () => {
  const driverError = (number: number) => Object.assign(new Error(`Server error ${number}.`), { info: { number } });

  it("reads the server's number from mssql's RequestError and from the driver's own error", () => {
    expect(sqlErrorNumber(new sql.RequestError(driverError(2627)))).toBe(2627);
    expect(sqlErrorNumber({ originalError: driverError(1205) })).toBe(1205);
  });

  it('reads it through the error mssql raises for a transaction the server aborted', () => {
    const aborted = new sql.TransactionError('Transaction has been aborted.', 'EABORT');
    Object.defineProperty(aborted, 'originalError', { value: new sql.RequestError(driverError(1205)) });
    expect(sqlErrorNumber(aborted)).toBe(1205);
  });

  it('is undefined for anything without one', () => {
    for (const error of [undefined, null, 'EREQUEST', 1205, new Error('plain'), { number: '1205' }]) {
      expect(sqlErrorNumber(error)).toBeUndefined();
    }
  });
});

describe('transaction', () => {
  it('runs queries one at a time and rolls back only after they settle', async () => {
    let active = 0;
    let peak = 0;
    let activeAtRollback = -1;
    query.mockImplementation(async (text) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 100));
      active -= 1;
      if (text === 'FAIL') throw new sql.RequestError('The statement failed.', 'EREQUEST');
      return { recordset: [] };
    });
    rollback.mockImplementation(() => {
      activeAtRollback = active;
      return Promise.resolve();
    });
    const outcome = transaction((tx) => Promise.all([tx.query('FAIL'), tx.query('SELECT 1')])).catch(
      (failure: unknown) => failure,
    );
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ message: 'The statement failed.' });
    expect(peak).toBe(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(activeAtRollback).toBe(0);
    expect(commit).not.toHaveBeenCalled();
  });

  it('retries begin when no connection could be acquired', async () => {
    begin.mockRejectedValueOnce(noConnection());
    const outcome = transaction((tx) => tx.query('SELECT 1')).catch((failure: unknown) => failure);
    await vi.runAllTimersAsync();
    expect(await outcome).toEqual([]);
    expect(begin).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('does not retry a begin the server may have started', async () => {
    const error = new sql.TransactionError('Failed to begin the transaction.', 'EREQUEST');
    begin.mockRejectedValue(error);
    const work = vi.fn((tx: Db) => tx.query('SELECT 1'));
    const outcome = transaction(work).catch((failure: unknown) => failure);
    await vi.runAllTimersAsync();
    expect(await outcome).toBe(error);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(work).not.toHaveBeenCalled();
  });

  it('does not run the work again when one of its queries loses the connection', async () => {
    const error = new sql.ConnectionError('Connection is closed.', 'ECONNCLOSED');
    query.mockRejectedValueOnce(error);
    const work = vi.fn((tx: Db) => tx.query('SELECT 1'));
    const outcome = transaction(work).catch((failure: unknown) => failure);
    await vi.runAllTimersAsync();
    expect(await outcome).toBe(error);
    expect(work).toHaveBeenCalledTimes(1);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits only after a query the work did not await settles', async () => {
    let active = 0;
    let activeAtCommit = -1;
    query.mockImplementation(async () => {
      active += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      active -= 1;
      return { recordset: [] };
    });
    commit.mockImplementation(() => {
      activeAtCommit = active;
      return Promise.resolve();
    });
    const outcome = transaction((tx) => {
      void tx.query('SELECT 1');
      return Promise.resolve('done');
    });
    await vi.runAllTimersAsync();
    expect(await outcome).toBe('done');
    expect(query).toHaveBeenCalledTimes(1);
    expect(activeAtCommit).toBe(0);
  });

  describe('a query chained from another while the transaction drains', () => {
    let log: string[];
    const scopes: Db[] = [];

    beforeEach(() => {
      log = [];
      scopes.length = 0;
      query.mockImplementation(async (text) => {
        log.push(`start ${text}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
        log.push(`end ${text}`);
        if (text === 'FAIL') throw new sql.RequestError('The statement failed.', 'EREQUEST');
        return { recordset: [] };
      });
      commit.mockImplementation(() => {
        log.push('commit');
        return Promise.resolve();
      });
      rollback.mockImplementation(() => {
        log.push('rollback');
        return Promise.resolve();
      });
    });

    async function expectEnded(): Promise<void> {
      const [tx] = scopes;
      await expect(tx?.query('LATE')).rejects.toThrow('The transaction has already ended.');
      expect(log).not.toContain('start LATE');
    }

    it('runs before the rollback', async () => {
      const outcome = transaction((tx) => {
        scopes.push(tx);
        return Promise.all([tx.query('FAIL'), tx.query('B').then(() => tx.query('C'))]);
      }).catch((failure: unknown) => failure);
      await vi.runAllTimersAsync();
      expect(await outcome).toMatchObject({ message: 'The statement failed.' });
      expect(log).toEqual(['start FAIL', 'end FAIL', 'start B', 'end B', 'start C', 'end C', 'rollback']);
      await expectEnded();
    });

    it('runs before the commit', async () => {
      const outcome = transaction((tx) => {
        scopes.push(tx);
        void tx.query('B').then(() => tx.query('C'));
        return Promise.resolve('done');
      });
      await vi.runAllTimersAsync();
      expect(await outcome).toBe('done');
      expect(log).toEqual(['start B', 'end B', 'start C', 'end C', 'commit']);
      await expectEnded();
    });
  });
});
