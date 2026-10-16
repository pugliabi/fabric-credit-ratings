import { hasUnsavedWork } from '../hooks/useUnsavedWork';
import { ApiError, errorMessage } from '../lib/api';
import { cardDraftPrefix, clearDrafts, hasUnsavedDrafts } from '../rating-ui/usePersistentDraft';

export type LogoutState = { kind: 'idle' | 'leaving' } | { kind: 'failed'; message: string };

export const UNSAVED_ON_LOGOUT = 'Log out and remove your unsaved scores from this browser?';
export const UNSAVED_WORK_ON_LOGOUT = 'Log out? Your unsaved whys or card edits will be lost.';
export const UNSAVED_BOTH_ON_LOGOUT =
  'Log out and remove your unsaved scores from this browser? Your unsaved whys or card edits will be lost too.';

/** Log out's one question: stored scores it would remove, work on the page it would drop, both, or nothing. */
function logoutQuestion(storedScores: boolean, pageWork: boolean): string | undefined {
  if (storedScores && pageWork) return UNSAVED_BOTH_ON_LOGOUT;
  if (storedScores) return UNSAVED_ON_LOGOUT;
  return pageWork ? UNSAVED_WORK_ON_LOGOUT : undefined;
}

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
 * The Log out button: on a shared computer, the user's stored cards must not outlive their session. Asks once first
 * when any of them holds unsaved scores, or the page holds unsaved whys or card edits (Cancel keeps the user logged
 * in), and removes the stored cards only once the session has ended, so a failed logout keeps them. A 401 never comes
 * here: the session-ended notice says what is kept. `known` is the current catalog's item ids, when the page has them:
 * a stored edit on an item deleted since is then no reason to ask, as the Score tab would have dropped it on mount.
 */
export async function logOutClearingDrafts(
  userId: number,
  logout: () => Promise<void>,
  update: (state: LogoutState) => void,
  ask: (message: string) => boolean = (message) => confirm(message),
  known?: ReadonlySet<string>,
): Promise<void> {
  const prefix = cardDraftPrefix(userId);
  const question = logoutQuestion(hasUnsavedDrafts(prefix, known), hasUnsavedWork());
  if (question && !ask(question)) return;
  await runLogout(async () => {
    await logout();
    clearDrafts(prefix);
  }, update);
}
