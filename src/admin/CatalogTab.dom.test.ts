// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCatalog } from '../domain/api-types';
import type { FactorId } from '../domain/types';
import { cleanup, click, fakeApi, render, settle, type } from '../test/dom';
import { CatalogTab } from './CatalogTab';

const catalogWith = (naFactors: FactorId[], description = ''): AdminCatalog => ({
  workloads: [{ id: 'data-engineering', name: 'Data Engineering', shortName: 'Data Eng', blurb: '', sortOrder: 10 }],
  artifacts: [
    {
      id: 'notebook',
      name: 'Notebook',
      workload: 'data-engineering',
      status: 'ga',
      naFactors,
      sortOrder: 10,
      referenced: false,
      description,
    },
  ],
});

const box = (root: ParentNode, factor: string) =>
  root.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="Notebook: ${factor} not applicable"]`);

async function open(naFactors: FactorId[], description = '') {
  const before = catalogWith(naFactors, description);
  const api = fakeApi({
    'GET /api/admin/catalog': before,
    'PUT /api/admin/artifacts/notebook': (body: unknown) =>
      catalogWith((body as { naFactors: FactorId[] }).naFactors, description),
    'PUT /api/admin/artifacts/notebook/description': (body: unknown) =>
      catalogWith(naFactors, (body as { description: string }).description),
  });
  vi.stubGlobal('fetch', api.fetchMock);
  const { container } = await render(CatalogTab, { catalog: before, onCatalog: () => {} });
  await settle();
  return { container, api };
}

const toggle = (root: ParentNode) =>
  root.querySelector<HTMLButtonElement>('button[aria-label="Notebook description"]');
const editor = (root: ParentNode) =>
  root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Notebook description text"]');
const saveDescription = (root: ParentNode) =>
  root.querySelector<HTMLButtonElement>('button[aria-label="Save Notebook description"]');

const puts = (api: { calls: { method: string }[] }) => api.calls.filter((call) => call.method === 'PUT');

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', '');
});

afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.body.innerHTML = '';
});

describe('CatalogTab not applicable', () => {
  it('shows one checkbox per factor on each row, checked for the factors already marked', async () => {
    const { container } = await open(['ux']);

    expect(container.querySelectorAll('fieldset input[type="checkbox"]')).toHaveLength(4);
    expect(box(container, 'Feature Capability')?.checked).toBe(false);
    expect(box(container, 'User Experience')?.checked).toBe(true);
  });

  it('sends the whole row with the factor added when a box is checked', async () => {
    const { container, api } = await open([]);

    await click(box(container, 'CU / Token Cost'));
    await settle();

    expect(puts(api)).toHaveLength(1);
    expect(api.calls.find((call) => call.method === 'PUT')).toMatchObject({
      path: '/api/admin/artifacts/notebook',
      body: { name: 'Notebook', workload: 'data-engineering', status: 'ga', naFactors: ['cost'], sortOrder: 10 },
    });
  });

  it('sends nothing for a check that would leave no factor applicable', async () => {
    const { container, api } = await open(['capability', 'ux', 'cost']);

    await click(box(container, 'Outlook'));
    await settle();

    expect(puts(api)).toHaveLength(0);
  });
});

describe('CatalogTab item descriptions', () => {
  it('shows a collapsed Description button per row, checked once the item has a description', async () => {
    const empty = await open([]);
    expect(toggle(empty.container)?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle(empty.container)?.textContent).toBe('Description');
    expect(editor(empty.container)).toBeNull();
    await cleanup();

    const described = await open([], 'Runs Spark code.');
    expect(toggle(described.container)?.textContent).toBe('Description ✓');
  });

  it('tells a screen reader which items have a description, which the aria-label would hide', async () => {
    const empty = await open([]);
    expect(toggle(empty.container)?.hasAttribute('title')).toBe(false);
    expect(toggle(empty.container)?.hasAttribute('aria-describedby')).toBe(false);
    expect(empty.container.textContent).not.toContain('Has a description');
    await cleanup();

    const { container } = await open([], 'Runs Spark code.');
    const button = toggle(container);
    expect(button?.getAttribute('title')).toBe('Has a description');
    const hint = container.querySelector(`[id="${button?.getAttribute('aria-describedby')}"]`);
    expect(hint?.textContent).toBe('Has a description');
    expect(hint?.classList.contains('visually-hidden')).toBe(true);
  });

  it('still renders the row and its Description toggle when an older API omits the description', async () => {
    const full = catalogWith([]);
    const { description: _, ...artifact } = full.artifacts[0] as AdminCatalog['artifacts'][number];
    const old = { ...full, artifacts: [artifact] } as unknown as AdminCatalog;
    vi.stubGlobal('fetch', fakeApi({ 'GET /api/admin/catalog': old }).fetchMock);
    const { container } = await render(CatalogTab, { catalog: old, onCatalog: () => {} });
    await settle();

    expect(container.querySelector('input[aria-label="Notebook name"]')).not.toBeNull();
    expect(toggle(container)?.textContent).toBe('Description');
    await click(toggle(container));
    expect(editor(container)?.value).toBe('');
  });

  it('opens a row below the item with the current text and a counter, and closes it again', async () => {
    const { container } = await open([], 'Runs Spark code.');

    await click(toggle(container));

    expect(toggle(container)?.getAttribute('aria-expanded')).toBe('true');
    const field = editor(container);
    expect(field?.value).toBe('Runs Spark code.');
    expect(field?.hasAttribute('maxlength')).toBe(false);
    expect(field?.closest('tr')?.previousElementSibling).toBe(toggle(container)?.closest('tr'));
    expect(field?.closest('td')?.getAttribute('colspan')).toBe('6');
    expect(container.textContent).toContain('16/600');
    expect(saveDescription(container)?.getAttribute('aria-disabled')).toBe('true');

    await click(toggle(container));

    expect(toggle(container)?.getAttribute('aria-expanded')).toBe('false');
    expect(editor(container)).toBeNull();
  });

  it('sends the trimmed text on Save, and nothing while the text is unchanged', async () => {
    const { container, api } = await open([]);
    await click(toggle(container));

    await click(saveDescription(container));
    await settle();
    expect(puts(api)).toHaveLength(0);

    await type(editor(container), '  Runs Spark code.  ');
    expect(container.textContent).toContain('16/600');
    expect(saveDescription(container)?.getAttribute('aria-disabled')).toBe('false');
    await click(saveDescription(container));
    await settle();

    expect(puts(api)).toHaveLength(1);
    expect(api.calls.find((call) => call.method === 'PUT')).toMatchObject({
      path: '/api/admin/artifacts/notebook/description',
      body: { description: 'Runs Spark code.' },
    });
  });

  it('keeps Save aria-disabled, and sends nothing more, while a write runs', async () => {
    let release: (catalog: AdminCatalog) => void = () => {};
    const pending = new Promise<AdminCatalog>((resolve) => {
      release = resolve;
    });
    const before = catalogWith([]);
    const api = fakeApi({
      'GET /api/admin/catalog': before,
      'PUT /api/admin/artifacts/notebook/description': () => pending,
    });
    vi.stubGlobal('fetch', api.fetchMock);
    const { container } = await render(CatalogTab, { catalog: before, onCatalog: () => {} });
    await settle();
    await click(toggle(container));
    await type(editor(container), 'Runs Spark code.');
    await click(saveDescription(container));

    await type(editor(container), 'Runs Spark code. More.');
    expect(saveDescription(container)?.getAttribute('aria-disabled')).toBe('true');
    await click(saveDescription(container));
    expect(puts(api)).toHaveLength(1);

    release(catalogWith([], 'Runs Spark code.'));
    await settle();
    expect(saveDescription(container)?.getAttribute('aria-disabled')).toBe('false');
  });
});
