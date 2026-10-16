import type { AdminCatalog } from '../domain/api-types';
import { api, ApiError, errorMessage } from '../lib/api';

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
