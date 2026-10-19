import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminRound, RoundReview, SiteStatus } from '../domain/api-types';
import { draftWarning, PublishForm, SitePanel } from './PublishTab';

const q4: AdminRound = {
  id: '2026-Q4',
  label: 'Q4 2026',
  status: 'open',
  publishedOn: null,
  scorecards: 2,
  submitted: 2,
  notes: 0,
};

const submittedAt = '2026-10-15T12:00:00.000Z';
const twoSubmitted: RoundReview['raters'] = [
  { userId: 9, name: 'P2 Rater A', submittedAt },
  { userId: 2, name: 'Tommy Puglia', submittedAt },
];

function review(
  notes: Record<string, string>,
  raters: RoundReview['raters'] = twoSubmitted,
  unscored: readonly string[] = [],
): RoundReview {
  const item = (id: string, name: string) => ({
    artifact: { id, name, workload: 'data-engineering', status: 'ga' as const, naFactors: [] },
    // Only drafts scored an unscored item, so it has no point.
    point: unscored.includes(id)
      ? null
      : {
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
    raters,
    items: [item('notebook', 'Notebook'), item('environment', 'Environment')],
    notes,
    aiEnabled: false,
  };
}

function form(
  notes: Record<string, string>,
  earliestDate?: string,
  raters?: RoundReview['raters'],
  unscored?: readonly string[],
): string {
  return renderToStaticMarkup(
    createElement(PublishForm, {
      round: q4,
      review: review(notes, raters, unscored),
      catalogSize: 78,
      earliestDate,
      onPublish: async () => {},
    }),
  );
}

/** The markup without React's text-node separators, so a sentence can be matched whole. */
const plain = (html: string) => html.replace(/<!-- -->/g, '');
const releaseButton = (html: string) => /<button[^>]*>Release (<!-- -->)?Q4 2026<\/button>/.exec(html)?.[0] ?? '';

describe('draftWarning', () => {
  it('is empty when every card is submitted', () => {
    expect(draftWarning([])).toBe('');
  });

  it('names one draft', () => {
    expect(draftWarning(['Bo'])).toBe(" Bo's card isn't submitted and won't count.");
  });

  it('names several drafts in one sentence', () => {
    expect(draftWarning(['Bo', 'Cy'])).toBe(" These cards aren't submitted and won't count: Bo, Cy.");
  });
});

describe('PublishForm', () => {
  it('lists the scored count, who has submitted, and the items still missing a why', () => {
    const html = form({ notebook: 'Because.' });
    expect(html).toMatch(/2(<!-- -->)? of (<!-- -->)?78(<!-- -->)? items scored/);
    expect(plain(html)).toContain('2 submitted');
    expect(html).not.toContain('saved but not submitted');
    expect(html).toContain('1 missing a why: Environment');
  });

  it('names the cards that are saved but not submitted', () => {
    const raters = [
      { userId: 9, name: 'Ann', submittedAt },
      { userId: 2, name: 'Bo', submittedAt: null },
    ];
    const html = plain(form({ notebook: 'Because.', environment: 'Also.' }, undefined, raters));
    expect(html).toContain('1 submitted · 1 saved but not submitted (Bo)');
  });

  it('counts only items a submitted card scored, and lists none of the others as missing a why', () => {
    const html = plain(form({ notebook: 'Because.' }, undefined, undefined, ['environment']));
    expect(html).toContain('1 of 78 items scored');
    expect(html).toContain('Every scored item has a why');
    expect(html).not.toContain('missing a why');
    expect(releaseButton(html)).toContain('aria-disabled="false"');
  });

  it('keeps Release focusable but refused while whys are missing', () => {
    const button = releaseButton(form({}));
    expect(button).toContain('aria-disabled="true"');
    expect(button).not.toMatch(/\sdisabled[\s=>]/);
    expect(form({})).toContain('Release without them');
  });

  it('keeps Release focusable but refused while nobody has submitted', () => {
    const drafts = [{ userId: 9, name: 'Bo', submittedAt: null }];
    const html = form({ notebook: 'Because.', environment: 'Also because.' }, undefined, drafts);
    const button = releaseButton(html);
    expect(button).toContain('aria-disabled="true"');
    expect(button).not.toMatch(/\sdisabled[\s=>]/);
    expect(plain(html)).toContain('0 submitted · 1 saved but not submitted (Bo)');
  });

  it('counts a rater with no submittedAt at all (an older API) as not submitted: Release stays refused', () => {
    const older = [{ userId: 9, name: 'Bo' }] as unknown as RoundReview['raters'];
    const html = form({ notebook: 'Because.', environment: 'Also because.' }, undefined, older);
    expect(releaseButton(html)).toContain('aria-disabled="true"');
    expect(plain(html)).toContain('0 submitted · 1 saved but not submitted (Bo)');
  });

  it('lets Release go once every scored item has a why', () => {
    const html = form({ notebook: 'Because.', environment: 'Also because.' });
    expect(releaseButton(html)).toContain('aria-disabled="false"');
    expect(html).toContain('Every scored item has a why');
    expect(html).not.toContain('Release without them');
  });

  it('says items with no submitted scores stay off the site, and calls the date the release date', () => {
    const html = form({});
    expect(html).toContain('Items with no submitted scores stay off the public site.');
    expect(html).toContain('<span>Release date</span>');
    expect(plain(html)).toContain('>Release Q4 2026</h2>');
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
    expect(html).toContain('Released ratings, notes, or the catalog changed since then.');
    expect(html).toMatch(/<button[^>]*aria-disabled="false"[^>]*>Update public site<\/button>/);
    expect(html).toMatch(/aria-live="polite"><\/span>/);
  });

  it('reads up to date with no "changed since" sentence', () => {
    const html = panel({ lastSnapshotAt: '2026-10-15T20:00:00.000Z', behind: false, deployConfigured: true });
    expect(html).toContain('The public site is up to date');
    expect(html).not.toContain('changed since then');
  });
});
