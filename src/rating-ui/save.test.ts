import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyScores } from '../domain/api-types';
import type { Round } from '../domain/types';
import { ApiError } from '../lib/api';
import type { Draft } from './draft';
import {
  CHANGED_ELSEWHERE,
  pressSave,
  saveBlocked,
  saveCard,
  saveFailureMessage,
  saveStateText,
  settleSave,
} from './save';

const round: Round = { id: '2026-Q4', label: 'Q4 2026', status: 'open', publishedOn: null };
const loaded = { notebook: [5, 5, 5] } as const;

function card(scores: MyScores['scores'], updatedAt = '2026-10-15T23:00:00.000Z', open = round): MyScores {
  return { round: open, scores, updatedAt, previous: null };
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Answers GETs with `latest` and PUTs with `put`, and records each call as "METHOD /path". */
function server(latest: MyScores, put: () => Response) {
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
    const after = card({ notebook: [6, 5, 5] }, '2026-10-15T23:05:00.000Z');
    const api = server(card(loaded), () => reply(200, after));
    await expect(saveCard(round.id, loaded, { notebook: [6, 5, 5] })).resolves.toEqual({ kind: 'saved', card: after });
    expect(api.calls()).toEqual(['GET /api/rounds/open/my-scores', 'PUT /api/rounds/open/my-scores']);
    expect(api.sent()).toEqual({ round: '2026-Q4', scores: { notebook: [6, 5, 5] } });
  });

  it('does not save over a card that changed after this page loaded it', async () => {
    const newer = card({ notebook: [5, 5, 5], lakehouse: [6, 6, 6] }, '2026-10-15T23:04:00.000Z');
    const api = server(newer, () => reply(200, newer));
    await expect(saveCard(round.id, loaded, { notebook: [6, 5, 5] })).resolves.toEqual({
      kind: 'changed',
      card: newer,
    });
    expect(api.calls()).toEqual(['GET /api/rounds/open/my-scores']);
  });

  it('saves when the card was only saved again with the same scores', async () => {
    const resaved = card(loaded, '2026-10-15T23:04:00.000Z');
    const api = server(resaved, () => reply(200, card({ notebook: [6, 5, 5] })));
    await expect(saveCard(round.id, loaded, { notebook: [6, 5, 5] })).resolves.toMatchObject({ kind: 'saved' });
    expect(api.calls()).toHaveLength(2);
  });

  it('leaves a newly opened round to the server, which refuses the save in its own words', async () => {
    const next: Round = { id: '2027-Q1', label: 'Q1 2027', status: 'open', publishedOn: null };
    const error = 'The open round is now Q1 2027. Reload the page to score it.';
    server(card({}, '2027-01-02T10:00:00.000Z', next), () => reply(409, { error }));
    await expect(saveCard(round.id, loaded, { notebook: [6, 5, 5] })).rejects.toMatchObject({
      status: 409,
      message: error,
    });
  });

  it('sends no PUT when the check itself fails', async () => {
    const fetchMock = vi.fn(async () => reply(503, { error: 'The ratings database is not responding.' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(saveCard(round.id, loaded, { notebook: [6, 5, 5] })).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('settleSave', () => {
  const ids = new Set(['notebook', 'lakehouse']);
  const base: Draft = { notebook: [5, 5, 5] };
  const sent: Draft = { notebook: [6, 5, 5] };

  it('keeps a slider moved while the save was out', () => {
    const after = settleSave({ kind: 'saved', card: card({ notebook: [6, 5, 5] }) }, base, sent, ids);
    expect(after.draft({ ...sent, lakehouse: [2, 2, 2] })).toEqual({ ...sent, lakehouse: [2, 2, 2] });
    expect(after.status).toEqual({ kind: 'idle' });
  });

  it('puts the edits on top of a card changed elsewhere, keeps later moves, and asks for a check', () => {
    const newer = card({ notebook: [5, 5, 5], lakehouse: [4, 4, 4] });
    const after = settleSave({ kind: 'changed', card: newer }, base, sent, ids);
    expect(after.draft({ notebook: [7, 5, 5] })).toEqual({ notebook: [7, 5, 5], lakehouse: [4, 4, 4] });
    expect(after.status).toMatchObject({ kind: 'error', message: CHANGED_ELSEWHERE });
  });

  it('says nothing when the other save already holds these edits', () => {
    const newer = card({ notebook: [6, 5, 5], lakehouse: [4, 4, 4] });
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
  const sent: Draft = { notebook: [6, 5, 5] };

  function page() {
    return { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
  }

  function form(blocked: boolean) {
    return { blocked, roundId: round.id, saved: loaded, sent, scores: { notebook: [6, 5, 5] } as const, ids };
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
    const after = card({ notebook: [6, 5, 5] }, '2026-10-15T23:05:00.000Z');
    const api = server(card(loaded), () => reply(200, after));
    const handlers = page();
    await pressSave(form(false), handlers);
    expect(api.calls()).toEqual(['GET /api/rounds/open/my-scores', 'PUT /api/rounds/open/my-scores']);
    expect(handlers.saving).toHaveBeenCalledOnce();
    const [savedCard, settled] = handlers.saved.mock.calls[0] ?? [];
    expect(savedCard).toEqual(after);
    expect(settled.draft({ ...sent, lakehouse: [2, 2, 2] })).toEqual({ ...sent, lakehouse: [2, 2, 2] });
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
