import { api, ApiError } from '../lib/api';
import { withDraft, type Edits } from './notes';

/** The API's 502 when both drafts leaked a grade: only that item needs a human. */
export const KEPT_LEAKING = 'The model kept mentioning scores or grades. Write this one by hand.';
export const TIMED_OUT = 'Anthropic did not answer in time. Try again.';

/**
 * Whether "Draft all blank" should stop after this failure, because the next item would fail the same way.
 * `timeoutsInARow` includes this failure. The 502 has no error code, so this matches the API's exact texts.
 */
export function stopDrafting(reason: unknown, timeoutsInARow: number): boolean {
  if (!(reason instanceof ApiError)) return true;
  if (reason.status === 502) {
    if (reason.message === KEPT_LEAKING) return false;
    if (reason.message === TIMED_OUT) return timeoutsInARow >= 2;
    return true; // rate limit, overloaded, key, model, workspace, or raw provider text
  }
  if (reason.status === 404) return reason.message !== 'That item does not exist.';
  if (reason.status === 400) return !/ has no scores in .+ yet\.$/.test(reason.message);
  return true; // 0 (network), 401, 403, 409, 503
}

/** Drafts are slow by nature (the API answers within about 200 s), so they never show the wake notice. */
export function requestDraft(roundId: string, id: string): Promise<{ text: string }> {
  return api<{ text: string }>('POST', `/admin/rounds/${roundId}/draft/${id}`, undefined, { wakeNotice: false });
}

/** What drafting needs from the Review tab. */
export interface DraftPage {
  request: (id: string) => Promise<{ text: string }>;
  busy: (id: string | undefined) => void;
  /** The item's failure, or undefined to clear it. */
  failed: (id: string, reason: unknown) => void;
  edit: (change: (edits: Edits) => Edits) => void;
}

/** One draft into one box. Resolves to the failure, or undefined once the text is in the box. */
export async function draftItem(page: DraftPage, id: string, onlyIfBlank: boolean): Promise<unknown> {
  page.busy(id);
  page.failed(id, undefined);
  try {
    const { text } = await page.request(id);
    page.edit((edits) => withDraft(edits, id, text, onlyIfBlank));
    return undefined;
  } catch (reason) {
    page.failed(id, reason);
    return reason;
  } finally {
    page.busy(undefined);
  }
}

/**
 * "Draft all blank": one item at a time, filling only boxes still blank (the admin may type in one meanwhile), until
 * the queue is done, `cancelled()` (Stop, or the panel went away), or a failure every later item would share.
 */
export async function draftBlanks(
  page: DraftPage,
  queue: readonly string[],
  cancelled: () => boolean,
  progress: (done: number, total: number) => void,
): Promise<void> {
  progress(0, queue.length);
  let timeouts = 0;
  for (const [index, id] of queue.entries()) {
    if (cancelled()) break;
    const failure = await draftItem(page, id, true);
    progress(index + 1, queue.length);
    timeouts = failure instanceof ApiError && failure.message === TIMED_OUT ? timeouts + 1 : 0;
    if (failure !== undefined && stopDrafting(failure, timeouts)) break;
  }
}
