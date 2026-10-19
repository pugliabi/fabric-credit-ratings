import { describe, expect, it } from 'vitest';
import { varchar, type Db, type Params } from '../lib/db.ts';
import { isSubmitted, submitCard, withdrawCard } from './submissions.ts';

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

const params = { roundId: varchar('2026-Q4'), userId: 7 };

describe('submitCard', () => {
  it('inserts the submission only when the card has none, so a repeat keeps the first time', async () => {
    const { calls, fake } = answering([]);
    await submitCard(fake, '2026-Q4', 7);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toMatch(/INSERT INTO submissions \(round_id, user_id\)/);
    expect(calls[0]?.text).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM submissions WHERE round_id = @roundId AND/);
    expect(calls[0]?.params).toEqual(params);
  });
});

describe('withdrawCard', () => {
  it('deletes the submission', async () => {
    const { calls, fake } = answering([]);
    await withdrawCard(fake, '2026-Q4', 7);
    expect(calls[0]?.text).toBe('DELETE FROM submissions WHERE round_id = @roundId AND user_id = @userId');
    expect(calls[0]?.params).toEqual(params);
  });
});

describe('isSubmitted', () => {
  it('is true when a submission row exists', async () => {
    expect(await isSubmitted(answering([{ n: 1 }]).fake, '2026-Q4', 7)).toBe(true);
  });

  it('is false when none does', async () => {
    expect(await isSubmitted(answering([{ n: 0 }]).fake, '2026-Q4', 7)).toBe(false);
  });
});
