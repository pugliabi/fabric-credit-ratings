import { buildSnapshot } from '../domain/snapshot.ts';
import { db } from '../lib/db.ts';
import { HttpError } from '../lib/errors.ts';
import { route } from '../lib/http.ts';
import { loadDataset } from '../repo/dataset.ts';
import { markSnapshotTaken } from '../repo/site.ts';

/** Slack for this host's clock running behind the database's, which dated the snapshot. */
const MAX_AHEAD_MS = 5 * 60_000;

function deployedAt(value: unknown): Date {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'generatedAt is required: send the generatedAt of the snapshot that was deployed.');
  }
  const at = new Date(value);
  if (Number.isNaN(at.getTime()) || at.toISOString() !== value) {
    throw new HttpError(
      400,
      'generatedAt must be an ISO timestamp exactly as the snapshot gave it, such as 2026-10-15T21:00:00.000Z.',
    );
  }
  if (at.getTime() > Date.now() + MAX_AHEAD_MS) {
    throw new HttpError(
      400,
      'generatedAt is more than 5 minutes in the future. Send the generatedAt of the snapshot that was deployed.',
    );
  }
  return at;
}

/**
 * Read-only: the deploy workflow confirms with build/snapshot/deployed once the site is live. generatedAt comes from
 * the database's clock, the one changed_at uses, read before the load starts, so any change the load could miss is
 * later than it.
 */
route('buildSnapshot', 'GET', 'build/snapshot', 'build', async () => {
  const [clock] = await db.query<{ now: Date }>('SELECT SYSUTCDATETIME() AS now');
  if (!clock) throw new Error('SYSUTCDATETIME() returned no row.');
  const data = await loadDataset(db);
  return buildSnapshot(data.workloads, data.artifacts, data.rounds, clock.now);
});

route('buildSnapshotDeployed', 'POST', 'build/snapshot/deployed', 'build', async (ctx) => {
  await markSnapshotTaken(db, deployedAt(ctx.body.generatedAt));
});
