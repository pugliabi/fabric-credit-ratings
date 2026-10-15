import { errorMessage } from '../lib/api';

export type LogoutState = { kind: 'idle' | 'leaving' } | { kind: 'failed'; message: string };

/** Drives the Log out button. A failed logout leaves the session cookie in place, so the user must be told. */
export async function runLogout(logout: () => Promise<void>, update: (state: LogoutState) => void): Promise<void> {
  update({ kind: 'leaving' });
  try {
    await logout();
    update({ kind: 'idle' });
  } catch (reason) {
    update({ kind: 'failed', message: `${errorMessage(reason)} You are still logged in.` });
  }
}
