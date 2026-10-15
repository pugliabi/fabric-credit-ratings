import type { Snapshot } from '../../../src/domain/api-types.ts';
import { asOfDate, buildRatings } from '../../../src/domain/aggregate.ts';
import type { Artifact, RoundData, Workload } from '../../../src/domain/types.ts';

/** Published rounds only. Unscored items and workloads without a rated item are left out. */
export function buildSnapshot(
  workloads: readonly Workload[],
  artifacts: readonly Artifact[],
  rounds: readonly RoundData[],
  now: Date,
): Snapshot {
  const ratings = buildRatings(artifacts, rounds);
  const rated = new Set(ratings.map((rating) => rating.artifact.workload));
  return {
    generatedAt: now.toISOString(),
    asOf: asOfDate(rounds),
    workloads: workloads.filter((workload) => rated.has(workload.id)),
    ratings,
  };
}
