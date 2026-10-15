import { describe, expect, it } from 'vitest';
import type { Artifact } from '../domain/types';
import { draftFromValues, restorable, sameDraft, summarize, type Draft } from './draft';

const artifacts: Artifact[] = [
  { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga' },
  { id: 'lakehouse', name: 'Lakehouse', workload: 'storage', status: 'ga' },
  { id: 'kql', name: 'KQL database', workload: 'real-time', status: 'ga' },
];

describe('summarize', () => {
  it('keeps complete rows in catalog order and lists partial ones', () => {
    const summary = summarize({ kql: [4, 4, 4], notebook: [6, 5, null], lakehouse: [7, 6, 5] }, artifacts);
    expect(Object.keys(summary.scores)).toEqual(['lakehouse', 'kql']);
    expect(summary.rated).toBe(2);
    expect(summary.partial).toEqual(['notebook']);
  });

  it('ignores blank rows and items no longer in the catalog', () => {
    expect(summarize({ notebook: [null, null, null], gone: [1, 1, 1] }, artifacts)).toEqual({
      scores: {},
      rated: 0,
      partial: [],
    });
  });
});

describe('sameDraft', () => {
  it('treats a missing row and a blank row as equal', () => {
    expect(sameDraft({}, { notebook: [null, null, null] })).toBe(true);
    expect(sameDraft({ notebook: [1, 2, 3] }, { notebook: [1, 2, 4] })).toBe(false);
  });
});

describe('draftFromValues', () => {
  it('rounds averages to whole scores', () => {
    expect(draftFromValues({ notebook: { capability: 5.5, ux: 4.4, cost: 7 } })).toEqual({ notebook: [6, 4, 7] });
  });
});

describe('restorable', () => {
  const saved: Draft = { notebook: [5, 5, 5] };

  it('restores edits that were never saved', () => {
    expect(restorable({ base: saved, draft: { notebook: [6, 5, 5] } }, saved)).toEqual({ notebook: [6, 5, 5] });
  });

  it('lets a newer save win over an untouched draft', () => {
    const old: Draft = { notebook: [3, 3, 3] };
    expect(restorable({ base: old, draft: old }, saved)).toBeUndefined();
  });

  it('skips drafts that match the saved card, and missing drafts', () => {
    expect(restorable({ base: {}, draft: saved }, saved)).toBeUndefined();
    expect(restorable(undefined, saved)).toBeUndefined();
  });
});
