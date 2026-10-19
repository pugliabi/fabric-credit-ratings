import { describe, expect, it } from 'vitest';
import type { Db, Params } from '../lib/db.ts';
import { allScores, lastPublishedCard, replaceScorecard, scoresFor } from './scores.ts';

function answering(rows: object[]): { calls: { text: string; params: Params }[]; fake: Db } {
  const calls: { text: string; params: Params }[] = [];
  const fake: Db = {
    query<T>(text: string, params: Params = {}): Promise<T[]> {
      calls.push({ text, params });
      return Promise.resolve(rows as T[]);
    },
  };
  return { calls, fake };
}

describe('allScores', () => {
  it('returns rows in a fixed order, so the review lists raters the same way every load', async () => {
    const texts: string[] = [];
    const fake: Db = {
      query<T>(text: string): Promise<T[]> {
        texts.push(text);
        return Promise.resolve([]);
      },
    };
    await allScores(fake);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(/ORDER BY s\.round_id, u\.display_name, s\.user_id, s\.artifact_id$/);
  });
});

describe('submission state on score reads', () => {
  it('allScores and scoresFor join each card to its submission', async () => {
    const all = answering([]);
    await allScores(all.fake);
    expect(all.calls[0]?.text).toMatch(/sub\.submitted_at AS submittedAt/);
    expect(all.calls[0]?.text).toMatch(
      /LEFT JOIN submissions sub ON sub\.round_id = s\.round_id AND sub\.user_id = s\.user_id/,
    );
    const one = answering([]);
    await scoresFor(one.fake, '2026-Q4', 7);
    expect(one.calls[0]?.text).toMatch(/LEFT JOIN submissions sub/);
  });

  it('replaceScorecard with an empty card deletes the card and its submission', async () => {
    const { calls, fake } = answering([]);
    await replaceScorecard(fake, '2026-Q4', 7, {});
    expect(calls.map((call) => call.text)).toEqual([
      'DELETE FROM scores WHERE round_id = @roundId AND user_id = @userId',
      'DELETE FROM submissions WHERE round_id = @roundId AND user_id = @userId',
    ]);
  });

  it('replaceScorecard with scores leaves the submission alone', async () => {
    const { calls, fake } = answering([]);
    await replaceScorecard(fake, '2026-Q4', 7, { notebook: [6, 5, 4, 4] });
    expect(calls.some((call) => call.text.includes('submissions'))).toBe(false);
  });

  it('lastPublishedCard only looks at rounds where the user submitted', async () => {
    const { calls, fake } = answering([]);
    expect(await lastPublishedCard(fake, 7)).toBeUndefined();
    expect(calls[0]?.text).toMatch(
      /EXISTS \(SELECT 1 FROM submissions sub WHERE sub\.round_id = r\.id AND sub\.user_id = @userId\)/,
    );
  });
});
