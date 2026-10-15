import { ApiError, errorMessage } from '../lib/api';

export type LogoutState = { kind: 'idle' | 'leaving' } | { kind: 'failed'; message: string };

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
