import type { InvocationContext } from '@azure/functions';
import { CONSTRAINT_CONFLICT, DEADLOCK_VICTIM, hasSqlNumber, transaction, type Db } from './db.ts';
import { HttpError } from './errors.ts';

export const CARD_ITEM_DELETED = 'An item on this card was just deleted. Reload the page to get the current list.';

/**
 * Runs a card or note save. Its CHECKs are validated first, so a foreign key refusing it means an item was deleted
 * after the route checked it, answered with `deleted`. A save that loses a deadlock runs once more: `work` re-reads
 * everything it decides on under its own locks, and the server rolled the lost attempt back whole.
 */
export async function saveForItems(
  log: Pick<InvocationContext, 'warn'>,
  deleted: string,
  work: (tx: Db) => Promise<void>,
): Promise<void> {
  for (let retries = 0; ; retries += 1) {
    try {
      await transaction(work);
      return;
    } catch (error) {
      if (hasSqlNumber(error, CONSTRAINT_CONFLICT)) throw new HttpError(409, deleted);
      if (!hasSqlNumber(error, DEADLOCK_VICTIM)) throw error;
      log.warn('Deadlock victim', error);
      if (retries >= 1) throw new HttpError(503, 'Someone was changing the catalog at the same moment. Try again.');
    }
  }
}
