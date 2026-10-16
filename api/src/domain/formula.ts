import type { FactorValues, Grade } from '../../../src/domain/types.ts';

export const MIN_TOTAL = 3;
export const MAX_TOTAL = 21;

export const TOTAL_TO_GRADE: Readonly<Record<number, Grade>> = {
  21: 'AAA',
  20: 'AA+',
  19: 'AA',
  18: 'AA-',
  17: 'A+',
  16: 'A',
  15: 'A-',
  14: 'BBB+',
  13: 'BBB',
  12: 'BBB-',
  11: 'BB+',
  10: 'BB',
  9: 'BB-',
  8: 'B+',
  7: 'B',
  6: 'B-',
  5: 'CCC',
  4: 'CC',
  3: 'C',
};

export const WITHDRAWN_GRADE: Grade = 'E';

export function totalOf(scores: FactorValues): number {
  return scores.capability + scores.ux + scores.cost;
}

/** Averaged totals can be fractional; they round to the nearest notch. */
export function gradeForTotal(total: number): Grade {
  const notch = Math.min(MAX_TOTAL, Math.max(MIN_TOTAL, Math.round(total)));
  return TOTAL_TO_GRADE[notch] ?? 'C';
}
