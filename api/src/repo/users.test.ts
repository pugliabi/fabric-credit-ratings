import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTarget } from '../../../db/target.ts';
import { closeDb, db, transaction, type Db, type Params } from '../lib/db.ts';
import { countActiveAdminsLocked, createUser } from './users.ts';

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

describe.skipIf(!process.env.FCR_DB_TESTS)('the admin-count lock against the dev database', () => {
  const login = `itest-count-${Date.now().toString(36)}`;
  let raterId: number | undefined;

  beforeAll(async () => {
    useTarget([]);
    raterId = await createUser(db, { login, displayName: `itest ${login}`, role: 'rater', passwordHash: 'unset' });
  }, 120_000);

  afterAll(async () => {
    if (raterId !== undefined) await db.query('DELETE FROM users WHERE id = @id', { id: raterId });
    await closeDb();
  });

  // A rater's row, so even a broken lock changes no admin; the no-op update writes nothing either way.
  it('holds every users row until commit, so a write to any user waits', { timeout: 120_000 }, async () => {
    await transaction(async (tx) => {
      await countActiveAdminsLocked(tx);
      await expect(
        db.query(
          'SET LOCK_TIMEOUT 1000; UPDATE users SET display_name = display_name WHERE id = @id; SET LOCK_TIMEOUT -1;',
          { id: raterId ?? 0 },
        ),
      ).rejects.toMatchObject({ number: 1222 });
    });
  });
});
