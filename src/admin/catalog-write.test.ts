import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminArtifact, AdminCatalog } from '../domain/api-types';
import { api } from '../lib/api';
import { reorder } from './catalog-order';
import { catalogActions, createCatalogWrites, saveOrders, writeCatalog } from './catalog-write';

const CONFLICT = 'That conflicts with a change someone just made. Reload the page and try again.';

const artifact = (id: string, sortOrder: number): AdminArtifact => ({
  id,
  name: id,
  workload: 'data-factory',
  status: 'ga',
  naFactors: [],
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
    posts: () =>
      fetchMock.mock.calls
        .filter(([, init]) => init?.method === 'POST')
        .map(([, init]) => JSON.parse(String(init?.body))),
  };
}

const body = (item: AdminArtifact) => ({
  name: item.name,
  workload: item.workload,
  status: item.status,
  naFactors: item.naFactors,
});

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
      { name: 'b', workload: 'data-factory', status: 'ga', naFactors: [], sortOrder: 10 },
      { name: 'a', workload: 'data-factory', status: 'ga', naFactors: [], sortOrder: 20 },
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

/** A fetch that answers only when the test says so, and rejects on abort like the real one. */
function heldServer() {
  const held: { path: string; method: string; answer: (response: Response) => void }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          held.push({ path: url, method: init?.method ?? 'GET', answer: resolve });
        }),
    ),
  );
  return held;
}

function hooks() {
  const events: string[] = [];
  return {
    events,
    onCatalog: vi.fn((catalog: AdminCatalog) => void events.push(`catalog ${catalog.artifacts.map(({ id }) => id)}`)),
    onError: vi.fn((message: string) => void events.push(`error ${message}`)),
    onStart: vi.fn(() => void events.push('start')),
    onSettled: vi.fn(() => void events.push('settled')),
  };
}

describe('createCatalogWrites', () => {
  it('runs one write at a time: a second press while one runs sends nothing', async () => {
    const held = heldServer();
    const writes = createCatalogWrites(hooks());
    const first = writes.run(catalogActions.deleteArtifact(artifact('a', 10)));
    expect(writes.running).toBe(true);
    await expect(writes.run(catalogActions.deleteArtifact(artifact('b', 20)))).resolves.toBe(false);
    expect(held.map(({ method, path }) => `${method} ${path}`)).toEqual(['DELETE /api/admin/artifacts/a']);
    held[0]!.answer(reply(200, catalog()));
    await expect(first).resolves.toBe(true);
    expect(writes.running).toBe(false);
  });

  it('shows a refusal the server answered and reads the catalog again before settling', async () => {
    const fresh = catalog(artifact('a', 10));
    const calls = server(reply(409, { error: CONFLICT }), reply(200, fresh));
    const watch = hooks();
    const writes = createCatalogWrites(watch);
    const a = artifact('a', 10);
    await expect(writes.run(catalogActions.updateArtifact(a, { status: 'retired' }, catalog(a)))).resolves.toBe(false);
    expect(calls.calls()).toEqual(['PUT /api/admin/artifacts/a', 'GET /api/admin/catalog']);
    expect(watch.events).toEqual(['start', `error ${CONFLICT}`, 'catalog a', 'settled']);
  });

  it('applies the read made as the tab opens when nothing newer arrived', async () => {
    const held = heldServer();
    const watch = hooks();
    const read = createCatalogWrites(watch).readOnOpen(new AbortController().signal);
    expect(held.map(({ path }) => path)).toEqual(['/api/admin/catalog']);
    held[0]!.answer(reply(200, catalog(artifact('a', 10))));
    await read;
    expect(watch.events).toEqual(['catalog a']);
  });

  it("drops that read when it lands after a write's answer, which is newer", async () => {
    const held = heldServer();
    const watch = hooks();
    const writes = createCatalogWrites(watch);
    const read = writes.readOnOpen(new AbortController().signal);
    const write = writes.run(catalogActions.deleteArtifact(artifact('a', 10)));
    held[1]!.answer(reply(200, catalog(artifact('b', 20))));
    await write;
    held[0]!.answer(reply(200, catalog(artifact('a', 10), artifact('b', 20))));
    await read;
    expect(watch.events).toEqual(['start', 'catalog b', 'settled']);
  });

  it('keeps that read after a refusal made in the browser, which changed nothing', async () => {
    const held = heldServer();
    const watch = hooks();
    const writes = createCatalogWrites(watch);
    const read = writes.readOnOpen(new AbortController().signal);
    const add = catalogActions.addArtifact({
      id: 'constructor',
      name: 'Constructor',
      workload: 'data-factory',
      status: 'ga',
    });
    await expect(writes.run(add)).resolves.toBe(false);
    held[0]!.answer(reply(200, catalog(artifact('a', 10))));
    await read;
    expect(held).toHaveLength(1);
    expect(watch.events).toEqual([
      'start',
      'error Item id constructor is reserved. Pick another id.',
      'settled',
      'catalog a',
    ]);
  });

  it('drops that read once the tab closes (aborted)', async () => {
    const held = heldServer();
    const watch = hooks();
    const controller = new AbortController();
    const read = createCatalogWrites(watch).readOnOpen(controller.signal);
    controller.abort();
    held[0]!.answer(reply(200, catalog(artifact('a', 10))));
    await read;
    expect(watch.onCatalog).not.toHaveBeenCalled();
  });
});

describe('catalogActions', () => {
  it('updates an item with its whole row, keeping its place, or at the end of the workload it moves to', async () => {
    // The end is measured in the workload it moves to, across the whole catalog: data-factory's own end would be 30.
    const pipeline = { ...artifact('pipeline', 10), referenced: true };
    const copyJob = artifact('copy-job', 20);
    const report = { ...artifact('report', 30), workload: 'power-bi' };
    const current = catalog(pipeline, copyJob, report);
    const calls = server(reply(200, catalog()), reply(200, catalog()));
    await catalogActions.updateArtifact(pipeline, { status: 'preview' }, current)();
    await catalogActions.updateArtifact(pipeline, { workload: 'power-bi' }, current)();
    expect(calls.calls()).toEqual(['PUT /api/admin/artifacts/pipeline', 'PUT /api/admin/artifacts/pipeline']);
    expect(calls.bodies()).toEqual([
      { name: 'pipeline', workload: 'data-factory', status: 'preview', naFactors: [], sortOrder: 10 },
      { name: 'pipeline', workload: 'power-bi', status: 'ga', naFactors: [], sortOrder: 40 },
    ]);
  });

  it('refuses a reserved item or workload id in the browser, trimmed as the server does, sending nothing', async () => {
    const calls = server();
    const item = { name: 'Constructor', workload: 'data-factory', status: 'ga' } as const;
    await expect(catalogActions.addArtifact({ ...item, id: 'constructor' })()).rejects.toThrow(
      'Item id constructor is reserved. Pick another id.',
    );
    await expect(catalogActions.addArtifact({ ...item, id: ' constructor ' })()).rejects.toThrow(
      'Item id constructor is reserved. Pick another id.',
    );
    const workload = { id: ' prototype', name: 'Prototype', shortName: 'Proto', blurb: 'Tests.' };
    await expect(catalogActions.addWorkload(workload)()).rejects.toThrow(
      'Workload id prototype is reserved. Pick another id.',
    );
    expect(calls.calls()).toEqual([]);
  });

  it('adds items and workloads with trimmed ids and names', async () => {
    const calls = server(reply(200, catalog()), reply(200, catalog()));
    const item = { id: ' copy-job ', name: ' Copy job ', workload: 'data-factory', status: 'preview' } as const;
    await catalogActions.addArtifact(item)();
    await catalogActions.addWorkload({ id: 'fabric-iq ', name: ' Fabric IQ', shortName: 'IQ ', blurb: ' Agents. ' })();
    expect(calls.calls()).toEqual(['POST /api/admin/artifacts', 'POST /api/admin/workloads']);
    expect(calls.posts()).toEqual([
      { id: 'copy-job', name: 'Copy job', workload: 'data-factory', status: 'preview', naFactors: [] },
      { id: 'fabric-iq', name: 'Fabric IQ', shortName: 'IQ', blurb: 'Agents.' },
    ]);
  });

  it('saves a workload trimmed, in place, and deletes an item by its server id', async () => {
    const calls = server(reply(200, catalog()), reply(200, catalog()));
    const [workload] = catalog().workloads;
    await catalogActions.saveWorkload(workload!, { name: 'Data Factory ', shortName: ' Factory', blurb: 'Pipes.' })();
    await catalogActions.deleteArtifact(artifact('copy-job', 20))();
    expect(calls.calls()).toEqual(['PUT /api/admin/workloads/data-factory', 'DELETE /api/admin/artifacts/copy-job']);
    expect(calls.bodies()).toEqual([{ name: 'Data Factory', shortName: 'Factory', blurb: 'Pipes.', sortOrder: 10 }]);
  });

  it('moves items with one whole-row PUT per row that changes', async () => {
    const items = [artifact('a', 10), artifact('b', 20)];
    const calls = server(reply(200, catalog()), reply(200, catalog()));
    await catalogActions.moveArtifacts(catalog(...items), 'data-factory', 1, 0)();
    expect(calls.calls()).toEqual(['PUT /api/admin/artifacts/b', 'PUT /api/admin/artifacts/a']);
    expect(calls.bodies().map(({ sortOrder }) => sortOrder)).toEqual([10, 20]);
  });

  it("renumbers only the moved item's workload, even when other workloads' items come first in the catalog", async () => {
    const x = { ...artifact('x', 10), workload: 'power-bi' };
    const y = { ...artifact('y', 20), workload: 'power-bi' };
    const [a, b] = [artifact('a', 10), artifact('b', 20)];
    const calls = server(reply(200, catalog()), reply(200, catalog()));
    await catalogActions.moveArtifacts(catalog(x, y, a, b), 'data-factory', 1, 0)();
    expect(calls.calls()).toEqual(['PUT /api/admin/artifacts/b', 'PUT /api/admin/artifacts/a']);
    expect(calls.bodies()).toEqual([
      { name: 'b', workload: 'data-factory', status: 'ga', naFactors: [], sortOrder: 10 },
      { name: 'a', workload: 'data-factory', status: 'ga', naFactors: [], sortOrder: 20 },
    ]);
  });
});
