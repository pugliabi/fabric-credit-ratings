// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCatalog, RoundReview } from '../domain/api-types';
import { holdUnsaved } from '../hooks/useUnsavedWork';
import { act } from 'react';
import { cleanup, click, fakeApi, find, render, settle } from '../test/dom';
import { AdminPage } from './AdminPage';

const q4 = { id: '2026-Q4', label: 'Q4 2026', status: 'open' as const, publishedOn: null };
const catalog: AdminCatalog = {
  workloads: [{ id: 'data-engineering', name: 'Data Engineering', shortName: 'Data Eng', blurb: '', sortOrder: 1 }],
  artifacts: [
    { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga', sortOrder: 1, referenced: true },
  ],
};
const review: RoundReview = { round: q4, raters: [], items: [], notes: {}, aiEnabled: false };

function server() {
  return fakeApi({
    'GET /api/me': { id: 2, login: 'admin', displayName: 'Ada Admin', role: 'admin' },
    'GET /api/admin/rounds': [{ ...q4, scorecards: 0, notes: 0 }],
    'GET /api/admin/catalog': catalog,
    'GET /api/admin/users': [],
    'GET /api/catalog': catalog,
    'GET /api/rounds/open/my-scores': { round: q4, scores: {}, updatedAt: null, previous: null },
    'GET /api/admin/rounds/2026-Q4/review': review,
    'GET /api/admin/site': { lastSnapshotAt: null, behind: false, deployConfigured: false },
  });
}

const current = (root: ParentNode) => root.querySelector('nav [aria-current="page"]')?.textContent;

async function goTo(hash: string) {
  await act(async () => {
    history.replaceState(null, '', hash);
    dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await settle();
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
});
