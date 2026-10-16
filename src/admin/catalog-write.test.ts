import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminArtifact, AdminCatalog } from '../domain/api-types';
import { api } from '../lib/api';
import { reorder } from './catalog-order';
import { saveOrders, writeCatalog } from './catalog-write';

const CONFLICT = 'That conflicts with a change someone just made. Reload the page and try again.';

const artifact = (id: string, sortOrder: number): AdminArtifact => ({
  id,
  name: id,
  workload: 'data-factory',
  status: 'ga',
  sortOrder,
  referenced: false,
});

const catalog = (...artifacts: AdminArtifact[]): AdminCatalog => ({
  workloads: [{ id: 'data-factory', name: 'Data Factory', shortName: 'Factory', blurb: 'Pipelines.', sortOrder: 10 }],
  artifacts,
});

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Answers each call with the next reply in turn, and records each call as "METHOD /path". */
function server(...replies: Response[]) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) => replies.shift() ?? reply(500, { error: 'No more replies.' }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls: () => fetchMock.mock.calls.map(([url, init]) => `${init?.method} ${url}`),
    bodies: () =>
      fetchMock.mock.calls
        .filter(([, init]) => init?.method === 'PUT')
        .map(([, init]) => JSON.parse(String(init?.body))),
  };
}

const body = (item: AdminArtifact) => ({ name: item.name, workload: item.workload, status: item.status });

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('saveOrders', () => {
  it('sends one whole-row PUT per moved row and returns the last answer', async () => {
    const [a, b] = [artifact('a', 10), artifact('b', 20)];
    const after = catalog(artifact('b', 10), artifact('a', 20));
    const api = server(reply(200, catalog(a, artifact('b', 10))), reply(200, after));
    const moves = [
      { item: b, sortOrder: 10 },
      { item: a, sortOrder: 20 },
    ];
    await expect(saveOrders('/admin/artifacts', moves, body, catalog(a, b))).resolves.toEqual(after);
    expect(api.calls()).toEqual(['PUT /api/admin/artifacts/b', 'PUT /api/admin/artifacts/a']);
    expect(api.bodies()).toEqual([
      { name: 'b', workload: 'data-factory', status: 'ga', sortOrder: 10 },
      { name: 'a', workload: 'data-factory', status: 'ga', sortOrder: 20 },
    ]);
  });

  it('sends nothing and keeps the catalog when no row moves', async () => {
    const api = server();
    const current = catalog(artifact('a', 10));
    await expect(saveOrders('/admin/artifacts', [], body, current)).resolves.toBe(current);
    expect(api.calls()).toEqual([]);
  });
});

describe('writeCatalog', () => {
  it('hands the answer over and reports no error', async () => {
    const after = catalog(artifact('a', 10));
    server(reply(200, after));
    const onCatalog = vi.fn();
    const onError = vi.fn();
    const action = () => saveOrders('/admin/artifacts', [{ item: artifact('a', 20), sortOrder: 10 }], body, catalog());
    await expect(writeCatalog(action, { onCatalog, onError })).resolves.toBe(true);
    expect(onCatalog.mock.calls).toEqual([[after]]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('stops a reorder at the first refusal, shows it, and reads the catalog again', async () => {
    const items = [artifact('a', 10), artifact('b', 10), artifact('c', 15), artifact('d', 15)];
    const moves = reorder(items, 0, 1);
    const partial = catalog(artifact('a', 20), ...items.slice(1));
    const api = server(reply(200, partial), reply(409, { error: CONFLICT }), reply(200, partial));
    const onCatalog = vi.fn();
    const onError = vi.fn();
    const ok = await writeCatalog(() => saveOrders('/admin/artifacts', moves, body, catalog(...items)), {
      onCatalog,
      onError,
    });
    expect(moves.map(({ item }) => item.id)).toEqual(['a', 'c', 'd']);
    expect(ok).toBe(false);
    expect(api.calls()).toEqual(['PUT /api/admin/artifacts/a', 'PUT /api/admin/artifacts/c', 'GET /api/admin/catalog']);
    expect(onError.mock.calls).toEqual([[CONFLICT]]);
    expect(onCatalog.mock.calls).toEqual([[partial]]);
  });

  it('shows a refused delete and the refetched row, which is now referenced', async () => {
    const used = { ...artifact('a', 10), referenced: true };
    const refused = 'a has scores or notes. Mark it retired instead of deleting it.';
    const calls = server(reply(409, { error: refused }), reply(200, catalog(used)));
    const onCatalog = vi.fn();
    const onError = vi.fn();
    const action = () => api<AdminCatalog>('DELETE', '/admin/artifacts/a');
    await expect(writeCatalog(action, { onCatalog, onError })).resolves.toBe(false);
    expect(calls.calls()).toEqual(['DELETE /api/admin/artifacts/a', 'GET /api/admin/catalog']);
    expect(onError.mock.calls).toEqual([[refused]]);
    expect(onCatalog.mock.calls).toEqual([[catalog(used)]]);
  });

  it('does not read the catalog again after a 401, which shows the login instead', async () => {
    const api = server(reply(401, { error: 'Log in again.' }));
    const onCatalog = vi.fn();
    const onError = vi.fn();
    const action = () => saveOrders('/admin/artifacts', [{ item: artifact('a', 20), sortOrder: 10 }], body, catalog());
    await expect(writeCatalog(action, { onCatalog, onError })).resolves.toBe(false);
    expect(api.calls()).toEqual(['PUT /api/admin/artifacts/a']);
    expect(onError.mock.calls).toEqual([['Log in again.']]);
    expect(onCatalog).not.toHaveBeenCalled();
  });

  it('sends nothing for a refusal made in the browser', async () => {
    const api = server();
    const onCatalog = vi.fn();
    const onError = vi.fn();
    const action = async (): Promise<AdminCatalog> => {
      throw new Error('Item id constructor is reserved. Pick another id.');
    };
    await expect(writeCatalog(action, { onCatalog, onError })).resolves.toBe(false);
    expect(api.calls()).toEqual([]);
    expect(onError.mock.calls).toEqual([['Item id constructor is reserved. Pick another id.']]);
    expect(onCatalog).not.toHaveBeenCalled();
  });

  it('keeps the refusal when the catalog cannot be read again either', async () => {
    const api = server(reply(409, { error: CONFLICT }), reply(503, { error: 'The ratings database is waking up.' }));
    const onCatalog = vi.fn();
    const onError = vi.fn();
    const action = () => saveOrders('/admin/artifacts', [{ item: artifact('a', 20), sortOrder: 10 }], body, catalog());
    await expect(writeCatalog(action, { onCatalog, onError })).resolves.toBe(false);
    expect(api.calls()).toEqual(['PUT /api/admin/artifacts/a', 'GET /api/admin/catalog']);
    expect(onError.mock.calls).toEqual([[CONFLICT]]);
    expect(onCatalog).not.toHaveBeenCalled();
  });
});
