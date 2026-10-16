import { describe, expect, it } from 'vitest';
import { asOfDate, buildRatings, findUnrated, previousPoint } from './aggregate.ts';
import type { Artifact, RoundData, ScoreTriple } from './types.ts';

const lakehouse: Artifact = { id: 'lakehouse', name: 'Lakehouse', workload: 'storage', status: 'ga' };
const legacy: Artifact = { id: 'legacy', name: 'Legacy item', workload: 'storage', status: 'retired' };
const fresh: Artifact = { id: 'fresh', name: 'Fresh item', workload: 'mcp', status: 'preview' };
const catalog = [lakehouse, legacy, fresh];

const rounds: RoundData[] = [
  {
    round: { id: '2026-Q4', label: 'Q4 2026', status: 'published', publishedOn: '2026-10-01' },
    notes: {},
    scorecards: [{ rater: 'ann', submittedAt: '2026-09-30T00:00:00Z', scores: { lakehouse: [7, 7, 7] } }],
  },
  {
    round: { id: '2026-Q3', label: 'Q3 2026', status: 'published', publishedOn: '2026-07-01' },
    notes: { lakehouse: 'First look.' },
    scorecards: [
      { rater: 'ann', submittedAt: '2026-06-30T00:00:00Z', scores: { lakehouse: [6, 5, 4], legacy: [7, 7, 7] } },
      { rater: 'bo', submittedAt: '2026-06-30T00:00:00Z', scores: { lakehouse: [5, 5, 4] } },
    ],
  },
  {
    round: { id: '2027-Q1', label: 'Q1 2027', status: 'open', publishedOn: null },
    notes: {},
    scorecards: [{ rater: 'ann', submittedAt: '2026-12-30T00:00:00Z', scores: { fresh: [4, 4, 4] } }],
  },
];

describe('buildRatings', () => {
  const ratings = buildRatings(catalog, rounds);
  const byId = new Map(ratings.map((rating) => [rating.artifact.id, rating]));

  it('rates only items scored in a published round, in catalog order', () => {
    expect(ratings.map((rating) => rating.artifact.id)).toEqual(['lakehouse', 'legacy']);
  });

  it('averages each factor to one decimal and grades from the unrounded total', () => {
    const q3 = byId.get('lakehouse')?.history[0];
    expect(q3?.scores).toEqual({ capability: 5.5, ux: 5, cost: 4 });
    expect(q3?.raters).toBe(2);
    expect(q3?.grade).toBe('A-');
    expect(q3?.note).toBe('First look.');
  });

  it('grades from the unrounded total even when rounded factors would drop a notch', () => {
    const card = (rater: string, triple: ScoreTriple) => ({
      rater,
      submittedAt: '2026-06-30T00:00:00Z',
      scores: { lakehouse: triple },
    });
    const sixRaters: RoundData = {
      round: { id: '2026-Q3', label: 'Q3 2026', status: 'published', publishedOn: '2026-07-01' },
      notes: {},
      scorecards: [card('a', [4, 4, 4]), ...['b', 'c', 'd', 'e', 'f'].map((rater) => card(rater, [5, 5, 5]))],
    };
    const point = buildRatings([lakehouse], [sixRaters])[0]?.current;
    expect(point?.scores).toEqual({ capability: 4.8, ux: 4.8, cost: 4.8 });
    expect(point?.grade).toBe('A-');
  });

  it('keeps history oldest to newest with the newest as current', () => {
    const rating = byId.get('lakehouse');
    expect(rating?.history.map((point) => point.round)).toEqual(['2026-Q3', '2026-Q4']);
    expect(rating?.current.grade).toBe('AAA');
  });

  it('keeps the last rating for an item skipped in a later round', () => {
    expect(byId.get('legacy')?.current.round).toBe('2026-Q3');
  });

  it('grades retired items E whatever the scores', () => {
    expect(byId.get('legacy')?.current.grade).toBe('E');
  });

  it('lists never-rated items as unrated', () => {
    expect(findUnrated(catalog, ratings).map((artifact) => artifact.id)).toEqual(['fresh']);
  });
});

describe('previousPoint', () => {
  it('returns the newest published point before the round', () => {
    expect(previousPoint(lakehouse, rounds, '2026-Q4')?.round).toBe('2026-Q3');
  });

  it('returns the current published point for an open round', () => {
    expect(previousPoint(lakehouse, rounds, '2027-Q1')?.round).toBe('2026-Q4');
  });
});

describe('asOfDate', () => {
  it('is the newest publication date', () => {
    expect(asOfDate(rounds)).toBe('2026-10-01');
  });
});
