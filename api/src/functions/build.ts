import { buildSnapshot } from '../domain/snapshot.ts';
import { db } from '../lib/db.ts';
import { route } from '../lib/http.ts';
import { loadDataset } from '../repo/dataset.ts';
import { markSnapshotTaken } from '../repo/site.ts';

route('buildSnapshot', 'GET', 'build/snapshot', 'build', async () => {
  const takenAt = new Date();
  const data = await loadDataset(db);
  const snapshot = buildSnapshot(data.workloads, data.artifacts, data.rounds, takenAt);
  await markSnapshotTaken(db, takenAt);
  return snapshot;
});
