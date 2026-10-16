import { WITHDRAWN_GRADE, gradeForTotal } from './formula.ts';
import type { Artifact, FactorId, FactorValues, Rating, RatingPoint, RoundData, ScoreTriple } from '../../../src/domain/types.ts';

/** Position of each factor inside a ScoreTriple. */
export const FACTOR_ORDER: readonly FactorId[] = ['capability', 'ux', 'cost'];

function roundTo1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function triplesFor(artifactId: string, data: RoundData): ScoreTriple[] {
  return data.scorecards.flatMap((card) => {
    const triple = card.scores[artifactId];
    return triple ? [triple] : [];
  });
}

/** Mean per factor, rounded to one decimal for display. */
export function averageScores(triples: readonly ScoreTriple[]): FactorValues {
  const values = {} as FactorValues;
  FACTOR_ORDER.forEach((id, i) => {
    const sum = triples.reduce((acc, triple) => acc + (triple[i] ?? 0), 0);
    values[id] = roundTo1(sum / triples.length);
  });
  return values;
}

/** Grade from the unrounded mean total, so display rounding never moves a notch. */
export function gradeForTriples(artifact: Artifact, triples: readonly ScoreTriple[]): RatingPoint['grade'] {
  if (artifact.status === 'retired') return WITHDRAWN_GRADE;
  const meanTotal = triples.reduce((acc, [c, u, k]) => acc + c + u + k, 0) / triples.length;
  return gradeForTotal(meanTotal);
}

export function pointFor(artifact: Artifact, data: RoundData, date: string): RatingPoint | undefined {
  const triples = triplesFor(artifact.id, data);
  if (triples.length === 0) return undefined;
  return {
    round: data.round.id,
    roundLabel: data.round.label,
    date,
    scores: averageScores(triples),
    raters: triples.length,
    grade: gradeForTriples(artifact, triples),
    note: data.notes[artifact.id] ?? '',
  };
}

/** Published rounds, oldest first. */
export function publishedRounds(rounds: readonly RoundData[]): RoundData[] {
  return rounds
    .filter((data) => data.round.status === 'published' && data.round.publishedOn)
    .sort(
      (a, b) =>
        (a.round.publishedOn ?? '').localeCompare(b.round.publishedOn ?? '') || a.round.id.localeCompare(b.round.id),
    );
}

/**
 * The artifact's rating from the newest published round before `roundId`.
 * For an open round that is simply its current published rating.
 */
export function previousPoint(
  artifact: Artifact,
  rounds: readonly RoundData[],
  roundId: string,
): RatingPoint | undefined {
  const published = publishedRounds(rounds);
  const index = published.findIndex((data) => data.round.id === roundId);
  const earlier = index === -1 ? published : published.slice(0, index);
  for (let i = earlier.length - 1; i >= 0; i -= 1) {
    const data = earlier[i];
    const point = data && pointFor(artifact, data, data.round.publishedOn ?? '');
    if (point) return point;
  }
  return undefined;
}

/**
 * One history point per published round that scored the artifact. The newest
 * point is current, so an artifact skipped in a round keeps its last rating.
 */
export function buildRatings(artifacts: readonly Artifact[], rounds: readonly RoundData[]): Rating[] {
  const published = publishedRounds(rounds);
  const ratings: Rating[] = [];
  for (const artifact of artifacts) {
    const history = published.flatMap((data) => {
      const point = pointFor(artifact, data, data.round.publishedOn ?? '');
      return point ? [point] : [];
    });
    const current = history.at(-1);
    if (current) ratings.push({ artifact, current, history });
  }
  return ratings;
}

/** Publication date of the newest published round, or '' before the first one. */
export function asOfDate(rounds: readonly RoundData[]): string {
  return publishedRounds(rounds).at(-1)?.round.publishedOn ?? '';
}
