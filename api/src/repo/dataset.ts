import { assembleDataset, type Dataset } from '../domain/dataset.ts';
import type { Db } from '../lib/db.ts';
import { listArtifacts, listWorkloads } from './catalog.ts';
import { allNotes } from './notes.ts';
import { listRounds } from './rounds.ts';
import { allScores } from './scores.ts';

export async function loadDataset(db: Db): Promise<Dataset> {
  const [workloads, artifacts, rounds, scores, notes] = await Promise.all([
    listWorkloads(db),
    listArtifacts(db),
    listRounds(db),
    allScores(db),
    allNotes(db),
  ]);
  return assembleDataset(workloads, artifacts, rounds, scores, notes);
}
