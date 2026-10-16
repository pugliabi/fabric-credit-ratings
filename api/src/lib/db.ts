import { DefaultAzureCredential } from '@azure/identity';
import sql from 'mssql';
import { TimeoutError as PoolTimeoutError } from 'tarn';

/** A string bound as varchar. Make one with varchar(). */
class Varchar {
  readonly value: string | null;
  constructor(value: string | null) {
    this.value = value;
  }
}
export type { Varchar };

export type Param = string | number | boolean | Date | null | Varchar;
export type Params = Readonly<Record<string, Param>>;

/**
 * For parameters compared with or written to varchar and char columns. A plain string binds as nvarchar, and under
 * this database's SQL collation comparing that with a varchar column converts the column: the lookup scans instead of
 * seeking, and inside a transaction it locks every row it reads. Keep plain strings for nvarchar columns, since
 * varchar can only hold code page 1252 characters.
 */
export function varchar(value: string | null): Varchar {
  return new Varchar(value);
}

export interface Db {
  query<T>(text: string, params?: Params): Promise<T[]>;
}

/** The database did not answer, even after retries. Fabric SQL databases pause when idle. */
export class DatabaseUnavailableError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DatabaseUnavailableError';
  }
}

const SCOPE = 'https://database.windows.net/.default';
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];
const CONNECT_TIMEOUT_MS = 30_000;
// Longer than CONNECT_TIMEOUT_MS so a stalled login fails as mssql's ConnectionError (ETIMEOUT), which keeps the real
// cause, rather than as tarn's acquire timeout, which carries none.
const ACQUIRE_TIMEOUT_MS = CONNECT_TIMEOUT_MS + 5_000;
// Keeps a request well inside the 230 s Functions HTTP timeout when a cold open() has already used its own retries.
const WAKE_RETRY_BUDGET_MS = 150_000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
const OLD_POOL_GRACE_MS = 60_000;
const CONNECTION_CODES = new Set(['ESOCKET', 'ECONNCLOSED', 'ETIMEOUT', 'ELOGIN', 'ENOTOPEN', 'EINSTLOOKUP']);

interface Connection {
  pool: sql.ConnectionPool;
  expiresAt: number;
}

let credential: DefaultAzureCredential | undefined;
let pending: Promise<Connection> | undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function target(): { server: string; database: string } {
  const server = process.env.SQL_SERVER?.trim();
  const database = process.env.SQL_DATABASE?.trim();
  if (!server || !database) {
    throw new Error('Set SQL_SERVER and SQL_DATABASE (api/local.settings.json locally, app settings in Azure).');
  }
  return { server, database };
}

async function open(): Promise<Connection> {
  const { server, database } = target();
  credential ??= new DefaultAzureCredential();
  // Token problems (not signed in, no identity) are not retryable, so they fail fast as plain errors.
  const token = await credential.getToken(SCOPE);
  let lastError: unknown;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const pool = new sql.ConnectionPool({
        server,
        database,
        port: 1433,
        options: { encrypt: true, trustServerCertificate: false },
        authentication: { type: 'azure-active-directory-access-token', options: { token: token.token } },
        pool: {
          max: 5,
          min: 0,
          idleTimeoutMillis: 30_000,
          acquireTimeoutMillis: ACQUIRE_TIMEOUT_MS,
          createTimeoutMillis: ACQUIRE_TIMEOUT_MS,
        },
        connectionTimeout: CONNECT_TIMEOUT_MS,
        requestTimeout: 30_000,
      });
      pool.on('error', (error: unknown) => console.error('SQL pool error', error));
      await pool.connect();
      return { pool, expiresAt: token.expiresOnTimestamp };
    } catch (error) {
      lastError = error;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await sleep(delay);
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new DatabaseUnavailableError(message, { cause: lastError });
}

function retire(pool: sql.ConnectionPool): void {
  setTimeout(() => void pool.close().catch(() => undefined), OLD_POOL_GRACE_MS).unref();
}

/**
 * One pool per process, rebuilt shortly before its Entra token expires or after opening it failed. A pool stays
 * `connected` when the server goes away (a paused database, a dropped socket); it replaces dead connections on the
 * next acquire, and withWakeRetry waits for the database to come back.
 */
async function getPool(): Promise<sql.ConnectionPool> {
  const current = pending;
  if (current) {
    const connection = await current.catch(() => undefined);
    if (connection?.pool.connected && Date.now() < connection.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return connection.pool;
    }
    if (pending === current) {
      pending = undefined;
      if (connection) retire(connection.pool);
    }
  }
  pending ??= open();
  return (await pending).pool;
}

/**
 * No connection was acquired, so the statement never reached the server: mssql's ConnectionError, or tarn timing out
 * the acquire (more callers than pool slots while the database stalls). tarn's error has no name or code.
 */
function acquireFailed(error: unknown): boolean {
  if (error instanceof PoolTimeoutError) return true;
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'ConnectionError';
}

/**
 * Retries `run` while no connection could be acquired, which is how a paused database looks to a warm process. Stops
 * once another attempt could end past WAKE_RETRY_BUDGET_MS, so a call whose cold open() already waited is not doubled.
 */
async function withWakeRetry<T>(run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !acquireFailed(error)) throw error;
      if (Date.now() - started + delay + ACQUIRE_TIMEOUT_MS > WAKE_RETRY_BUDGET_MS) throw error;
      await sleep(delay);
    }
  }
}

// tedious sizes a string parameter by its value, so every value length would compile and cache its own plan.
const fixedLength = (value: string | null, limit: number) => (value !== null && value.length > limit ? sql.MAX : limit);

function bind(request: sql.Request, params: Params): sql.Request {
  for (const [name, value] of Object.entries(params)) {
    // mssql binds a Date as legacy datetime by default, which rounds to 1/300 s.
    if (value instanceof Date) request.input(name, sql.DateTime2, value);
    else if (value instanceof Varchar) request.input(name, sql.VarChar(fixedLength(value.value, 8_000)), value.value);
    else if (typeof value === 'string') request.input(name, sql.NVarChar(fixedLength(value, 4_000)), value);
    else request.input(name, value);
  }
  return request;
}

export const db: Db = {
  query<T>(text: string, params: Params = {}): Promise<T[]> {
    return withWakeRetry(async () => {
      const pool = await getPool();
      const result = await bind(pool.request(), params).query<T>(text);
      return result.recordset ?? [];
    });
  },
};

/**
 * Runs `work` in one transaction. Its queries run one at a time, in the order they are called. Await every query: a
 * failure nobody awaits is not reported, and the transaction still commits.
 */
export async function transaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
  const tx = await withWakeRetry(async () => {
    const begun = new sql.Transaction(await getPool());
    await begun.begin();
    return begun;
  });
  let queue: Promise<unknown> = Promise.resolve();
  let ended = false;
  const scoped: Db = {
    query<R>(text: string, params: Params = {}): Promise<R[]> {
      if (ended) return Promise.reject(new Error('The transaction has already ended.'));
      const next = queue.then(async () => {
        const result = await bind(new sql.Request(tx), params).query<R>(text);
        return result.recordset ?? [];
      });
      queue = next.catch(() => undefined);
      return next;
    },
  };
  // mssql refuses to commit or roll back while a request is in flight; a failed rollback leaks the connection and
  // its locks. So both wait until the queue stops growing (a settling query can chain another), then refuse more.
  const finish = async () => {
    for (let tail: Promise<unknown> | undefined; tail !== queue; ) {
      tail = queue;
      await tail;
    }
    ended = true;
  };
  try {
    const value = await work(scoped);
    await finish();
    await tx.commit();
    return value;
  } catch (error) {
    await finish();
    await tx.rollback().catch(() => undefined);
    throw error;
  }
}

/**
 * The SQL Server error number on an mssql error. mssql copies it onto its RequestError, the driver's error keeps it
 * as number or under info, and the error for a transaction the server aborted wraps a RequestError, which can itself
 * wrap the driver's error: so this follows originalError a few levels. A string number is an mssql code, not SQL's.
 */
export function sqlErrorNumber(error: unknown): number | undefined {
  let current = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    const { number, info, originalError } = current as {
      number?: unknown;
      info?: { number?: unknown };
      originalError?: unknown;
    };
    if (typeof number === 'number') return number;
    if (typeof info?.number === 'number') return info.number;
    current = originalError;
  }
  return undefined;
}

/** SQL Server's error numbers for a duplicate key in a unique index or a primary key. */
export const DUPLICATE_KEY: readonly number[] = [2601, 2627];
/** SQL Server's error number for the statement it rolled back to break a deadlock. */
export const DEADLOCK_VICTIM: readonly number[] = [1205];
/**
 * SQL Server's error number for a statement a constraint refused. Every CHECK is validated before the write, so at run
 * time it means a foreign key: a row still points at what a delete removes, or a write points at a deleted row.
 */
export const CONSTRAINT_CONFLICT: readonly number[] = [547];

export function hasSqlNumber(error: unknown, numbers: readonly number[]): boolean {
  const number = sqlErrorNumber(error);
  return number !== undefined && numbers.includes(number);
}

export function isConnectionError(error: unknown): boolean {
  if (error instanceof DatabaseUnavailableError || error instanceof PoolTimeoutError) return true;
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'ConnectionError' || (typeof code === 'string' && CONNECTION_CODES.has(code));
}

/** For scripts: lets the process exit. */
export async function closeDb(): Promise<void> {
  const current = pending;
  pending = undefined;
  const connection = await current?.catch(() => undefined);
  await connection?.pool.close();
}
