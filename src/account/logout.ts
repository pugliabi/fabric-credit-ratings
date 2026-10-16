import { ApiError, errorMessage } from '../lib/api';
import { cardDraftPrefix, clearDrafts, hasUnsavedDrafts } from '../rating-ui/usePersistentDraft';

export type LogoutState = { kind: 'idle' | 'leaving' } | { kind: 'failed'; message: string };

export const UNSAVED_ON_LOGOUT = 'Log out and remove your unsaved scores from this browser?';

const OFFLINE =
  'Could not reach the ratings server. You are still logged in. Check your connection, then log out again.';

/** Drives the Log out button. A failed logout may leave the session cookie in place, so the user must be told. */
export async function runLogout(logout: () => Promise<void>, update: (state: LogoutState) => void): Promise<void> {
  update({ kind: 'leaving' });
  try {
    await logout();
    update({ kind: 'idle' });
  } catch (reason) {
    const offline = reason instanceof ApiError && reason.status === 0;
    update({ kind: 'failed', message: offline ? OFFLINE : `${errorMessage(reason)} You are still logged in.` });
  }
}

/**
 * The Log out button: on a shared computer, the user's stored cards must not outlive their session. Asks first when
 * any of them holds unsaved scores (Cancel keeps the user logged in), and removes them only once the session has ended,
 * so a failed logout keeps them. A 401 never comes here: the session-ended notice promises the draft is kept.
 */
export async function logOutClearingDrafts(
  userId: number,
  logout: () => Promise<void>,
  update: (state: LogoutState) => void,
  ask: (message: string) => boolean = (message) => confirm(message),
): Promise<void> {
  const prefix = cardDraftPrefix(userId);
  if (hasUnsavedDrafts(prefix) && !ask(UNSAVED_ON_LOGOUT)) return;
  await runLogout(async () => {
    await logout();
    clearDrafts(prefix);
  }, update);
}
