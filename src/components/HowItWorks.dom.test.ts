// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '../test/dom';
import { HowItWorks } from './HowItWorks';
import { ScaleLegend } from './ScaleLegend';
import { SiteHeader } from './SiteHeader';

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
