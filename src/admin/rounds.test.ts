import { describe, expect, it } from 'vitest';
import type { Round } from '../domain/types';
import { localToday, nextRound, publishDate, roundIdProblem } from './rounds';

const round = (id: string): Round => ({ id, label: id, status: 'published', publishedOn: '2026-01-01' });

describe('nextRound', () => {
  it('follows the newest quarter', () => {
    expect(nextRound([round('2026-Q3'), round('2026-Q4')], '2026-12-01')).toEqual({ id: '2027-Q1', label: 'Q1 2027' });
    expect(nextRound([round('2026-Q2')], '2026-12-01')).toEqual({ id: '2026-Q3', label: 'Q3 2026' });
  });

  it('starts from the current quarter when there are no rounds', () => {
    expect(nextRound([], '2026-05-10')).toEqual({ id: '2026-Q2', label: 'Q2 2026' });
  });

  it('falls back to the quarter of today when the newest id is not a quarter', () => {
    expect(nextRound([round('2026-Q3'), round('2026-X')], '2026-11-02')).toEqual({ id: '2026-Q4', label: 'Q4 2026' });
  });
});

describe('roundIdProblem', () => {
  it("accepts the API's round ids and words a bad one as the server does", () => {
    for (const id of ['2027-Q1', '2027-H2', '2027-Q']) expect(roundIdProblem(id)).toBeUndefined();
    for (const id of ['2027-q1', '27-Q1', '2027-Q123', '2027Q1', '']) {
      expect(roundIdProblem(id)).toBe('Round ids look like 2027-Q1.');
    }
  });
});

describe('publishDate', () => {
  it('defaults to today, never before the latest published round', () => {
    expect(publishDate('2026-10-15')).toBe('2026-10-15');
    expect(publishDate('2026-10-15', '2026-09-30')).toBe('2026-10-15');
    expect(publishDate('2026-10-15', '2026-10-15')).toBe('2026-10-15');
    expect(publishDate('2026-10-15', '2026-11-01')).toBe('2026-11-01');
  });
});

describe('localToday', () => {
  it('formats the local date', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
