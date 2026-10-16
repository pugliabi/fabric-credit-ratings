// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCatalog, AdminRound, RoundReview } from '../domain/api-types';
import type { ScoreTuple } from '../domain/types';
import { mayLeave } from '../hooks/useUnsavedWork';
import { choose, cleanup, click, fakeApi, find, render, settle, type } from '../test/dom';
import { ReviewTab, RoundReviewPanel } from './ReviewTab';

const catalog: AdminCatalog = {
  workloads: [{ id: 'data-engineering', name: 'Data Engineering', shortName: 'Data Eng', blurb: '', sortOrder: 1 }],
  artifacts: [
    { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga', sortOrder: 1, referenced: true },
    {
      id: 'environment',
      name: 'Environment',
      workload: 'data-engineering',
      status: 'ga',
      sortOrder: 2,
      referenced: true,
    },
    { id: 'lakehouse', name: 'Lakehouse', workload: 'data-engineering', status: 'ga', sortOrder: 3, referenced: true },
  ],
};

function review(notes: Record<string, string>, aiEnabled = false, roundId = '2026-Q4'): RoundReview {
  const scores: ScoreTuple = [4, 5, 4, 4];
  const label = roundId === '2026-Q4' ? 'Q4 2026' : 'Q3 2026';
  return {
    round: { id: roundId, label, status: roundId === '2026-Q4' ? 'open' : 'published', publishedOn: null },
    raters: [
      { userId: 9, name: 'P2 Rater A' },
      { userId: 2, name: 'Tommy Puglia' },
    ],
    items: catalog.artifacts.map((artifact) => ({
      artifact,
      point: {
        round: '2026-Q4',
        roundLabel: 'Q4 2026',
        date: '2026-10-15',
        scores: { capability: 4, ux: 5, cost: 4, outlook: 4 },
        raters: 1,
        grade: 'BBB',
        note: '',
      },
      previous: null,
      change: { kind: 'new', text: 'First rating' },
      breakdown: [
        { userId: 9, name: 'P2 Rater A', scores },
        { userId: 2, name: 'Tommy Puglia', scores },
      ],
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

afterEach(async () => {
  await cleanup();
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

  it("opens a rater's card only from Edit card, not from moving through the list", async () => {
    vi.stubGlobal('fetch', fakeApi({ 'GET /api/admin/rounds/2026-Q4/review': review({}) }).fetchMock);
    const { container } = await render(RoundReviewPanel, panelProps());
    const edit = find(container, 'button', 'Edit card');
    expect(edit?.getAttribute('aria-disabled')).toBe('true');
    await choose(container.querySelector('select[aria-label="Edit a rater\'s card"]'), '9');
    expect(container.querySelector('[role="group"][aria-label="P2 Rater A\'s card"]')).toBeNull();
    await click(edit);
    await settle();
    expect(container.querySelector('[role="group"][aria-label="P2 Rater A\'s card"]')).not.toBeNull();
  });

  it("a save left running by Back to review doesn't close the next card or announce itself", async () => {
    let finish: (response: Response) => void = () => {};
    const routes = fakeApi({
      'GET /api/admin/rounds/2026-Q4/review': review({}),
      'PUT /api/admin/rounds/2026-Q4/scores/9': () => new Promise<Response>((resolve) => (finish = resolve)),
    });
    vi.stubGlobal('fetch', routes.fetchMock);
    vi.stubGlobal('confirm', () => true);
    const { container } = await render(RoundReviewPanel, panelProps());
    await openCard(container, '9');
    await type(container.querySelector('input[aria-label="Notebook, Feature Capability"]'), '3');
    await click(find(container, 'button', 'Save card'));
    await settle();
    await click(find(container, 'button', 'Back to review'));
    await openCard(container, '2');
    finish(new Response(JSON.stringify(review({})), { status: 200 }));
    await settle();
    expect(container.querySelector('[role="group"][aria-label="Tommy Puglia\'s card"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Saved P2 Rater A's card.");
  });

  it('stops "Draft all blank" when the panel goes away', async () => {
    const routes = fakeApi({
      'POST /api/admin/rounds/2026-Q4/draft/notebook': () =>
        new Promise<Response>((resolve) => setTimeout(() => resolve(new Response('{"text":"A."}')), 20)),
      'POST /api/admin/rounds/2026-Q4/draft/environment': { text: 'B.' },
      'POST /api/admin/rounds/2026-Q4/draft/lakehouse': { text: 'C.' },
    });
    vi.stubGlobal('fetch', routes.fetchMock);
    const { container, unmount } = await render(RoundReviewPanel, panelProps(review({}, true)));
    await click(find(container, 'button', /^Draft all blank with AI/));
    await unmount();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(routes.calls.map((call) => call.path)).toEqual(['/api/admin/rounds/2026-Q4/draft/notebook']);
  });

  it("lists a reviewed item whose workload this page's catalog hasn't loaded, under a group named by its id", async () => {
    vi.stubGlobal('fetch', fakeApi({}).fetchMock);
    const current = review({});
    const copilot = { id: 'copilot', name: 'Copilot', workload: 'fabric-iq', status: 'preview' as const };
    const added = { ...current, items: [...current.items, { ...current.items[0]!, artifact: copilot }] };
    const { container } = await render(RoundReviewPanel, panelProps(added));
    expect(shownItems(container)).toEqual(['Notebook', 'Environment', 'Lakehouse', 'Copilot']);
    expect(find(container, 'h2', 'fabric-iq')).not.toBeNull();
    expect(box(container, 'Copilot')).not.toBeNull();
    expect(container.textContent).toContain('4 missing a why');
  });

  it('asks before the page drops unsaved whys', async () => {
    vi.stubGlobal('fetch', fakeApi({}).fetchMock);
    const { container } = await render(RoundReviewPanel, panelProps());
    const ask = vi.fn(() => false);
    expect(mayLeave(ask)).toBe(true);
    await type(box(container, 'Lakehouse'), 'x'.repeat(2001));
    expect(mayLeave(ask)).toBe(false);
    expect(ask).toHaveBeenCalledOnce();
  });
});

describe('ReviewTab', () => {
  const rounds: AdminRound[] = [
    { id: '2026-Q4', label: 'Q4 2026', status: 'open', publishedOn: null, scorecards: 2, notes: 0 },
    { id: '2026-Q3', label: 'Q3 2026', status: 'published', publishedOn: '2026-09-30', scorecards: 2, notes: 3 },
  ];

  it('asks before another round drops unsaved whys; Cancel stays on this round', async () => {
    vi.stubGlobal(
      'fetch',
      fakeApi({
        'GET /api/admin/rounds/2026-Q4/review': review({}),
        'GET /api/admin/rounds/2026-Q3/review': review({}, false, '2026-Q3'),
      }).fetchMock,
    );
    const answers = [false, true];
    vi.stubGlobal('confirm', () => answers.shift());
    const { container } = await render(ReviewTab, { rounds, catalog, users: [] });
    await settle();
    await type(box(container, 'Lakehouse'), 'x'.repeat(2001));
    const picker = container.querySelector<HTMLSelectElement>('label select');

    await choose(picker, '2026-Q3');
    await settle();
    expect(picker?.value).toBe('2026-Q4');
    expect(box(container, 'Lakehouse')?.value).toHaveLength(2001);

    await choose(picker, '2026-Q3');
    await settle();
    expect(picker?.value).toBe('2026-Q3');
    expect(container.textContent).toContain('Q3 2026 is published');
  });
});

function panelProps(current = review({})) {
  return { review: current, catalog, users: [], onReview: () => {} };
}

async function openCard(container: HTMLElement, userId: string) {
  await choose(container.querySelector('select[aria-label="Edit a rater\'s card"]'), userId);
  await click(find(container, 'button', 'Edit card'));
  await settle();
}
