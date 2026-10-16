import type { InvocationContext } from '@azure/functions';
import { CONSTRAINT_CONFLICT, DEADLOCK_VICTIM, hasSqlNumber, transaction, type Db } from './db.ts';
import { HttpError } from './errors.ts';

export const CARD_ITEM_DELETED = 'An item on this card was just deleted. Reload the page to get the current list.';

/**
 * Runs a card or note save. Its CHECKs are validated first, so a foreign key refusing it means an item was deleted
 * after the route checked it, answered with `deleted`. Card saves take the round lock in turn, so the only deadlock
 * one can lose is to that same item delete.
 */
export async function saveForItems(
  log: Pick<InvocationContext, 'warn'>,
  deleted: string,
  work: (tx: Db) => Promise<void>,
): Promise<void> {
  try {
    await transaction(work);
  } catch (error) {
    if (hasSqlNumber(error, CONSTRAINT_CONFLICT)) throw new HttpError(409, deleted);
    if (hasSqlNumber(error, DEADLOCK_VICTIM)) {
      log.warn('Deadlock victim', error);
      throw new HttpError(503, 'Someone was changing the catalog at the same moment. Try again.');
    }
    throw error;
  }
}
