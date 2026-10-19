import { describe, expect, it } from 'vitest';
import { dataset } from './fixtures.ts';
import { buildSnapshot } from './snapshot.ts';

const snapshot = buildSnapshot(dataset.workloads, dataset.artifacts, dataset.rounds, new Date('2026-10-15T00:00:00Z'));

describe('buildSnapshot', () => {
  it('includes only items scored in a published round', () => {
    expect(snapshot.ratings.map((rating) => rating.artifact.id)).toEqual(['lakehouse', 'legacy']);
  });

  it('drops workloads with no rated items', () => {
    expect(snapshot.workloads.map((workload) => workload.id)).toEqual(['storage']);
  });

  it('keeps averages, history order, notes, and the retired rule', () => {
    const [lakehouse, legacy] = snapshot.ratings;
    expect(lakehouse?.history.map((point) => [point.round, point.grade, point.raters])).toEqual([
      ['2026-Q3', 'A-', 2],
      ['2026-Q4', 'AAA', 1],
    ]);
    expect(lakehouse?.history[0]?.scores).toEqual({ capability: 5.5, ux: 5, cost: 4, outlook: 5 });
    expect(lakehouse?.current.note).toBe('Now the default store.');
    expect(legacy?.current.grade).toBe('D');
  });

  it("ignores a rater's draft: Lakehouse's Q4 point is Ann's card alone", () => {
    const history = snapshot.ratings.find((rating) => rating.artifact.id === 'lakehouse')?.history;
    const q4 = history?.find((point) => point.round === '2026-Q4');
    expect(q4?.scores.capability).toBe(7);
    expect(q4?.raters).toBe(1);
  });

  it('dates the snapshot and the ratings', () => {
    expect(snapshot.generatedAt).toBe('2026-10-15T00:00:00.000Z');
    expect(snapshot.asOf).toBe('2026-10-01');
  });

  it('carries no rater identities', () => {
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain('Ann');
    expect(json).not.toContain('"rater"');
    expect(json).not.toContain('userId');
  });
});
