import { describe, expect, it } from 'vitest';
import { LOCK_MS, MAX_FAILURES, WINDOW_MS, afterFailure, isLocked, type AttemptRow } from './lockout.ts';

const start = new Date('2026-10-15T12:00:00Z');
const at = (ms: number) => new Date(start.getTime() + ms);

/** One failure per second from `start`. */
function fail(times: number): AttemptRow | undefined {
  let row: AttemptRow | undefined;
  for (let i = 0; i < times; i += 1) row = afterFailure(row, at(i * 1000));
  return row;
}

describe('login lockout', () => {
  it('allows nine failures', () => {
    expect(isLocked(fail(MAX_FAILURES - 1), at(10_000))).toBe(false);
  });

  it('locks on the tenth failure for 15 minutes', () => {
    const row = fail(MAX_FAILURES);
    expect(isLocked(row, at(10_000))).toBe(true);
    expect(isLocked(row, at(9_000 + LOCK_MS + 1))).toBe(false);
  });

  it('starts a new window after 15 quiet minutes', () => {
    expect(afterFailure(fail(5), at(WINDOW_MS + 5_000)).failures).toBe(1);
  });

  it('never shortens an active lock', () => {
    const row = afterFailure(fail(MAX_FAILURES - 1), at(WINDOW_MS - 1_000));
    expect(isLocked(afterFailure(row, at(WINDOW_MS + 1_000)), at(WINDOW_MS + 2_000))).toBe(true);
  });

  it('treats a missing row as unlocked', () => {
    expect(isLocked(undefined, start)).toBe(false);
  });
});
