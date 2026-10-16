import { describe, expect, it } from 'vitest';
import { BAND_META, BAND_ORDER, GRADES, bandOf, isInvestmentGrade, medianGrade, notchDelta, spokenGrade } from './grades.ts';

describe('grades', () => {
  it('splits bands at A-, BBB- and B-, with D outside them', () => {
    expect(bandOf('AAA')).toBe('investment');
    expect(bandOf('A-')).toBe('investment');
    expect(bandOf('BBB+')).toBe('lowInvestment');
    expect(bandOf('BBB-')).toBe('lowInvestment');
    expect(bandOf('BB+')).toBe('speculative');
    expect(bandOf('B-')).toBe('speculative');
    expect(bandOf('CCC')).toBe('distressed');
    expect(bandOf('C')).toBe('distressed');
    expect(bandOf('D')).toBe('deprecated');
  });

  it('counts both investment bands as investment grade', () => {
    expect(isInvestmentGrade('A-')).toBe(true);
    expect(isInvestmentGrade('BBB-')).toBe(true);
    expect(isInvestmentGrade('BB+')).toBe(false);
    expect(isInvestmentGrade('D')).toBe(false);
  });

  it('lists the five bands best to worst, each covering its grades', () => {
    expect(BAND_ORDER).toEqual(['investment', 'lowInvestment', 'speculative', 'distressed', 'deprecated']);
    expect(GRADES.at(-1)).toBe('D');
    expect(BAND_META.lowInvestment.label).toBe('Low investment grade');
    expect(BAND_META.lowInvestment.range).toBe('BBB+ to BBB-');
    expect(BAND_META.investment.range).toBe('AAA to A-');
    expect(BAND_META.deprecated.label).toBe('Deprecated');
    expect(BAND_META.deprecated.range).toBe('D');
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
