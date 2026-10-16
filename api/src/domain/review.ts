import type { ChangeKind, ReviewItem, RoundReview } from '../../../src/domain/api-types.ts';
import { pointFor, previousPoint } from '../../../src/domain/aggregate.ts';
import { notchDelta } from '../../../src/domain/grades.ts';
import type { RatingPoint } from '../../../src/domain/types.ts';
import { pluralize } from '../../../src/lib/format.ts';
import type { Dataset } from './dataset.ts';

export function changeLabel(point: RatingPoint, previous: RatingPoint | undefined): { kind: ChangeKind; text: string } {
  if (!previous) return { kind: 'new', text: 'First rating' };
  const delta = notchDelta(previous.grade, point.grade);
  const from = `from ${previous.grade} (${previous.roundLabel})`;
  if (delta > 0) return { kind: 'up', text: `Up ${pluralize(delta, 'notch', 'notches')} ${from}` };
  if (delta < 0) return { kind: 'down', text: `Down ${pluralize(-delta, 'notch', 'notches')} ${from}` };
  return { kind: 'same', text: `Unchanged ${from}` };
}

/** Everything the admin Review tab shows for one round. Open rounds are dated `today`. */
export function buildReview(data: Dataset, roundId: string, today: string, aiEnabled: boolean): RoundReview | undefined {
  const target = data.rounds.find((item) => item.round.id === roundId);
  if (!target) return undefined;
  const date = target.round.publishedOn ?? today;
  const rater = (id: string) => ({ userId: Number(id), name: data.raterNames.get(Number(id)) ?? id });
  const items = data.artifacts.flatMap((artifact): ReviewItem[] => {
    const point = pointFor(artifact, target, date);
    if (!point) return [];
    const previous = previousPoint(artifact, data.rounds, roundId);
    const breakdown = target.scorecards.flatMap((card) => {
      const scores = card.scores[artifact.id];
      return scores ? [{ ...rater(card.rater), scores }] : [];
    });
    return [{ artifact, point, previous: previous ?? null, change: changeLabel(point, previous), breakdown }];
  });
  return {
    round: target.round,
    raters: target.scorecards.map((card) => rater(card.rater)),
    items,
    notes: target.notes,
    aiEnabled,
  };
}
