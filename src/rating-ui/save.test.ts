import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyScores } from '../domain/api-types';
import type { Round } from '../domain/types';
import { saveCard } from './save';

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
    await expect(saveCard(round.id, loaded, { notebook: [6, 5, 5] })).resolves.toEqual({ kind: 'changed', card: newer });
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
    await expect(saveCard(round.id, loaded, { notebook: [6, 5, 5] })).rejects.toMatchObject({ status: 409, message: error });
  });
});
