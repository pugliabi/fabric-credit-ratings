export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60_000;
export const LOCK_MS = 15 * 60_000;

/** One row per key: "login:<login>" or "ip:<address>". */
export interface AttemptRow {
  failures: number;
  windowStart: Date;
  lockedUntil: Date | null;
}

export function isLocked(row: AttemptRow | undefined, now: Date): boolean {
  return row?.lockedUntil != null && row.lockedUntil.getTime() > now.getTime();
}

export function afterFailure(row: AttemptRow | undefined, now: Date): AttemptRow {
  if (row && isLocked(row, now)) return row;
  const inWindow = row !== undefined && now.getTime() - row.windowStart.getTime() < WINDOW_MS;
  const failures = inWindow ? row.failures + 1 : 1;
  return {
    failures,
    windowStart: inWindow ? row.windowStart : now,
    lockedUntil: failures >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MS) : null,
  };
}
