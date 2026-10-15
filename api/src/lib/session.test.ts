import { describe, expect, it } from 'vitest';
import {
  clearedCookie,
  cookieName,
  expiryFrom,
  hashToken,
  needsRenewal,
  newToken,
  readCookie,
  sessionCookie,
} from './session.ts';

const DAY = 86_400_000;

describe('session tokens', () => {
  it('creates long random tokens', () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
  });

  it('stores only a sha256 hex hash', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('session expiry', () => {
  const now = new Date('2026-10-15T12:00:00Z');

  it('lasts 30 days', () => {
    expect(expiryFrom(now).getTime() - now.getTime()).toBe(30 * DAY);
  });

  it('renews once fewer than 29 days remain', () => {
    expect(needsRenewal(new Date(now.getTime() + 29.5 * DAY), now)).toBe(false);
    expect(needsRenewal(new Date(now.getTime() + 28.9 * DAY), now)).toBe(true);
  });
});

describe('session cookie', () => {
  it('uses the __Host- prefix when secure', () => {
    expect(sessionCookie(true, 't')).toMatchObject({
      name: '__Host-fcr_session',
      value: 't',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 30 * 86_400,
    });
  });

  it('drops the prefix for local http', () => {
    expect(cookieName(false)).toBe('fcr_session');
  });

  it('clears with an empty value and max age 0', () => {
    expect(clearedCookie(true)).toMatchObject({ value: '', maxAge: 0 });
  });

  it('reads one cookie out of a header', () => {
    expect(readCookie('a=1; fcr_session=tok%2Den; b=2', 'fcr_session')).toBe('tok-en');
    expect(readCookie('a=1', 'fcr_session')).toBeUndefined();
    expect(readCookie(null, 'fcr_session')).toBeUndefined();
  });
});
