import { useEffect, useState } from 'react';
import type { SessionUser } from '../domain/api-types';
import { api, ApiError, errorMessage, onSignedOut } from '../lib/api';

export type Session =
  | { status: 'loading' }
  | { status: 'signed-out'; notice: string }
  | { status: 'signed-in'; user: SessionUser }
  | { status: 'unavailable'; message: string };

type SetSession = (next: Session | ((current: Session) => Session)) => void;

export const EXPIRED = 'Your session ended. Log in again; unsaved scores are still in this browser.';
export const LEFTOVER_SESSION = 'You are logged out. The ratings server will remove the old session on its own.';

/** The second logout needs no database once the cookie is gone, so it answers fast or not at all. */
const LOGOUT_RETRY_MS = 5000;

/** A failed /me: 401 means nobody is logged in; anything else means the server can't be used right now. */
export function sessionAfterError(reason: unknown): Session {
  return reason instanceof ApiError && reason.status === 401
    ? { status: 'signed-out', notice: '' }
    : { status: 'unavailable', message: errorMessage(reason) };
}

export function sessionAfterSignedOut(current: Session): Session {
  return current.status === 'signed-in' ? { status: 'signed-out', notice: EXPIRED } : current;
}

/** The hook's logic, kept apart from React so it can be tested without a DOM. */
export function createSessionActions(setSession: SetSession) {
  let loggedInAt = 0;
  return {
    check: async () => {
      setSession({ status: 'loading' });
      try {
        setSession({ status: 'signed-in', user: await api<SessionUser>('GET', '/me') });
      } catch (reason) {
        setSession(sessionAfterError(reason));
      }
    },
    login: async (loginName: string, password: string) => {
      const user = await api<SessionUser>('POST', '/auth/login', { login: loginName, password });
      loggedInAt = performance.now();
      setSession({ status: 'signed-in', user });
    },
    /**
     * Rejects, with the first failure, when this browser may still hold the session cookie. The API clears the cookie
     * before it deletes the session, so after an error answer from it the cookie is usually gone already, but a
     * gateway error or a lost answer leaves it. A second logout tells them apart: without a cookie it answers 204.
     */
    logout: async () => {
      let notice = '';
      try {
        await api('POST', '/auth/logout');
      } catch (reason) {
        const retry = { wakeNotice: false, signal: AbortSignal.timeout(LOGOUT_RETRY_MS) };
        await api('POST', '/auth/logout', undefined, retry).catch(() => Promise.reject(reason));
        if (reason instanceof ApiError && reason.status > 0) notice = LEFTOVER_SESSION;
      }
      setSession({ status: 'signed-out', notice });
    },
    /** A 401 for a request sent before the latest login says nothing about the new session. */
    signedOut: (startedAt: number) => {
      if (startedAt >= loggedInAt) setSession(sessionAfterSignedOut);
    },
  };
}

/** Who is logged in. Any 401 from any API call drops back to the login form. */
export function useSession() {
  const [session, setSession] = useState<Session>({ status: 'loading' });
  const [actions] = useState(() => createSessionActions(setSession));

  useEffect(() => {
    void actions.check();
  }, [actions]);

  useEffect(() => onSignedOut(actions.signedOut), [actions]);

  return { session, login: actions.login, logout: actions.logout, retry: actions.check };
}
