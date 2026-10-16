import sql from 'mssql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminArtifact, AdminCatalog, AdminWorkload, SessionUser } from '../../../src/domain/api-types.ts';
import { db, transaction, type Db } from '../lib/db.ts';
import type { UserCtx } from '../lib/http.ts';
import {
  adminCatalog,
  createArtifact,
  createWorkload,
  deleteArtifact,
  setArtifactDescription,
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
  setArtifactDescription: vi.fn(),
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
  naFactors: [],
  sortOrder: 10,
  referenced: false,
  description: '',
};
const catalog: AdminCatalog = { workloads: [workload], artifacts: [notebook] };
const admin: SessionUser = { id: 1, login: 'admin', displayName: 'Admin', role: 'admin' };
const tx: Db = { query: () => Promise.reject(new Error('The repo functions are mocked.')) };
const committed = vi.fn();
const log = { warn: vi.fn() };

function call(name: string, params: Record<string, string>, body: Record<string, unknown> = {}): Promise<unknown> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered.`);
  return handler({ params, body, user: admin, log } as unknown as UserCtx);
}

/** What mssql rejects with when the server refuses a statement. */
function sqlError(number: number): sql.RequestError {
  return new sql.RequestError(Object.assign(new Error(`SQL Server error ${number}`), { info: { number } }));
}

/** When each mock was first called, for comparing with the order the calls should happen in. Each must be called. */
function callOrder(...mocks: { mock: { invocationCallOrder: number[] } }[]): number[] {
  return mocks.map((fn) => {
    const [first] = fn.mock.invocationCallOrder;
    if (first === undefined) throw new Error('Expected every mock in the order check to have been called.');
    return first;
  });
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

  it('answers 503 asking to try again, and logs it, when it loses a deadlock to a save adding the item', async () => {
    const deadlock = sqlError(1205);
    vi.mocked(deleteArtifact).mockRejectedValue(deadlock);

    await expect(call('adminArtifactDelete', { id: 'notebook' })).rejects.toMatchObject({
      status: 503,
      message: 'Someone was saving a score or note for Notebook at the same moment. Try again.',
    });
    expect(log.warn).toHaveBeenCalledWith('Deadlock victim', deadlock);
    expect(markChanged).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();
  });

  it('passes other database errors through', async () => {
    const error = sqlError(2627);
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

describe('adminArtifactDescription', () => {
  it('saves the trimmed description with a plain write: no transaction, no site-changed mark', async () => {
    const described: AdminCatalog = { ...catalog, artifacts: [{ ...notebook, description: 'Runs Spark code.' }] };
    vi.mocked(adminCatalog).mockResolvedValueOnce(catalog).mockResolvedValueOnce(described);

    const answer = await call('adminArtifactDescription', { id: 'notebook' }, { description: '  Runs Spark code.  ' });

    expect(answer).toEqual(described);

    expect(setArtifactDescription).toHaveBeenCalledWith(db, 'notebook', 'Runs Spark code.');
    expect(transaction).not.toHaveBeenCalled();
    expect(markChanged).not.toHaveBeenCalled();
  });

  it('clears the description when it is empty or only spaces', async () => {
    await call('adminArtifactDescription', { id: 'notebook' }, { description: '   ' });

    expect(setArtifactDescription).toHaveBeenCalledWith(db, 'notebook', '');
  });

  it('accepts exactly 600 characters after trimming, and refuses 601 with 400', async () => {
    await call('adminArtifactDescription', { id: 'notebook' }, { description: ` ${'a'.repeat(600)} ` });
    expect(setArtifactDescription).toHaveBeenCalledWith(db, 'notebook', 'a'.repeat(600));

    vi.mocked(setArtifactDescription).mockClear();
    await expect(
      call('adminArtifactDescription', { id: 'notebook' }, { description: 'a'.repeat(601) }),
    ).rejects.toMatchObject({ status: 400, message: 'Descriptions use at most 600 characters.' });
    expect(setArtifactDescription).not.toHaveBeenCalled();
  });

  it('refuses a description that is not text with 400', async () => {
    for (const body of [{}, { description: 7 }, { description: null }, { description: ['a'] }]) {
      await expect(call('adminArtifactDescription', { id: 'notebook' }, body)).rejects.toMatchObject({
        status: 400,
        message: 'Send the description as text.',
      });
    }
    expect(setArtifactDescription).not.toHaveBeenCalled();
  });

  it('answers 404 for an item that does not exist, writing nothing', async () => {
    await expect(call('adminArtifactDescription', { id: 'nope' }, { description: 'Hi.' })).rejects.toMatchObject({
      status: 404,
      message: 'That item does not exist.',
    });
    expect(setArtifactDescription).not.toHaveBeenCalled();
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

    expect(createArtifact).toHaveBeenCalledWith(tx, { ...newArtifact, naFactors: [] });
    expect(markChanged).toHaveBeenCalledWith(tx);
    expectAscending(callOrder(vi.mocked(createArtifact), vi.mocked(markChanged), committed));
  });

  it('stores the not-applicable factors sent with a new item', async () => {
    await call('adminArtifactCreate', {}, { ...newArtifact, naFactors: ['cost'] });

    expect(createArtifact).toHaveBeenCalledWith(tx, { ...newArtifact, naFactors: ['cost'] });
  });

  it('keeps the current not-applicable factors when an update sends none, and replaces them when it does', async () => {
    const marked: AdminCatalog = { ...catalog, artifacts: [{ ...notebook, naFactors: ['cost'] }] };
    vi.mocked(adminCatalog).mockResolvedValue(marked);
    const body = { name: 'Notebook', workload: workload.id, status: 'ga' };

    await call('adminArtifactUpdate', { id: notebook.id }, body);
    expect(updateArtifact).toHaveBeenLastCalledWith(tx, notebook.id, expect.objectContaining({ naFactors: ['cost'] }));

    await call('adminArtifactUpdate', { id: notebook.id }, { ...body, naFactors: [] });
    expect(updateArtifact).toHaveBeenLastCalledWith(tx, notebook.id, expect.objectContaining({ naFactors: [] }));
  });

  it('refuses unknown factors, and every factor marked not applicable, with 400', async () => {
    await expect(call('adminArtifactCreate', {}, { ...newArtifact, naFactors: ['bogus'] })).rejects.toMatchObject({
      status: 400,
      message: 'Unknown factor "bogus".',
    });
    const all = ['capability', 'ux', 'cost', 'outlook'];
    await expect(
      call('adminArtifactUpdate', { id: notebook.id }, { ...newArtifact, naFactors: all }),
    ).rejects.toMatchObject({ status: 400, message: 'At least one factor must apply.' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('updates an item, keeping its order when none is sent, and marks the site changed in one transaction', async () => {
    await call('adminArtifactUpdate', { id: notebook.id }, { name: 'Notebooks', workload: workload.id, status: 'ga' });

    expect(updateArtifact).toHaveBeenCalledWith(tx, notebook.id, {
      name: 'Notebooks',
      workload: workload.id,
      status: 'ga',
      naFactors: [],
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

  it('refuses a bad id or an unknown workload with 400 before opening a transaction', async () => {
    await expect(call('adminWorkloadCreate', {}, { ...newWorkload, id: 'Real Time' })).rejects.toMatchObject({
      status: 400,
      message: 'Workload id must be lowercase words joined by dashes, like copy-job.',
    });
    await expect(call('adminArtifactCreate', {}, { ...newArtifact, workload: 'nope' })).rejects.toMatchObject({
      status: 400,
      message: 'Workload nope does not exist.',
    });
    await expect(
      call('adminArtifactUpdate', { id: notebook.id }, { name: 'Notebook', workload: 'nope', status: 'ga' }),
    ).rejects.toMatchObject({ status: 400, message: 'Workload nope does not exist.' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses ids that are built-in object property names with 400, before opening a transaction', async () => {
    for (const id of ['constructor', 'prototype', '__proto__', 'hasOwnProperty', 'toString']) {
      await expect(call('adminWorkloadCreate', {}, { ...newWorkload, id })).rejects.toMatchObject({
        status: 400,
        message: `Workload id ${id} is reserved. Pick another id.`,
      });
      await expect(call('adminArtifactCreate', {}, { ...newArtifact, id })).rejects.toMatchObject({
        status: 400,
        message: `Item id ${id} is reserved. Pick another id.`,
      });
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  it('passes constraint errors from the update routes through unmapped', async () => {
    const duplicate = sqlError(2627);
    vi.mocked(updateWorkload).mockRejectedValue(duplicate);
    const body = { name: 'Data Engineering', shortName: 'DE', blurb: 'Spark.' };
    await expect(call('adminWorkloadUpdate', { id: workload.id }, body)).rejects.toBe(duplicate);

    const refused = sqlError(547);
    vi.mocked(updateArtifact).mockRejectedValue(refused);
    const item = { name: 'Notebook', workload: workload.id, status: 'ga' };
    await expect(call('adminArtifactUpdate', { id: notebook.id }, item)).rejects.toBe(refused);
  });
});
