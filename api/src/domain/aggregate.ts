import { FACTORS } from '../../../src/data/factors.ts';
import { DEPRECATED_GRADE, MIN_TOTAL, gradeForTotal, weightedUnits } from './formula.ts';
import type {
  Artifact,
  FactorId,
  FactorValues,
  PublicRatingPoint,
  Rating,
  RatingPoint,
  RoundData,
  ScoreTuple,
} from '../../../src/domain/types.ts';

/** Position of each factor inside a ScoreTuple. */
export const FACTOR_ORDER: readonly FactorId[] = FACTORS.map((factor) => factor.id);

function roundTo1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function tuplesFor(artifactId: string, data: RoundData): ScoreTuple[] {
  return data.scorecards.flatMap((card) => {
    const tuple = card.scores[artifactId];
    return tuple ? [tuple] : [];
  });
}

/** Mean per factor, rounded to one decimal for display. */
export function averageScores(tuples: readonly ScoreTuple[], artifact: Pick<Artifact, 'naFactors'>): FactorValues {
  const values = {} as FactorValues;
  FACTOR_ORDER.forEach((id, i) => {
    if (artifact.naFactors.includes(id)) {
      values[id] = null;
      return;
    }
    // A null in an applicable position (a row written before the flag was cleared) is skipped.
    const given = tuples.flatMap((tuple) => {
      const value = tuple[i];
      return value === null || value === undefined ? [] : [value];
    });
    values[id] = given.length === 0 ? null : roundTo1(given.reduce((acc, value) => acc + value, 0) / given.length);
  });
  return values;
}

/** Grade from the unrounded mean of each rater's weighted total, so display rounding never moves a notch. */
export function gradeForTuples(artifact: Artifact, tuples: readonly ScoreTuple[]): RatingPoint['grade'] {
  if (artifact.status === 'retired') return DEPRECATED_GRADE;
  // Integer units summed first, one division at the end: an exact x.5 mean stays exactly x.5.
  let units = 0;
  let weight = 0;
  for (const tuple of tuples) {
    const values = {} as FactorValues;
    FACTOR_ORDER.forEach((id, i) => {
      values[id] = artifact.naFactors.includes(id) ? null : (tuple[i] ?? null);
    });
    const part = weightedUnits(values);
    units += part.units;
    weight += part.weight;
  }
  return gradeForTotal(weight === 0 ? MIN_TOTAL : (3 * units) / weight);
}

export function pointFor(artifact: Artifact, data: RoundData, date: string): RatingPoint | undefined {
  const tuples = tuplesFor(artifact.id, data);
  if (tuples.length === 0) return undefined;
  return {
    round: data.round.id,
    roundLabel: data.round.label,
    date,
    scores: averageScores(tuples, artifact),
    raters: tuples.length,
    grade: gradeForTuples(artifact, tuples),
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
    const history = published.flatMap((data): PublicRatingPoint[] => {
      const point = pointFor(artifact, data, data.round.publishedOn ?? '');
      if (!point) return [];
      // The public site never says how many people rated an item.
      const { raters: _raters, ...shown } = point;
      return [shown];
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
