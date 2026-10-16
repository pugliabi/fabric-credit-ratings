import { describe, expect, it } from 'vitest';
import type { Db } from '../lib/db.ts';
import { allScores } from './scores.ts';

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
