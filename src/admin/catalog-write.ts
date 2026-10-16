import type { AdminArtifact, AdminCatalog, AdminWorkload } from '../domain/api-types';
import type { ReleaseStatus } from '../domain/types';
import { api, ApiError, errorMessage } from '../lib/api';
import {
  artifactBody,
  artifactUpdate,
  reorder,
  reservedIdProblem,
  workloadBody,
  type ArtifactChanges,
  type WorkloadFields,
} from './catalog-order';

export interface CatalogWriteHandlers {
  onCatalog: (catalog: AdminCatalog) => void;
  onError: (message: string) => void;
}

/**
 * Runs one or more catalog writes and hands the last answer to `onCatalog`. Resolves false on failure.
 * After any refusal the server answered, except a 401 (which shows the login), the catalog is read again: a reorder is
 * one PUT per row, so a failure partway leaves a partial order, and the page must show what the server has now.
 */
export async function writeCatalog(
  action: () => Promise<AdminCatalog>,
  { onCatalog, onError }: CatalogWriteHandlers,
): Promise<boolean> {
  try {
    onCatalog(await action());
    return true;
  } catch (reason) {
    onError(errorMessage(reason));
    if (reason instanceof ApiError && reason.status !== 401) {
      await api<AdminCatalog>('GET', '/admin/catalog').then(onCatalog, () => undefined);
    }
    return false;
  }
}

/**
 * One whole-row PUT per moved row, in order; each is its own transaction on the server. The first refusal stops the
 * rest. Resolves to the last answer, or to `current` when nothing moves.
 */
export async function saveOrders<T extends { id: string }>(
  path: '/admin/workloads' | '/admin/artifacts',
  moves: readonly { item: T; sortOrder: number }[],
  body: (item: T) => object,
  current: AdminCatalog,
): Promise<AdminCatalog> {
  let latest = current;
  for (const { item, sortOrder } of moves) {
    latest = await api<AdminCatalog>('PUT', `${path}/${item.id}`, { ...body(item), sortOrder });
  }
  return latest;
}

export interface CatalogWriteHooks extends CatalogWriteHandlers {
  /** A write starts: show it as busy and clear the last error. */
  onStart: () => void;
  /** The write, and any read after it, is done. */
  onSettled: () => void;
}

/** The Catalog tab's write runner, kept outside React so its rules can be tested. Make one per mounted tab. */
export function createCatalogWrites({ onCatalog, onError, onStart, onSettled }: CatalogWriteHooks) {
  let running = false;
  /** Catalogs handed over so far. A read is stale if one arrived after it was sent. */
  let applied = 0;
  const apply = (catalog: AdminCatalog) => {
    applied += 1;
    onCatalog(catalog);
  };

  return {
    get running() {
      return running;
    },

    /** One write at a time: a press while one runs resolves false and sends nothing. */
    async run(action: () => Promise<AdminCatalog>): Promise<boolean> {
      if (running) return false;
      running = true;
      onStart();
      try {
        return await writeCatalog(action, { onCatalog: apply, onError });
      } finally {
        running = false;
        onSettled();
      }
    },

    /**
     * Reads the catalog as the tab opens, because scores saved since the page loaded change which items can be
     * deleted. Dropped once `signal` aborts (the tab closed) or when a newer catalog arrived meanwhile. A refusal made
     * in the browser hands over nothing, so it doesn't drop the read.
     */
    async readOnOpen(signal: AbortSignal): Promise<void> {
      const at = applied;
      try {
        const fresh = await api<AdminCatalog>('GET', '/admin/catalog', undefined, { signal });
        if (!signal.aborted && applied === at) apply(fresh);
      } catch {
        // The copy the page loaded stays; the next write's answer replaces it.
      }
    },
  };
}

export type CatalogWrites = ReturnType<typeof createCatalogWrites>;

/** An add that refuses a reserved id in the browser, so nothing is sent. Trims the id first, as the server does. */
export function addAction(
  label: 'Item id' | 'Workload id',
  rawId: string,
  post: (id: string) => Promise<AdminCatalog>,
): () => Promise<AdminCatalog> {
  return async () => {
    const id = rawId.trim();
    const problem = reservedIdProblem(label, id);
    if (problem) throw new Error(problem);
    return post(id);
  };
}

const trimmed = (fields: WorkloadFields): WorkloadFields => ({
  name: fields.name.trim(),
  shortName: fields.shortName.trim(),
  blurb: fields.blurb.trim(),
});

/** The Catalog tab's writes, as actions for `run`. Ids in paths come from the server; new ids go in POST bodies. */
export const catalogActions = {
  addArtifact: (fields: { id: string; name: string; workload: string; status: ReleaseStatus }) =>
    addAction('Item id', fields.id, (id) =>
      api<AdminCatalog>('POST', '/admin/artifacts', {
        id,
        name: fields.name.trim(),
        workload: fields.workload,
        status: fields.status,
        naFactors: [],
      }),
    ),

  addWorkload: (fields: WorkloadFields & { id: string }) =>
    addAction('Workload id', fields.id, (id) =>
      api<AdminCatalog>('POST', '/admin/workloads', { id, ...trimmed(fields) }),
    ),

  saveWorkload: (workload: AdminWorkload, fields: WorkloadFields) => () =>
    api<AdminCatalog>('PUT', `/admin/workloads/${workload.id}`, { ...trimmed(fields), sortOrder: workload.sortOrder }),

  /** A move to another workload lands at that workload's end, measured across the whole catalog. */
  updateArtifact: (artifact: AdminArtifact, changes: ArtifactChanges, current: AdminCatalog) => () =>
    api<AdminCatalog>('PUT', `/admin/artifacts/${artifact.id}`, artifactUpdate(artifact, changes, current.artifacts)),

  /** The description has its own route: it is admin-only prompt context, not part of the item's whole row. */
  saveDescription: (artifact: AdminArtifact, description: string) => () =>
    api<AdminCatalog>('PUT', `/admin/artifacts/${artifact.id}/description`, { description: description.trim() }),

  deleteArtifact: (artifact: AdminArtifact) => () => api<AdminCatalog>('DELETE', `/admin/artifacts/${artifact.id}`),

  /** Renumbers only `workload`'s items, in the catalog's order; `from` and `to` index that list. */
  moveArtifacts: (current: AdminCatalog, workload: string, from: number, to: number) => () =>
    saveOrders(
      '/admin/artifacts',
      reorder(current.artifacts.filter((item) => item.workload === workload), from, to),
      artifactBody,
      current,
    ),

  moveWorkloads: (current: AdminCatalog, from: number, to: number) => () =>
    saveOrders('/admin/workloads', reorder(current.workloads, from, to), workloadBody, current),
};
