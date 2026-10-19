// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { Rating, PublicRatingPoint } from '../domain/types';
import { cleanup, render } from '../test/dom';
import { ArtifactDetail } from './ArtifactDetail';

afterEach(cleanup);

const point = (round: string, roundLabel: string, date: string, grade: PublicRatingPoint['grade']): PublicRatingPoint => ({
  round,
  roundLabel,
  date,
  scores: { capability: 6, ux: 5, cost: 4, outlook: 5 },
  grade,
  note: `${roundLabel} note.`,
});

const q3 = point('2026-Q3', 'Q3 2026', '2026-07-01', 'A-');
const q4 = point('2026-Q4', 'Q4 2026', '2026-10-01', 'A');
const rating: Rating = {
  artifact: { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga', naFactors: [] },
  current: q4,
  history: [q3, q4],
};

describe('ArtifactDetail', () => {
  it('names the review round under the why, with no date and no rater count', async () => {
    const { container } = await render(ArtifactDetail, { rating, asOf: '2026-10-01' });
    const text = container.textContent ?? '';
    expect(text).toContain('From the Q4 2026 review.');
    expect(text).not.toMatch(/rater/i);
    expect(text).not.toContain('Rated ');
  });

  it('labels each history entry by its round instead of a date', async () => {
    const { container } = await render(ArtifactDetail, { rating, asOf: '2026-10-01' });
    const entries = [...container.querySelectorAll('ol li')].map((entry) => entry.textContent ?? '');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toContain('Q4 2026');
    expect(entries[1]).toContain('Q3 2026');
    expect(container.querySelector('ol time')).toBeNull();
    expect(entries.join(' ')).not.toMatch(/July|October|2026-07|2026-10/);
  });
});
