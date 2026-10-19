import { describe, expect, it } from 'vitest';
import { assembleDataset } from './dataset.ts';
import { artifacts, dataset, noteRows, rounds, row, scoreRows, workloads } from './fixtures.ts';
import { buildReview } from './review.ts';

describe('buildReview', () => {
  it('compares a published round with the one before it', () => {
    const review = buildReview(dataset, '2026-Q4', '2026-10-15', false);
    expect(review?.items.map((item) => item.artifact.id)).toEqual(['lakehouse']);
    const item = review?.items[0];
    expect(item?.change).toEqual({ kind: 'up', text: 'Up 6 notches from A- (Q3 2026)' });
    expect(item?.breakdown).toEqual([
      { userId: 1, name: 'Ann', submitted: true, scores: [7, 7, 7, 7] },
      { userId: 2, name: 'Bo', submitted: false, scores: [1, 1, 1, 1] },
    ]);
    expect(review?.notes).toEqual({ lakehouse: 'Now the default store.' });
  });

  it('dates an open round with today and flags first ratings', () => {
    const review = buildReview(dataset, '2027-Q1', '2026-10-15', true);
    expect(review?.items[0]?.point?.date).toBe('2026-10-15');
    expect(review?.items[0]?.change.kind).toBe('new');
    expect(review?.raters).toEqual([{ userId: 1, name: 'Ann', submittedAt: '2026-09-30T12:00:00.000Z' }]);
    expect(review?.aiEnabled).toBe(true);
  });

  it('lists every rater in the round', () => {
    expect(buildReview(dataset, '2026-Q3', '2026-10-15', false)?.raters).toEqual([
      { userId: 1, name: 'Ann', submittedAt: '2026-09-30T12:00:00.000Z' },
      { userId: 2, name: 'Bo', submittedAt: '2026-09-30T12:00:00.000Z' },
    ]);
  });

  it('returns undefined for an unknown round', () => {
    expect(buildReview(dataset, '1999-Q1', '2026-10-15', false)).toBeUndefined();
  });
});

describe('drafts in the review', () => {
  it('lists a draft card beside the submitted ones and leaves it out of the averages', () => {
    const review = buildReview(dataset, '2026-Q4', '2026-10-19', false);
    const lakehouse = review?.items.find((item) => item.artifact.id === 'lakehouse');
    expect(lakehouse?.point?.scores.capability).toBe(7);
    expect(lakehouse?.point?.raters).toBe(1);
    expect(lakehouse?.breakdown).toEqual([
      { userId: 1, name: 'Ann', submitted: true, scores: [7, 7, 7, 7] },
      { userId: 2, name: 'Bo', submitted: false, scores: [1, 1, 1, 1] },
    ]);
    expect(review?.raters).toEqual([
      { userId: 1, name: 'Ann', submittedAt: '2026-09-30T12:00:00.000Z' },
      { userId: 2, name: 'Bo', submittedAt: null },
    ]);
  });

  it('lists an item only drafts scored, with no point', () => {
    const rows = [...scoreRows, row('2027-Q1', 2, 'unscored', [3, 3, 3, 3], false)];
    const data = assembleDataset(workloads, artifacts, rounds, rows, noteRows);
    const item = buildReview(data, '2027-Q1', '2026-10-19', false)?.items.find((i) => i.artifact.id === 'unscored');
    expect(item).toMatchObject({ point: null, previous: null, change: { kind: 'draft', text: 'Only in drafts' } });
    expect(item?.breakdown).toEqual([{ userId: 2, name: 'Bo', submitted: false, scores: [3, 3, 3, 3] }]);
  });
});
