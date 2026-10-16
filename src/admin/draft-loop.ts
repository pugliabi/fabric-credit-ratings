import { ApiError } from '../lib/api';

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
