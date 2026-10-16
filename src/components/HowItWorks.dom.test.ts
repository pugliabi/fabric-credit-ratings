// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '../test/dom';
import { HowItWorks } from './HowItWorks';
import { ScaleLegend } from './ScaleLegend';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import { SiteNav } from './SiteNav';

afterEach(cleanup);

describe('HowItWorks', () => {
  it('lists four factors, four bands and the Deprecated grade', async () => {
    const { container } = await render(HowItWorks, {});
    const text = container.textContent ?? '';
    expect(text).toContain('four factors');
    expect(text).toContain('Outlook');
    expect(text).toContain('Where is it headed over the next year?');
    expect(text).toContain('Low investment grade');
    expect(text).toContain('Deprecated');
    expect(text).not.toContain('Withdrawn');
    expect(text).not.toMatch(/weight|out of 21|\b21\b/);
    expect(text).not.toContain('down to E');
    expect(text).not.toContain('three factors');
  });

  it('links to the reasoning behind the 1 to 7 scale', async () => {
    const { container } = await render(HowItWorks, {});
    expect(container.querySelector('a[href="/about.html#scale"]')?.textContent).toBe('Why 1 to 7?');
  });
});

describe('ScaleLegend', () => {
  it('shows five bands ending in D', async () => {
    const { container } = await render(ScaleLegend, {});
    const text = container.textContent ?? '';
    expect(text).toContain('Low investment grade');
    expect(text).toContain('Deprecated');
    expect(text.trim().endsWith('D')).toBe(true);
  });
});

describe('SiteHeader', () => {
  it('names outlook and ends the ladder at C, not E', async () => {
    const { container } = await render(SiteHeader, { ratings: [], asOf: '2026-10-16' });
    const text = container.textContent ?? '';
    expect(text).toContain('outlook');
    expect(text).toContain('down to C');
    expect(text).not.toMatch(/down to E/);
  });
});

describe('SiteFooter', () => {
  it('links to the About page before the rater log-in line', async () => {
    const { container } = await render(SiteFooter, { asOf: '2026-10-16' });
    const about = container.querySelector('a[href="/about.html"]');
    expect(about?.textContent).toBe('About these ratings');
    expect(about?.parentElement?.textContent).toBe(
      'About these ratings: where the ratings come from and who built this site.',
    );
    const login = container.querySelector('a[href="/rate"]');
    expect(about?.compareDocumentPosition(login as Node) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('credits Tommy Puglia with a link to his LinkedIn page', async () => {
    const { container } = await render(SiteFooter, { asOf: '2026-10-16' });
    const credit = container.querySelector('a[href="https://www.linkedin.com/in/tommypuglia"]');
    expect(credit?.textContent).toBe('Tommy Puglia');
    expect(credit?.parentElement?.textContent).toBe('Built by Tommy Puglia.');
    expect(credit?.getAttribute('target')).toBe('_blank');
    expect(credit?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('SiteNav', () => {
  it('keeps an About link in the top bar, outside the scrolling section links', async () => {
    const items = [{ id: 'ratings', label: 'Ratings' }];
    const { container } = await render(SiteNav, { items, active: undefined, onNavigate: () => undefined });
    const about = container.querySelector('header a[href="/about.html"]');
    expect(about?.textContent).toBe('About');
    expect(about?.closest('nav[aria-label="Sections"]')).toBeNull();
  });
});
