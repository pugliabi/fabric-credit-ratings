import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, onSlow, SLOW_MS } from '../lib/api';
import {
  draftBlanks,
  draftItem,
  KEPT_LEAKING,
  requestDraft,
  stopDrafting,
  TIMED_OUT,
  type DraftPage,
} from './draft-loop';
import { withNote, type Edits } from './notes';

const fail = (status: number, message: string) => new ApiError(status, message);
const RATE_LIMIT = "Anthropic's rate limit was reached. Wait a minute, then try again.";

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', '');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('stopDrafting', () => {
  it('goes on past failures that belong to one item', () => {
    expect(stopDrafting(fail(502, KEPT_LEAKING), 0)).toBe(false);
    expect(stopDrafting(fail(404, 'That item does not exist.'), 0)).toBe(false);
    expect(stopDrafting(fail(400, 'Notebook has no scores in Q4 2026 yet.'), 0)).toBe(false);
  });

  it('stops when every later item would fail the same way', () => {
    const everyItem = [
      fail(502, RATE_LIMIT),
      fail(502, 'Anthropic is overloaded right now. Try again in a minute.'),
      fail(502, 'Anthropic rejected ANTHROPIC_API_KEY. Check the key in the Function App settings.'),
      fail(502, "ANTHROPIC_MODEL names a model this key can't use. Check the setting in the Function App."),
      fail(
        502,
        'This Anthropic key is not scoped to a workspace. Set ANTHROPIC_WORKSPACE_ID in the Function App settings ' +
          '(Claude Console, Settings, Workspaces), or create the key inside a workspace.',
      ),
      fail(
        502,
        "ANTHROPIC_API_KEY has a line break or another character a request header can't carry. Paste the key again " +
          'in the Function App settings.',
      ),
      fail(502, '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'),
      fail(400, 'Set ANTHROPIC_API_KEY in the Function App settings to draft with AI.'),
      fail(503, 'The ratings database is not responding. Try again in a minute.'),
      fail(0, 'Could not reach the ratings server. Check your connection, then try again.'),
    ];
    for (const reason of everyItem) expect(stopDrafting(reason, 0)).toBe(true);
    expect(stopDrafting(new Error('boom'), 0)).toBe(true);
  });

  it('stops after the second timeout in a row', () => {
    expect(stopDrafting(fail(502, TIMED_OUT), 1)).toBe(false);
    expect(stopDrafting(fail(502, TIMED_OUT), 2)).toBe(true);
  });

  it('stops on a 404 for the round itself', () => {
    expect(stopDrafting(fail(404, 'Round 2026-Q4 does not exist.'), 0)).toBe(true);
  });
});

describe('requestDraft', () => {
  it('asks for one draft and never shows the wake notice, however long the answer takes', async () => {
    vi.useFakeTimers();
    let finish: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      (_url: string, _init?: RequestInit) => new Promise<Response>((resolve) => (finish = resolve)),
    );
    vi.stubGlobal('fetch', fetchMock);
    const states: boolean[] = [];
    const stop = onSlow((slow) => states.push(slow));
    const pending = requestDraft('2026-Q4', 'notebook');
    await vi.advanceTimersByTimeAsync(SLOW_MS * 3);
    finish(new Response(JSON.stringify({ text: 'A first pass.' }), { status: 200 }));
    await expect(pending).resolves.toEqual({ text: 'A first pass.' });
    stop();
    expect(states).toEqual([false]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/rounds/2026-Q4/draft/notebook');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
  });
});

/** A fake page: drafts come from `answers`, and `edits` changes as the panel's state would. */
function fakePage(answers: Record<string, () => Promise<{ text: string }>>, start?: Edits) {
  const state = {
    edits: start ?? { notes: {}, dirty: new Set<string>() },
    asked: [] as string[],
    busy: [] as (string | undefined)[],
    failures: {} as Record<string, unknown>,
  };
  const page: DraftPage = {
    request: (id) => {
      state.asked.push(id);
      return answers[id]?.() ?? Promise.reject(new ApiError(502, `no answer for ${id}`));
    },
    busy: (id) => state.busy.push(id),
    failed: (id, reason) => {
      if (reason === undefined) delete state.failures[id];
      else state.failures[id] = reason;
    },
    edit: (change) => {
      state.edits = change(state.edits);
    },
  };
  return { page, state };
}

describe('draftItem', () => {
  it('puts the draft in the box as an unsaved edit, over any text, for a single item', async () => {
    const { page, state } = fakePage({ notebook: async () => ({ text: 'Drafted.' }) }, {
      notes: { notebook: 'Old text.' },
      dirty: new Set(),
    });
    await expect(draftItem(page, 'notebook', false)).resolves.toBeUndefined();
    expect(state.edits).toEqual({ notes: { notebook: 'Drafted.' }, dirty: new Set(['notebook']) });
    expect(state.busy).toEqual(['notebook', undefined]);
  });

  it('resolves to the failure and shows it on the item, clearing an older one first', async () => {
    const reason = fail(502, KEPT_LEAKING);
    const { page, state } = fakePage({ notebook: () => Promise.reject(reason) });
    state.failures.notebook = 'an older failure';
    await expect(draftItem(page, 'notebook', false)).resolves.toBe(reason);
    expect(state.failures).toEqual({ notebook: reason });
    expect(state.busy).toEqual(['notebook', undefined]);
  });
});

describe('draftBlanks', () => {
  it('fills only boxes still blank: one typed in while its draft was out keeps the typed text', async () => {
    const { page, state } = fakePage({
      notebook: async () => {
        state.edits = withNote(state.edits, 'notebook', 'Typed by hand.');
        return { text: 'Drafted.' };
      },
      environment: async () => ({ text: 'Drafted too.' }),
    });
    await draftBlanks(page, ['notebook', 'environment'], () => false, () => {});
    expect(state.edits.notes).toEqual({ notebook: 'Typed by hand.', environment: 'Drafted too.' });
  });

  it('goes on past an item that needs a human, and stops where every later item would fail the same way', async () => {
    const progress: number[] = [];
    const { page, state } = fakePage({
      a: () => Promise.reject(fail(502, KEPT_LEAKING)),
      b: async () => ({ text: 'B.' }),
      c: () => Promise.reject(fail(502, RATE_LIMIT)),
      d: async () => ({ text: 'D.' }),
    });
    await draftBlanks(page, ['a', 'b', 'c', 'd'], () => false, (done) => progress.push(done));
    expect(state.asked).toEqual(['a', 'b', 'c']);
    expect(progress).toEqual([0, 1, 2, 3]);
  });

  it('stops after two timeouts in a row, but not after two apart', async () => {
    const timedOut = () => Promise.reject(fail(502, TIMED_OUT));
    const answered = async () => ({ text: 'Drafted.' });
    const apart = fakePage({ a: timedOut, b: answered, c: timedOut, d: answered });
    await draftBlanks(apart.page, ['a', 'b', 'c', 'd'], () => false, () => {});
    expect(apart.state.asked).toEqual(['a', 'b', 'c', 'd']);
    const inARow = fakePage({ a: timedOut, b: timedOut, c: async () => ({ text: 'C.' }) });
    await draftBlanks(inARow.page, ['a', 'b', 'c'], () => false, () => {});
    expect(inARow.state.asked).toEqual(['a', 'b']);
  });

  it('asks for nothing more once cancelled', async () => {
    let cancelled = false;
    const { page, state } = fakePage({
      a: async () => {
        cancelled = true;
        return { text: 'A.' };
      },
      b: async () => ({ text: 'B.' }),
    });
    await draftBlanks(page, ['a', 'b'], () => cancelled, () => {});
    expect(state.asked).toEqual(['a']);
  });
});
