import { describe, expect, it } from 'vitest';
import { bandOf, isInvestmentGrade, medianGrade, notchDelta, spokenGrade } from './grades.ts';

describe('grades', () => {
  it('splits bands at BBB- and B-', () => {
    expect(bandOf('BBB-')).toBe('investment');
    expect(bandOf('BB+')).toBe('speculative');
    expect(bandOf('CCC')).toBe('distressed');
    expect(bandOf('E')).toBe('withdrawn');
    expect(isInvestmentGrade('E')).toBe(false);
  });

  it('counts notches as positive when the grade improves', () => {
    expect(notchDelta('BBB', 'A')).toBe(3);
    expect(notchDelta('A', 'BBB')).toBe(-3);
  });

  it('takes the middle grade, or the better middle one for an even count', () => {
    expect(medianGrade(['AAA', 'C', 'BBB'])).toBe('BBB');
    expect(medianGrade(['AAA', 'A'])).toBe('AAA');
    expect(medianGrade([])).toBeUndefined();
  });

  it('spells signs for screen readers', () => {
    expect(spokenGrade('AA+')).toBe('AA plus');
  });
});
