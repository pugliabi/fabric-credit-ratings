import sql from 'mssql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact, Round } from '../../../src/domain/types.ts';
import type { ScoreRow } from '../domain/dataset.ts';
import { transaction, type Db } from '../lib/db.ts';
import { HttpError } from '../lib/errors.ts';
import type { UserCtx } from '../lib/http.ts';
import { listArtifacts } from '../repo/catalog.ts';
import { findOpenRound, lockRound } from '../repo/rounds.ts';
import { lastPublishedCard, replaceScorecard, scoresFor } from '../repo/scores.ts';
import { isSubmitted, submitCard, withdrawCard } from '../repo/submissions.ts';
import './rater.ts';

type Handler = (ctx: UserCtx) => Promise<unknown>;

const handlers = vi.hoisted(() => new Map<string, Handler>());

vi.mock(import('../lib/http.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
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
vi.mock(import('../repo/submissions.ts'), () => ({
  isSubmitted: vi.fn(),
  submitCard: vi.fn(),
  withdrawCard: vi.fn(),
}));

const round: Round = { id: '2026-Q4', label: 'Q4 2026', status: 'open', publishedOn: null };
const notebook: Artifact = {
  id: 'notebook',
  name: 'Notebook',
  workload: 'data-engineering',
  status: 'ga',
  naFactors: [],
};
const tx: Db = { query: () => Promise.reject(new Error('The repo functions are mocked.')) };
const log = { warn: vi.fn() };

/** Calls a registered handler as rater 7. */
function call(name: string, body: Record<string, unknown>): Promise<unknown> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered.`);
  const user = { id: 7, login: 'rater', displayName: 'Rater', role: 'rater' as const };
  return handler({ body, user, log } as unknown as UserCtx);
}

const save = (body: Record<string, unknown>) => call('myScoresPut', body);

/** A saved, unsubmitted score row of rater 7's card in the open round; overrides change what a test cares about. */
function cardRow(overrides: Partial<ScoreRow> = {}): ScoreRow {
  return {
    roundId: round.id,
    userId: 7,
    name: 'Rater',
    artifactId: 'notebook',
    capability: 6,
    ux: 5,
    cost: 4,
    outlook: 4,
    updatedAt: new Date('2026-10-15T20:00:00Z'),
    submittedAt: null,
    ...overrides,
  };
}

/** What mssql rejects with when the server refuses a statement. */
function sqlError(number: number): sql.RequestError {
  return new sql.RequestError(Object.assign(new Error(`SQL Server error ${number}`), { info: { number } }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(transaction).mockImplementation((work) => work(tx));
  vi.mocked(findOpenRound).mockResolvedValue(round);
  vi.mocked(listArtifacts).mockResolvedValue([notebook]);
  vi.mocked(lastPublishedCard).mockResolvedValue(undefined);
  vi.mocked(scoresFor).mockResolvedValue([]);
  vi.mocked(isSubmitted).mockResolvedValue(false);
});

describe('myScoresPut', () => {
  it('refuses with 409, writing nothing, when the round was published before the save locked it', async () => {
    vi.mocked(lockRound).mockResolvedValue({ ...round, status: 'published', publishedOn: '2026-10-15' });

    const saving = save({ round: round.id, scores: { notebook: [6, 5, 4, 4] } });

    await expect(saving).rejects.toBeInstanceOf(HttpError);
    await expect(saving).rejects.toMatchObject({
      status: 409,
      message: 'Q4 2026 was just released. Reload the page.',
    });
    expect(lockRound).toHaveBeenCalledWith(tx, round.id);
    expect(replaceScorecard).not.toHaveBeenCalled();
  });

  it('locks the round, then replaces the card, in the same transaction', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    const row = cardRow();
    vi.mocked(scoresFor).mockResolvedValue([row]);

    const result = await save({ round: round.id, scores: { notebook: [6, 5, 4, 4] } });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(lockRound).toHaveBeenCalledWith(tx, round.id);
    expect(replaceScorecard).toHaveBeenCalledWith(tx, round.id, 7, { notebook: [6, 5, 4, 4] });
    const [locked = 0] = vi.mocked(lockRound).mock.invocationCallOrder;
    const [replaced = 0] = vi.mocked(replaceScorecard).mock.invocationCallOrder;
    expect(locked).toBeLessThan(replaced);
    expect(result).toEqual({
      round,
      scores: { notebook: [6, 5, 4, 4] },
      updatedAt: row.updatedAt.toISOString(),
      submittedAt: null,
      previous: null,
    });
  });

  it('refuses with 409, before any transaction, a card for a round that is no longer the open one', async () => {
    await expect(save({ round: '2026-Q3', scores: {} })).rejects.toMatchObject({ status: 409 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('answers 409 when an item on the card was deleted after the check', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    vi.mocked(replaceScorecard).mockRejectedValue(sqlError(547));

    await expect(save({ round: round.id, scores: { notebook: [6, 5, 4, 4] } })).rejects.toMatchObject({
      status: 409,
      message: 'An item on this card was just deleted. Reload the page to get the current list.',
    });
  });

  it('answers 503 asking to try again, logging each loss, when its one retry loses a deadlock too', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    const deadlock = sqlError(1205);
    vi.mocked(replaceScorecard).mockRejectedValue(deadlock);

    await expect(save({ round: round.id, scores: { notebook: [6, 5, 4, 4] } })).rejects.toMatchObject({
      status: 503,
      message: 'Someone was changing the catalog at the same moment. Try again.',
    });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledWith('Deadlock victim', deadlock);
  });

  it('saves on its one retry after losing a deadlock, logging the loss once', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    const deadlock = sqlError(1205);
    vi.mocked(replaceScorecard).mockRejectedValueOnce(deadlock).mockResolvedValueOnce(undefined);

    expect(await save({ round: round.id, scores: { notebook: [6, 5, 4, 4] } })).toMatchObject({ round });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(replaceScorecard).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith('Deadlock victim', deadlock);
  });

  it('passes other database errors through', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    const error = sqlError(2627);
    vi.mocked(replaceScorecard).mockRejectedValue(error);

    await expect(save({ round: round.id, scores: { notebook: [6, 5, 4, 4] } })).rejects.toBe(error);
  });
});

describe('saving a submitted card', () => {
  it('refuses with 409, writing nothing, once the card is submitted', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    vi.mocked(isSubmitted).mockResolvedValue(true);
    await expect(save({ round: round.id, scores: { notebook: [6, 5, 4, 4] } })).rejects.toMatchObject({
      status: 409,
      message: 'You submitted this card. Withdraw your submission to make changes.',
    });
    expect(isSubmitted).toHaveBeenCalledWith(tx, round.id, 7);
    expect(replaceScorecard).not.toHaveBeenCalled();
  });
});

describe('myScoresSubmit', () => {
  const seen = '2026-10-15T20:00:00.000Z';

  it('submits the card it was shown, after locking the round, and returns it with the time', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    const submittedAt = new Date('2026-10-19T15:02:00Z');
    vi.mocked(scoresFor).mockResolvedValueOnce([cardRow()]).mockResolvedValue([cardRow({ submittedAt })]);
    const result = await call('myScoresSubmit', { round: round.id, updatedAt: seen });
    expect(scoresFor).toHaveBeenCalledWith(tx, round.id, 7);
    expect(submitCard).toHaveBeenCalledWith(tx, round.id, 7);
    const [locked = 0] = vi.mocked(lockRound).mock.invocationCallOrder;
    const [submitted = 0] = vi.mocked(submitCard).mock.invocationCallOrder;
    expect(locked).toBeLessThan(submitted);
    expect(result).toMatchObject({ submittedAt: submittedAt.toISOString(), updatedAt: seen });
  });

  it.each([
    [{ round: '2026-Q3', updatedAt: seen }, 409, 'The open round is now Q4 2026. Reload the page to score it.'],
    [{ round: '2026-Q4' }, 400, 'Send updatedAt: the save time of the card you are submitting.'],
  ])('refuses %j before any transaction', async (body, status, message) => {
    await expect(call('myScoresSubmit', body)).rejects.toMatchObject({ status, message });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses when the round was released before the lock', async () => {
    vi.mocked(lockRound).mockResolvedValue({ ...round, status: 'published', publishedOn: '2026-10-19' });
    await expect(call('myScoresSubmit', { round: round.id, updatedAt: seen })).rejects.toMatchObject({
      status: 409,
      message: 'Q4 2026 was just released. Reload the page.',
    });
    expect(submitCard).not.toHaveBeenCalled();
  });

  it('refuses an unsaved card', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    vi.mocked(scoresFor).mockResolvedValue([]);
    await expect(call('myScoresSubmit', { round: round.id, updatedAt: seen })).rejects.toMatchObject({
      status: 400,
      message: 'Save your scores before submitting.',
    });
  });

  it('refuses a card that is already submitted', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    vi.mocked(scoresFor).mockResolvedValue([cardRow({ submittedAt: new Date('2026-10-18T10:00:00Z') })]);
    await expect(call('myScoresSubmit', { round: round.id, updatedAt: seen })).rejects.toMatchObject({
      status: 409,
      message: 'Your card is already submitted.',
    });
    expect(submitCard).not.toHaveBeenCalled();
  });

  it('refuses a card saved since the page loaded it', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    vi.mocked(scoresFor).mockResolvedValue([cardRow({ updatedAt: new Date('2026-10-16T09:00:00Z') })]);
    await expect(call('myScoresSubmit', { round: round.id, updatedAt: seen })).rejects.toMatchObject({
      status: 409,
      message: 'Your card changed since this page loaded. Reload the page to see it.',
    });
    expect(submitCard).not.toHaveBeenCalled();
  });
});

describe('myScoresWithdraw', () => {
  it('withdraws after locking the round and returns the draft', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    vi.mocked(scoresFor).mockResolvedValue([cardRow()]);
    const result = await call('myScoresWithdraw', { round: round.id });
    expect(withdrawCard).toHaveBeenCalledWith(tx, round.id, 7);
    expect(result).toMatchObject({ submittedAt: null });
  });

  it('refuses once the round is released', async () => {
    vi.mocked(lockRound).mockResolvedValue({ ...round, status: 'published', publishedOn: '2026-10-19' });
    await expect(call('myScoresWithdraw', { round: round.id })).rejects.toMatchObject({
      status: 409,
      message: 'Q4 2026 was just released. Reload the page.',
    });
    expect(withdrawCard).not.toHaveBeenCalled();
  });
});
