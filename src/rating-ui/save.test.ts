import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyScores, RoundReview } from '../domain/api-types';
import type { Artifact, Round, ScoreTuple } from '../domain/types';
import { ApiError } from '../lib/api';
import { hasChanges, summarize, type Draft } from './draft';
import {
  cardFromReview,
  CHANGED_ELSEWHERE,
  CHANGED_WHILE_SAVING,
  clashingRows,
  describeClashes,
  pressRaterSave,
  pressSave,
  raterCardArtifacts,
  raterCardChanged,
  raterCardWorkloads,
  saveBlocked,
  saveCard,
  saveFailureMessage,
  saveRaterCard,
  saveStateText,
  settleSave,
} from './save';

const round: Round = { id: '2026-Q4', label: 'Q4 2026', status: 'open', publishedOn: null };
const loaded = { notebook: [5, 5, 5, 5] } as const;

function card(scores: MyScores['scores'], updatedAt = '2026-10-15T23:00:00.000Z', open = round): MyScores {
  return { round: open, scores, updatedAt, previous: null };
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Answers GETs with `latest` and PUTs with `put`, and records each call as "METHOD /path". */
function server(latest: unknown, put: () => Response) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PUT' ? put() : reply(200, latest),
  );
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls: () => fetchMock.mock.calls.map(([url, init]) => `${init?.method} ${url}`),
    sent: () => JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')?.[1]?.body)),
  };
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('saveCard', () => {
  it('saves when the server still has the card this page loaded', async () => {
    const after = card({ notebook: [6, 5, 5, 5] }, '2026-10-15T23:05:00.000Z');
    const api = server(card(loaded), () => reply(200, after));
    await expect(saveCard(round.id, loaded, { notebook: [6, 5, 5, 5] })).resolves.toEqual({ kind: 'saved', card: after });
    expect(api.calls()).toEqual(['GET /api/rounds/open/my-scores', 'PUT /api/rounds/open/my-scores']);
    expect(api.sent()).toEqual({ round: '2026-Q4', scores: { notebook: [6, 5, 5, 5] } });
  });

  it('does not save over a card that changed after this page loaded it', async () => {
    const newer = card({ notebook: [5, 5, 5, 5], lakehouse: [6, 6, 6, 6] }, '2026-10-15T23:04:00.000Z');
    const api = server(newer, () => reply(200, newer));
    await expect(saveCard(round.id, loaded, { notebook: [6, 5, 5, 5] })).resolves.toEqual({
      kind: 'changed',
      card: newer,
    });
    expect(api.calls()).toEqual(['GET /api/rounds/open/my-scores']);
  });

  it('saves when the card was only saved again with the same scores', async () => {
    const resaved = card(loaded, '2026-10-15T23:04:00.000Z');
    const api = server(resaved, () => reply(200, card({ notebook: [6, 5, 5, 5] })));
    await expect(saveCard(round.id, loaded, { notebook: [6, 5, 5, 5] })).resolves.toMatchObject({ kind: 'saved' });
    expect(api.calls()).toHaveLength(2);
  });

  it('leaves a newly opened round to the server, which refuses the save in its own words', async () => {
    const next: Round = { id: '2027-Q1', label: 'Q1 2027', status: 'open', publishedOn: null };
    const error = 'The open round is now Q1 2027. Reload the page to score it.';
    server(card({}, '2027-01-02T10:00:00.000Z', next), () => reply(409, { error }));
    await expect(saveCard(round.id, loaded, { notebook: [6, 5, 5, 5] })).rejects.toMatchObject({
      status: 409,
      message: error,
    });
  });

  it('sends no PUT when the check itself fails', async () => {
    const fetchMock = vi.fn(async () => reply(503, { error: 'The ratings database is not responding.' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(saveCard(round.id, loaded, { notebook: [6, 5, 5, 5] })).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('settleSave', () => {
  const ids = new Set(['notebook', 'lakehouse']);
  const base: Draft = { notebook: [5, 5, 5, 5] };
  const sent: Draft = { notebook: [6, 5, 5, 5] };

  it('keeps a slider moved while the save was out', () => {
    const after = settleSave({ kind: 'saved', card: card({ notebook: [6, 5, 5, 5] }) }, base, sent, ids);
    expect(after.draft({ ...sent, lakehouse: [2, 2, 2, 2] })).toEqual({ ...sent, lakehouse: [2, 2, 2, 2] });
    expect(after.status).toEqual({ kind: 'idle' });
  });

  it('puts the edits on top of a card changed elsewhere, keeps later moves, and asks for a check', () => {
    const newer = card({ notebook: [5, 5, 5, 5], lakehouse: [4, 4, 4, 4] });
    const after = settleSave({ kind: 'changed', card: newer }, base, sent, ids);
    expect(after.draft({ notebook: [7, 5, 5, 5] })).toEqual({ notebook: [7, 5, 5, 5], lakehouse: [4, 4, 4, 4] });
    expect(after.status).toMatchObject({ kind: 'error', message: CHANGED_ELSEWHERE });
  });

  it('says nothing when the other save already holds these edits', () => {
    const newer = card({ notebook: [6, 5, 5, 5], lakehouse: [4, 4, 4, 4] });
    expect(settleSave({ kind: 'changed', card: newer }, base, sent, ids).status).toEqual({ kind: 'idle' });
  });
});

describe('saveBlocked', () => {
  it('blocks a clean card, an incomplete row, and a second save while one is out', () => {
    expect(saveBlocked(true, 0, false)).toBe(false);
    expect(saveBlocked(false, 0, false)).toBe(true);
    expect(saveBlocked(true, 1, false)).toBe(true);
    expect(saveBlocked(true, 0, true)).toBe(true);
  });
});

describe('pressSave', () => {
  const ids = new Set(['notebook', 'lakehouse']);
  const sent: Draft = { notebook: [6, 5, 5, 5] };

  function page() {
    return { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
  }

  function form(blocked: boolean) {
    return { blocked, roundId: round.id, saved: loaded, sent, scores: { notebook: [6, 5, 5, 5] } as const, ids };
  }

  it('does nothing while Save is blocked, so an incomplete row never reaches the server', async () => {
    const fetchMock = vi.fn(async () => reply(200, card(loaded)));
    vi.stubGlobal('fetch', fetchMock);
    const handlers = page();
    await pressSave(form(true), handlers);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(handlers.saving).not.toHaveBeenCalled();
    expect(handlers.saved).not.toHaveBeenCalled();
  });

  it('saves, then hands back the card and a rebase that keeps sliders moved meanwhile', async () => {
    const after = card({ notebook: [6, 5, 5, 5] }, '2026-10-15T23:05:00.000Z');
    const api = server(card(loaded), () => reply(200, after));
    const handlers = page();
    await pressSave(form(false), handlers);
    expect(api.calls()).toEqual(['GET /api/rounds/open/my-scores', 'PUT /api/rounds/open/my-scores']);
    expect(handlers.saving).toHaveBeenCalledOnce();
    const [savedCard, settled] = handlers.saved.mock.calls[0] ?? [];
    expect(savedCard).toEqual(after);
    expect(settled.draft({ ...sent, lakehouse: [2, 2, 2, 2] })).toEqual({ ...sent, lakehouse: [2, 2, 2, 2] });
    expect(handlers.failed).not.toHaveBeenCalled();
  });

  it("reports a failed save in the server's words, with Reload after a 409, and leaves the draft alone", async () => {
    const error = 'No round is open for scoring right now.';
    vi.stubGlobal('fetch', vi.fn(async () => reply(409, { error })));
    const handlers = page();
    await pressSave(form(false), handlers);
    expect(handlers.failed).toHaveBeenCalledWith({
      kind: 'error',
      message: `${error} Your draft is kept in this browser.`,
      reload: true,
    });
    expect(handlers.saved).not.toHaveBeenCalled();
  });
});

const raterA = { userId: 9, name: 'P2 Rater A' };
const NAMES: Record<number, string> = { 2: 'Tommy Puglia', 9: raterA.name };

/** A review of `round` holding these cards (keyed by user id), one breakdown row per rater and item. */
function review(cards: Record<number, Record<string, ScoreTuple>>): RoundReview {
  const raters = Object.keys(cards).map(Number);
  const ids = [...new Set(Object.values(cards).flatMap((scores) => Object.keys(scores)))];
  return {
    round,
    raters: raters.map((userId) => ({ userId, name: NAMES[userId] ?? '', submittedAt: '2026-10-15T12:00:00.000Z' })),
    items: ids.map((id) => ({
      artifact: { id, name: id, workload: 'data-engineering', status: 'ga', naFactors: [] },
      point: {
        round: round.id,
        roundLabel: round.label,
        date: '2026-10-15',
        scores: { capability: 5, ux: 5, cost: 5, outlook: 5 },
        raters: 1,
        grade: 'A',
        note: '',
      },
      previous: null,
      change: { kind: 'new', text: 'First rating' },
      breakdown: raters.flatMap((userId) => {
        const scores = cards[userId]?.[id];
        return scores ? [{ userId, name: NAMES[userId] ?? '', submitted: true, scores }] : [];
      }),
    })),
    notes: {},
    aiEnabled: true,
  };
}

const opened = { notebook: [2, 5, 4, 4], environment: [3, 4, 7, 7] } as const;
const adminCard = { notebook: [6, 6, 5, 5] } as const;
const edited = { notebook: [3, 5, 4, 4], environment: [3, 4, 7, 7] } as const;

describe('cardFromReview', () => {
  it("rebuilds one rater's card from the breakdown, without the other raters' scores", () => {
    const both = review({ 9: opened, 2: { ...adminCard, lakehouse: [1, 1, 1, 1] } });
    expect(cardFromReview(both, 9)).toEqual(opened);
    expect(cardFromReview(both, 5)).toEqual({});
  });
});

describe("the admin card editor's item list", () => {
  const catalog: Artifact[] = [
    { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga', naFactors: [] },
    { id: 'old', name: 'Old item', workload: 'data-engineering', status: 'retired', naFactors: [] },
  ];
  const latest = review({ 9: { notebook: [2, 5, 4, 4], 'added-later': [4, 4, 4, 4] } });

  it('holds the whole catalog, retired items too, plus reviewed items this page has not loaded', () => {
    const artifacts = raterCardArtifacts(catalog, latest);
    expect(artifacts.map((artifact) => artifact.id)).toEqual(['notebook', 'old', 'added-later']);
    const card: Draft = { ...cardFromReview(latest, 9), old: [1, 1, 1, 1] };
    expect(summarize(card, artifacts).scores).toEqual(card);
  });

  it('leaves an unedited card clean, where the catalog alone would mark it changed', () => {
    const saved = cardFromReview(latest, 9);
    const known = (artifacts: readonly Artifact[]) => new Set(artifacts.map((artifact) => artifact.id));
    expect(hasChanges(saved, saved, known(catalog))).toBe(true);
    expect(hasChanges(saved, saved, known(raterCardArtifacts(catalog, latest)))).toBe(false);
  });

  it("adds a group for an item whose workload this page hasn't loaded", () => {
    const workloads = [{ id: 'data-engineering', name: 'Data Engineering', shortName: 'Data Eng', blurb: '' }];
    const artifacts: Artifact[] = [...catalog, {
      id: 'x',
      name: 'X',
      workload: 'brand-new',
      status: 'ga',
      naFactors: [],
    }];
    expect(raterCardWorkloads(workloads, artifacts)).toEqual([
      ...workloads,
      { id: 'brand-new', name: 'brand-new', shortName: 'brand-new', blurb: '' },
    ]);
  });
});

describe('clashingRows', () => {
  it('lists the rows both sides changed since the card opened, to different values', () => {
    const saved: Draft = { notebook: [2, 5, 4, 4], environment: [3, 4, 7, 7], lakehouse: [1, 1, 1, 1], pipeline: [2, 2, 2, 2] };
    const sent: Draft = { notebook: [3, 5, 4, 4], environment: [3, 5, 7, 7], lakehouse: [1, 1, 1, 1], pipeline: [3, 3, 3, 3] };
    const card: Draft = { notebook: [3, 5, 4, 4], environment: [3, 4, 6, 6], lakehouse: [2, 2, 2, 2] };
    expect(clashingRows(saved, sent, card)).toEqual(['environment', 'pipeline']);
  });
});

describe('describeClashes', () => {
  it('names each clashing row in catalog order, with the newer value or "cleared", falling back to the id', () => {
    const card: Draft = { environment: [3, 4, 6, 6] };
    const names = { notebook: 'Notebook', environment: 'Environment' };
    expect(describeClashes(['environment', 'notebook', 'unknown'], card, names)).toEqual([
      'Notebook (newer card: cleared)',
      'Environment (newer card: 3 · 4 · 6 · 6)',
      'unknown (newer card: cleared)',
    ]);
    expect(describeClashes([], card, names)).toEqual([]);
  });
});

describe('saveRaterCard', () => {
  it('saves when the review still has the card the editor opened with', async () => {
    const after = review({ 9: edited, 2: adminCard });
    const api = server(review({ 9: opened, 2: adminCard }), () => reply(200, after));
    await expect(saveRaterCard(round.id, raterA.userId, opened, edited)).resolves.toEqual({
      kind: 'saved',
      review: after,
    });
    expect(api.calls()).toEqual(['GET /api/admin/rounds/2026-Q4/review', 'PUT /api/admin/rounds/2026-Q4/scores/9']);
    expect(api.sent()).toEqual({ scores: edited });
  });

  it('does not save over a card the rater changed after the editor opened', async () => {
    const newer = review({ 9: { ...opened, environment: [7, 7, 7, 7] }, 2: adminCard });
    const api = server(newer, () => reply(200, newer));
    await expect(saveRaterCard(round.id, raterA.userId, opened, edited)).resolves.toEqual({
      kind: 'changed',
      review: newer,
    });
    expect(api.calls()).toEqual(['GET /api/admin/rounds/2026-Q4/review']);
  });

  it("saves when only someone else's card changed, or this one was saved again unchanged", async () => {
    const others = review({ 9: opened, 2: { notebook: [1, 1, 1, 1] } });
    const api = server(others, () => reply(200, review({ 9: edited })));
    await expect(saveRaterCard(round.id, raterA.userId, opened, edited)).resolves.toMatchObject({ kind: 'saved' });
    expect(api.calls()).toHaveLength(2);
  });

  it('leaves other refusals to the server, in its own words', async () => {
    const error = 'An item on this card was just deleted. Reload the page to get the current list.';
    server(review({ 9: opened }), () => reply(409, { error }));
    await expect(saveRaterCard(round.id, raterA.userId, opened, edited)).rejects.toMatchObject({
      status: 409,
      message: error,
    });
  });

  it('sends no PUT when the check itself fails', async () => {
    const fetchMock = vi.fn(async () => reply(503, { error: 'The ratings database is not responding.' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(saveRaterCard(round.id, raterA.userId, opened, edited)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('pressRaterSave', () => {
  function page(live: Draft) {
    return { saving: vi.fn(), live: () => live, saved: vi.fn(), refreshed: vi.fn(), failed: vi.fn() };
  }

  const names = { notebook: 'Notebook', environment: 'Environment' };

  function form(blocked: boolean) {
    return { blocked, roundId: round.id, rater: raterA, saved: opened, sent: edited, scores: edited, names };
  }

  it('does nothing while Save is blocked', async () => {
    const fetchMock = vi.fn(async () => reply(200, review({ 9: opened })));
    vi.stubGlobal('fetch', fetchMock);
    const handlers = page(edited);
    await pressRaterSave(form(true), handlers);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(handlers.saving).not.toHaveBeenCalled();
  });

  it('closes the editor when the save went through and nothing moved meanwhile', async () => {
    const after = review({ 9: edited });
    server(review({ 9: opened }), () => reply(200, after));
    const handlers = page(edited);
    await pressRaterSave(form(false), handlers);
    expect(handlers.saving).toHaveBeenCalledOnce();
    expect(handlers.saved).toHaveBeenCalledWith(after);
    expect(handlers.refreshed).not.toHaveBeenCalled();
  });

  it('stays open after a save when a slider moved meanwhile, and keeps that move unsaved', async () => {
    const after = review({ 9: edited });
    server(review({ 9: opened }), () => reply(200, after));
    const moved: Draft = { ...edited, environment: [7, 7, 7, 7] };
    const handlers = page(moved);
    await pressRaterSave(form(false), handlers);
    expect(handlers.saved).not.toHaveBeenCalled();
    const [next, rebased, message] = handlers.refreshed.mock.calls[0] ?? [];
    expect(next).toEqual(after);
    expect(rebased(moved)).toEqual(moved);
    expect(message).toEqual({ text: CHANGED_WHILE_SAVING, saved: true });
  });

  it("puts the admin's edits on top of the rater's newer card, without saving, and says so", async () => {
    const newer = review({ 9: { ...opened, environment: [7, 7, 7, 7] } });
    const api = server(newer, () => reply(200, newer));
    const handlers = page(edited);
    await pressRaterSave(form(false), handlers);
    expect(api.calls()).toEqual(['GET /api/admin/rounds/2026-Q4/review']);
    const [next, rebased, message] = handlers.refreshed.mock.calls[0] ?? [];
    expect(next).toEqual(newer);
    expect(rebased(edited)).toEqual({ notebook: [3, 5, 4, 4], environment: [7, 7, 7, 7] });
    expect(message).toEqual({ text: raterCardChanged('P2 Rater A'), saved: false });
    expect(message.text).toMatch(/^P2 Rater A's card changed after you opened it/);
  });

  it('names each row both sides changed, with the newer values the admin would override', async () => {
    const newer = review({ 9: { notebook: [2, 5, 4, 4], environment: [3, 4, 6, 6] } });
    server(newer, () => reply(200, newer));
    const sent = { notebook: [2, 5, 4, 4], environment: [3, 5, 7, 7] } as const;
    const handlers = page(sent);
    await pressRaterSave({ ...form(false), sent, scores: sent }, handlers);
    const [, rebased, message] = handlers.refreshed.mock.calls[0] ?? [];
    expect(rebased(sent)).toEqual(sent);
    expect(message.text).toBe(
      "P2 Rater A's card changed after you opened it, on their page or in another admin window, including a row " +
        'you changed too: Environment (newer card: 3 · 4 · 6 · 6). Your values are kept on it, and the rest of the card ' +
        'shows the newer scores. Check it, then save again.',
    );
  });

  it('lists several clashing rows in catalog order, and says when the newer card cleared one', async () => {
    const newer = review({ 9: { environment: [3, 4, 6, 6] } });
    server(newer, () => reply(200, newer));
    const sent = { notebook: [3, 5, 4, 4], environment: [3, 5, 7, 7] } as const;
    const handlers = page(sent);
    await pressRaterSave({ ...form(false), sent, scores: sent }, handlers);
    const [, , message] = handlers.refreshed.mock.calls[0] ?? [];
    expect(message.text).toContain(
      'including rows you changed too: Notebook (newer card: cleared) and Environment (newer card: 3 · 4 · 6 · 6). ' +
        'Your values are kept on them',
    );
    expect(message.text).toMatch(/Check them, then save again\.$/);
  });

  it("shows a failed save in the server's words", async () => {
    const error = 'That conflicts with a change someone just made. Reload the page and try again.';
    server(review({ 9: opened }), () => reply(409, { error }));
    const handlers = page(edited);
    await pressRaterSave(form(false), handlers);
    expect(handlers.failed).toHaveBeenCalledWith(error);
    expect(handlers.saved).not.toHaveBeenCalled();
  });
});

describe('saveFailureMessage', () => {
  it("keeps the server's 409 words and says the draft is kept", () => {
    const reason = new ApiError(409, 'The open round is now Q1 2027. Reload the page to score it.');
    expect(saveFailureMessage(reason)).toBe(
      'The open round is now Q1 2027. Reload the page to score it. Your draft is kept in this browser.',
    );
  });

  it('says the draft is kept when the server is unreachable, asleep, or rejects an item', () => {
    for (const status of [0, 400, 503]) {
      expect(saveFailureMessage(new ApiError(status, 'Try again.'))).toBe(
        'Try again. Your draft is kept in this browser.',
      );
    }
  });
});

describe('saveStateText', () => {
  const error = { kind: 'error', message: 'Try again. Your draft is kept in this browser.', reload: false } as const;
  const updatedAt = '2026-10-15T23:00:00.000Z';

  it('still says the card has unsaved changes while a failed save is shown', () => {
    expect(saveStateText(error, { dirty: true, restored: false, updatedAt })).toBe('Unsaved changes');
    expect(saveStateText(error, { dirty: true, restored: true, updatedAt })).toBe('Unsaved draft restored');
  });

  it('says saving, saved, or nothing saved yet', () => {
    expect(saveStateText({ kind: 'saving' }, { dirty: true, restored: false, updatedAt })).toBe('Saving…');
    expect(saveStateText({ kind: 'idle' }, { dirty: false, restored: false, updatedAt })).toMatch(/^Saved [A-Z]/);
    expect(saveStateText(error, { dirty: false, restored: false, updatedAt: null })).toBe('Nothing saved yet');
  });
});
