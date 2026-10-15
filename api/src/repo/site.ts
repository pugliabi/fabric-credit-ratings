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

/** Call after any change the public site would show: publish, reopen, published edits, catalog edits. */
export async function markChanged(db: Db): Promise<void> {
  await db.query('UPDATE site_state SET changed_at = SYSUTCDATETIME() WHERE id = 1');
}

/** Pass the time read before loading the dataset, so a change made during the build still shows as behind. */
export async function markSnapshotTaken(db: Db, takenAt: Date): Promise<void> {
  await db.query('UPDATE site_state SET last_snapshot_at = @takenAt WHERE id = 1', { takenAt });
}
