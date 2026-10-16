import { describe, expect, it } from 'vitest';
import { applicableFactors, naFactorsProblem, parseNaFactors, serializeNaFactors } from './factors-applicable.ts';

describe('applicable factors', () => {
  it('lists the factors not marked n/a, in FACTORS order', () => {
    expect(applicableFactors({ naFactors: [] })).toEqual(['capability', 'ux', 'cost', 'outlook']);
    expect(applicableFactors({ naFactors: ['cost'] })).toEqual(['capability', 'ux', 'outlook']);
    expect(applicableFactors({ naFactors: ['outlook', 'cost'] })).toEqual(['capability', 'ux']);
  });

  it('round-trips the stored form in FACTORS order', () => {
    expect(serializeNaFactors(['outlook', 'cost'])).toBe('cost,outlook');
    expect(parseNaFactors('')).toEqual([]);
    expect(parseNaFactors('cost,outlook')).toEqual(['cost', 'outlook']);
    expect(parseNaFactors('cost,bogus')).toEqual(['cost']);
  });

  it('refuses unknown ids and marking every factor', () => {
    expect(naFactorsProblem(['cost'])).toBeUndefined();
    expect(naFactorsProblem(['bogus'])).toBe('Unknown factor "bogus".');
    expect(naFactorsProblem(['capability', 'ux', 'cost', 'outlook'])).toBe('At least one factor must apply.');
    expect(naFactorsProblem('cost')).toBe('naFactors must be a list of factor ids.');
  });
});
