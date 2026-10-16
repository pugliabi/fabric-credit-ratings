import { createHash, randomBytes } from 'node:crypto';
import type { Cookie } from '@azure/functions';

export const SESSION_DAYS = 30;
const RENEW_BELOW_DAYS = 29;
const DAY_MS = 86_400_000;

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + SESSION_DAYS * DAY_MS);
}

/** Sliding expiry, written at most about once a day per session. */
export function needsRenewal(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() - now.getTime() < RENEW_BELOW_DAYS * DAY_MS;
}

/** __Host- needs Secure, so local http uses a plain name. */
export function cookieName(secure: boolean): string {
  return secure ? '__Host-fcr_session' : 'fcr_session';
}

export function sessionCookie(secure: boolean, token: string): Cookie {
  return {
    name: cookieName(secure),
    value: token,
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  };
}

export function clearedCookie(secure: boolean): Cookie {
  return { ...sessionCookie(secure, ''), maxAge: 0 };
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const split = part.indexOf('=');
    if (split === -1 || part.slice(0, split).trim() !== name) continue;
    const value = part.slice(split + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}
