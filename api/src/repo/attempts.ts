import { transaction, type Db, type Param } from '../lib/db.ts';
import { afterFailure, type AttemptRow } from '../lib/lockout.ts';

// mssql sends strings as nvarchar. Compared with the varchar key under this database's SQL collation, that converts
// the column and scans the table, so every key goes in as varchar to let the primary key seek and lock only its key.
const varchar = (name: string) => `CAST(@${name} AS varchar(100))`;

export async function getAttempts(db: Db, keys: readonly string[]): Promise<Map<string, AttemptRow>> {
  if (keys.length === 0) return new Map();
  const params: Record<string, Param> = {};
  const names = keys.map((key, i) => {
    params[`k${i}`] = key;
    return varchar(`k${i}`);
  });
  const rows = await db.query<AttemptRow & { attemptKey: string }>(
    `SELECT attempt_key AS attemptKey, failures, window_start AS windowStart, locked_until AS lockedUntil
     FROM login_attempts WHERE attempt_key IN (${names.join(', ')})`,
    params,
  );
  return new Map(rows.map(({ attemptKey, ...row }) => [attemptKey, row]));
}

/**
 * Counts one failed login against every key and returns the new rows. Each key's read holds UPDLOCK, HOLDLOCK until
 * the commit, even for a key with no row yet, so parallel failures on a key wait for each other instead of
 * overwriting each other's count. Keys are locked in sorted order so overlapping calls cannot deadlock.
 */
export async function recordFailures(keys: readonly string[], now: Date): Promise<Map<string, AttemptRow>> {
  return transaction(async (tx) => {
    const next = new Map<string, AttemptRow>();
    for (const key of [...new Set(keys)].sort()) {
      const [current] = await tx.query<AttemptRow>(
        `SELECT failures, window_start AS windowStart, locked_until AS lockedUntil
         FROM login_attempts WITH (UPDLOCK, HOLDLOCK) WHERE attempt_key = ${varchar('key')}`,
        { key },
      );
      const row = afterFailure(current, now);
      await tx.query(
        `MERGE login_attempts AS t
         USING (SELECT ${varchar('key')} AS attempt_key) AS s ON t.attempt_key = s.attempt_key
         WHEN MATCHED THEN UPDATE SET failures = @failures, window_start = @windowStart, locked_until = @lockedUntil
         WHEN NOT MATCHED THEN INSERT (attempt_key, failures, window_start, locked_until)
           VALUES (s.attempt_key, @failures, @windowStart, @lockedUntil);`,
        { key, failures: row.failures, windowStart: row.windowStart, lockedUntil: row.lockedUntil },
      );
      next.set(key, row);
    }
    return next;
  });
}

export async function clearAttempt(db: Db, key: string): Promise<void> {
  await db.query(`DELETE FROM login_attempts WHERE attempt_key = ${varchar('key')}`, { key });
}
