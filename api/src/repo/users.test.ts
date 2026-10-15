import { describe, expect, it } from 'vitest';
import type { Db, Params } from '../lib/db.ts';
import { countActiveAdminsLocked } from './users.ts';

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

describe('countActiveAdminsLocked', () => {
  it('counts active admins with locks held until commit, so concurrent admin changes take turns', async () => {
    const { calls, fake } = answering([{ n: 2 }]);
    expect(await countActiveAdminsLocked(fake)).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe(
      `SELECT COUNT(*) AS n FROM users WITH (UPDLOCK, HOLDLOCK) WHERE role = 'admin' AND active = 1`,
    );
    expect(calls[0]?.params).toEqual({});
  });

  it('answers 0 when no row comes back', async () => {
    const { fake } = answering([]);
    expect(await countActiveAdminsLocked(fake)).toBe(0);
  });
});
