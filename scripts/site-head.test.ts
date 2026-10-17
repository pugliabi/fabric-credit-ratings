import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

const PAGES = ['index.html', 'rate.html', 'admin.html', 'about.html'];
const PUBLIC_PAGES = ['index.html', 'rate.html', 'about.html'];

describe('site head', () => {
  it.each(PAGES)('%s links the Threaded A icons and the web manifest', (page) => {
    const html = read(page);
    expect(html).toContain('<link rel="icon" href="%BASE_URL%favicon.ico" sizes="48x48" />');
    expect(html).toContain('<link rel="icon" href="%BASE_URL%favicon.svg" type="image/svg+xml" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="%BASE_URL%apple-touch-icon.png" />');
    expect(html).toContain('<link rel="manifest" href="%BASE_URL%site.webmanifest" />');
  });

  it.each(PUBLIC_PAGES)('%s has a link preview card', (page) => {
    const html = read(page);
    expect(html).toContain('<meta property="og:image" content="https://fabriccreditratings.com/og-image.png" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it('keeps link previews off the admin page', () => {
    expect(read('admin.html')).not.toContain('og:');
  });

  it('ships every icon the heads and the manifest name', () => {
    for (const file of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'site.webmanifest', 'og-image.png']) {
      expect(existsSync(new URL(`public/${file}`, root)), file).toBe(true);
    }
    const manifest = JSON.parse(read('public/site.webmanifest')) as { icons: { src: string }[] };
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) expect(existsSync(new URL(`public${icon.src}`, root)), icon.src).toBe(true);
  });

  it('retires the old AAA text favicon', () => {
    expect(read('public/favicon.svg')).not.toContain('AAA');
  });
});
