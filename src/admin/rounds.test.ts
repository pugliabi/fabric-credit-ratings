import { describe, expect, it } from 'vitest';
import type { Round } from '../domain/types';
import { localToday, nextRound } from './rounds';

const round = (id: string): Round => ({ id, label: id, status: 'published', publishedOn: '2026-01-01' });

describe('nextRound', () => {
  it('follows the newest quarter', () => {
    expect(nextRound([round('2026-Q3'), round('2026-Q4')], '2026-12-01')).toEqual({ id: '2027-Q1', label: 'Q1 2027' });
    expect(nextRound([round('2026-Q2')], '2026-12-01')).toEqual({ id: '2026-Q3', label: 'Q3 2026' });
  });

  it('starts from the current quarter when there are no rounds', () => {
    expect(nextRound([], '2026-05-10')).toEqual({ id: '2026-Q2', label: 'Q2 2026' });
  });
});

describe('localToday', () => {
  it('formats the local date', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
