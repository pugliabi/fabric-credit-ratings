import { describe, expect, it } from 'vitest';
import { asOfDate, buildRatings, pointFor, previousPoint } from './aggregate.ts';
import type { Artifact, RoundData, ScoreTuple } from '../../../src/domain/types.ts';

const lakehouse: Artifact = { id: 'lakehouse', name: 'Lakehouse', workload: 'storage', status: 'ga', naFactors: [] };
const legacy: Artifact = { id: 'legacy', name: 'Legacy item', workload: 'storage', status: 'retired', naFactors: [] };
const fresh: Artifact = { id: 'fresh', name: 'Fresh item', workload: 'mcp', status: 'preview', naFactors: [] };
const catalog = [lakehouse, legacy, fresh];

const rounds: RoundData[] = [
  {
    round: { id: '2026-Q4', label: 'Q4 2026', status: 'published', publishedOn: '2026-10-01' },
    notes: {},
    scorecards: [
      {
        rater: 'ann',
        savedAt: '2026-09-30T00:00:00Z',
        submittedAt: '2026-09-30T00:00:00Z',
        scores: { lakehouse: [7, 7, 7, 7] },
      },
    ],
    drafts: [],
  },
  {
    round: { id: '2026-Q3', label: 'Q3 2026', status: 'published', publishedOn: '2026-07-01' },
    notes: { lakehouse: 'First look.' },
    scorecards: [
      {
        rater: 'ann',
        savedAt: '2026-06-30T00:00:00Z',
        submittedAt: '2026-06-30T00:00:00Z',
        scores: { lakehouse: [6, 5, 4, 6], legacy: [7, 7, 7, 7] },
      },
      {
        rater: 'bo',
        savedAt: '2026-06-30T00:00:00Z',
        submittedAt: '2026-06-30T00:00:00Z',
        scores: { lakehouse: [5, 5, 4, 4] },
      },
    ],
    drafts: [],
  },
  {
    round: { id: '2027-Q1', label: 'Q1 2027', status: 'open', publishedOn: null },
    notes: {},
    scorecards: [
      {
        rater: 'ann',
        savedAt: '2026-12-30T00:00:00Z',
        submittedAt: '2026-12-30T00:00:00Z',
        scores: { fresh: [4, 4, 4, 4] },
      },
    ],
    drafts: [],
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
    expect(q3?.scores).toEqual({ capability: 5.5, ux: 5, cost: 4, outlook: 5 });
    expect(q3).not.toHaveProperty('raters');
    expect(q3?.grade).toBe('A-');
    expect(q3?.note).toBe('First look.');
  });

  it('grades from the unrounded total even when rounded factors would drop a notch', () => {
    const card = (rater: string, tuple: ScoreTuple) => ({
      rater,
      savedAt: '2026-06-30T00:00:00Z',
      submittedAt: '2026-06-30T00:00:00Z',
      scores: { lakehouse: tuple },
    });
    const sixRaters: RoundData = {
      round: { id: '2026-Q3', label: 'Q3 2026', status: 'published', publishedOn: '2026-07-01' },
      notes: {},
      scorecards: [card('a', [4, 4, 4, 4]), ...['b', 'c', 'd', 'e', 'f'].map((rater) => card(rater, [5, 5, 5, 5]))],
      drafts: [],
    };
    const point = buildRatings([lakehouse], [sixRaters])[0]?.current;
    expect(point?.scores).toEqual({ capability: 4.8, ux: 4.8, cost: 4.8, outlook: 4.8 });
    expect(point?.grade).toBe('A-');
  });

  it('averages an item over the raters who scored it, not every rater in the round', () => {
    const card = (rater: string, scores: Record<string, ScoreTuple>) => ({
      rater,
      savedAt: '2026-06-30T00:00:00Z',
      submittedAt: '2026-06-30T00:00:00Z',
      scores,
    });
    const round: RoundData = {
      round: { id: '2026-Q3', label: 'Q3 2026', status: 'published', publishedOn: '2026-07-01' },
      notes: {},
      scorecards: [
        card('a', { lakehouse: [7, 7, 7, 7], fresh: [1, 1, 1, 1] }),
        card('b', { lakehouse: [7, 7, 7, 7], fresh: [3, 3, 3, 3] }),
        card('c', { lakehouse: [7, 7, 7, 7], fresh: [5, 5, 5, 5] }),
        card('d', { lakehouse: [1, 1, 1, 1] }),
        card('e', { lakehouse: [1, 1, 1, 1] }),
      ],
      drafts: [],
    };
    const byId = new Map(buildRatings([lakehouse, fresh], [round]).map((r) => [r.artifact.id, r]));
    expect(byId.get('fresh')?.current.scores).toEqual({ capability: 3, ux: 3, cost: 3, outlook: 3 });
    expect(byId.get('lakehouse')?.current.scores).toEqual({ capability: 4.6, ux: 4.6, cost: 4.6, outlook: 4.6 });
    // The admin review still counts who scored each item; the public ratings don't carry it.
    expect(pointFor(fresh, round, '2026-07-01')?.raters).toBe(3);
    expect(pointFor(lakehouse, round, '2026-07-01')?.raters).toBe(5);
  });

  it('keeps history oldest to newest with the newest as current', () => {
    const rating = byId.get('lakehouse');
    expect(rating?.history.map((point) => point.round)).toEqual(['2026-Q3', '2026-Q4']);
    expect(rating?.current.grade).toBe('AAA');
  });

  it('keeps the last rating for an item skipped in a later round', () => {
    expect(byId.get('legacy')?.current.round).toBe('2026-Q3');
  });

  it('grades retired items D whatever the scores', () => {
    expect(byId.get('legacy')?.current.grade).toBe('D');
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

describe('not-applicable factors', () => {
  const git: Artifact = { id: 'git', name: 'Git', workload: 'storage', status: 'ga', naFactors: ['cost'] };
  const roundWith = (a: ScoreTuple, b: ScoreTuple): RoundData[] => [
    {
      round: { id: '2026-Q4', label: 'Q4 2026', status: 'published', publishedOn: '2026-10-01' },
      notes: {},
      scorecards: [
        { rater: 'ann', savedAt: '2026-09-30T00:00:00Z', submittedAt: '2026-09-30T00:00:00Z', scores: { git: a } },
        { rater: 'bo', savedAt: '2026-09-30T00:00:00Z', submittedAt: '2026-09-30T00:00:00Z', scores: { git: b } },
      ],
      drafts: [],
    },
  ];

  it('averages and grades over the applicable factors only', () => {
    const current = buildRatings([git], roundWith([7, 7, null, 7], [7, 7, null, 7]))[0]?.current;
    expect(current?.scores).toEqual({ capability: 7, ux: 7, cost: null, outlook: 7 });
    expect(current?.grade).toBe('AAA');
  });

  it('ignores a stored value in a not-applicable position', () => {
    const current = buildRatings([git], roundWith([7, 7, 1, 7], [7, 7, 1, 7]))[0]?.current;
    expect(current?.scores).toEqual({ capability: 7, ux: 7, cost: null, outlook: 7 });
    expect(current?.grade).toBe('AAA');
  });
});
