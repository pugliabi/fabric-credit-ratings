// @vitest-environment happy-dom
import { createElement, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCatalog, RoundReview } from '../domain/api-types';
import type { Artifact, Round, ScoreTriple } from '../domain/types';
import { click, fakeApi, find, render, settle, type } from '../test/dom';
import { RaterCardEditor } from './RaterCardEditor';

const q4: Round = { id: '2026-Q4', label: 'Q4 2026', status: 'open', publishedOn: null };
const rater = { userId: 9, name: 'P2 Rater A' };
const catalog: AdminCatalog = {
  workloads: [{ id: 'data-engineering', name: 'Data Engineering', shortName: 'Data Eng', blurb: '', sortOrder: 1 }],
  artifacts: [
    { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga', sortOrder: 1, referenced: true },
    { id: 'environment', name: 'Environment', workload: 'data-engineering', status: 'ga', sortOrder: 2, referenced: true },
  ],
};
const addedLater: Artifact = { id: 'added-later', name: 'Added later', workload: 'data-engineering', status: 'ga' };

function review(card: Record<string, ScoreTriple>): RoundReview {
  const known = [...catalog.artifacts, addedLater];
  return {
    round: q4,
    raters: [rater],
    items: Object.entries(card).map(([id, scores]) => ({
      artifact: known.find((artifact) => artifact.id === id) ?? addedLater,
      point: {
        round: q4.id,
        roundLabel: q4.label,
        date: '2026-10-15',
        scores: { capability: scores[0], ux: scores[1], cost: scores[2] },
        raters: 1,
        grade: 'BBB',
        note: '',
      },
      previous: null,
      change: { kind: 'new', text: 'First rating' },
      breakdown: [{ ...rater, scores }],
    })),
    notes: {},
    aiEnabled: false,
  };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** Holds the review the way RoundReviewPanel does, so onRefreshed feeds back into the editor. */
function Host({ initial, onSaved }: { initial: RoundReview; onSaved: (next: RoundReview) => void }) {
  const [current, setCurrent] = useState(initial);
  return createElement(RaterCardEditor, {
    review: current,
    rater,
    catalog,
    onSaved,
    onRefreshed: setCurrent,
    onCancel: () => {},
  });
}

const slider = (root: ParentNode, name: string) =>
  root.querySelector<HTMLInputElement>(`input[type="range"][aria-label="${name}"]`);
const value = (root: ParentNode, name: string) => slider(root, name)?.getAttribute('aria-valuetext');
const status = (root: ParentNode) => root.querySelector('[aria-live="polite"]')?.textContent ?? '';

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.body.innerHTML = '';
});

describe('RaterCardEditor', () => {
  it('reads the card again on open, keeps Save blocked and says so until it is in, then keeps edits on top', async () => {
    let answer: (response: Response) => void = () => {};
    const opened = review({ notebook: [2, 5, 4], environment: [3, 4, 7] });
    const newer = review({ notebook: [2, 5, 4], environment: [3, 4, 6] });
    const api = fakeApi({
      'GET /api/admin/rounds/2026-Q4/review': () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    vi.stubGlobal('fetch', api.fetchMock);
    const onSaved = vi.fn();
    const { container } = await render(Host, { initial: opened, onSaved });
    const save = find(container, 'button', 'Save card');

    expect(save?.getAttribute('aria-disabled')).toBe('true');
    expect(status(container)).toContain('Checking for newer scores…');
    await type(slider(container, 'Notebook, Feature Capability'), '3');
    expect(save?.getAttribute('aria-disabled')).toBe('true');

    answer(json(newer));
    await settle();
    expect(value(container, 'Environment, CU / Token Cost')).toBe('6');
    expect(value(container, 'Notebook, Feature Capability')).toBe('3');
    expect(save?.getAttribute('aria-disabled')).toBe('false');
    expect(status(container)).toContain('Newer scores loaded');

    api.calls.length = 0;
    const routes = fakeApi({
      'GET /api/admin/rounds/2026-Q4/review': newer,
      'PUT /api/admin/rounds/2026-Q4/scores/9': (body: unknown) => json({ ...newer, sentBack: body }),
    });
    vi.stubGlobal('fetch', routes.fetchMock);
    await click(save);
    await settle();
    expect(routes.calls.at(-1)?.body).toEqual({ scores: { notebook: [3, 5, 4], environment: [3, 4, 6] } });
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('keeps a reviewed item the page has not loaded, so a save never drops its score', async () => {
    const opened = review({ notebook: [2, 5, 4], 'added-later': [4, 4, 4] });
    const routes = fakeApi({
      'GET /api/admin/rounds/2026-Q4/review': opened,
      'PUT /api/admin/rounds/2026-Q4/scores/9': opened,
    });
    vi.stubGlobal('fetch', routes.fetchMock);
    const { container } = await render(Host, { initial: opened, onSaved: vi.fn() });
    await settle();
    const save = find(container, 'button', 'Save card');

    expect(container.textContent).toContain('2 of 3 rated');
    expect(value(container, 'Added later, Feature Capability')).toBe('4');
    expect(save?.getAttribute('aria-disabled')).toBe('true');

    await type(slider(container, 'Notebook, Feature Capability'), '3');
    await click(save);
    await settle();
    expect(routes.calls.find((call) => call.method === 'PUT')?.body).toEqual({
      scores: { notebook: [3, 5, 4], 'added-later': [4, 4, 4] },
    });
  });
});
