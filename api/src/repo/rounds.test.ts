import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Round, ScoreTuple } from '../../../src/domain/types.ts';
import { closeDb, db, transaction, varchar, type Db, type Params } from '../lib/db.ts';
import { ROUND_ID } from '../lib/validate.ts';
import { useDevTarget } from '../test-target.ts';
import { listArtifacts } from './catalog.ts';
import { findLatestPublishedRound, lockRound } from './rounds.ts';
import { replaceScorecard, scoresFor, toTriples } from './scores.ts';
import { createUser } from './users.ts';

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

describe('lockRound', () => {
  const round: Round = { id: '2026-Q4', label: 'Q4 2026', status: 'open', publishedOn: null };

  it('reads the round with a lock held until commit, looking it up as varchar', async () => {
    const { calls, fake } = answering([round]);
    expect(await lockRound(fake, round.id)).toEqual(round);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toMatch(/FROM rounds r WITH \(UPDLOCK, HOLDLOCK\) WHERE r\.id = @id/);
    expect(calls[0]?.params).toEqual({ id: varchar(round.id) });
  });

  it('returns undefined for a round that does not exist', async () => {
    const { fake } = answering([]);
    expect(await lockRound(fake, '2099-NO')).toBeUndefined();
  });
});

describe('findLatestPublishedRound', () => {
  it('takes the newest published round by publish date, then id, as the public history orders them', async () => {
    const round: Round = { id: '2026-Q3', label: 'Q3 2026', status: 'published', publishedOn: '2026-07-15' };
    const { calls, fake } = answering([round]);
    expect(await findLatestPublishedRound(fake)).toEqual(round);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toMatch(/SELECT TOP 1 .* FROM rounds r WHERE r\.status = 'published'/s);
    expect(calls[0]?.text).toMatch(/ORDER BY r\.published_on DESC, r\.id DESC$/);
  });
});

describe.skipIf(!process.env.FCR_DB_TESTS)('card writes against the dev database', () => {
  const stamp = Date.now().toString(36);
  const roundId = `2099-${stamp.slice(-3).toUpperCase()}`;
  const login = `itest-card-${stamp}`;
  let roundCreated = false;
  let userId: number | undefined;

  beforeAll(async () => {
    useDevTarget();
    expect(roundId).toMatch(ROUND_ID);
    // Published, because the database allows only one open round and the seeded one holds that slot. Dated before any
    // real round, so while it exists it is never the latest published round that publish and reopen check against.
    await db.query(
      `INSERT INTO rounds (id, label, status, published_on) VALUES (@id, @label, 'published', '2000-01-01')`,
      { id: varchar(roundId), label: `itest ${stamp}` },
    );
    roundCreated = true;
    userId = await createUser(db, { login, displayName: `itest ${stamp}`, role: 'rater', passwordHash: 'unset' });
  }, 120_000);

  // The round is deleted even if a step before it failed, so a failed run can't leave it behind.
  afterAll(async () => {
    try {
      if (roundCreated) await db.query('DELETE FROM scores WHERE round_id = @id', { id: varchar(roundId) });
      if (userId !== undefined) await db.query('DELETE FROM users WHERE id = @id', { id: userId });
    } finally {
      try {
        if (roundCreated) await db.query('DELETE FROM rounds WHERE id = @id', { id: varchar(roundId) });
      } finally {
        await closeDb();
      }
    }
  });

  it('makes two writers of one card take turns, so it ends as exactly one of them', { timeout: 120_000 }, async () => {
    const ids = (await listArtifacts(db)).slice(0, 3).map((artifact) => artifact.id);
    expect(ids).toHaveLength(3);
    const [a = '', b = '', c = ''] = ids;
    // Overlapping on one item, so writes that interleave either collide on the key or merge into one card.
    const cards: Record<string, Record<string, ScoreTuple>> = {
      rater: { [a]: [1, 1, 1], [b]: [1, 1, 1] },
      admin: { [b]: [2, 2, 2], [c]: [2, 2, 2] },
    };
    const events: string[] = [];
    const save = (writer: string) =>
      transaction(async (tx) => {
        expect((await lockRound(tx, roundId))?.id).toBe(roundId);
        events.push(`${writer} locked`);
        // Without the lock, the other writer gets in here.
        await new Promise((resolve) => setTimeout(resolve, 300));
        await replaceScorecard(tx, roundId, userId ?? 0, cards[writer] ?? {});
        events.push(`${writer} wrote`);
      });

    await Promise.all([save('rater'), save('admin')]);

    const first = events[0]?.startsWith('rater') ? 'rater' : 'admin';
    const second = first === 'rater' ? 'admin' : 'rater';
    expect(events).toEqual([`${first} locked`, `${first} wrote`, `${second} locked`, `${second} wrote`]);
    expect(toTriples(await scoresFor(db, roundId, userId ?? 0))).toEqual(cards[second]);
  });
});
