import { gradeFor, totalOf } from '../domain/scale';
import type { Artifact, Rating, RatingPoint, Submission, Workload, WorkloadId } from '../domain/types';
import { ARTIFACTS } from './artifacts';
import { SUBMISSIONS } from './submissions.mock';
import { WORKLOADS } from './workloads';

function toPoint(submission: Submission): RatingPoint {
  return {
    date: submission.date,
    scores: submission.scores,
    total: totalOf(submission.scores),
    grade: gradeFor(submission.scores, submission.flag),
    outlook: submission.outlook,
    note: submission.note,
    flag: submission.flag,
  };
}

export function buildRatings(artifacts: readonly Artifact[], submissions: readonly Submission[]): Rating[] {
  const byArtifact = new Map<string, Submission[]>();
  for (const submission of submissions) {
    const list = byArtifact.get(submission.artifactId) ?? [];
    list.push(submission);
    byArtifact.set(submission.artifactId, list);
  }

  const ratings: Rating[] = [];
  for (const artifact of artifacts) {
    const entries = (byArtifact.get(artifact.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    const latest = entries.at(-1);
    if (!latest) continue;
    ratings.push({
      artifact,
      current: toPoint(latest),
      upside: latest.upside ?? [],
      downside: latest.downside ?? [],
      history: entries.map(toPoint),
    });
  }
  return ratings;
}

export function getRatings(): Rating[] {
  return buildRatings(ARTIFACTS, SUBMISSIONS);
}

export function getWorkloads(): readonly Workload[] {
  return WORKLOADS;
}

export function groupByWorkload(ratings: Rating[]): Map<WorkloadId, Rating[]> {
  const groups = new Map<WorkloadId, Rating[]>(WORKLOADS.map((w) => [w.id, []]));
  for (const rating of ratings) groups.get(rating.artifact.workload)?.push(rating);
  return groups;
}

/** Most recent submission date across all artifacts. */
export function asOfDate(ratings: Rating[]): string {
  return ratings.reduce((latest, r) => (r.current.date > latest ? r.current.date : latest), '');
}
