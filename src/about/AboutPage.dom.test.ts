// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '../test/dom';
import { AboutPage } from './AboutPage';

afterEach(cleanup);

const KROSNICK =
  'https://web.stanford.edu/dept/communication/faculty/krosnick/docs/2010/2010%20Handbook%20of%20Survey%20Research.pdf';
const MEASURINGU = 'https://measuringu.com/ratingscales-myth-evidence/';

const SITE_LINKS: readonly [text: string, href: string][] = [
  ['Puglia BI Consulting', 'https://pugliabi.com'],
  ['Prompting BI', 'https://promptingbi.com'],
  ['Contact Puglia BI Consulting', 'https://pugliabi.com/contact'],
  ['Tommy Puglia on LinkedIn', 'https://www.linkedin.com/in/tommypuglia'],
  ['Puglia BI Consulting on LinkedIn', 'https://www.linkedin.com/company/puglia-bi-consulting'],
];

describe('AboutPage', () => {
  it('has a title and four sections, with the scale section addressable', async () => {
    const { container } = await render(AboutPage, {});
    const h1 = [...container.querySelectorAll('h1')].map((h) => h.textContent);
    expect(h1).toEqual(['About these ratings']);
    const h2 = [...container.querySelectorAll('h2')].map((h) => h.textContent);
    expect(h2).toEqual(['What this is', 'Where the ratings come from', 'Why a 1 to 7 scale', 'Who built this']);
    expect(container.querySelector('h2#scale')?.textContent).toBe('Why a 1 to 7 scale');
  });

  it('links back to the ratings', async () => {
    const { container } = await render(AboutPage, {});
    const back = [...container.querySelectorAll('a')].find((a) => a.textContent === '← Back to the ratings');
    expect(back?.getAttribute('href')).toBe('/');
  });

  it('says what the ratings are, where they come from and why 1 to 7', async () => {
    const { container } = await render(AboutPage, {});
    const text = container.textContent ?? '';
    expect(text).toContain('from AAA down to C');
    expect(text).toContain('Retired items are rated D.');
    expect(text).toContain('The ratings are opinions.');
    expect(text).toContain('not measurements, benchmarks, or advice to buy');
    expect(text).toContain('Feature Capability, User Experience, CU / Token Cost, and Outlook');
    expect(text).toContain('like these (Krosnick and Presser, Question and Questionnaire Design). Going beyond seven');
    expect(text).toContain('adds little reliability (MeasuringU, Rating Scales: Myth vs. Evidence). The site does not');
    expect(text).toContain('The site does not publish how the four scores combine into a grade.');
    expect(text).toContain('built by Tommy Puglia of Puglia BI Consulting, a Microsoft Fabric and Power BI consultancy.');
    expect(text).toContain('Tommy writes about AI and business intelligence at Prompting BI.');
    expect(text).toContain(
      'Independent and unofficial. Not affiliated with or endorsed by Microsoft. ' +
        'Microsoft Fabric is a trademark of Microsoft Corporation.',
    );
  });

  it('cites Krosnick and Presser and MeasuringU in new tabs', async () => {
    const { container } = await render(AboutPage, {});
    const section = container.querySelector('h2#scale')?.parentElement;
    const krosnick = section?.querySelector<HTMLAnchorElement>(`a[href="${KROSNICK}"]`);
    const measuringu = section?.querySelector<HTMLAnchorElement>(`a[href="${MEASURINGU}"]`);
    expect(krosnick?.textContent).toBe('Krosnick and Presser, Question and Questionnaire Design');
    expect(measuringu?.textContent).toBe('MeasuringU, Rating Scales: Myth vs. Evidence');
    for (const link of [krosnick, measuringu]) {
      expect(link?.getAttribute('target')).toBe('_blank');
      expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('links to the five Puglia BI pages in new tabs', async () => {
    const { container } = await render(AboutPage, {});
    for (const [text, href] of SITE_LINKS) {
      const link = [...container.querySelectorAll('a')].find((a) => a.textContent === text);
      expect(link?.getAttribute('href'), text).toBe(href);
      expect(link?.getAttribute('target'), text).toBe('_blank');
      expect(link?.getAttribute('rel'), text).toBe('noopener noreferrer');
    }
  });

  it('never mentions weights or a total', async () => {
    const { container } = await render(AboutPage, {});
    expect(container.textContent ?? '').not.toMatch(/weight|out of 21|\b21\b/);
  });
});
