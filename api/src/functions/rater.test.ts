import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact, Round } from '../../../src/domain/types.ts';
import type { ScoreRow } from '../domain/dataset.ts';
import { transaction, type Db } from '../lib/db.ts';
import { HttpError } from '../lib/errors.ts';
import type { UserCtx } from '../lib/http.ts';
import { listArtifacts } from '../repo/catalog.ts';
import { findOpenRound, lockRound } from '../repo/rounds.ts';
import { lastPublishedCard, replaceScorecard, scoresFor } from '../repo/scores.ts';
import './rater.ts';

type Handler = (ctx: UserCtx) => Promise<unknown>;

const handlers = vi.hoisted(() => new Map<string, Handler>());

vi.mock(import('../lib/http.ts'), () => ({
  route: (name: string, _method: string, _path: string, _access: string, handler: Handler) => {
    handlers.set(name, handler);
  },
}));
vi.mock(import('../lib/db.ts'), async (importOriginal) => ({ ...(await importOriginal()), transaction: vi.fn() }));
vi.mock(import('../repo/catalog.ts'), () => ({ listArtifacts: vi.fn(), listWorkloads: vi.fn() }));
vi.mock(import('../repo/rounds.ts'), () => ({ findOpenRound: vi.fn(), lockRound: vi.fn() }));
vi.mock(import('../repo/scores.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  lastPublishedCard: vi.fn(),
  replaceScorecard: vi.fn(),
  scoresFor: vi.fn(),
}));

const round: Round = { id: '2026-Q4', label: 'Q4 2026', status: 'open', publishedOn: null };
const notebook: Artifact = { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga' };
const tx: Db = { query: () => Promise.reject(new Error('The repo functions are mocked.')) };

function save(body: Record<string, unknown>): Promise<unknown> {
  const handler = handlers.get('myScoresPut');
  if (!handler) throw new Error('myScoresPut was not registered.');
  const user = { id: 7, login: 'rater', displayName: 'Rater', role: 'rater' as const };
  return handler({ body, user } as unknown as UserCtx);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(transaction).mockImplementation((work) => work(tx));
  vi.mocked(findOpenRound).mockResolvedValue(round);
  vi.mocked(listArtifacts).mockResolvedValue([notebook]);
  vi.mocked(lastPublishedCard).mockResolvedValue(undefined);
  vi.mocked(scoresFor).mockResolvedValue([]);
});

describe('myScoresPut', () => {
  it('refuses with 409, writing nothing, when the round was published before the save locked it', async () => {
    vi.mocked(lockRound).mockResolvedValue({ ...round, status: 'published', publishedOn: '2026-10-15' });

    const saving = save({ round: round.id, scores: { notebook: [6, 5, 4] } });

    await expect(saving).rejects.toBeInstanceOf(HttpError);
    await expect(saving).rejects.toMatchObject({
      status: 409,
      message: 'Q4 2026 was just published. Reload the page.',
    });
    expect(lockRound).toHaveBeenCalledWith(tx, round.id);
    expect(replaceScorecard).not.toHaveBeenCalled();
  });

  it('locks the round, then replaces the card, in the same transaction', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    const updatedAt = new Date('2026-10-15T20:00:00Z');
    const row: ScoreRow = {
      roundId: round.id,
      userId: 7,
      name: 'Rater',
      artifactId: 'notebook',
      capability: 6,
      ux: 5,
      cost: 4,
      updatedAt,
    };
    vi.mocked(scoresFor).mockResolvedValue([row]);

    const result = await save({ round: round.id, scores: { notebook: [6, 5, 4] } });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(lockRound).toHaveBeenCalledWith(tx, round.id);
    expect(replaceScorecard).toHaveBeenCalledWith(tx, round.id, 7, { notebook: [6, 5, 4] });
    const [locked = 0] = vi.mocked(lockRound).mock.invocationCallOrder;
    const [replaced = 0] = vi.mocked(replaceScorecard).mock.invocationCallOrder;
    expect(locked).toBeLessThan(replaced);
    expect(result).toEqual({
      round,
      scores: { notebook: [6, 5, 4] },
      updatedAt: updatedAt.toISOString(),
      previous: null,
    });
  });

  it('refuses with 409, before any transaction, a card for a round that is no longer the open one', async () => {
    await expect(save({ round: '2026-Q3', scores: {} })).rejects.toMatchObject({ status: 409 });
    expect(transaction).not.toHaveBeenCalled();
  });
});
