import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '../domain/api-types';
import { api, ApiError, errorMessage, onSignedOut } from '../lib/api';

export type Session =
  | { status: 'loading' }
  | { status: 'signed-out'; notice: string }
  | { status: 'signed-in'; user: SessionUser }
  | { status: 'unavailable'; message: string };

export const EXPIRED = 'Your session ended. Log in again; unsaved scores are still in this browser.';

/** A failed /me: 401 means nobody is logged in; anything else means the server can't be used right now. */
export function sessionAfterError(reason: unknown): Session {
  return reason instanceof ApiError && reason.status === 401
    ? { status: 'signed-out', notice: '' }
    : { status: 'unavailable', message: errorMessage(reason) };
}

/** A wrong password on the login form is also a 401, so only a live session counts as ended. */
export function sessionAfterSignedOut(current: Session): Session {
  return current.status === 'signed-in' ? { status: 'signed-out', notice: EXPIRED } : current;
}

/** Who is logged in. Any 401 from any API call drops back to the login form. */
export function useSession() {
  const [session, setSession] = useState<Session>({ status: 'loading' });

  const check = useCallback(async () => {
    setSession({ status: 'loading' });
    try {
      setSession({ status: 'signed-in', user: await api<SessionUser>('GET', '/me') });
    } catch (reason) {
      setSession(sessionAfterError(reason));
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => onSignedOut(() => setSession(sessionAfterSignedOut)), []);

  const login = useCallback(async (loginName: string, password: string) => {
    const user = await api<SessionUser>('POST', '/auth/login', { login: loginName, password });
    setSession({ status: 'signed-in', user });
  }, []);

  const logout = useCallback(async () => {
    await api('POST', '/auth/logout').catch(() => undefined);
    setSession({ status: 'signed-out', notice: '' });
  }, []);

  return { session, login, logout, retry: check };
}
