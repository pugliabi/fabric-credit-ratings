import type { FactorId, FactorValues, Grade } from '../../../src/domain/types.ts';

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

export const DEPRECATED_GRADE: Grade = 'D';

/** Share of each factor in the grade. The site never shows these, or any total. */
export const FACTOR_WEIGHTS: Readonly<Record<FactorId, number>> = {
  capability: 0.4,
  ux: 0.25,
  cost: 0.25,
  outlook: 0.1,
};

const FACTOR_IDS = Object.keys(FACTOR_WEIGHTS) as FactorId[];

/** The weights in hundredths, so whole scores give whole units and the arithmetic stays exact. */
const WEIGHT_UNITS: Readonly<Record<FactorId, number>> = { capability: 40, ux: 25, cost: 25, outlook: 10 };

/** 40·capability + 25·ux + 25·cost + 10·outlook: an integer for whole scores. */
export function weightedUnits(scores: FactorValues): number {
  return FACTOR_IDS.reduce((acc, id) => acc + WEIGHT_UNITS[id] * scores[id], 0);
}

/** Weighted mean of the four factors, scaled by 3 so it runs 3 to 21 like the old three-factor sum. */
export function totalOf(scores: FactorValues): number {
  return (3 * weightedUnits(scores)) / 100;
}

/** Averaged totals can be fractional; they round to the nearest notch. */
export function gradeForTotal(total: number): Grade {
  const notch = Math.min(MAX_TOTAL, Math.max(MIN_TOTAL, Math.round(total)));
  return TOTAL_TO_GRADE[notch] ?? 'C';
}
