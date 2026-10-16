import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminRound, RoundReview, SiteStatus } from '../domain/api-types';
import { PublishForm, SitePanel } from './PublishTab';

const q4: AdminRound = { id: '2026-Q4', label: 'Q4 2026', status: 'open', publishedOn: null, scorecards: 2, notes: 0 };

function review(notes: Record<string, string>): RoundReview {
  const item = (id: string, name: string) => ({
    artifact: { id, name, workload: 'data-engineering', status: 'ga' as const, naFactors: [] },
    point: {
      round: q4.id,
      roundLabel: q4.label,
      date: '2026-10-15',
      scores: { capability: 4, ux: 5, cost: 4, outlook: 4 },
      raters: 2,
      grade: 'BBB+' as const,
      note: '',
    },
    previous: null,
    change: { kind: 'new' as const, text: 'First rating' },
    breakdown: [],
  });
  return {
    round: q4,
    raters: [
      { userId: 9, name: 'P2 Rater A' },
      { userId: 2, name: 'Tommy Puglia' },
    ],
    items: [item('notebook', 'Notebook'), item('environment', 'Environment')],
    notes,
    aiEnabled: false,
  };
}

function form(notes: Record<string, string>, earliestDate?: string): string {
  return renderToStaticMarkup(
    createElement(PublishForm, {
      round: q4,
      review: review(notes),
      catalogSize: 78,
      earliestDate,
      onPublish: async () => {},
    }),
  );
}

const publishButton = (html: string) => /<button[^>]*>Publish (<!-- -->)?Q4 2026<\/button>/.exec(html)?.[0] ?? '';

describe('PublishForm', () => {
  it('lists the scored count, the raters, and the items still missing a why', () => {
    const html = form({ notebook: 'Because.' });
    expect(html).toMatch(/2(<!-- -->)? of (<!-- -->)?78(<!-- -->)? items scored/);
    expect(html).toContain('P2 Rater A, Tommy Puglia');
    expect(html).toContain('1 missing a why: Environment');
  });

  it('keeps Publish focusable but refused while whys are missing', () => {
    const button = publishButton(form({}));
    expect(button).toContain('aria-disabled="true"');
    expect(button).not.toMatch(/\sdisabled[\s=>]/);
    expect(form({})).toContain('Publish without them');
  });

  it('lets Publish go once every scored item has a why', () => {
    const html = form({ notebook: 'Because.', environment: 'Also because.' });
    expect(publishButton(html)).toContain('aria-disabled="false"');
    expect(html).toContain('Every scored item has a why');
    expect(html).not.toContain('Publish without them');
  });

  it("never offers a date before the latest published round's", () => {
    const dateInput = (html: string) => /<input type="date"[^>]*>/.exec(html)?.[0] ?? '';
    expect(dateInput(form({}, '2026-09-30'))).toContain('min="2026-09-30"');
    const later = dateInput(form({}, '2999-01-01'));
    expect(later).toContain('min="2999-01-01"');
    expect(later).toContain('value="2999-01-01"');
    expect(dateInput(form({}))).not.toContain('min=');
  });
});

function panel(site: SiteStatus): string {
  return renderToStaticMarkup(createElement(SitePanel, { site, onCheck: () => {} }));
}

describe('SitePanel', () => {
  it('says no deploy has confirmed a build yet, without the "changed since" sentence', () => {
    const html = panel({ lastSnapshotAt: null, behind: true, deployConfigured: false });
    expect(html).toContain('The public site is behind');
    expect(html).toContain('No deploy has confirmed a build from the database yet.');
    expect(html).not.toContain('changed since then');
    expect(html).toContain('Automatic site updates are not set up.');
    expect(html).not.toContain('Update public site');
  });

  it('says when the site is behind a confirmed build, and offers the update when deploys are set up', () => {
    const html = panel({ lastSnapshotAt: '2026-10-15T20:00:00.000Z', behind: true, deployConfigured: true });
    expect(html).toContain('The live site shows the database as of');
    expect(html).toContain('Published ratings, notes, or the catalog changed since then.');
    expect(html).toMatch(/<button[^>]*aria-disabled="false"[^>]*>Update public site<\/button>/);
    expect(html).toMatch(/aria-live="polite"><\/span>/);
  });

  it('reads up to date with no "changed since" sentence', () => {
    const html = panel({ lastSnapshotAt: '2026-10-15T20:00:00.000Z', behind: false, deployConfigured: true });
    expect(html).toContain('The public site is up to date');
    expect(html).not.toContain('changed since then');
  });
});
