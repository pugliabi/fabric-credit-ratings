import { describe, expect, it } from 'vitest';
import { DEPRECATED_GRADE, FACTOR_WEIGHTS, WEIGHT_UNITS, gradeForTotal, totalOf, weightedUnits } from './formula.ts';

describe('gradeForTotal', () => {
  it('maps whole totals to notches', () => {
    expect(gradeForTotal(21)).toBe('AAA');
    expect(gradeForTotal(12)).toBe('BBB-');
    expect(gradeForTotal(3)).toBe('C');
  });

  it('rounds fractional totals to the nearest notch', () => {
    expect(gradeForTotal(14.5)).toBe('A-');
    expect(gradeForTotal(14.4)).toBe('BBB+');
  });

  it('clamps totals outside 3 to 21', () => {
    expect(gradeForTotal(1)).toBe('C');
    expect(gradeForTotal(30)).toBe('AAA');
  });
});

describe('totalOf', () => {
  it('weights the four factors 40/25/25/10 and scales onto 3 to 21', () => {
    expect(totalOf({ capability: 7, ux: 7, cost: 7, outlook: 7 })).toBe(21);
    expect(totalOf({ capability: 1, ux: 1, cost: 1, outlook: 1 })).toBe(3);
    expect(totalOf({ capability: 5.5, ux: 5, cost: 4, outlook: 5 })).toBeCloseTo(14.85, 10);
    expect(totalOf({ capability: 5, ux: 4, cost: 5, outlook: 5 })).toBe(14.25);
  });

  it('scales the weights over the applicable factors only', () => {
    expect(totalOf({ capability: 7, ux: 7, cost: null, outlook: 7 })).toBe(21);
    expect(totalOf({ capability: 4, ux: 4, cost: null, outlook: 4 })).toBe(12);
    expect(totalOf({ capability: 7, ux: null, cost: null, outlook: 7 })).toBe(21);
    expect(totalOf({ capability: 5.5, ux: 5, cost: null, outlook: 5 })).toBeCloseTo((3 * (220 + 125 + 50)) / 75, 10);
    expect(weightedUnits({ capability: 5, ux: 4, cost: 5, outlook: 5 })).toEqual({ units: 475, weight: 100 });
    expect(weightedUnits({ capability: 5, ux: 4, cost: null, outlook: 5 })).toEqual({ units: 350, weight: 75 });
  });

  it('lets the weights, not the sum, decide the notch', () => {
    // 7/1/1/7: the old sum was 9 (BB-); weighted it is 3 x (2.8 + 0.25 + 0.25 + 0.7) = 12 (BBB-).
    expect(gradeForTotal(totalOf({ capability: 7, ux: 1, cost: 1, outlook: 7 }))).toBe('BBB-');
    // 1/7/7/1: the old sum was 15 (A-); weighted it is 3 x (0.4 + 1.75 + 1.75 + 0.1) = 12 (BBB-).
    expect(gradeForTotal(totalOf({ capability: 1, ux: 7, cost: 7, outlook: 1 }))).toBe('BBB-');
  });

  it('exposes the weights, which sum to one', () => {
    expect(Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(FACTOR_WEIGHTS).toEqual({ capability: 0.4, ux: 0.25, cost: 0.25, outlook: 0.1 });
    expect(Object.values(WEIGHT_UNITS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(DEPRECATED_GRADE).toBe('D');
  });
});
