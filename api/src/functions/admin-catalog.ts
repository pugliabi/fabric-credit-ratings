import type { AdminCatalog } from '../../../src/domain/api-types.ts';
import { db, transaction, type Db } from '../lib/db.ts';
import { HttpError } from '../lib/errors.ts';
import { CONSTRAINT_CONFLICT, DUPLICATE_KEY, hasSqlNumber, route } from '../lib/http.ts';
import { SLUG, oneOf, optionalInt, text } from '../lib/validate.ts';
import {
  adminCatalog,
  createArtifact,
  createWorkload,
  deleteArtifact,
  updateArtifact,
  updateWorkload,
} from '../repo/catalog.ts';
import { markChanged } from '../repo/site.ts';

const RELEASE_STATUSES = ['ga', 'preview', 'retired'] as const;

function slug(body: Record<string, unknown>, label: string): string {
  const id = text(body, 'id', label, 64);
  if (!SLUG.test(id)) throw new HttpError(400, `${label} must be lowercase words joined by dashes, like copy-job.`);
  return id;
}

function workloadFields(body: Record<string, unknown>) {
  return {
    name: text(body, 'name', 'Name', 100),
    shortName: text(body, 'shortName', 'Short name', 30),
    blurb: text(body, 'blurb', 'Description', 300),
  };
}

function artifactFields(body: Record<string, unknown>, catalog: AdminCatalog) {
  const workload = text(body, 'workload', 'Workload', 64);
  if (!catalog.workloads.some((item) => item.id === workload)) {
    throw new HttpError(400, `Workload ${workload} does not exist.`);
  }
  return {
    name: text(body, 'name', 'Name', 100),
    workload,
    status: oneOf(body, 'status', 'Status', RELEASE_STATUSES),
  };
}

/**
 * Runs a catalog write and its site-changed mark in one transaction, so a committed change always shows the site as
 * behind. These transactions lock no round, so taking site_state last keeps admin-rounds.ts's lock order. A SQL error
 * numbered in `refused` (a race the route's earlier check lost) becomes `refused.error`.
 */
async function saveCatalog(
  write: (tx: Db) => Promise<void>,
  refused?: { numbers: readonly number[]; error: HttpError },
): Promise<AdminCatalog> {
  try {
    await transaction(async (tx) => {
      await write(tx);
      await markChanged(tx);
    });
  } catch (error) {
    if (refused && hasSqlNumber(error, refused.numbers)) throw refused.error;
    throw error;
  }
  return adminCatalog(db);
}

route('adminCatalog', 'GET', 'admin/catalog', 'admin', async () => adminCatalog(db));

route('adminWorkloadCreate', 'POST', 'admin/workloads', 'admin', async (ctx) => {
  const id = slug(ctx.body, 'Workload id');
  const fields = workloadFields(ctx.body);
  const taken = new HttpError(409, `A workload with id ${id} already exists.`);
  if ((await adminCatalog(db)).workloads.some((item) => item.id === id)) throw taken;
  return saveCatalog((tx) => createWorkload(tx, { id, ...fields }), { numbers: DUPLICATE_KEY, error: taken });
});

route('adminWorkloadUpdate', 'PUT', 'admin/workloads/{id}', 'admin', async (ctx) => {
  const current = (await adminCatalog(db)).workloads.find((item) => item.id === ctx.params.id);
  if (!current) throw new HttpError(404, 'That workload does not exist.');
  const sortOrder = optionalInt(ctx.body, 'sortOrder', 'Order') ?? current.sortOrder;
  const fields = workloadFields(ctx.body);
  return saveCatalog((tx) => updateWorkload(tx, current.id, { ...fields, sortOrder }));
});

route('adminArtifactCreate', 'POST', 'admin/artifacts', 'admin', async (ctx) => {
  const catalog = await adminCatalog(db);
  const id = slug(ctx.body, 'Item id');
  const taken = new HttpError(409, `An item with id ${id} already exists.`);
  if (catalog.artifacts.some((item) => item.id === id)) throw taken;
  const fields = artifactFields(ctx.body, catalog);
  return saveCatalog((tx) => createArtifact(tx, { id, ...fields }), { numbers: DUPLICATE_KEY, error: taken });
});

route('adminArtifactUpdate', 'PUT', 'admin/artifacts/{id}', 'admin', async (ctx) => {
  const catalog = await adminCatalog(db);
  const current = catalog.artifacts.find((item) => item.id === ctx.params.id);
  if (!current) throw new HttpError(404, 'That item does not exist.');
  const sortOrder = optionalInt(ctx.body, 'sortOrder', 'Order') ?? current.sortOrder;
  const fields = artifactFields(ctx.body, catalog);
  return saveCatalog((tx) => updateArtifact(tx, current.id, { ...fields, sortOrder }));
});

route('adminArtifactDelete', 'DELETE', 'admin/artifacts/{id}', 'admin', async (ctx) => {
  const current = (await adminCatalog(db)).artifacts.find((item) => item.id === ctx.params.id);
  if (!current) throw new HttpError(404, 'That item does not exist.');
  const inUse = new HttpError(409, `${current.name} has scores or notes. Mark it retired instead of deleting it.`);
  if (current.referenced) throw inUse;
  return saveCatalog((tx) => deleteArtifact(tx, current.id), { numbers: CONSTRAINT_CONFLICT, error: inUse });
});
