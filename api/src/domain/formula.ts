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

/** The weights in hundredths, so whole scores give whole units and the arithmetic stays exact. */
export const WEIGHT_UNITS: Readonly<Record<FactorId, number>> = { capability: 40, ux: 25, cost: 25, outlook: 10 };

const FACTOR_IDS = Object.keys(WEIGHT_UNITS) as FactorId[];

/** Share of each factor in the grade, derived from WEIGHT_UNITS. The site never shows these, or any total. */
export const FACTOR_WEIGHTS = Object.fromEntries(FACTOR_IDS.map((id) => [id, WEIGHT_UNITS[id] / 100])) as Readonly<
  Record<FactorId, number>
>;

/** Weighted units over the applicable (non-null) factors, and the weight they carry. */
export function weightedUnits(scores: FactorValues): { units: number; weight: number } {
  let units = 0;
  let weight = 0;
  for (const id of FACTOR_IDS) {
    const value = scores[id];
    if (value === null) continue;
    units += WEIGHT_UNITS[id] * value;
    weight += WEIGHT_UNITS[id];
  }
  return { units, weight };
}

/** Weighted mean of the applicable factors, scaled onto 3 to 21. An item with no applicable factor can't exist. */
export function totalOf(scores: FactorValues): number {
  const { units, weight } = weightedUnits(scores);
  return weight === 0 ? MIN_TOTAL : (3 * units) / weight;
}

/** Averaged totals can be fractional; they round to the nearest notch. */
export function gradeForTotal(total: number): Grade {
  const notch = Math.min(MAX_TOTAL, Math.max(MIN_TOTAL, Math.round(total)));
  return TOTAL_TO_GRADE[notch] ?? 'C';
}
