import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Catalog, MyScores, SessionUser } from '../domain/api-types';
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
  previous: null,
};

function render(): string {
  return renderToStaticMarkup(createElement(CardForm, { user, catalog, card, reference: {}, onSaved: () => {} }));
}

describe('CardForm', () => {
  it('announces the save state in a polite live region, without adding a second status role', () => {
    const html = render();
    expect(html).toMatch(/<span aria-live="polite"><span[^>]*> · (<!-- -->)?Saved [^<]+<\/span><\/span>/);
    expect(html).not.toContain('role="status"');
  });

  it('names the toolbar so focus can land on it when the control that had it is gone', () => {
    expect(render()).toMatch(/^<div tabindex="-1" role="group" aria-label="Your scorecard"/);
  });

  it('keeps Save focusable when there is nothing to save', () => {
    const save = /<button[^>]*>Save scores<\/button>/.exec(render())?.[0];
    expect(save).toContain('aria-disabled="true"');
    expect(save).not.toMatch(/\sdisabled[\s=>]/);
  });
});
