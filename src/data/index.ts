import { asOfDate as roundsAsOf, buildRatings, findUnrated } from '../domain/aggregate';
import type {
  Artifact,
  FactorValues,
  Rating,
  Round,
  RoundData,
  RoundNotes,
  Scorecard,
  Workload,
  WorkloadId,
} from '../domain/types';
import { ARTIFACTS } from './artifacts';
import { WORKLOADS } from './workloads';

const roundFiles = import.meta.glob<Round>('./rounds/*/round.json', { eager: true, import: 'default' });
const noteFiles = import.meta.glob<RoundNotes>('./rounds/*/notes.json', { eager: true, import: 'default' });
const scoreFiles = import.meta.glob<Scorecard>('./rounds/*/scores/*.json', { eager: true, import: 'default' });

/** './rounds/2026-Q4/scores/pugliabi.json' -> '2026-Q4' */
function folderOf(path: string): string {
  return path.split('/')[2] ?? '';
}

export const ROUNDS: readonly RoundData[] = Object.entries(roundFiles).map(([path, round]) => {
  const folder = folderOf(path);
  return {
    round,
    notes: noteFiles[`./rounds/${folder}/notes.json`] ?? {},
    scorecards: Object.entries(scoreFiles)
      .filter(([scorePath]) => folderOf(scorePath) === folder)
      .map(([, card]) => card),
  };
});

/** The round raters can currently submit to, if any. */
export function openRound(): Round | undefined {
  return ROUNDS.find((data) => data.round.status === 'open')?.round;
}

export function getRatings(): Rating[] {
  return buildRatings(ARTIFACTS, ROUNDS);
}

export function getUnrated(ratings: readonly Rating[]): Artifact[] {
  return findUnrated(ARTIFACTS, ratings);
}

export function getWorkloads(): readonly Workload[] {
  return WORKLOADS;
}

export function groupByWorkload<T>(items: readonly T[], workloadOf: (item: T) => WorkloadId): Map<WorkloadId, T[]> {
  const groups = new Map<WorkloadId, T[]>(WORKLOADS.map((w) => [w.id, []]));
  for (const item of items) groups.get(workloadOf(item))?.push(item);
  return groups;
}

/** Publication date of the newest published round. */
export function asOfDate(): string {
  return roundsAsOf(ROUNDS);
}

/** Published averages per item id, used to prefill score sliders. */
export function currentValues(): Record<string, FactorValues> {
  return Object.fromEntries(getRatings().map((rating) => [rating.artifact.id, rating.current.scores]));
}
