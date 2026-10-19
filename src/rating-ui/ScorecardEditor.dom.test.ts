// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Catalog, MyScores, SessionUser } from '../domain/api-types';
import { cleanup, click, fakeApi, find, render, settle, type } from '../test/dom';
import { CardForm, SubmittedCard } from './ScorecardEditor';

const user: SessionUser = { id: 7, login: 'ann', displayName: 'Ann', role: 'rater' };
const catalog: Catalog = {
  workloads: [{ id: 'data-engineering', name: 'Data Engineering', shortName: 'Data Eng', blurb: '' }],
  artifacts: [{ id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga', naFactors: [] }],
};
const card: MyScores = {
  round: { id: '2026-Q4', label: 'Q4 2026', status: 'open', publishedOn: null },
  scores: { notebook: [5, 5, 5, 5] },
  updatedAt: '2026-10-15T23:00:00.000Z',
  submittedAt: null,
  previous: null,
};
const KEY = 'fcr-card:7:2026-Q4';

const props = { user, catalog, card, reference: {}, onSaved: () => {} };
const toolbar = (root: ParentNode) => root.querySelector('[role="group"][aria-label="Your scorecard"]');
const slider = (root: ParentNode) => root.querySelector('input[aria-label="Notebook, Feature Capability"]');

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', '');
});

afterEach(async () => {
  await cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('CardForm', () => {
  it('moves focus to the toolbar when Discard changes removes itself', async () => {
    const { container } = await render(CardForm, props);
    await type(slider(container), '6');
    const discard = find(container, 'button', 'Discard changes');
    discard?.focus();
    await click(discard);
    expect(document.activeElement).toBe(toolbar(container));
    expect(find(container, 'button', 'Discard changes')).toBeNull();
  });

  it('flags a row with three scores until the Outlook slider is set', async () => {
    const empty: MyScores = { ...card, scores: {}, updatedAt: null };
    const { container } = await render(CardForm, { ...props, card: empty });
    const input = (label: string) => container.querySelector(`input[aria-label="Notebook, ${label}"]`);
    for (const label of ['Feature Capability', 'User Experience', 'CU / Token Cost']) await type(input(label), '5');
    expect(container.textContent).toContain('Set all four, or clear');
    await type(input('Outlook'), '5');
    expect(container.textContent).not.toContain('Set all four, or clear');
  });

  it('shows three sliders and a Not applicable cell for an item without a cost factor', async () => {
    const noCost: Catalog = {
      ...catalog,
      artifacts: [{ id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga', naFactors: ['cost'] }],
    };
    const empty: MyScores = { ...card, scores: {}, updatedAt: null };
    const { container } = await render(CardForm, { ...props, catalog: noCost, card: empty });
    const input = (label: string) => container.querySelector(`input[aria-label="Notebook, ${label}"]`);
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(3);
    expect(container.querySelector('[aria-label="Notebook, CU / Token Cost: not applicable"]')?.textContent).toBe(
      'Not applicable',
    );
    await type(input('Feature Capability'), '5');
    await type(input('User Experience'), '5');
    expect(container.textContent).toContain('Set all three, or clear');
    await type(input('Outlook'), '5');
    expect(container.textContent).not.toContain('Set all three, or clear');
    expect(container.textContent).toContain('1/1 rated');
  });

  it('moves focus to the toolbar when Clear all removes itself', async () => {
    vi.stubGlobal('confirm', () => true);
    const { container } = await render(CardForm, props);
    const clear = find(container, 'button', 'Clear all');
    clear?.focus();
    await click(clear);
    expect(document.activeElement).toBe(toolbar(container));
    expect(find(container, 'button', 'Clear all')).toBeNull();
  });

  it('drops a stored draft that holds only a row for an item no longer in the catalog', async () => {
    localStorage.setItem(KEY, JSON.stringify({ base: {}, draft: { 'no-such-item': [3, 3, 3, 3] } }));
    const { container } = await render(CardForm, props);
    await settle();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(toolbar(container)?.textContent).toMatch(/Saved /);
  });
});

const SUBMIT = 'POST /api/rounds/open/my-scores/submit';
const WITHDRAW = 'POST /api/rounds/open/my-scores/withdraw';
const submitted: MyScores = { ...card, submittedAt: '2026-10-19T20:02:00.000Z' };
const CONFIRM_TEXT = 'Submit your Q4 2026 card? You can withdraw it to make changes until the round is released.';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('CardForm submit', () => {
  it('offers Submit scores on a saved, clean card, and not while there are unsaved changes', async () => {
    const { container } = await render(CardForm, props);
    expect(find(container, 'button', 'Submit scores')).not.toBeNull();
    await type(slider(container), '6');
    expect(find(container, 'button', 'Submit scores')).toBeNull();
    await click(find(container, 'button', 'Discard changes'));
    expect(find(container, 'button', 'Submit scores')).not.toBeNull();
  });

  it('offers no Submit on a card that was never saved', async () => {
    const empty: MyScores = { ...card, scores: {}, updatedAt: null };
    const { container } = await render(CardForm, { ...props, card: empty });
    expect(find(container, 'button', 'Submit scores')).toBeNull();
  });

  it('submits the saved card after the rater confirms, and hands the answer to onSaved', async () => {
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmMock);
    const api = fakeApi({ [SUBMIT]: submitted });
    vi.stubGlobal('fetch', api.fetchMock);
    const onSaved = vi.fn();
    const { container } = await render(CardForm, { ...props, onSaved });
    await click(find(container, 'button', 'Submit scores'));
    await settle();
    expect(confirmMock).toHaveBeenCalledWith(CONFIRM_TEXT);
    expect(api.calls).toEqual([
      {
        method: 'POST',
        path: '/api/rounds/open/my-scores/submit',
        body: { round: '2026-Q4', updatedAt: '2026-10-15T23:00:00.000Z' },
      },
    ]);
    expect(onSaved).toHaveBeenCalledWith(submitted);
  });

  it('sends nothing when the rater declines the confirmation', async () => {
    vi.stubGlobal('confirm', () => false);
    const api = fakeApi({ [SUBMIT]: submitted });
    vi.stubGlobal('fetch', api.fetchMock);
    const onSaved = vi.fn();
    const { container } = await render(CardForm, { ...props, onSaved });
    await click(find(container, 'button', 'Submit scores'));
    await settle();
    expect(api.calls).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('shows a refusal in an alert, with Reload page after a 409', async () => {
    vi.stubGlobal('confirm', () => true);
    const message = 'Q4 2026 has been released, so it can no longer be submitted.';
    vi.stubGlobal('fetch', fakeApi({ [SUBMIT]: json({ error: message }, 409) }).fetchMock);
    const onSaved = vi.fn();
    const { container } = await render(CardForm, { ...props, onSaved });
    await click(find(container, 'button', 'Submit scores'));
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(find(container, 'button', 'Reload page')).not.toBeNull();
    expect(find(container, 'button', 'Submit scores')).not.toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('says submitted cards count once the admin releases the round, not "is published"', async () => {
    const { container } = await render(CardForm, props);
    const text = container.textContent ?? '';
    expect(text).toContain(
      'Submitted cards count toward the averages, which appear on the site when the admin releases Q4 2026.',
    );
    expect(text).not.toContain('is published');
  });
});

describe('SubmittedCard', () => {
  const withdrawn: MyScores = { ...card, submittedAt: null };
  const submittedProps = { catalog, card: submitted, reference: {}, onWithdrawn: () => {} };

  it('shows the scores read-only: sliders disabled, no Clear, no Save scores', async () => {
    const { container } = await render(SubmittedCard, submittedProps);
    const sliders = [...container.querySelectorAll<HTMLInputElement>('input[type="range"]')];
    expect(sliders.length).toBeGreaterThan(0);
    expect(sliders.every((input) => input.disabled)).toBe(true);
    expect(container.querySelector('button[aria-label^="Clear"]')).toBeNull();
    expect(find(container, 'button', 'Clear')).toBeNull();
    expect(find(container, 'button', 'Save scores')).toBeNull();
    expect(find(container, 'button', 'Withdraw submission')).not.toBeNull();
  });

  it('says when the card was submitted and when it counts', async () => {
    const { container } = await render(SubmittedCard, submittedProps);
    const note = container.querySelector('p')?.textContent ?? '';
    expect(note.startsWith('Submitted ')).toBe(true);
    expect(note).toContain('Your scores count when Q4 2026 is released.');
  });

  it('withdraws on request and hands the draft card to onWithdrawn', async () => {
    const api = fakeApi({ [WITHDRAW]: withdrawn });
    vi.stubGlobal('fetch', api.fetchMock);
    const onWithdrawn = vi.fn();
    const { container } = await render(SubmittedCard, { ...submittedProps, onWithdrawn });
    await click(find(container, 'button', 'Withdraw submission'));
    await settle();
    expect(api.calls).toEqual([
      { method: 'POST', path: '/api/rounds/open/my-scores/withdraw', body: { round: '2026-Q4' } },
    ]);
    expect(onWithdrawn).toHaveBeenCalledWith(withdrawn);
  });

  it('shows a refusal in an alert, with Reload page after a 409', async () => {
    const message = 'Q4 2026 has been released, so a submission can no longer be withdrawn.';
    vi.stubGlobal('fetch', fakeApi({ [WITHDRAW]: json({ error: message }, 409) }).fetchMock);
    const onWithdrawn = vi.fn();
    const { container } = await render(SubmittedCard, { ...submittedProps, onWithdrawn });
    await click(find(container, 'button', 'Withdraw submission'));
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(find(container, 'button', 'Reload page')).not.toBeNull();
    expect(onWithdrawn).not.toHaveBeenCalled();
  });
});
