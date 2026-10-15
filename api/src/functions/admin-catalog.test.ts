import sql from 'mssql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminArtifact, AdminCatalog, AdminWorkload, SessionUser } from '../../../src/domain/api-types.ts';
import { transaction, type Db } from '../lib/db.ts';
import type { UserCtx } from '../lib/http.ts';
import {
  adminCatalog,
  createArtifact,
  createWorkload,
  deleteArtifact,
  updateArtifact,
  updateWorkload,
} from '../repo/catalog.ts';
import { markChanged } from '../repo/site.ts';
import './admin-catalog.ts';

type Handler = (ctx: UserCtx) => Promise<unknown>;

const handlers = vi.hoisted(() => new Map<string, Handler>());

vi.mock(import('../lib/http.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  route: (name: string, _method: string, _path: string, _access: string, handler: Handler) => {
    handlers.set(name, handler);
  },
}));
vi.mock(import('../lib/db.ts'), async (importOriginal) => ({ ...(await importOriginal()), transaction: vi.fn() }));
vi.mock(import('../repo/catalog.ts'), () => ({
  adminCatalog: vi.fn(),
  createArtifact: vi.fn(),
  createWorkload: vi.fn(),
  deleteArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  updateWorkload: vi.fn(),
}));
vi.mock(import('../repo/site.ts'), () => ({ markChanged: vi.fn() }));

const workload: AdminWorkload = {
  id: 'data-engineering',
  name: 'Data Engineering',
  shortName: 'Data Eng',
  blurb: 'Spark and lakehouses.',
  sortOrder: 10,
};
const notebook: AdminArtifact = {
  id: 'notebook',
  name: 'Notebook',
  workload: 'data-engineering',
  status: 'ga',
  sortOrder: 10,
  referenced: false,
};
const catalog: AdminCatalog = { workloads: [workload], artifacts: [notebook] };
const admin: SessionUser = { id: 1, login: 'admin', displayName: 'Admin', role: 'admin' };
const tx: Db = { query: () => Promise.reject(new Error('The repo functions are mocked.')) };
const committed = vi.fn();

function call(name: string, params: Record<string, string>, body: Record<string, unknown> = {}): Promise<unknown> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered.`);
  return handler({ params, body, user: admin } as unknown as UserCtx);
}

/** What mssql rejects with when the server refuses a statement. */
function sqlError(number: number): sql.RequestError {
  return new sql.RequestError(Object.assign(new Error(`SQL Server error ${number}`), { info: { number } }));
}

/** When each mock was first called, for comparing with the order the calls should happen in. */
function callOrder(...mocks: { mock: { invocationCallOrder: number[] } }[]): number[] {
  return mocks.map((fn) => fn.mock.invocationCallOrder[0] ?? 0);
}

function expectAscending(order: number[]): void {
  expect(order).toEqual([...order].sort((a, b) => a - b));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(transaction).mockImplementation(async (work) => {
    const value = await work(tx);
    committed();
    return value;
  });
  vi.mocked(adminCatalog).mockResolvedValue(catalog);
});

describe('adminArtifactDelete', () => {
  it('deletes the item and marks the site changed in one transaction', async () => {
    expect(await call('adminArtifactDelete', { id: 'notebook' })).toEqual(catalog);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deleteArtifact).toHaveBeenCalledWith(tx, 'notebook');
    expect(markChanged).toHaveBeenCalledWith(tx);
    expectAscending(callOrder(vi.mocked(deleteArtifact), vi.mocked(markChanged), committed));
  });

  it('answers 409, saying to retire it, when a score or note landed after the check', async () => {
    vi.mocked(deleteArtifact).mockRejectedValue(sqlError(547));

    await expect(call('adminArtifactDelete', { id: 'notebook' })).rejects.toMatchObject({
      status: 409,
      message: 'Notebook has scores or notes. Mark it retired instead of deleting it.',
    });
    expect(markChanged).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();
  });

  it('passes other database errors through', async () => {
    const error = sqlError(1205);
    vi.mocked(deleteArtifact).mockRejectedValue(error);
    await expect(call('adminArtifactDelete', { id: 'notebook' })).rejects.toBe(error);
  });

  it('refuses with 409, before any transaction, an item that has scores or notes', async () => {
    vi.mocked(adminCatalog).mockResolvedValue({ ...catalog, artifacts: [{ ...notebook, referenced: true }] });

    await expect(call('adminArtifactDelete', { id: 'notebook' })).rejects.toMatchObject({
      status: 409,
      message: 'Notebook has scores or notes. Mark it retired instead of deleting it.',
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('answers 404 for an item that does not exist', async () => {
    await expect(call('adminArtifactDelete', { id: 'nope' })).rejects.toMatchObject({
      status: 404,
      message: 'That item does not exist.',
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('catalog writes', () => {
  const newWorkload = { id: 'real-time', name: 'Real-Time Intelligence', shortName: 'RTI', blurb: 'Streams.' };
  const newArtifact = { id: 'copy-job', name: 'Copy job', workload: 'data-engineering', status: 'preview' };

  it('creates a workload and marks the site changed in one transaction', async () => {
    expect(await call('adminWorkloadCreate', {}, newWorkload)).toEqual(catalog);

    expect(createWorkload).toHaveBeenCalledWith(tx, newWorkload);
    expect(markChanged).toHaveBeenCalledWith(tx);
    expectAscending(callOrder(vi.mocked(createWorkload), vi.mocked(markChanged), committed));
  });

  it('updates a workload and marks the site changed in one transaction', async () => {
    const body = { name: 'Data Engineering', shortName: 'DE', blurb: 'Spark.', sortOrder: 20 };
    await call('adminWorkloadUpdate', { id: workload.id }, body);

    expect(updateWorkload).toHaveBeenCalledWith(tx, workload.id, body);
    expect(markChanged).toHaveBeenCalledWith(tx);
    expectAscending(callOrder(vi.mocked(updateWorkload), vi.mocked(markChanged), committed));
  });

  it('creates an item and marks the site changed in one transaction', async () => {
    await call('adminArtifactCreate', {}, newArtifact);

    expect(createArtifact).toHaveBeenCalledWith(tx, newArtifact);
    expect(markChanged).toHaveBeenCalledWith(tx);
    expectAscending(callOrder(vi.mocked(createArtifact), vi.mocked(markChanged), committed));
  });

  it('updates an item, keeping its order when none is sent, and marks the site changed in one transaction', async () => {
    await call('adminArtifactUpdate', { id: notebook.id }, { name: 'Notebooks', workload: workload.id, status: 'ga' });

    expect(updateArtifact).toHaveBeenCalledWith(tx, notebook.id, {
      name: 'Notebooks',
      workload: workload.id,
      status: 'ga',
      sortOrder: notebook.sortOrder,
    });
    expect(markChanged).toHaveBeenCalledWith(tx);
    expectAscending(callOrder(vi.mocked(updateArtifact), vi.mocked(markChanged), committed));
  });

  it('answers a concurrent create of the same id with the usual already-exists 409', async () => {
    vi.mocked(createWorkload).mockRejectedValue(sqlError(2627));
    await expect(call('adminWorkloadCreate', {}, newWorkload)).rejects.toMatchObject({
      status: 409,
      message: 'A workload with id real-time already exists.',
    });

    vi.mocked(createArtifact).mockRejectedValue(sqlError(2601));
    await expect(call('adminArtifactCreate', {}, newArtifact)).rejects.toMatchObject({
      status: 409,
      message: 'An item with id copy-job already exists.',
    });
    expect(markChanged).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();
  });
});
