import { describe, expect, it } from 'vitest';
import type { Artifact } from '../domain/types';
import { draftFromValues, parseStoredDraft, rebase, restorable, sameDraft, summarize, type Draft } from './draft';

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

  it('re-applies only edited rows on top of a newer save', () => {
    const base: Draft = { notebook: [3, 3, 3], lakehouse: [4, 4, 4] };
    const newer: Draft = { notebook: [3, 3, 3], lakehouse: [6, 6, 6] };
    expect(restorable({ base, draft: { ...base, notebook: [7, 3, 3] } }, newer)).toEqual({
      notebook: [7, 3, 3],
      lakehouse: [6, 6, 6],
    });
  });

  it('keeps a cleared row cleared', () => {
    expect(restorable({ base: saved, draft: {} }, saved)).toEqual({ notebook: [null, null, null] });
  });

  it("keeps the rater's edit when the same row also changed in a newer save", () => {
    const base: Draft = { notebook: [3, 3, 3] };
    expect(restorable({ base, draft: { notebook: [7, 3, 3] } }, saved)).toEqual({ notebook: [7, 3, 3] });
    expect(restorable({ base, draft: {} }, saved)).toEqual({ notebook: [null, null, null] });
  });

  it('treats a blank row the base never had as no edit', () => {
    expect(restorable({ base: {}, draft: { notebook: [null, null, null] } }, saved)).toBeUndefined();
  });

  it('drops edits that a newer save already holds', () => {
    expect(restorable({ base: { notebook: [3, 3, 3] }, draft: saved }, saved)).toBeUndefined();
  });
});

describe('rebase', () => {
  const sent: Draft = { notebook: [5, 5, 5] };

  it('keeps edits made while a save was in flight', () => {
    const current: Draft = { notebook: [5, 5, 5], lakehouse: [6, 6, 6] };
    expect(rebase(sent, current, sent)).toEqual(current);
  });

  it('is the new card when nothing changed since the base', () => {
    const card: Draft = { notebook: [7, 7, 7] };
    expect(rebase(sent, sent, card)).toBe(card);
  });

  it("puts this tab's edits on top of a card saved elsewhere", () => {
    const base: Draft = { notebook: [3, 3, 3], lakehouse: [4, 4, 4] };
    const current: Draft = { ...base, notebook: [7, 3, 3] };
    const elsewhere: Draft = { notebook: [3, 3, 3], lakehouse: [6, 6, 6] };
    expect(rebase(base, current, elsewhere)).toEqual({ notebook: [7, 3, 3], lakehouse: [6, 6, 6] });
  });

  it('keeps a row cleared during the save cleared', () => {
    expect(rebase(sent, { notebook: [null, null, null] }, sent)).toEqual({ notebook: [null, null, null] });
  });
});

describe('parseStoredDraft', () => {
  it('reads what the hook writes', () => {
    const stored = { base: { notebook: [5, 5, 5] }, draft: { notebook: [6, null, 5] } };
    expect(parseStoredDraft(JSON.stringify(stored))).toEqual(stored);
  });

  it('drops malformed records', () => {
    const bad = [
      null,
      '',
      '{',
      'null',
      '[]',
      '"x"',
      '{"base":{"notebook":[1,1,1,1]},"draft":{}}',
      '{"notebook":[1,2,3]}',
      '{"base":null,"draft":{}}',
      '{"base":{},"draft":[]}',
      '{"base":{},"draft":{"notebook":"x"}}',
      '{"base":{},"draft":{"notebook":[9,1,1]}}',
      '{"base":{},"draft":{"notebook":[1.5,1,1]}}',
      '{"base":{},"draft":{"notebook":[1,2]}}',
    ];
    for (const raw of bad) expect(parseStoredDraft(raw)).toBeUndefined();
  });
});
