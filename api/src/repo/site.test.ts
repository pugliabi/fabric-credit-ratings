import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, db, transaction, type Db, type Params } from '../lib/db.ts';
import { useDevTarget } from '../test-target.ts';
import { isBehind, markChanged, markSnapshotTaken } from './site.ts';

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

describe('markChanged', () => {
  it('stamps twice in one batch, so the stamp that counts is taken after the row lock is held', async () => {
    const { calls, fake } = recording();
    await markChanged(fake);
    expect(calls).toHaveLength(1);
    const statements = calls[0]?.text
      .split(';')
      .map((statement) => statement.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const stamp = 'UPDATE site_state SET changed_at = SYSUTCDATETIME() WHERE id = 1';
    expect(statements).toEqual([stamp, stamp]);
    expect(calls[0]?.params).toEqual({});
  });
});

describe('isBehind', () => {
  const snapshot = new Date('2026-10-15T21:00:00.123Z');
  const at = (ms: number) => new Date(snapshot.getTime() + ms);

  it('is behind until a snapshot has been deployed', () => {
    expect(isBehind({ lastSnapshotAt: null, changedAt: null })).toBe(true);
    expect(isBehind({ lastSnapshotAt: null, changedAt: snapshot })).toBe(true);
  });

  it('is behind for a change after the snapshot, or in the same millisecond', () => {
    expect(isBehind({ lastSnapshotAt: snapshot, changedAt: at(1) })).toBe(true);
    expect(isBehind({ lastSnapshotAt: snapshot, changedAt: at(0) })).toBe(true);
  });

  it('is up to date with no change since the snapshot', () => {
    expect(isBehind({ lastSnapshotAt: snapshot, changedAt: at(-1) })).toBe(false);
    expect(isBehind({ lastSnapshotAt: snapshot, changedAt: null })).toBe(false);
  });
});

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

describe.skipIf(!process.env.FCR_DB_TESTS)('the site-changed stamp against the dev database', () => {
  beforeAll(() => {
    useDevTarget();
  });

  afterAll(async () => {
    await closeDb();
  });

  // Rolled back, so site_state is unchanged. It holds the row for 1 s, so a deploy's snapshot read then waits 1 s.
  it('holds back a locking clock read until the stamping transaction ends', { timeout: 120_000 }, async () => {
    const rollBack = new Error('Rolled back on purpose.');
    let read: Promise<unknown[]> | undefined;
    let settled = false;
    await transaction(async (tx) => {
      await markChanged(tx);
      // A plain read uses the row version, so it doesn't wait: that shows the hint below is what blocks. It also leaves
      // an open pooled connection, so the locking read isn't held up by a fresh login instead.
      expect(await db.query('SELECT changed_at FROM site_state WHERE id = 1')).toHaveLength(1);
      read = db
        .query('SELECT SYSUTCDATETIME() AS now FROM site_state WITH (READCOMMITTEDLOCK) WHERE id = 1')
        .finally(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(settled).toBe(false);
      throw rollBack;
    }).catch((error: unknown) => {
      if (error !== rollBack) throw error;
    });
    expect(await read).toHaveLength(1);
    expect(settled).toBe(true);
  });
});
