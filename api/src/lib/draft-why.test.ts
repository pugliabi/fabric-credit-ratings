import { describe, expect, it } from 'vitest';
import { createDrafter, mentionsMath, promptFor } from './draft-why.ts';

describe('mentionsMath', () => {
  it('flags grades, totals, and sums', () => {
    expect(mentionsMath('Rated AA+ this time')).toBe(true);
    expect(mentionsMath('scored 18 out of 21')).toBe(true);
    expect(mentionsMath('5 + 6 + 7')).toBe(true);
    expect(mentionsMath('A dependable workhorse with rough edges.')).toBe(false);
  });
});

describe('promptFor', () => {
  it('names the workload and forbids the math', () => {
    const prompt = promptFor({
      artifact: { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga' },
      workload: { id: 'data-engineering', name: 'Data Engineering', shortName: 'Data Eng', blurb: 'Notebooks and Spark' },
      roundLabel: 'Q4 2026',
      scores: { capability: 6, ux: 5, cost: 4 },
      raters: 2,
    });
    expect(prompt).toContain('Workload: Data Engineering (Notebooks and Spark)');
    expect(prompt).toContain('average of 2 raters');
    expect(prompt).toContain('Never mention scores');
  });
});

describe('createDrafter', () => {
  it('is off without an API key', () => {
    expect(createDrafter({ apiKey: '', workspaceId: '', model: '' })).toBeUndefined();
  });
});
