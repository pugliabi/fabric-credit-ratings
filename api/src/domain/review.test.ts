import { describe, expect, it } from 'vitest';
import { dataset } from './fixtures.ts';
import { buildReview } from './review.ts';

describe('buildReview', () => {
  it('compares a published round with the one before it', () => {
    const review = buildReview(dataset, '2026-Q4', '2026-10-15', false);
    expect(review?.items.map((item) => item.artifact.id)).toEqual(['lakehouse']);
    const item = review?.items[0];
    expect(item?.change).toEqual({ kind: 'up', text: 'Up 6 notches from A- (Q3 2026)' });
    expect(item?.breakdown).toEqual([{ userId: 1, name: 'Ann', scores: [7, 7, 7, 7] }]);
    expect(review?.notes).toEqual({ lakehouse: 'Now the default store.' });
  });

  it('dates an open round with today and flags first ratings', () => {
    const review = buildReview(dataset, '2027-Q1', '2026-10-15', true);
    expect(review?.items[0]?.point.date).toBe('2026-10-15');
    expect(review?.items[0]?.change.kind).toBe('new');
    expect(review?.raters).toEqual([{ userId: 1, name: 'Ann' }]);
    expect(review?.aiEnabled).toBe(true);
  });

  it('lists every rater in the round', () => {
    expect(buildReview(dataset, '2026-Q3', '2026-10-15', false)?.raters).toEqual([
      { userId: 1, name: 'Ann' },
      { userId: 2, name: 'Bo' },
    ]);
  });

  it('returns undefined for an unknown round', () => {
    expect(buildReview(dataset, '1999-Q1', '2026-10-15', false)).toBeUndefined();
  });
});
