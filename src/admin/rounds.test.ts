import { describe, expect, it } from 'vitest';
import type { Round } from '../domain/types';
import { localToday, nextRound, publishDate, roundIdProblem } from './rounds';

const round = (id: string): Round => ({ id, label: id, status: 'published', publishedOn: '2026-01-01' });

describe('nextRound', () => {
  const today = '2026-10-16';
  it('suggests the month after the latest month round', () => {
    expect(nextRound([round('2026-NOV')], today)).toEqual({ id: '2026-DEC', label: 'December 2026' });
    expect(nextRound([round('2026-DEC')], today)).toEqual({ id: '2027-JAN', label: 'January 2027' });
  });
  it('suggests the month after the latest quarter round', () => {
    expect(nextRound([round('2026-Q4')], today)).toEqual({ id: '2027-JAN', label: 'January 2027' });
    expect(nextRound([round('2026-Q1')], today)).toEqual({ id: '2026-APR', label: 'April 2026' });
  });
  it('ranks rounds by period, not by id text', () => {
    const rounds = [round('2026-OCT'), round('2026-NOV')];
    expect(nextRound(rounds, today)).toEqual({ id: '2026-DEC', label: 'December 2026' });
    expect(nextRound([round('2026-NOV'), round('2026-Q4')], today)).toEqual({ id: '2027-JAN', label: 'January 2027' });
    expect(nextRound([round('2026-Q4'), round('2027-JAN')], today)).toEqual({ id: '2027-FEB', label: 'February 2027' });
  });
  it('ignores ids it cannot read', () => {
    expect(nextRound([round('2026-H1')], today)).toEqual({ id: '2026-NOV', label: 'November 2026' });
  });
  it('falls back to the month after today', () => {
    expect(nextRound([], today)).toEqual({ id: '2026-NOV', label: 'November 2026' });
    expect(nextRound([round('2026-H1')], '2026-12-02')).toEqual({ id: '2027-JAN', label: 'January 2027' });
  });
});

describe('roundIdProblem', () => {
  it("accepts the API's round ids and words a bad one as the server does", () => {
    for (const id of ['2027-Q1', '2027-H2', '2027-Q']) expect(roundIdProblem(id)).toBeUndefined();
    for (const id of ['2027-q1', '27-Q1', '2027-Q123', '2027Q1', '']) {
      expect(roundIdProblem(id)).toBe('Round ids look like 2026-NOV or 2027-Q1.');
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
