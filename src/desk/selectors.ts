import { ARTIFACTS } from '../data/artifacts';
import { buildRatings, publishedRounds } from '../domain/aggregate';
import { notchDelta } from '../domain/scale';
import type { FactorValues, RatingPoint, RoundData, ScoreTriple } from '../domain/types';
import { pluralize } from '../lib/format';

/** Current published values per artifact id. */
export function currentValues(rounds: readonly RoundData[]): Record<string, FactorValues> {
  return Object.fromEntries(buildRatings(ARTIFACTS, rounds).map((rating) => [rating.artifact.id, rating.current.scores]));
}

/** The rater's own scores from the newest published round they took part in. */
export function lastOwnScores(rounds: readonly RoundData[], rater: string): Record<string, ScoreTriple> | undefined {
  const who = rater.toLowerCase();
  for (const data of publishedRounds(rounds).reverse()) {
    const card = data.scorecards.find((item) => item.rater.toLowerCase() === who);
    if (card) return card.scores;
  }
  return undefined;
}

/** 2026-Q4 -> { id: 2027-Q1, label: Q1 2027 }. Falls back to blanks for other id styles. */
export function nextRound(rounds: readonly RoundData[], today: string): { id: string; label: string } {
  const latest = rounds.map((data) => data.round.id).sort().at(-1);
  const match = latest ? /^(\d{4})-Q([1-4])$/.exec(latest) : null;
  let year = Number(today.slice(0, 4));
  let quarter = Math.ceil(Number(today.slice(5, 7)) / 3);
  if (match) {
    year = Number(match[1]);
    quarter = Number(match[2]) + 1;
    if (quarter > 4) {
      quarter = 1;
      year += 1;
    }
  }
  return { id: `${year}-Q${quarter}`, label: `Q${quarter} ${year}` };
}

export function changeLabel(point: RatingPoint, previous: RatingPoint | undefined): { kind: string; text: string } {
  if (!previous) return { kind: 'new', text: 'First rating' };
  const delta = notchDelta(previous.grade, point.grade);
  const from = `from ${previous.grade} (${previous.roundLabel})`;
  if (delta > 0) return { kind: 'up', text: `Up ${pluralize(delta, 'notch', 'notches')} ${from}` };
  if (delta < 0) return { kind: 'down', text: `Down ${pluralize(-delta, 'notch', 'notches')} ${from}` };
  return { kind: 'same', text: `Unchanged ${from}` };
}
