import { describe, expect, it } from 'vitest';
import { gradeForTotal, totalOf } from './formula.ts';

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
  it('adds the three factors', () => {
    expect(totalOf({ capability: 5.5, ux: 5, cost: 4 })).toBe(14.5);
  });
});
