import type { Snapshot } from '../domain/api-types';
import type { FactorValues, Rating, Workload, WorkloadId } from '../domain/types';

const EMPTY: Snapshot = { generatedAt: '', asOf: '', workloads: [], ratings: [] };

// Typed through the glob so TypeScript never infers a type from the (large) JSON file.
const files = import.meta.glob<Snapshot>('./snapshot.json', { eager: true, import: 'default' });

/** Published rounds only. `npm run snapshot` refreshes it from the API; the deploy workflow runs that first. */
const SNAPSHOT = files['./snapshot.json'] ?? EMPTY;

export function getRatings(): Rating[] {
  return SNAPSHOT.ratings;
}

/** Workloads with at least one published rating. */
export function getWorkloads(): readonly Workload[] {
  return SNAPSHOT.workloads;
}

export function groupByWorkload<T>(items: readonly T[], workloadOf: (item: T) => WorkloadId): Map<WorkloadId, T[]> {
  const groups = new Map<WorkloadId, T[]>(SNAPSHOT.workloads.map((workload) => [workload.id, []]));
  for (const item of items) groups.get(workloadOf(item))?.push(item);
  return groups;
}

/** Publication date of the newest published round, or '' before the first one. */
export function asOfDate(): string {
  return SNAPSHOT.asOf;
}

/** Published averages per item id, used to prefill score sliders. */
export function currentValues(): Record<string, FactorValues> {
  return Object.fromEntries(SNAPSHOT.ratings.map((rating) => [rating.artifact.id, rating.current.scores]));
}
