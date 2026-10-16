// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCatalog } from '../domain/api-types';
import type { FactorId } from '../domain/types';
import { cleanup, click, fakeApi, render, settle } from '../test/dom';
import { CatalogTab } from './CatalogTab';

const catalogWith = (naFactors: FactorId[]): AdminCatalog => ({
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
    },
  ],
});

const box = (root: ParentNode, factor: string) =>
  root.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="Notebook: ${factor} not applicable"]`);

async function open(naFactors: FactorId[]) {
  const before = catalogWith(naFactors);
  const api = fakeApi({
    'GET /api/admin/catalog': before,
    'PUT /api/admin/artifacts/notebook': (body: unknown) =>
      catalogWith((body as { naFactors: FactorId[] }).naFactors),
  });
  vi.stubGlobal('fetch', api.fetchMock);
  const { container } = await render(CatalogTab, { catalog: before, onCatalog: () => {} });
  await settle();
  return { container, api };
}

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
