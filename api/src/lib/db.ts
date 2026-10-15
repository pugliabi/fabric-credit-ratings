import { DefaultAzureCredential } from '@azure/identity';
import sql from 'mssql';

export type Param = string | number | boolean | Date | null;
export type Params = Readonly<Record<string, Param>>;

export interface Db {
  query<T>(text: string, params?: Params): Promise<T[]>;
}

/** The database did not answer, even after retries. Fabric SQL databases pause when idle. */
export class DatabaseUnavailableError extends Error {}

const SCOPE = 'https://database.windows.net/.default';
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];
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
        pool: { max: 5, min: 0, idleTimeoutMillis: 30_000 },
        connectionTimeout: 30_000,
        requestTimeout: 30_000,
      });
      await pool.connect();
      return { pool, expiresAt: token.expiresOnTimestamp };
    } catch (error) {
      lastError = error;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await sleep(delay);
    }
  }
  throw new DatabaseUnavailableError(lastError instanceof Error ? lastError.message : String(lastError));
}

function retire(pool: sql.ConnectionPool): void {
  setTimeout(() => void pool.close().catch(() => undefined), OLD_POOL_GRACE_MS).unref();
}

/** One pool per process, rebuilt shortly before its Entra token expires or after it breaks. */
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

function bind(request: sql.Request, params: Params): sql.Request {
  for (const [name, value] of Object.entries(params)) request.input(name, value);
  return request;
}

export const db: Db = {
  async query<T>(text: string, params: Params = {}): Promise<T[]> {
    const pool = await getPool();
    const result = await bind(pool.request(), params).query<T>(text);
    return result.recordset ?? [];
  },
};

/** Runs `work` in one transaction. Queries inside must run one at a time. */
export async function transaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  const scoped: Db = {
    async query<R>(text: string, params: Params = {}): Promise<R[]> {
      const result = await bind(new sql.Request(tx), params).query<R>(text);
      return result.recordset ?? [];
    },
  };
  try {
    const value = await work(scoped);
    await tx.commit();
    return value;
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  }
}

export function isConnectionError(error: unknown): boolean {
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
