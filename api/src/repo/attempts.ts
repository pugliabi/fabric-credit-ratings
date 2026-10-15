import { sqlErrorNumber, transaction, varchar, type Db, type Param } from '../lib/db.ts';
import { MAX_FAILURES, afterFailure, isLocked, type AttemptRow } from '../lib/lockout.ts';

/** SQL Server's error number for the statement it rolled back to break a deadlock. */
const DEADLOCK_VICTIM = 1205;
const DEADLOCK_RETRIES = 2;

export async function getAttempts(db: Db, keys: readonly string[]): Promise<Map<string, AttemptRow>> {
  if (keys.length === 0) return new Map();
  const params: Record<string, Param> = {};
  const names = keys.map((key, i) => {
    params[`k${i}`] = varchar(key);
    return `@k${i}`;
  });
  const rows = await db.query<AttemptRow & { attemptKey: string }>(
    `SELECT attempt_key AS attemptKey, failures, window_start AS windowStart, locked_until AS lockedUntil
     FROM login_attempts WHERE attempt_key IN (${names.join(', ')})`,
    params,
  );
  return new Map(rows.map(({ attemptKey, ...row }) => [attemptKey, row]));
}

/**
 * Counts one login attempt against every key before the password is checked, unless a key is already locked: then it
 * counts nothing and returns `locked: true`. `rows` holds what was written, keyed by the caller's keys.
 *
 * Every key's read holds UPDLOCK, HOLDLOCK until the commit, even for a key with no row yet, and all reads finish
 * before any write, so parallel attempts on a key take turns and at most MAX_FAILURES of them get through a window.
 * Keys are locked in sorted order so overlapping calls cannot deadlock. That needs JS sort order to agree with the
 * column's collation for the keys of one call, which holds when they differ in prefix ("ip:", "login:") but not in
 * general. A deadlock victim is run again, at most twice.
 *
 * Opens its own transaction instead of taking a Db, because it must commit before the password check rather than
 * hold its locks across it.
 */
export async function reserveAttempt(
  keys: readonly string[],
  now: Date,
): Promise<{ locked: boolean; rows: Map<string, AttemptRow> }> {
  const sorted = [...new Set(keys)].sort();
  for (let retries = 0; ; retries += 1) {
    try {
      return await transaction(async (tx) => {
        const current: (AttemptRow | undefined)[] = [];
        for (const key of sorted) {
          const [row] = await tx.query<AttemptRow>(
            `SELECT failures, window_start AS windowStart, locked_until AS lockedUntil
             FROM login_attempts WITH (UPDLOCK, HOLDLOCK) WHERE attempt_key = @key`,
            { key: varchar(key) },
          );
          current.push(row);
        }
        if (current.some((row) => isLocked(row, now))) return { locked: true, rows: new Map<string, AttemptRow>() };
        const rows = new Map<string, AttemptRow>();
        for (const [i, key] of sorted.entries()) {
          const row = afterFailure(current[i], now);
          await tx.query(
            `MERGE login_attempts AS t
             USING (SELECT @key AS attempt_key) AS s ON t.attempt_key = s.attempt_key
             WHEN MATCHED THEN UPDATE SET failures = @failures, window_start = @windowStart, locked_until = @lockedUntil
             WHEN NOT MATCHED THEN INSERT (attempt_key, failures, window_start, locked_until)
               VALUES (s.attempt_key, @failures, @windowStart, @lockedUntil);`,
            { key: varchar(key), failures: row.failures, windowStart: row.windowStart, lockedUntil: row.lockedUntil },
          );
          rows.set(key, row);
        }
        return { locked: false, rows };
      });
    } catch (error) {
      if (retries >= DEADLOCK_RETRIES || sqlErrorNumber(error) !== DEADLOCK_VICTIM) throw error;
    }
  }
}

/**
 * Takes back one attempt reserveAttempt counted against `key`, and lifts the lock once the count is below
 * MAX_FAILURES. Matching window_start keeps it from taking a failure out of a newer window.
 */
export async function releaseAttempt(db: Db, key: string, reserved: AttemptRow): Promise<void> {
  await db.query(
    `UPDATE login_attempts
     SET failures = failures - 1, locked_until = CASE WHEN failures - 1 >= @max THEN locked_until END
     WHERE attempt_key = @key AND window_start = @windowStart AND failures > 0`,
    { key: varchar(key), windowStart: reserved.windowStart, max: MAX_FAILURES },
  );
}

export async function clearAttempt(db: Db, key: string): Promise<void> {
  await db.query('DELETE FROM login_attempts WHERE attempt_key = @key', { key: varchar(key) });
}
