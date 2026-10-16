import Anthropic from '@anthropic-ai/sdk';
import sql from 'mssql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminRound, DeployResult, SessionUser } from '../../../src/domain/api-types.ts';
import type { Artifact, Round } from '../../../src/domain/types.ts';
import type { Dataset } from '../domain/dataset.ts';
import type { Config } from '../lib/config.ts';
import { DatabaseUnavailableError, transaction, type Db } from '../lib/db.ts';
import { createDrafter, type Drafter } from '../lib/draft-why.ts';
import { startDeploy } from '../lib/github.ts';
import type { UserCtx } from '../lib/http.ts';
import { listArtifacts } from '../repo/catalog.ts';
import { loadDataset } from '../repo/dataset.ts';
import { saveNote } from '../repo/notes.ts';
import {
  countScorecards,
  createRound,
  findLatestPublishedRound,
  findOpenRound,
  findRound,
  listRoundsWithCounts,
  lockRound,
  publishRound,
  reopenRound,
} from '../repo/rounds.ts';
import { replaceScorecard } from '../repo/scores.ts';
import { markChanged } from '../repo/site.ts';
import { findUserById, type UserRecord } from '../repo/users.ts';
import './admin-rounds.ts';

type Handler = (ctx: UserCtx) => Promise<unknown>;

const handlers = vi.hoisted(() => new Map<string, Handler>());

vi.mock(import('../lib/http.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  route: (name: string, _method: string, _path: string, _access: string, handler: Handler) => {
    handlers.set(name, handler);
  },
}));
vi.mock(import('../lib/db.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  db: { query: () => Promise.reject(new Error('The repo functions are mocked.')) },
  transaction: vi.fn(),
}));
vi.mock(import('../lib/draft-why.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  createDrafter: vi.fn(),
}));
vi.mock(import('../lib/github.ts'), () => ({ startDeploy: vi.fn() }));
vi.mock(import('../repo/catalog.ts'), () => ({ listArtifacts: vi.fn() }));
vi.mock(import('../repo/dataset.ts'), () => ({ loadDataset: vi.fn() }));
vi.mock(import('../repo/notes.ts'), () => ({ saveNote: vi.fn() }));
vi.mock(import('../repo/rounds.ts'), () => ({
  countScorecards: vi.fn(),
  createRound: vi.fn(),
  findLatestPublishedRound: vi.fn(),
  findOpenRound: vi.fn(),
  findRound: vi.fn(),
  listRoundsWithCounts: vi.fn(),
  lockRound: vi.fn(),
  publishRound: vi.fn(),
  reopenRound: vi.fn(),
}));
vi.mock(import('../repo/scores.ts'), () => ({ replaceScorecard: vi.fn() }));
vi.mock(import('../repo/site.ts'), () => ({ markChanged: vi.fn() }));
vi.mock(import('../repo/users.ts'), () => ({ findUserById: vi.fn() }));

const open: Round = { id: '2026-Q4', label: 'Q4 2026', status: 'open', publishedOn: null };
const published: Round = { ...open, status: 'published', publishedOn: '2026-10-15' };
const notebook: Artifact = { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga' };
const rounds: AdminRound[] = [{ ...published, scorecards: 2, notes: 0 }];
const deploy: DeployResult = { started: true, message: 'The public site is rebuilding.' };
const dataset: Dataset = {
  workloads: [],
  artifacts: [notebook],
  rounds: [{ round: open, notes: {}, scorecards: [] }],
  raterNames: new Map(),
};
const admin: SessionUser = { id: 1, login: 'admin', displayName: 'Admin', role: 'admin' };
const rater: SessionUser = { id: 7, login: 'rater', displayName: 'Rater', role: 'rater' };
const raterRecord: UserRecord = { ...rater, active: true, passwordHash: 'unused' };
const config = { anthropic: { apiKey: '', workspaceId: '', model: '' } } as Config;
const tx: Db = { query: () => Promise.reject(new Error('The repo functions are mocked.')) };
const committed = vi.fn();
const log = { warn: vi.fn() };

function call(
  name: string,
  params: Record<string, string>,
  body: Record<string, unknown> = {},
  user: SessionUser = admin,
): Promise<unknown> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered.`);
  return handler({ params, body, user, config, log } as unknown as UserCtx);
}

/** When each mock was first called, for comparing with the order the calls should happen in. Each must be called. */
function callOrder(...mocks: { mock: { invocationCallOrder: number[] } }[]): number[] {
  return mocks.map((fn) => {
    const [first] = fn.mock.invocationCallOrder;
    if (first === undefined) throw new Error('Expected every mock in the order check to have been called.');
    return first;
  });
}

function expectAscending(order: number[]): void {
  expect(order).toEqual([...order].sort((a, b) => a - b));
}

/** What mssql rejects with when the server refuses a statement. */
function sqlError(number: number): sql.RequestError {
  return new sql.RequestError(Object.assign(new Error(`SQL Server error ${number}`), { info: { number } }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(transaction).mockImplementation(async (work) => {
    const value = await work(tx);
    committed();
    return value;
  });
  vi.mocked(findRound).mockResolvedValue(open);
  vi.mocked(lockRound).mockResolvedValue(open);
  vi.mocked(listRoundsWithCounts).mockResolvedValue(rounds);
  vi.mocked(listArtifacts).mockResolvedValue([notebook]);
  vi.mocked(loadDataset).mockResolvedValue(dataset);
  vi.mocked(findUserById).mockResolvedValue(raterRecord);
  vi.mocked(startDeploy).mockResolvedValue(deploy);
});

describe('adminRoundUpdate: publish', () => {
  const publish = { status: 'published', publishedOn: '2026-10-15' };

  it('publishes in one locked transaction that marks the site changed, then deploys after the commit', async () => {
    vi.mocked(countScorecards).mockResolvedValue(2);

    const result = await call('adminRoundUpdate', { id: open.id }, publish);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(lockRound).toHaveBeenCalledWith(tx, open.id);
    expect(countScorecards).toHaveBeenCalledWith(tx, open.id);
    expect(findLatestPublishedRound).toHaveBeenCalledWith(tx);
    expect(publishRound).toHaveBeenCalledWith(tx, open.id, '2026-10-15');
    expect(markChanged).toHaveBeenCalledWith(tx);
    expect(startDeploy).toHaveBeenCalledWith(config);
    expectAscending(
      callOrder(
        vi.mocked(lockRound),
        vi.mocked(countScorecards),
        vi.mocked(findLatestPublishedRound),
        vi.mocked(publishRound),
        vi.mocked(markChanged),
        committed,
        vi.mocked(startDeploy),
      ),
    );
    expect(result).toEqual({ rounds, deploy });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('still publishes, and logs why, when the deploy does not start', async () => {
    vi.mocked(countScorecards).mockResolvedValue(2);
    const refused: DeployResult = { started: false, message: 'GitHub did not respond. Try again in a minute.' };
    vi.mocked(startDeploy).mockResolvedValue(refused);

    expect(await call('adminRoundUpdate', { id: open.id }, publish)).toEqual({ rounds, deploy: refused });
    expect(publishRound).toHaveBeenCalledWith(tx, open.id, '2026-10-15');
    expect(log.warn).toHaveBeenCalledWith('The site deploy did not start:', refused.message);
  });

  it('refuses with 409, changing nothing, when the round was published before the lock', async () => {
    vi.mocked(lockRound).mockResolvedValue(published);

    await expect(call('adminRoundUpdate', { id: open.id }, publish)).rejects.toMatchObject({
      status: 409,
      message: 'Q4 2026 is already published.',
    });
    expect(publishRound).not.toHaveBeenCalled();
    expect(markChanged).not.toHaveBeenCalled();
    expect(startDeploy).not.toHaveBeenCalled();
  });

  it('refuses with 400, starting no deploy, when nobody has scored the round', async () => {
    vi.mocked(countScorecards).mockResolvedValue(0);

    await expect(call('adminRoundUpdate', { id: open.id }, publish)).rejects.toMatchObject({
      status: 400,
      message: 'Nobody has scored Q4 2026 yet.',
    });
    expect(countScorecards).toHaveBeenCalledWith(tx, open.id);
    expect(publishRound).not.toHaveBeenCalled();
    expect(markChanged).not.toHaveBeenCalled();
    expect(startDeploy).not.toHaveBeenCalled();
  });

  it("refuses with 400, changing nothing, a date earlier than the latest published round's", async () => {
    const q3: Round = { id: '2026-Q3', label: 'Q3 2026', status: 'published', publishedOn: '2026-07-15' };
    vi.mocked(countScorecards).mockResolvedValue(2);
    vi.mocked(findLatestPublishedRound).mockResolvedValue(q3);

    await expect(
      call('adminRoundUpdate', { id: open.id }, { status: 'published', publishedOn: '2026-07-14' }),
    ).rejects.toMatchObject({ status: 400, message: "Publish dates can't be earlier than Q3 2026's (2026-07-15)." });
    expect(findLatestPublishedRound).toHaveBeenCalledWith(tx);
    expect(publishRound).not.toHaveBeenCalled();
    expect(markChanged).not.toHaveBeenCalled();
    expect(startDeploy).not.toHaveBeenCalled();
  });

  it('publishes on any date when the latest published round has none', async () => {
    const undated: Round = { id: '2026-Q3', label: 'Q3 2026', status: 'published', publishedOn: null };
    vi.mocked(countScorecards).mockResolvedValue(2);
    vi.mocked(findLatestPublishedRound).mockResolvedValue(undated);

    await call('adminRoundUpdate', { id: open.id }, { status: 'published', publishedOn: '2026-01-01' });
    expect(publishRound).toHaveBeenCalledWith(tx, open.id, '2026-01-01');
  });

  it("accepts the latest published round's own date and future dates", async () => {
    const q3: Round = { id: '2026-Q3', label: 'Q3 2026', status: 'published', publishedOn: '2026-07-15' };
    vi.mocked(countScorecards).mockResolvedValue(2);
    vi.mocked(findLatestPublishedRound).mockResolvedValue(q3);

    for (const publishedOn of ['2026-07-15', '2099-01-01']) {
      await call('adminRoundUpdate', { id: open.id }, { status: 'published', publishedOn });
      expect(publishRound).toHaveBeenLastCalledWith(tx, open.id, publishedOn);
    }
  });

  it('refuses an impossible publish date before opening a transaction', async () => {
    for (const publishedOn of ['2026-02-31', '2026-13-01', '10/15/2026']) {
      await expect(
        call('adminRoundUpdate', { id: open.id }, { status: 'published', publishedOn }),
      ).rejects.toMatchObject({ status: 400, message: 'Publish dates look like 2026-10-15.' });
    }
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('adminRoundUpdate: reopen', () => {
  const reopen = { status: 'open' };

  it('checks no round is open or newer, reopens, and marks the site changed in one locked transaction', async () => {
    vi.mocked(findRound).mockResolvedValue(published);
    vi.mocked(lockRound).mockResolvedValue(published);
    vi.mocked(findLatestPublishedRound).mockResolvedValue(published);

    const result = await call('adminRoundUpdate', { id: open.id }, reopen);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(lockRound).toHaveBeenCalledWith(tx, open.id);
    expect(findOpenRound).toHaveBeenCalledWith(tx);
    expect(findLatestPublishedRound).toHaveBeenCalledWith(tx);
    expect(reopenRound).toHaveBeenCalledWith(tx, open.id);
    expect(markChanged).toHaveBeenCalledWith(tx);
    expectAscending(
      callOrder(
        vi.mocked(lockRound),
        vi.mocked(findOpenRound),
        vi.mocked(findLatestPublishedRound),
        vi.mocked(reopenRound),
        vi.mocked(markChanged),
        committed,
      ),
    );
    expect(startDeploy).not.toHaveBeenCalled();
    expect(result).toEqual({ rounds, deploy: null });
  });

  it('refuses with 409, changing nothing, to reopen a round that a newer published round followed', async () => {
    const q3: Round = { id: '2026-Q3', label: 'Q3 2026', status: 'published', publishedOn: '2026-07-15' };
    vi.mocked(findRound).mockResolvedValue(q3);
    vi.mocked(lockRound).mockResolvedValue(q3);
    vi.mocked(findLatestPublishedRound).mockResolvedValue(published);

    await expect(call('adminRoundUpdate', { id: q3.id }, reopen)).rejects.toMatchObject({
      status: 409,
      message: 'Only the most recent published round (Q4 2026) can be reopened.',
    });
    expect(reopenRound).not.toHaveBeenCalled();
    expect(markChanged).not.toHaveBeenCalled();
  });

  it('refuses with 409 when the locked round is already open, or another round is', async () => {
    await expect(call('adminRoundUpdate', { id: open.id }, reopen)).rejects.toMatchObject({
      status: 409,
      message: 'Q4 2026 is already open.',
    });

    vi.mocked(lockRound).mockResolvedValue(published);
    vi.mocked(findOpenRound).mockResolvedValue({ id: '2027-Q1', label: 'Q1 2027', status: 'open', publishedOn: null });
    await expect(call('adminRoundUpdate', { id: open.id }, reopen)).rejects.toMatchObject({
      status: 409,
      message: 'Publish Q1 2027 before reopening another round.',
    });

    expect(reopenRound).not.toHaveBeenCalled();
    expect(markChanged).not.toHaveBeenCalled();
  });
});

describe('adminRoundCreate', () => {
  const next = { id: '2027-Q1', label: 'Q1 2027' };

  it('creates the round when none is open and the id is new', async () => {
    vi.mocked(findRound).mockResolvedValue(undefined);

    expect(await call('adminRoundCreate', {}, next)).toEqual(rounds);
    expect(createRound).toHaveBeenCalledWith(expect.anything(), '2027-Q1', 'Q1 2027');
  });

  it('refuses a bad id with 400 before any query', async () => {
    await expect(call('adminRoundCreate', {}, { ...next, id: '2027-q1' })).rejects.toMatchObject({
      status: 400,
      message: 'Round ids look like 2027-Q1.',
    });
    expect(findOpenRound).not.toHaveBeenCalled();
    expect(createRound).not.toHaveBeenCalled();
  });

  it('refuses with 409 while a round is open', async () => {
    vi.mocked(findOpenRound).mockResolvedValue(open);

    await expect(call('adminRoundCreate', {}, next)).rejects.toMatchObject({
      status: 409,
      message: 'Publish Q4 2026 before starting a new round.',
    });
    expect(createRound).not.toHaveBeenCalled();
  });

  it('refuses with 409 an id that already exists', async () => {
    vi.mocked(findRound).mockResolvedValue(published);

    await expect(call('adminRoundCreate', {}, { ...next, id: published.id })).rejects.toMatchObject({
      status: 409,
      message: 'Round 2026-Q4 already exists.',
    });
    expect(createRound).not.toHaveBeenCalled();
  });
});

describe('round ids', () => {
  it('answers 404 for an id that is not a round id, without querying', async () => {
    await expect(call('adminReview', { id: 'nope' })).rejects.toMatchObject({
      status: 404,
      message: 'Round nope does not exist.',
    });
    await expect(call('adminRoundUpdate', { id: '2026-q4' }, { status: 'open' })).rejects.toMatchObject({
      status: 404,
    });
    expect(findRound).not.toHaveBeenCalled();
  });
});

describe('adminScoresPut', () => {
  const body = { scores: { notebook: [6, 5, 4] } };

  it('locks the round, replaces the card, and marks the site changed when the locked round is published', async () => {
    vi.mocked(lockRound).mockResolvedValue(published);

    const review = await call('adminScoresPut', { id: open.id, userId: '7' }, body);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(lockRound).toHaveBeenCalledWith(tx, open.id);
    expect(replaceScorecard).toHaveBeenCalledWith(tx, open.id, 7, { notebook: [6, 5, 4] });
    expect(markChanged).toHaveBeenCalledWith(tx);
    expectAscending(
      callOrder(vi.mocked(lockRound), vi.mocked(replaceScorecard), vi.mocked(markChanged), committed),
    );
    expect(review).toMatchObject({ round: open, items: [], aiEnabled: false });
  });

  it('leaves the site flag alone when the locked round is open, even if it read as published', async () => {
    vi.mocked(findRound).mockResolvedValue(published);

    await call('adminScoresPut', { id: open.id, userId: '7' }, body);

    expect(replaceScorecard).toHaveBeenCalledWith(tx, open.id, 7, { notebook: [6, 5, 4] });
    expect(markChanged).not.toHaveBeenCalled();
  });

  it('checks the card permission against the locked round', async () => {
    vi.mocked(lockRound).mockResolvedValue(published);

    await expect(call('adminScoresPut', { id: open.id, userId: '7' }, body, rater)).rejects.toMatchObject({
      status: 403,
      message: 'Q4 2026 is published, so scores can no longer be changed. Ask an admin if a score needs correcting.',
    });
    expect(replaceScorecard).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown user before any transaction', async () => {
    await expect(call('adminScoresPut', { id: open.id, userId: 'abc' }, body)).rejects.toMatchObject({
      status: 404,
      message: 'That user does not exist.',
    });
    expect(findUserById).not.toHaveBeenCalled();

    vi.mocked(findUserById).mockResolvedValue(undefined);
    await expect(call('adminScoresPut', { id: open.id, userId: '99' }, body)).rejects.toMatchObject({ status: 404 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('answers 404 for a user id that only parses as a number, without looking it up', async () => {
    for (const userId of ['1e1', '0x7', '7.0', '-7', ' 7', '']) {
      await expect(call('adminScoresPut', { id: open.id, userId }, body)).rejects.toMatchObject({
        status: 404,
        message: 'That user does not exist.',
      });
    }
    expect(findUserById).not.toHaveBeenCalled();
  });

  it('refuses bad scores with 400 before any transaction', async () => {
    await expect(
      call('adminScoresPut', { id: open.id, userId: '7' }, { scores: { notebook: [9, 5, 4] } }),
    ).rejects.toMatchObject({ status: 400, message: '"notebook" needs three whole scores from 1 to 7.' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('answers 409 when an item on the card was deleted after the check, and passes other errors through', async () => {
    vi.mocked(replaceScorecard).mockRejectedValueOnce(sqlError(547));
    await expect(call('adminScoresPut', { id: open.id, userId: '7' }, body)).rejects.toMatchObject({
      status: 409,
      message: 'An item on this card was just deleted. Reload the page to get the current list.',
    });

    const error = sqlError(2627);
    vi.mocked(replaceScorecard).mockRejectedValueOnce(error);
    await expect(call('adminScoresPut', { id: open.id, userId: '7' }, body)).rejects.toBe(error);
    expect(markChanged).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();
  });
});

describe('adminNotePut', () => {
  it('locks the round, saves the note, and marks the site changed when the locked round is published', async () => {
    vi.mocked(lockRound).mockResolvedValue(published);

    const result = await call('adminNotePut', { id: open.id, artifactId: 'notebook' }, { body: '  Solid.  ' });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(lockRound).toHaveBeenCalledWith(tx, open.id);
    expect(saveNote).toHaveBeenCalledWith(tx, open.id, 'notebook', 'Solid.', admin.id);
    expect(markChanged).toHaveBeenCalledWith(tx);
    expectAscending(callOrder(vi.mocked(lockRound), vi.mocked(saveNote), vi.mocked(markChanged), committed));
    expect(result).toBeUndefined();
  });

  it('leaves the site flag alone when the locked round is open', async () => {
    vi.mocked(findRound).mockResolvedValue(published);

    await call('adminNotePut', { id: open.id, artifactId: 'notebook' }, { body: 'Solid.' });

    expect(saveNote).toHaveBeenCalledWith(tx, open.id, 'notebook', 'Solid.', admin.id);
    expect(markChanged).not.toHaveBeenCalled();
  });

  it('clears the note for a blank write-up', async () => {
    await call('adminNotePut', { id: open.id, artifactId: 'notebook' }, { body: '   ' });
    expect(saveNote).toHaveBeenCalledWith(tx, open.id, 'notebook', '', admin.id);
  });

  it('refuses with 400, before any transaction, a write-up that is missing or not text', async () => {
    for (const body of [{}, { body: 5 }, { body: null }, { body: ['Solid.'] }]) {
      await expect(call('adminNotePut', { id: open.id, artifactId: 'notebook' }, body)).rejects.toMatchObject({
        status: 400,
        message: 'Send the write-up as text.',
      });
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  it('takes a write-up of exactly 2,000 characters and refuses one longer, before any transaction', async () => {
    await call('adminNotePut', { id: open.id, artifactId: 'notebook' }, { body: 'x'.repeat(2_000) });
    expect(saveNote).toHaveBeenCalledWith(tx, open.id, 'notebook', 'x'.repeat(2_000), admin.id);
    vi.mocked(transaction).mockClear();

    await expect(
      call('adminNotePut', { id: open.id, artifactId: 'notebook' }, { body: 'x'.repeat(2_001) }),
    ).rejects.toMatchObject({ status: 400, message: 'Keep the write-up to 2,000 characters or fewer.' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown item before any transaction', async () => {
    await expect(call('adminNotePut', { id: open.id, artifactId: 'nope' }, { body: 'Solid.' })).rejects.toMatchObject({
      status: 404,
      message: 'That item does not exist.',
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('answers 409 when the item was deleted after the check, and passes other errors through', async () => {
    vi.mocked(saveNote).mockRejectedValueOnce(sqlError(547));
    await expect(
      call('adminNotePut', { id: open.id, artifactId: 'notebook' }, { body: 'Solid.' }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'That item was just deleted. Reload the page to get the current list.',
    });

    const error = sqlError(2627);
    vi.mocked(saveNote).mockRejectedValueOnce(error);
    await expect(call('adminNotePut', { id: open.id, artifactId: 'notebook' }, { body: 'Solid.' })).rejects.toBe(error);
    expect(committed).not.toHaveBeenCalled();
  });
});

describe('adminDraft', () => {
  const drafter = vi.fn<Drafter>();
  const scored: Dataset = {
    ...dataset,
    rounds: [
      {
        round: open,
        notes: {},
        scorecards: [{ rater: '7', submittedAt: '2026-10-15T12:00:00.000Z', scores: { notebook: [6, 5, 4] } }],
      },
    ],
  };

  beforeEach(() => {
    vi.mocked(createDrafter).mockReturnValue(drafter);
    vi.mocked(loadDataset).mockResolvedValue(scored);
  });

  it('answers 400 without an Anthropic key, before loading any data', async () => {
    vi.mocked(createDrafter).mockReturnValue(undefined);

    await expect(call('adminDraft', { id: open.id, artifactId: 'notebook' })).rejects.toMatchObject({
      status: 400,
      message: 'Set ANTHROPIC_API_KEY in the Function App settings to draft with AI.',
    });
    expect(createDrafter).toHaveBeenCalledWith(config.anthropic);
    expect(loadDataset).not.toHaveBeenCalled();
  });

  it('gives the whole draft one 200 s deadline, set before the dataset load and passed to the drafter', async () => {
    const deadline = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline);
    drafter.mockResolvedValue('Solid and complete.');

    try {
      await call('adminDraft', { id: open.id, artifactId: 'notebook' });

      expect(timeout).toHaveBeenCalledWith(200_000);
      expect(drafter).toHaveBeenCalledWith(expect.objectContaining({ artifact: notebook }), deadline);
      expectAscending(callOrder(timeout, vi.mocked(loadDataset), drafter));
    } finally {
      timeout.mockRestore();
    }
  });

  it('answers the database 503, calling no drafter, when the dataset load used up the deadline', async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    vi.mocked(loadDataset).mockImplementation(async () => {
      deadline.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
      return scored;
    });

    try {
      const drafting = call('adminDraft', { id: open.id, artifactId: 'notebook' });
      await expect(drafting).rejects.toBeInstanceOf(DatabaseUnavailableError);
      await expect(drafting).rejects.toThrow(/^Loading the dataset for an AI draft took \d+ ms\.$/);
      expect(drafter).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
    }
  });

  it("drafts from the round's scores and returns the text", async () => {
    drafter.mockResolvedValue('Solid and complete.');

    expect(await call('adminDraft', { id: open.id, artifactId: 'notebook' })).toEqual({ text: 'Solid and complete.' });
    expect(drafter).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact: notebook,
        roundLabel: 'Q4 2026',
        scores: { capability: 6, ux: 5, cost: 4 },
        raters: 1,
      }),
      expect.any(AbortSignal),
    );
  });

  it('answers 404 for an unknown round or item, and 400 for an item nobody has scored, without drafting', async () => {
    await expect(call('adminDraft', { id: '2027-Q1', artifactId: 'notebook' })).rejects.toMatchObject({
      status: 404,
      message: 'Round 2027-Q1 does not exist.',
    });
    await expect(call('adminDraft', { id: open.id, artifactId: 'nope' })).rejects.toMatchObject({
      status: 404,
      message: 'That item does not exist.',
    });
    vi.mocked(loadDataset).mockResolvedValue(dataset);
    await expect(call('adminDraft', { id: open.id, artifactId: 'notebook' })).rejects.toMatchObject({
      status: 400,
      message: 'Notebook has no scores in Q4 2026 yet.',
    });
    expect(drafter).not.toHaveBeenCalled();
  });

  it("answers 502 with the drafter's message, and logs the provider's answer behind it", async () => {
    const body = { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } };
    const provider = new Anthropic.InternalServerError(
      529,
      body,
      undefined,
      new Headers({ 'request-id': 'req_529' }),
      'overloaded_error',
    );
    const overloaded = 'Anthropic is overloaded right now. Try again in a minute.';
    drafter.mockRejectedValue(new Error(overloaded, { cause: provider }));

    await expect(call('adminDraft', { id: open.id, artifactId: 'notebook' })).rejects.toMatchObject({
      status: 502,
      message: overloaded,
    });
    expect(log.warn).toHaveBeenCalledWith('AI draft failed', {
      model: 'claude-sonnet-5-5',
      status: 529,
      requestId: 'req_529',
      type: 'overloaded_error',
      error: `InternalServerError: 529 ${JSON.stringify(body)}`,
      loadMs: expect.any(Number),
      elapsedMs: expect.any(Number),
    });
  });
});
