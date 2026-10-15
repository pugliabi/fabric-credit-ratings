import type { Db } from '../lib/db.ts';

export interface SiteState {
  lastSnapshotAt: Date | null;
  changedAt: Date | null;
}

export async function siteState(db: Db): Promise<SiteState> {
  const [row] = await db.query<SiteState>(
    'SELECT last_snapshot_at AS lastSnapshotAt, changed_at AS changedAt FROM site_state WHERE id = 1',
  );
  return row ?? { lastSnapshotAt: null, changedAt: null };
}

export function isBehind(state: SiteState): boolean {
  if (!state.lastSnapshotAt) return true;
  return state.changedAt !== null && state.changedAt > state.lastSnapshotAt;
}

/**
 * Call inside the same transaction as any change the public site would show: publish, reopen, published edits, catalog
 * edits.
 */
export async function markChanged(db: Db): Promise<void> {
  await db.query('UPDATE site_state SET changed_at = SYSUTCDATETIME() WHERE id = 1');
}

/**
 * Call once the site built from a snapshot is live, with that snapshot's generatedAt: the database time read before
 * its dataset was loaded, so a change made during the build still shows as behind. Never moves the stamp back, so a
 * late confirmation of an older deploy doesn't undo a newer one's.
 */
export async function markSnapshotTaken(db: Db, takenAt: Date): Promise<void> {
  await db.query(
    `UPDATE site_state SET last_snapshot_at = @takenAt
     WHERE id = 1 AND (last_snapshot_at IS NULL OR last_snapshot_at < @takenAt)`,
    { takenAt },
  );
}
