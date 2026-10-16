// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCatalog, RoundReview } from '../domain/api-types';
import type { ScoreTriple } from '../domain/types';
import { fakeApi, find, render, settle, type } from '../test/dom';
import { RoundReviewPanel } from './ReviewTab';

const catalog: AdminCatalog = {
  workloads: [{ id: 'data-engineering', name: 'Data Engineering', shortName: 'Data Eng', blurb: '', sortOrder: 1 }],
  artifacts: [
    { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga', sortOrder: 1, referenced: true },
    { id: 'environment', name: 'Environment', workload: 'data-engineering', status: 'ga', sortOrder: 2, referenced: true },
    { id: 'lakehouse', name: 'Lakehouse', workload: 'data-engineering', status: 'ga', sortOrder: 3, referenced: true },
  ],
};

function review(notes: Record<string, string>, aiEnabled = false): RoundReview {
  const scores: ScoreTriple = [4, 5, 4];
  return {
    round: { id: '2026-Q4', label: 'Q4 2026', status: 'open', publishedOn: null },
    raters: [{ userId: 9, name: 'P2 Rater A' }],
    items: catalog.artifacts.map((artifact) => ({
      artifact,
      point: {
        round: '2026-Q4',
        roundLabel: 'Q4 2026',
        date: '2026-10-15',
        scores: { capability: 4, ux: 5, cost: 4 },
        raters: 1,
        grade: 'BBB',
        note: '',
      },
      previous: null,
      change: { kind: 'new', text: 'First rating' },
      breakdown: [{ userId: 9, name: 'P2 Rater A', scores }],
    })),
    notes,
    aiEnabled,
  };
}

const box = (root: ParentNode, name: string) =>
  root.querySelector<HTMLTextAreaElement>(`textarea[aria-label="Why this rating for ${name}"]`);
const shownItems = (root: ParentNode) =>
  [...root.querySelectorAll('article strong')].map((node) => node.textContent);

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', '');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.body.innerHTML = '';
});

describe('RoundReviewPanel', () => {
  it('keeps a box, and its focus, while a why is typed under "Only missing a why"', async () => {
    const api = fakeApi({ 'PUT /api/admin/rounds/2026-Q4/notes/environment': null });
    vi.stubGlobal('fetch', api.fetchMock);
    const { container } = await render(RoundReviewPanel, {
      review: review({ notebook: 'Because.' }),
      catalog,
      users: [],
      onReview: () => {},
    });
    const filter = find(container, 'label', 'Only missing a why')?.querySelector('input');
    filter?.click();
    await settle();
    expect(shownItems(container)).toEqual(['Environment', 'Lakehouse']);

    const environment = box(container, 'Environment');
    environment?.focus();
    await type(environment, 'W');
    await type(environment, 'Well documented.');
    expect(shownItems(container)).toEqual(['Environment', 'Lakehouse']);
    expect(document.activeElement).toBe(environment);
    expect(environment?.isConnected).toBe(true);
    expect(container.textContent).toContain('1 missing a why');
  });
});
