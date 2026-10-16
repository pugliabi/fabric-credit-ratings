import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminCatalog, AdminUser, RoundReview } from '../domain/api-types';
import { NOTE_TOO_LONG } from './notes';
import { RaterCardEditor } from './RaterCardEditor';
import { RoundReviewPanel } from './ReviewTab';

const catalog: AdminCatalog = {
  workloads: [{ id: 'data-engineering', name: 'Data Engineering', shortName: 'Data Eng', blurb: '', sortOrder: 1 }],
  artifacts: [
    { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga', sortOrder: 1, referenced: true },
    { id: 'old', name: 'Old item', workload: 'data-engineering', status: 'retired', sortOrder: 2, referenced: true },
  ],
};

const users: AdminUser[] = [
  {
    id: 9,
    login: 'p2-rater-a',
    displayName: 'P2 Rater A',
    role: 'rater',
    active: true,
    createdAt: '2026-10-15T00:00:00.000Z',
    lastScoredRound: '2026-Q4',
  },
  {
    id: 11,
    login: 'new-rater',
    displayName: 'New Rater',
    role: 'rater',
    active: true,
    createdAt: '2026-10-15T00:00:00.000Z',
    lastScoredRound: null,
  },
];

function review(notes: Record<string, string> = {}, aiEnabled = true): RoundReview {
  return {
    round: { id: '2026-Q4', label: 'Q4 2026', status: 'open', publishedOn: null },
    raters: [{ userId: 9, name: 'P2 Rater A' }],
    items: [
      {
        artifact: catalog.artifacts[0]!,
        point: {
          round: '2026-Q4',
          roundLabel: 'Q4 2026',
          date: '2026-10-15',
          scores: { capability: 2, ux: 5, cost: 4, outlook: 4 },
          raters: 1,
          grade: 'BB',
          note: '',
        },
        previous: null,
        change: { kind: 'new', text: 'First rating' },
        breakdown: [{ userId: 9, name: 'P2 Rater A', scores: [2, 5, 4, 4] }],
      },
    ],
    notes,
    aiEnabled,
  };
}

function panel(notes?: Record<string, string>, aiEnabled?: boolean): string {
  return renderToStaticMarkup(
    createElement(RoundReviewPanel, { review: review(notes, aiEnabled), catalog, users, onReview: () => {} }),
  );
}

function button(html: string, label: RegExp): string {
  return new RegExp(`<button[^>]*>${label.source}</button>`).exec(html)?.[0] ?? '';
}

describe('RoundReviewPanel', () => {
  it("names each rater in the breakdown and offers cards for raters who haven't scored", () => {
    const html = panel();
    expect(html).toContain('P2 Rater A 2 · 5 · 4');
    expect(html).toMatch(/<option value="9">P2 Rater A<\/option>/);
    expect(html).toMatch(/<option value="11">New Rater(<!-- -->)? \(no card yet\)<\/option>/);
  });

  it('accepts a note of exactly 2,000 characters after trimming', () => {
    const html = panel({ notebook: `  ${'x'.repeat(2000)}  ` });
    expect(html).not.toContain(NOTE_TOO_LONG);
    expect(html).not.toContain('aria-invalid');
  });

  it("shows the server's wording under a longer note, ties it to the box, and never truncates", () => {
    const html = panel({ notebook: 'x'.repeat(2001) });
    const box = /<textarea[^>]*>/.exec(html)?.[0] ?? '';
    const id = /aria-describedby="([^"]+)"/.exec(box)?.[1];
    const message = /<p id="([^"]+)"[^>]*role="alert">([^<]*)<\/p>/.exec(html);
    expect(box).toContain('aria-invalid="true"');
    expect(id).toBeTruthy();
    expect(message?.slice(1)).toEqual([id, NOTE_TOO_LONG]);
    expect(box).not.toMatch(/maxlength/i);
  });

  it('announces the notes save state from the first render', () => {
    expect(panel()).toMatch(/<span aria-live="polite"><span[^>]*> · (<!-- -->)?All notes saved<\/span><\/span>/);
  });

  it('keeps the AI buttons focusable, with a reason, when no key is set', () => {
    const html = panel({}, false);
    for (const label of [/Draft all blank with AI \((<!-- -->)?1(<!-- -->)?\)/, /Draft with AI/]) {
      const found = button(html, label);
      expect(found).toContain('aria-disabled="true"');
      expect(found).toContain('title="Set ANTHROPIC_API_KEY in the Function App settings"');
      expect(found).not.toMatch(/\sdisabled[\s=>]/);
    }
  });
});

describe('RaterCardEditor', () => {
  function editor(status: 'open' | 'published' = 'open'): string {
    const opened = review();
    return renderToStaticMarkup(
      createElement(RaterCardEditor, {
        review: { ...opened, round: { ...opened.round, status, publishedOn: status === 'open' ? null : '2026-10-20' } },
        rater: { userId: 9, name: 'P2 Rater A' },
        catalog,
        onSaved: () => {},
        onRefreshed: () => {},
        onCancel: () => {},
      }),
    );
  }

  it("counts every catalog item, retired ones too, and names the rater's card for focus", () => {
    const html = editor();
    expect(html).toMatch(/^<div[^>]*><div tabindex="-1" role="group" aria-label="P2 Rater A&#x27;s card"/);
    expect(html).toMatch(/P2 Rater A(<!-- -->)? · (<!-- -->)?Q4 2026(<!-- -->)? · (<!-- -->)?1(<!-- -->)? of (<!-- -->)?2/);
    expect(html).toContain('Old item');
  });

  it('keeps Save card focusable but refused while it reads the card again, saying so in the live region', () => {
    const html = editor();
    const save = button(html, /Save card/);
    expect(save).toContain('aria-disabled="true"');
    expect(save).not.toMatch(/\sdisabled[\s=>]/);
    expect(html).toMatch(/<span aria-live="polite"><span[^>]*> · (<!-- -->)?Checking for newer scores…<\/span><\/span>/);
  });

  it('warns that a published round changes the public averages at the next site update', () => {
    expect(editor('published')).toContain('Q4 2026 is published. Saving changes its public averages');
  });
});
