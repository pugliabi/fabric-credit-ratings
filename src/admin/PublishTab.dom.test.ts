// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminRound, RoundReview, SiteStatus } from '../domain/api-types';
import { onSlow, SLOW_MS } from '../lib/api';
import { formatFullDate } from '../lib/format';
import { cleanup, click, fakeApi, find, render, settle } from '../test/dom';
import { PublishTab } from './PublishTab';

const q4: AdminRound = {
  id: '2026-Q4',
  label: 'Q4 2026',
  status: 'open',
  publishedOn: null,
  scorecards: 2,
  submitted: 2,
  notes: 1,
};
const q4Published: AdminRound = { ...q4, status: 'published', publishedOn: '2026-10-15' };
const q3: AdminRound = {
  id: '2026-Q3',
  label: 'Q3 2026',
  status: 'published',
  publishedOn: '2026-09-30',
  scorecards: 2,
  submitted: 2,
  notes: 3,
};
const NOT_SET_UP =
  'Automatic site updates are not set up. Set GITHUB_DISPATCH_TOKEN and GITHUB_REPO in the Function App.';
const WAKING = 'The ratings database is not responding. Try again in a minute.';

const behind: SiteStatus = { lastSnapshotAt: '2026-10-15T20:00:00.000Z', behind: true, deployConfigured: true };
const upToDate: SiteStatus = { ...behind, behind: false };
const review: RoundReview = {
  round: q4,
  raters: [{ userId: 9, name: 'P2 Rater A', submittedAt: '2026-10-15T12:00:00.000Z' }],
  items: [
    {
      artifact: { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga', naFactors: [] },
      point: {
        round: q4.id,
        roundLabel: q4.label,
        date: '2026-10-15',
        scores: { capability: 4, ux: 5, cost: 4, outlook: 4 },
        raters: 1,
        grade: 'BBB',
        note: '',
      },
      previous: null,
      change: { kind: 'new', text: 'First rating' },
      breakdown: [{ userId: 9, name: 'P2 Rater A', submitted: true, scores: [4, 5, 4, 4] }],
    },
  ],
  notes: { notebook: 'Because.' },
  aiEnabled: false,
};
const ann = { userId: 1, name: 'Ann', submittedAt: '2026-10-15T12:00:00.000Z' };
const bo = { userId: 2, name: 'Bo', submittedAt: null };
const cy = { userId: 3, name: 'Cy', submittedAt: null };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const held = () => {
  let release: (response: Response) => void = () => {};
  const answer = () => new Promise<Response>((resolve) => (release = resolve));
  return { answer, release: (response: Response) => release(response) };
};

/** Holds the rounds the way AdminShell does, so onRounds feeds back into the tab. */
function Host({ initial }: { initial: AdminRound[] }) {
  const [rounds, setRounds] = useState(initial);
  return createElement(PublishTab, { rounds, catalogSize: 3, onRounds: setRounds });
}

const heading = (root: ParentNode, text: string) => find(root, 'h2', text);
const sitePanel = (root: ParentNode) =>
  [...root.querySelectorAll('section')].find((section) =>
    section.querySelector('h2')?.textContent?.match(/public site/i),
  );

const sectionTitled = (root: ParentNode, title: string) =>
  [...root.querySelectorAll('section')].find((section) => section.querySelector('h2')?.textContent === title);
const listed = (section: Element | undefined) =>
  [...(section?.querySelectorAll('li') ?? [])].map((item) => item.textContent);
const releaseForm = (root: ParentNode) => sectionTitled(root, 'Release Q4 2026');
const dateField = (root: ParentNode) => root.querySelector<HTMLInputElement>('input[type="date"]');

/** Records whether the wake notice would show while `run` is in flight: fake timers jump past SLOW_MS. */
async function slowWhile(run: () => Promise<void>, finish: () => void): Promise<boolean[]> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const states: boolean[] = [];
  const stop = onSlow((slow) => states.push(slow));
  await run();
  await act(async () => {
    vi.advanceTimersByTime(SLOW_MS + 1000);
  });
  finish();
  await settle();
  stop();
  vi.useRealTimers();
  return states;
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', '');
  vi.stubGlobal('confirm', () => true);
});

afterEach(async () => {
  await cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('PublishTab', () => {
  it('reads the public site status every time it opens', async () => {
    const api = fakeApi({ 'GET /api/admin/site': behind, 'GET /api/admin/rounds/2026-Q4/review': review });
    vi.stubGlobal('fetch', api.fetchMock);
    const { container } = await render(Host, { initial: [q4] });
    await settle();
    expect(api.calls.filter((call) => call.path === '/api/admin/site')).toHaveLength(1);
    expect(heading(container, 'The public site is behind')).not.toBeNull();
  });

  it('focuses the release notice, not the new-round form, and a failed site read leaves it alone', async () => {
    let siteFails = false;
    const api = fakeApi({
      'GET /api/admin/site': () => (siteFails ? json({ error: WAKING }, 503) : json(behind)),
      'GET /api/admin/rounds/2026-Q4/review': review,
      'PUT /api/admin/rounds/2026-Q4': { rounds: [q4Published], deploy: { started: false, message: NOT_SET_UP } },
    });
    vi.stubGlobal('fetch', api.fetchMock);
    const { container } = await render(Host, { initial: [q4] });
    await settle();
    await click(find(container, 'button', 'Release Q4 2026'));
    await settle();
    const notice = heading(container, 'Q4 2026 is released');
    expect(document.activeElement).toBe(notice);
    expect(heading(container, 'Start a new round')).not.toBeNull();

    siteFails = true;
    await click(find(container, 'button', 'Check again'));
    await settle();
    await click(find(container, 'button', 'Check again'));
    await settle();
    expect(heading(container, 'Q4 2026 is released')).toBe(notice);
    expect(document.activeElement).toBe(notice);
    expect(container.querySelectorAll('[data-tone="success"]')).toHaveLength(1);
    expect(sitePanel(container)?.querySelector('[role="alert"]')?.textContent).toBe(WAKING);
  });

  it('refuses Release while a why is missing, and a second Release while one is out', async () => {
    const out = held();
    const ask = vi.fn(() => true);
    vi.stubGlobal('confirm', ask);
    const api = fakeApi({
      'GET /api/admin/site': behind,
      'GET /api/admin/rounds/2026-Q4/review': { ...review, notes: {} },
      'PUT /api/admin/rounds/2026-Q4': out.answer,
    });
    vi.stubGlobal('fetch', api.fetchMock);
    const { container } = await render(Host, { initial: [q4] });
    await settle();
    const release = find(container, 'button', 'Release Q4 2026');
    await click(release);
    expect(ask).not.toHaveBeenCalled();

    await click(find(container, 'label', 'Release without them')?.querySelector('input') ?? null);
    await click(release);
    await click(release);
    expect(ask).toHaveBeenCalledOnce();
    expect(api.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(release?.textContent).toBe('Releasing…');
    expect(release?.getAttribute('aria-disabled')).toBe('true');
    out.release(json({ rounds: [q4Published], deploy: { started: false, message: NOT_SET_UP } }));
    await settle();
  });

  it('never shows the wake notice for a slow release; a slow reopen does', async () => {
    const publishing = held();
    vi.stubGlobal(
      'fetch',
      fakeApi({
        'GET /api/admin/site': behind,
        'GET /api/admin/rounds/2026-Q4/review': review,
        'PUT /api/admin/rounds/2026-Q4': publishing.answer,
      }).fetchMock,
    );
    const { container, unmount } = await render(Host, { initial: [q4] });
    await settle();
    const whilePublishing = await slowWhile(
      () => click(find(container, 'button', 'Release Q4 2026')),
      () => publishing.release(json({ rounds: [q4Published], deploy: null })),
    );
    expect(whilePublishing).toEqual([false]);
    await unmount();

    const reopening = held();
    vi.stubGlobal(
      'fetch',
      fakeApi({ 'GET /api/admin/site': behind, 'PUT /api/admin/rounds/2026-Q4': reopening.answer }).fetchMock,
    );
    const second = await render(Host, { initial: [q4Published, q3] });
    await settle();
    const whileReopening = await slowWhile(
      () => click(find(second.container, 'button', 'Reopen')),
      () => reopening.release(json({ rounds: [q4, q3], deploy: null })),
    );
    expect(whileReopening).toContain(true);
  });

  it('keeps Reopen busy while its PUT is out: a second click asks nothing and sends nothing', async () => {
    const out = held();
    const ask = vi.fn(() => true);
    vi.stubGlobal('confirm', ask);
    const api = fakeApi({ 'GET /api/admin/site': behind, 'PUT /api/admin/rounds/2026-Q4': out.answer });
    vi.stubGlobal('fetch', api.fetchMock);
    const { container } = await render(Host, { initial: [q4Published, q3] });
    await settle();
    const reopen = find(container, 'button', 'Reopen');
    reopen?.focus();
    await click(reopen);
    expect(ask).toHaveBeenCalledWith('Reopen Q4 2026? Raters can change their cards again until you release it again.');
    expect(reopen?.textContent).toBe('Reopening…');
    expect(reopen?.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(reopen);
    await click(reopen);
    expect(ask).toHaveBeenCalledOnce();
    expect(api.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    out.release(json({ rounds: [q4, q3], deploy: null }));
    await settle();
    expect(heading(container, 'Q4 2026 is open again')).not.toBeNull();
  });

  it('deletes the open round after a confirm that counts its scorecards', async () => {
    const ask = vi.fn(() => true);
    vi.stubGlobal('confirm', ask);
    const api = fakeApi({
      'GET /api/admin/site': behind,
      'GET /api/admin/rounds/2026-Q4/review': review,
      'DELETE /api/admin/rounds/2026-Q4': [q3],
    });
    vi.stubGlobal('fetch', api.fetchMock);
    const { container } = await render(Host, { initial: [q4, q3] });
    await settle();
    await click(find(container, 'button', 'Delete round'));
    await settle();
    expect(ask).toHaveBeenCalledWith('Delete Q4 2026 and its 2 scorecards? This cannot be undone.');
    expect(api.calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual([
      '/api/admin/rounds/2026-Q4',
    ]);
    expect(heading(container, 'Q4 2026 was deleted.')).not.toBeNull();
    expect(heading(container, 'Start a new round')).not.toBeNull();
  });

  it('words the delete question for one scorecard and for none', async () => {
    const ask = vi.fn(() => false);
    vi.stubGlobal('confirm', ask);
    const api = fakeApi({ 'GET /api/admin/site': behind, 'GET /api/admin/rounds/2026-Q4/review': review });
    vi.stubGlobal('fetch', api.fetchMock);
    const one = await render(Host, { initial: [{ ...q4, scorecards: 1, submitted: 1 }] });
    await settle();
    await click(find(one.container, 'button', 'Delete round'));
    expect(ask).toHaveBeenLastCalledWith('Delete Q4 2026 and its 1 scorecard? This cannot be undone.');
    const none = await render(Host, { initial: [{ ...q4, scorecards: 0, submitted: 0 }] });
    await settle();
    await click(find(none.container, 'button', 'Delete round'));
    expect(ask).toHaveBeenLastCalledWith('Delete Q4 2026? This cannot be undone.');
  });

  it('sends nothing when the delete is not confirmed', async () => {
    vi.stubGlobal('confirm', () => false);
    const api = fakeApi({ 'GET /api/admin/site': behind, 'GET /api/admin/rounds/2026-Q4/review': review });
    vi.stubGlobal('fetch', api.fetchMock);
    const { container } = await render(Host, { initial: [q4] });
    await settle();
    await click(find(container, 'button', 'Delete round'));
    await settle();
    expect(api.calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  });

  it('shows the site panel with its error and a working Check again when the first read fails', async () => {
    let fails = true;
    vi.stubGlobal(
      'fetch',
      fakeApi({
        'GET /api/admin/site': () => (fails ? json({ error: WAKING }, 503) : json(behind)),
        'GET /api/admin/rounds/2026-Q4/review': review,
      }).fetchMock,
    );
    const { container } = await render(Host, { initial: [q4] });
    await settle();
    const panel = sitePanel(container);
    expect(panel?.querySelector('[role="alert"]')?.textContent).toBe(WAKING);
    const check = find(container, 'button', 'Check again');
    check?.focus();
    fails = false;
    await click(check);
    await settle();
    expect(heading(container, 'The public site is behind')).not.toBeNull();
    expect(sitePanel(container)?.querySelector('[role="alert"]')).toBeNull();
    expect(document.activeElement).toBe(check);
  });

  it('lets only the latest site read land', async () => {
    const slow = held();
    let reads = 0;
    const site = () => {
      reads += 1;
      if (reads === 2) return slow.answer();
      return json(reads === 1 ? behind : upToDate);
    };
    vi.stubGlobal(
      'fetch',
      fakeApi({ 'GET /api/admin/site': site, 'GET /api/admin/rounds/2026-Q4/review': review }).fetchMock,
    );
    const { container } = await render(Host, { initial: [q4] });
    await settle();
    await click(find(container, 'button', 'Check again'));
    await click(find(container, 'button', 'Check again'));
    await settle();
    expect(heading(container, 'The public site is up to date')).not.toBeNull();
    slow.release(json(behind));
    await settle();
    expect(heading(container, 'The public site is up to date')).not.toBeNull();
  });

  it('offers Try again when the review does not load, and takes focus to the form once it does', async () => {
    let fails = true;
    vi.stubGlobal(
      'fetch',
      fakeApi({
        'GET /api/admin/site': behind,
        'GET /api/admin/rounds/2026-Q4/review': () => (fails ? json({ error: WAKING }, 503) : json(review)),
      }).fetchMock,
    );
    const { container } = await render(Host, { initial: [q4] });
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(WAKING);
    // The read failed on arrival (after a login on #publish, say), so its heading takes the focus the page lost.
    expect(document.activeElement).toBe(heading(container, 'Could not check Q4 2026'));
    fails = false;
    await click(find(container, 'button', 'Try again'));
    await settle();
    expect(document.activeElement).toBe(heading(container, 'Release Q4 2026'));
  });

  it('shows a failed update and a failed later read as two alerts, each in its own words', async () => {
    const DEPLOY_FAILED =
      'GitHub refused the deploy request. Check GITHUB_DISPATCH_TOKEN in the Function App settings.';
    let reads = 0;
    const api = fakeApi({
      'GET /api/admin/site': () => (++reads === 1 ? json(behind) : json({ error: WAKING }, 503)),
      'GET /api/admin/rounds/2026-Q4/review': review,
      'POST /api/admin/site/update': () => json({ error: DEPLOY_FAILED }, 502),
    });
    vi.stubGlobal('fetch', api.fetchMock);
    const { container } = await render(Host, { initial: [q4] });
    await settle();
    await click(find(container, 'button', 'Update public site'));
    await settle();
    await click(find(container, 'button', 'Check again'));
    await settle();
    const alerts = () => [...(sitePanel(container)?.querySelectorAll('[role="alert"]') ?? [])];
    expect(alerts().map((node) => node.textContent)).toEqual([DEPLOY_FAILED, WAKING]);
    expect(heading(container, 'The public site is behind')).not.toBeNull();

    // Each failure is its own alert element, so the same words are announced again.
    const [, readAlert] = alerts();
    await click(find(container, 'button', 'Check again'));
    await settle();
    expect(alerts().map((node) => node.textContent)).toEqual([DEPLOY_FAILED, WAKING]);
    expect(alerts()[1]).not.toBe(readAlert);
  });

  it('starts a site update once per press, without the wake notice', async () => {
    const out = held();
    const api = fakeApi({
      'GET /api/admin/site': behind,
      'GET /api/admin/rounds/2026-Q4/review': review,
      'POST /api/admin/site/update': out.answer,
    });
    vi.stubGlobal('fetch', api.fetchMock);
    const { container } = await render(Host, { initial: [q4] });
    await settle();
    const update = find(container, 'button', 'Update public site');
    const states = await slowWhile(
      async () => {
        await click(update);
        await click(update);
      },
      () => out.release(json({ started: true, message: 'The public site is rebuilding.' })),
    );
    expect(states).toEqual([false]);
    expect(api.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  describe('the release form', () => {
    const withRaters = (raters: RoundReview['raters'], extra: Partial<RoundReview> = {}): RoundReview => ({
      ...review,
      raters,
      ...extra,
    });

    async function open(body: RoundReview) {
      const ask = vi.fn(() => true);
      vi.stubGlobal('confirm', ask);
      const api = fakeApi({
        'GET /api/admin/site': behind,
        'GET /api/admin/rounds/2026-Q4/review': body,
        'PUT /api/admin/rounds/2026-Q4': { rounds: [q4Published], deploy: null },
      });
      vi.stubGlobal('fetch', api.fetchMock);
      const { container } = await render(Host, { initial: [q4] });
      await settle();
      return { container, ask, api };
    }

    it('says who has submitted, names the drafts, and warns about them in the confirm', async () => {
      const { container, ask, api } = await open(withRaters([ann, bo]));
      const form = releaseForm(container);
      expect(listed(form)).toEqual([
        '1 of 3 items scored',
        '1 submitted · 1 saved but not submitted (Bo)',
        'Every scored item has a why',
      ]);
      expect(form?.querySelector('li[data-ok="false"]')?.textContent).toBe(
        '1 submitted · 1 saved but not submitted (Bo)',
      );
      const date = dateField(container)?.value ?? '';
      await click(find(container, 'button', 'Release Q4 2026'));
      await settle();
      expect(date).not.toBe('');
      expect(ask).toHaveBeenCalledWith(
        `Release Q4 2026, dated ${formatFullDate(date)}? Raters can no longer change their cards. ` +
          "Bo's card isn't submitted and won't count.",
      );
      expect(api.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    });

    it('names every draft in one sentence when several cards are not submitted', async () => {
      const { container, ask } = await open(withRaters([ann, bo, cy]));
      expect(listed(releaseForm(container))[1]).toBe('1 submitted · 2 saved but not submitted (Bo, Cy)');
      const date = dateField(container)?.value ?? '';
      await click(find(container, 'button', 'Release Q4 2026'));
      await settle();
      expect(ask).toHaveBeenCalledWith(
        `Release Q4 2026, dated ${formatFullDate(date)}? Raters can no longer change their cards. ` +
          "These cards aren't submitted and won't count: Bo, Cy.",
      );
    });

    it('adds no warning to the confirm, and marks the line ok, when everyone has submitted', async () => {
      const { container, ask } = await open(withRaters([ann, { ...bo, submittedAt: '2026-10-16T12:00:00.000Z' }]));
      const form = releaseForm(container);
      expect(listed(form)[1]).toBe('2 submitted');
      expect(form?.querySelector('li[data-ok="false"]')).toBeNull();
      const date = dateField(container)?.value ?? '';
      await click(find(container, 'button', 'Release Q4 2026'));
      await settle();
      expect(ask).toHaveBeenCalledWith(
        `Release Q4 2026, dated ${formatFullDate(date)}? Raters can no longer change their cards.`,
      );
    });

    it('blocks Release when every card is still a draft: nothing is asked and nothing is sent', async () => {
      const { container, ask, api } = await open(withRaters([bo, cy]));
      expect(listed(releaseForm(container))[1]).toBe('0 submitted · 2 saved but not submitted (Bo, Cy)');
      const release = find(container, 'button', 'Release Q4 2026');
      expect(release?.getAttribute('aria-disabled')).toBe('true');
      await click(release);
      await settle();
      expect(ask).not.toHaveBeenCalled();
      expect(api.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
    });

    it('counts only items a submitted card scored, and asks no why for the rest', async () => {
      const [scored] = review.items;
      if (!scored) throw new Error('the fixture has no items');
      const draftOnly = {
        ...scored,
        artifact: { ...scored.artifact, id: 'pipeline', name: 'Pipeline' },
        point: null,
        change: { kind: 'draft' as const, text: 'Not submitted' },
      };
      const { container } = await open(withRaters([ann, bo], { items: [scored, draftOnly] }));
      const form = releaseForm(container);
      expect(listed(form)[0]).toBe('1 of 3 items scored');
      expect(listed(form)[2]).toBe('Every scored item has a why');
      expect(find(container, 'label', 'Release without them')).toBeNull();
    });

    it('words the form with release', async () => {
      const { container } = await open(review);
      const form = releaseForm(container);
      expect(form?.textContent).toContain('Items with no submitted scores stay off the public site.');
      expect(find(form ?? container, 'span', 'Release date')).not.toBeNull();
    });
  });

  describe('round management is always on the page', () => {
    const OPEN_SENTENCE = 'Only one round can be open. Release or delete Q4 2026 to start the next one.';
    const NEXT_SENTENCE =
      'Start the next round below. The form suggests the next month; the id and label can be changed.';

    it('lists the open round first, says why there is no form, and shows an empty released list', async () => {
      vi.stubGlobal(
        'fetch',
        fakeApi({ 'GET /api/admin/site': behind, 'GET /api/admin/rounds/2026-Q4/review': review }).fetchMock,
      );
      const { container } = await render(Host, { initial: [q4] });
      await settle();
      const panel = sectionTitled(container, 'Rounds');
      expect(panel).toBeDefined();
      expect(container.querySelector('section')).toBe(panel);
      expect(panel?.getAttribute('aria-labelledby')).toBe(panel?.querySelector('h2')?.id);
      expect(listed(panel)).toEqual([
        'Q4 2026 · open · 2 cards · 2 submitted · raters score this round; release or delete it below',
      ]);
      expect(panel?.querySelector('p')?.textContent).toBe(OPEN_SENTENCE);
      expect(listed(sectionTitled(container, 'Released rounds'))).toEqual([]);
      expect(sectionTitled(container, 'Released rounds')?.textContent).toContain('No released rounds yet.');
      expect(heading(container, 'Start a new round')).toBeNull();
      expect(heading(container, 'Release Q4 2026')).not.toBeNull();
    });

    it('counts one card in the singular', async () => {
      vi.stubGlobal(
        'fetch',
        fakeApi({ 'GET /api/admin/site': behind, 'GET /api/admin/rounds/2026-Q4/review': review }).fetchMock,
      );
      const { container } = await render(Host, { initial: [{ ...q4, scorecards: 1, submitted: 1 }] });
      await settle();
      expect(listed(sectionTitled(container, 'Rounds'))[0]).toContain('Q4 2026 · open · 1 card ·');
    });

    it('lists a released round and offers the new-round form when none is open', async () => {
      vi.stubGlobal('fetch', fakeApi({ 'GET /api/admin/site': behind }).fetchMock);
      const { container } = await render(Host, { initial: [q3] });
      await settle();
      const panel = sectionTitled(container, 'Rounds');
      const line = `Q3 2026 · released ${formatFullDate('2026-09-30')} · 2 cards · 2 submitted`;
      expect(listed(panel)).toEqual([line]);
      expect(panel?.querySelector('p')?.textContent).toBe(NEXT_SENTENCE);
      expect(listed(sectionTitled(container, 'Released rounds'))).toEqual([`${line}Reopen`]);
      expect(sectionTitled(container, 'Released rounds')?.textContent).not.toContain('No released rounds yet.');
      expect(heading(container, 'Start a new round')).not.toBeNull();
    });

    it('says there are no rounds yet and offers the form', async () => {
      vi.stubGlobal('fetch', fakeApi({ 'GET /api/admin/site': behind }).fetchMock);
      const { container } = await render(Host, { initial: [] });
      await settle();
      const panel = sectionTitled(container, 'Rounds');
      expect(listed(panel)).toEqual(['No rounds yet. Start one below.']);
      expect(panel?.querySelector('p')?.textContent).toBe(NEXT_SENTENCE);
      expect(sectionTitled(container, 'Released rounds')?.textContent).toContain('No released rounds yet.');
      expect(heading(container, 'Start a new round')).not.toBeNull();
    });

    it('follows a release: the round moves from open to released and the form appears', async () => {
      vi.stubGlobal(
        'fetch',
        fakeApi({
          'GET /api/admin/site': behind,
          'GET /api/admin/rounds/2026-Q4/review': review,
          'PUT /api/admin/rounds/2026-Q4': { rounds: [q4Published], deploy: null },
        }).fetchMock,
      );
      const { container } = await render(Host, { initial: [q4] });
      await settle();
      await click(find(container, 'button', 'Release Q4 2026'));
      await settle();
      const panel = sectionTitled(container, 'Rounds');
      expect(listed(panel)).toEqual([`Q4 2026 · released ${formatFullDate('2026-10-15')} · 2 cards · 2 submitted`]);
      expect(panel?.querySelector('p')?.textContent).toBe(NEXT_SENTENCE);
    });

    it('counts submitted cards beside all cards, for an open round and a released one', async () => {
      vi.stubGlobal(
        'fetch',
        fakeApi({ 'GET /api/admin/site': behind, 'GET /api/admin/rounds/2026-Q4/review': review }).fetchMock,
      );
      const { container } = await render(Host, { initial: [{ ...q4, scorecards: 3, submitted: 2 }, q3] });
      await settle();
      expect(listed(sectionTitled(container, 'Rounds'))).toEqual([
        'Q4 2026 · open · 3 cards · 2 submitted · raters score this round; release or delete it below',
        `Q3 2026 · released ${formatFullDate('2026-09-30')} · 2 cards · 2 submitted`,
      ]);
    });

    it('words the released-rounds hint with release', async () => {
      vi.stubGlobal('fetch', fakeApi({ 'GET /api/admin/site': behind }).fetchMock);
      const { container } = await render(Host, { initial: [q3] });
      await settle();
      const panel = sectionTitled(container, 'Released rounds');
      expect(panel?.querySelector('p')?.textContent).toBe(
        'To fix a released score or why without reopening, edit it on the Review tab. ' +
          'The change reaches the public site at the next update.',
      );
    });
  });
});
