import { describe, expect, it } from 'vitest';
import type { Db, Params } from '../lib/db.ts';
import { markSnapshotTaken } from './site.ts';

function recording(): { calls: { text: string; params: Params }[]; fake: Db } {
  const calls: { text: string; params: Params }[] = [];
  const fake: Db = {
    query<T>(text: string, params: Params = {}): Promise<T[]> {
      calls.push({ text, params });
      return Promise.resolve([]);
    },
  };
  return { calls, fake };
}

describe('markSnapshotTaken', () => {
  it('only ever moves the stamp forward, so a late confirmation of an older deploy changes nothing', async () => {
    const { calls, fake } = recording();
    const takenAt = new Date('2026-10-15T21:00:00.123Z');
    await markSnapshotTaken(fake, takenAt);
    expect(calls).toHaveLength(1);
    const text = calls[0]?.text.replace(/\s+/g, ' ');
    expect(text).toBe(
      'UPDATE site_state SET last_snapshot_at = @takenAt ' +
        'WHERE id = 1 AND (last_snapshot_at IS NULL OR last_snapshot_at < @takenAt)',
    );
    expect(calls[0]?.params).toEqual({ takenAt });
  });
});
