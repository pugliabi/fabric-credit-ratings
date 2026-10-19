// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Catalog, MyScores, SessionUser } from '../domain/api-types';
import { cleanup, click, find, render, settle, type } from '../test/dom';
import { CardForm } from './ScorecardEditor';

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

afterEach(async () => {
  await cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
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
