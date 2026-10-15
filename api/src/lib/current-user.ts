import type { Cookie } from '@azure/functions';
import type { SessionUser } from '../../../src/domain/api-types.ts';
import { findSession, renewSession } from '../repo/sessions.ts';
import type { Config } from './config.ts';
import { db } from './db.ts';
import { cookieName, expiryFrom, hashToken, needsRenewal, readCookie, sessionCookie } from './session.ts';

export function sessionToken(cookieHeader: string | null, config: Config): string | undefined {
  return readCookie(cookieHeader, cookieName(config.cookieSecure));
}

/** Looks up the caller and slides the session forward; a renewed cookie is pushed onto `cookies`. */
export async function resolveSession(
  cookieHeader: string | null,
  config: Config,
  cookies: Cookie[],
): Promise<SessionUser | undefined> {
  const token = sessionToken(cookieHeader, config);
  if (!token) return undefined;
  const tokenHash = hashToken(token);
  const found = await findSession(db, tokenHash);
  if (!found) return undefined;
  const now = new Date();
  if (needsRenewal(found.expiresAt, now)) {
    await renewSession(db, tokenHash, expiryFrom(now));
    cookies.push(sessionCookie(config.cookieSecure, token));
  }
  return found.user;
}
