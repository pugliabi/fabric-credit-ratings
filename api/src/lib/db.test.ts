import sql from 'mssql';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DatabaseUnavailableError, closeDb, db, isConnectionError, transaction } from './db.ts';

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

  it('binds dates as datetime2 and leaves other types to mssql', async () => {
    const at = new Date('2026-10-15T12:00:00.123Z');
    await db.query('SELECT @at, @label', { at, label: 'Round 1' });
    const request = query.mock.contexts[0] as sql.Request;
    expect(request.parameters.at?.type).toBe(sql.DateTime2);
    expect(request.parameters.at?.value).toBe(at);
    expect(request.parameters.label?.type).toBe(sql.NVarChar);
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
});
