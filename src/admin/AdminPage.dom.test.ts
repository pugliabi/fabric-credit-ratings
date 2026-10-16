// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNSAVED_WORK_ON_LOGOUT } from '../account/logout';
import { ADMIN_EXPIRED } from '../account/useSession';
import type { AdminCatalog, MyScores, RoundReview } from '../domain/api-types';
import { holdUnsaved, LEAVE_UNSAVED } from '../hooks/useUnsavedWork';
import { cleanup, click, fakeApi, find, render, settle, type } from '../test/dom';
import { AdminPage } from './AdminPage';

const q4 = { id: '2026-Q4', label: 'Q4 2026', status: 'open' as const, publishedOn: null };
const catalog: AdminCatalog = {
  workloads: [{ id: 'data-engineering', name: 'Data Engineering', shortName: 'Data Eng', blurb: '', sortOrder: 1 }],
  artifacts: [
    {
      id: 'notebook',
      name: 'Notebook',
      workload: 'data-engineering',
      status: 'ga',
      naFactors: [],
      sortOrder: 1,
      referenced: true,
      description: '',
    },
  ],
};
const review: RoundReview = {
  round: q4,
  raters: [{ userId: 9, name: 'P2 Rater A' }],
  items: [
    {
      artifact: { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga', naFactors: [] },
      point: {
        round: q4.id,
        roundLabel: q4.label,
        date: '2026-10-15',
        scores: { capability: 4, ux: 5, cost: 4, outlook: 4 },
        raters: 1,
        grade: 'BBB',
        note: '',
      },
      previous: null,
      change: { kind: 'new', text: 'First rating' },
      breakdown: [{ userId: 9, name: 'P2 Rater A', scores: [4, 5, 4, 4] }],
    },
  ],
  notes: {},
  aiEnabled: false,
};
const card: MyScores = {
  round: q4,
  scores: { notebook: [5, 5, 5, 5] },
  updatedAt: '2026-10-15T23:00:00Z',
  previous: null,
};
const WAKING = 'The ratings database is not responding. Try again in a minute.';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function server(overrides: Record<string, unknown> = {}) {
  return fakeApi({
    'GET /api/me': { id: 2, login: 'admin', displayName: 'Ada Admin', role: 'admin' },
    'GET /api/admin/rounds': [{ ...q4, scorecards: 1, notes: 0 }],
    'GET /api/admin/catalog': catalog,
    'GET /api/admin/users': [],
    'GET /api/catalog': catalog,
    'GET /api/rounds/open/my-scores': card,
    'GET /api/admin/rounds/2026-Q4/review': review,
    'GET /api/admin/site': { lastSnapshotAt: null, behind: false, deployConfigured: false },
    'PUT /api/admin/rounds/2026-Q4/notes/notebook': null,
    'POST /api/auth/logout': null,
    ...overrides,
  });
}

const current = (root: ParentNode) => root.querySelector('nav [aria-current="page"]')?.textContent;
const why = (root: ParentNode) => root.querySelector('textarea[aria-label="Why this rating for Notebook"]');
const count = (api: ReturnType<typeof server>, path: string) => api.calls.filter((call) => call.path === path).length;

async function goTo(hash: string) {
  await act(async () => {
    history.replaceState(null, '', hash);
    dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await settle();
}

/** Lets chains of fetches, renders, and effects run their course (a macrotask per step). */
async function settleAll(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

let release = () => {};

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', '');
  history.replaceState(null, '', '#score');
  vi.stubGlobal('fetch', server().fetchMock);
});

afterEach(async () => {
  release();
  await cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('AdminPage tabs', () => {
  it('follows a hash typed into the open page', async () => {
    const { container } = await render(AdminPage, {});
    await settle();
    expect(current(container)).toBe('Score');
    await goTo('#review');
    expect(current(container)).toBe('Review & why');
    await goTo('#publish');
    expect(current(container)).toBe('Publish');
  });

  it('asks before a hash or a tab drops unsaved work; Cancel stays and puts the hash back', async () => {
    const { container } = await render(AdminPage, {});
    await settle();
    await goTo('#review');
    release = holdUnsaved();
    const answers = [false, false, true];
    const ask = vi.fn(() => answers.shift());
    vi.stubGlobal('confirm', ask);

    await goTo('#publish');
    expect(current(container)).toBe('Review & why');
    expect(location.hash).toBe('#review');

    await click(find(container, 'nav button', 'Score'));
    expect(current(container)).toBe('Review & why');

    await click(find(container, 'nav button', 'Score'));
    expect(current(container)).toBe('Score');
    expect(location.hash).toBe('#score');
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('asks before a tab switch drops a why typed moments ago, still waiting for its autosave', async () => {
    history.replaceState(null, '', '#review');
    const api = server();
    vi.stubGlobal('fetch', api.fetchMock);
    const ask = vi.fn(() => false);
    vi.stubGlobal('confirm', ask);
    const { container } = await render(AdminPage, {});
    await settleAll();
    await type(why(container), 'Typed just now.');
    await click(find(container, 'nav button', 'Publish'));
    expect(ask).toHaveBeenCalledExactlyOnceWith(LEAVE_UNSAVED);
    expect(current(container)).toBe('Review & why');
    expect(count(api, '/api/admin/rounds/2026-Q4/notes/notebook')).toBe(0);
  });

  it('asks before a tab switch drops a why whose save failed and waits for Retry', async () => {
    history.replaceState(null, '', '#review');
    const failing = server({ 'PUT /api/admin/rounds/2026-Q4/notes/notebook': () => json({ error: WAKING }, 503) });
    vi.stubGlobal('fetch', failing.fetchMock);
    const ask = vi.fn(() => false);
    vi.stubGlobal('confirm', ask);
    const { container } = await render(AdminPage, {});
    await settleAll();
    await type(why(container), 'Not saved.');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
    });
    await settle();
    expect(find(container, 'button', 'Retry')).not.toBeNull();
    await click(find(container, 'nav button', 'Publish'));
    expect(ask).toHaveBeenCalledExactlyOnceWith(LEAVE_UNSAVED);
    expect(current(container)).toBe('Review & why');
  });
});

describe('AdminPage session and loads', () => {
  it('re-reads /me once for a 403 it cannot explain, then shows the message instead of looping', async () => {
    // /me answers a moment later, as over a network, so "loading" and "signed in" render apart as in a browser.
    const admin = { id: 2, login: 'admin', displayName: 'Ada Admin', role: 'admin' };
    const api = server({
      'GET /api/me': () => new Promise<Response>((resolve) => setTimeout(() => resolve(json(admin)), 20)),
      'GET /api/admin/rounds': () => json({ error: 'Only admins can do that.' }, 403),
    });
    vi.stubGlobal('fetch', api.fetchMock);
    const { container } = await render(AdminPage, {});
    await settleAll(20);
    expect(find(container, 'h2', 'Could not load the admin page')).not.toBeNull();
    expect(container.textContent).toContain('Only admins can do that.');
    expect(count(api, '/api/me')).toBe(2);
  });

  it("remounts the Score tab's card once when it says no round is open but the rounds still list one", async () => {
    const api = server({
      'GET /api/rounds/open/my-scores': () => json({ error: 'No round is open for scoring right now.' }, 409),
    });
    vi.stubGlobal('fetch', api.fetchMock);
    const { container } = await render(AdminPage, {});
    await settleAll(10);
    expect(container.textContent).toContain('Checking the rounds…');
    expect(count(api, '/api/rounds/open/my-scores')).toBe(2);
  });

  it("reloads the rounds and the card in place from the save's Reload page", async () => {
    let cardReads = 0;
    const api = server({
      'GET /api/rounds/open/my-scores': () => {
        cardReads += 1;
        return cardReads === 2
          ? json({ error: 'That conflicts with a change someone just made. Reload the page and try again.' }, 409)
          : json(card);
      },
    });
    vi.stubGlobal('fetch', api.fetchMock);
    const reload = vi.spyOn(location, 'reload').mockImplementation(() => {});
    const { container } = await render(AdminPage, {});
    await settleAll();
    await type(container.querySelector('input[aria-label="Notebook, Feature Capability"]'), '6');
    await click(find(container, 'button', 'Save scores'));
    await settleAll();
    const roundsBefore = count(api, '/api/admin/rounds');
    await click(find(container, 'button', 'Reload page'));
    await settleAll();
    expect(reload).not.toHaveBeenCalled();
    expect(count(api, '/api/admin/rounds')).toBe(roundsBefore + 1);
    expect(cardReads).toBe(3);
    expect(container.querySelector('[role="group"][aria-label="Your scorecard"]')?.textContent).toContain(
      'Unsaved draft restored',
    );
  });

  it('shows your new name in the header once you rename yourself on the Users tab', async () => {
    history.replaceState(null, '', '#users');
    const me = { id: 2, login: 'admin', displayName: 'Ada Admin', role: 'admin' as const };
    const row = { ...me, active: true, createdAt: '2026-10-01T00:00:00Z', lastScoredRound: null };
    const api = server({
      'GET /api/admin/users': [row],
      'PUT /api/admin/users/2': (body: unknown) => [{ ...row, ...(body as object) }],
    });
    vi.stubGlobal('fetch', api.fetchMock);
    const { container } = await render(AdminPage, {});
    await settleAll();
    expect(container.querySelector('header')?.textContent).toContain('Logged in as Ada Admin');
    await click(find(container, 'button', 'Edit'));
    const name = container.querySelector<HTMLInputElement>('td input[maxlength="80"]');
    await type(name, 'Bea Admin');
    await click(find(container, 'button', 'Save'));
    await settleAll();
    expect(container.textContent).toContain('Bea Admin is saved.');
    expect(container.querySelector('header')?.textContent).toContain('Logged in as Bea Admin');
    expect(container.querySelector('header')?.textContent).not.toContain('Ada Admin');
  });

  it('asks before Log out drops unsaved whys, once', async () => {
    history.replaceState(null, '', '#review');
    const api = server();
    vi.stubGlobal('fetch', api.fetchMock);
    const answers = [false, true];
    const ask = vi.fn(() => answers.shift());
    vi.stubGlobal('confirm', ask);
    const { container } = await render(AdminPage, {});
    await settleAll();
    await type(why(container), 'Typed just now.');
    await click(find(container, 'button', 'Log out'));
    expect(ask).toHaveBeenLastCalledWith(UNSAVED_WORK_ON_LOGOUT);
    expect(count(api, '/api/auth/logout')).toBe(0);
    expect(current(container)).toBe('Review & why');
    await click(find(container, 'button', 'Log out'));
    await settleAll();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(count(api, '/api/auth/logout')).toBe(1);
    expect(find(container, 'h2', 'Admin login')).not.toBeNull();
  });

  it('asks nothing at Log out for a stored edit on an item the catalog no longer has', async () => {
    // The Score tab prunes such rows when it mounts; Log out from another tab must judge by the current catalog too.
    localStorage.setItem(
      'fcr-card:2:2026-Q4',
      JSON.stringify({ base: { notebook: [5, 5, 5, 5] }, draft: { notebook: [5, 5, 5, 5], gone: [6, 5, 5, 5] } }),
    );
    history.replaceState(null, '', '#catalog');
    const api = server();
    vi.stubGlobal('fetch', api.fetchMock);
    const ask = vi.fn(() => false);
    vi.stubGlobal('confirm', ask);
    const { container } = await render(AdminPage, {});
    await settleAll();
    await click(find(container, 'button', 'Log out'));
    await settleAll();
    expect(ask).not.toHaveBeenCalled();
    expect(count(api, '/api/auth/logout')).toBe(1);
    expect(localStorage.getItem('fcr-card:2:2026-Q4')).toBeNull();
  });

  it('asks nothing when the session ends on its own, and says what was lost', async () => {
    history.replaceState(null, '', '#review');
    const expired = () => json({ error: 'Log in first.' }, 401);
    const expiring = server({ 'PUT /api/admin/rounds/2026-Q4/notes/notebook': expired });
    vi.stubGlobal('fetch', expiring.fetchMock);
    const ask = vi.fn(() => true);
    vi.stubGlobal('confirm', ask);
    const { container } = await render(AdminPage, {});
    await settleAll();
    await type(why(container), 'Typed before the session ran out.');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
    });
    await settleAll();
    expect(find(container, 'h2', 'Admin login')).not.toBeNull();
    expect(container.textContent).toContain(ADMIN_EXPIRED);
    expect(ask).not.toHaveBeenCalled();
  });
});
