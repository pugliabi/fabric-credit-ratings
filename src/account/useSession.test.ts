import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '../domain/api-types';
import { api, ApiError, onSignedOut } from '../lib/api';
import { EXPIRED, sessionAfterError, sessionAfterSignedOut, type Session } from './useSession';

const user: SessionUser = { id: 1, login: 'ann', displayName: 'Ann', role: 'rater' };

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

/** Mirrors the hook's listener: every 401 runs sessionAfterSignedOut on the current state. */
function track(initial: Session) {
  let session = initial;
  const stop = onSignedOut(() => {
    session = sessionAfterSignedOut(session);
  });
  return { current: () => session, stop };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sessionAfterError', () => {
  it('shows the login form without a notice when nobody is logged in', () => {
    expect(sessionAfterError(new ApiError(401, 'Log in to continue.'))).toEqual({ status: 'signed-out', notice: '' });
  });

  it('reports any other failure as the server being unavailable, in its own words', () => {
    const waking = 'The ratings database is not responding. Try again in a minute.';
    expect(sessionAfterError(new ApiError(503, waking))).toEqual({ status: 'unavailable', message: waking });
    expect(sessionAfterError(new ApiError(0, 'Could not reach the ratings server.'))).toEqual({
      status: 'unavailable',
      message: 'Could not reach the ratings server.',
    });
  });
});

describe('sessionAfterSignedOut', () => {
  it('ends a live session with a notice that unsaved scores are kept', () => {
    expect(sessionAfterSignedOut({ status: 'signed-in', user })).toEqual({ status: 'signed-out', notice: EXPIRED });
    expect(EXPIRED).toBe('Your session ended. Log in again; unsaved scores are still in this browser.');
  });

  it('leaves every other state alone', () => {
    const states: Session[] = [
      { status: 'loading' },
      { status: 'signed-out', notice: '' },
      { status: 'unavailable', message: 'The ratings server is down.' },
    ];
    for (const state of states) expect(sessionAfterSignedOut(state)).toBe(state);
  });
});

describe('session expiry through the API client', () => {
  it('drops a logged-in user back to the login form when any call answers 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(401, { error: 'Log in to continue.' })));
    const session = track({ status: 'signed-in', user });
    await expect(api('PUT', '/rounds/open/my-scores', { scores: {} })).rejects.toMatchObject({ status: 401 });
    session.stop();
    expect(session.current()).toEqual({ status: 'signed-out', notice: EXPIRED });
  });

  it('does not call a wrong password an expired session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(401, { error: 'Wrong login or password.' })));
    const session = track({ status: 'signed-out', notice: '' });
    await expect(api('POST', '/auth/login', { login: 'ann', password: 'not-it' })).rejects.toMatchObject({
      status: 401,
      message: 'Wrong login or password.',
    });
    session.stop();
    expect(session.current()).toEqual({ status: 'signed-out', notice: '' });
  });

  it('stays logged in when the current password is wrong, which the server answers with 400', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(400, { error: 'Your current password is wrong.' })));
    const session = track({ status: 'signed-in', user });
    await expect(api('PUT', '/me/password', { current: 'x', next: 'y' })).rejects.toMatchObject({
      status: 400,
      message: 'Your current password is wrong.',
    });
    session.stop();
    expect(session.current()).toEqual({ status: 'signed-in', user });
  });
});
