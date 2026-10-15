import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '../domain/api-types';
import { ApiError, api, onSignedOut, onSlow, SLOW_MS } from '../lib/api';
import { runLogout, type LogoutState } from './logout';
import { createSessionActions, EXPIRED, sessionAfterError, sessionAfterSignedOut, type Session } from './useSession';

const user: SessionUser = { id: 1, login: 'ann', displayName: 'Ann', role: 'rater' };
const WAKING = 'The ratings database is not responding. Try again in a minute.';

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

/** The hook's actions and 401 listener, wired to a plain variable instead of React state. */
function harness(initial: Session) {
  let session = initial;
  const actions = createSessionActions((next) => {
    session = typeof next === 'function' ? next(session) : next;
  });
  const stop = onSignedOut(actions.signedOut);
  return { actions, current: () => session, stop };
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('sessionAfterError', () => {
  it('shows the login form without a notice when nobody is logged in', () => {
    expect(sessionAfterError(new ApiError(401, 'Log in to continue.'))).toEqual({ status: 'signed-out', notice: '' });
  });

  it('reports any other failure as the server being unavailable, in its own words', () => {
    expect(sessionAfterError(new ApiError(503, WAKING))).toEqual({ status: 'unavailable', message: WAKING });
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

describe('session actions', () => {
  it('checks /me: logged in, nobody logged in, or the server unavailable', async () => {
    const answers = [reply(200, user), reply(401, { error: 'Log in to continue.' }), reply(503, { error: WAKING })];
    vi.stubGlobal('fetch', vi.fn(async () => answers.shift()));
    const session = harness({ status: 'loading' });
    await session.actions.check();
    expect(session.current()).toEqual({ status: 'signed-in', user });
    await session.actions.check();
    expect(session.current()).toEqual({ status: 'signed-out', notice: '' });
    await session.actions.check();
    session.stop();
    expect(session.current()).toEqual({ status: 'unavailable', message: WAKING });
  });

  it('logs in, and leaves the form as it was when the password is wrong', async () => {
    const answers = [reply(401, { error: 'Wrong login or password.' }), reply(200, user)];
    vi.stubGlobal('fetch', vi.fn(async () => answers.shift()));
    const session = harness({ status: 'signed-out', notice: EXPIRED });
    await expect(session.actions.login('ann', 'not-it')).rejects.toMatchObject({ message: 'Wrong login or password.' });
    expect(session.current()).toEqual({ status: 'signed-out', notice: EXPIRED });
    await session.actions.login('ann', 'the-right-one');
    session.stop();
    expect(session.current()).toEqual({ status: 'signed-in', user });
  });

  it('logs out only once the server has ended the session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(204)));
    const session = harness({ status: 'signed-in', user });
    await session.actions.logout();
    session.stop();
    expect(session.current()).toEqual({ status: 'signed-out', notice: '' });
  });

  it('logs out when the server answered an error but had already cleared the cookie', async () => {
    const answers = [reply(503, { error: WAKING }), reply(204)];
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => answers.shift());
    vi.stubGlobal('fetch', fetchMock);
    const session = harness({ status: 'signed-in', user });
    await session.actions.logout();
    session.stop();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/auth/logout');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', signal: expect.any(AbortSignal) });
    expect(session.current()).toEqual({ status: 'signed-out', notice: '' });
  });

  it('logs out without a note when only the second try got an answer', async () => {
    const answers: (() => Response)[] = [
      () => {
        throw new TypeError('Failed to fetch');
      },
      () => reply(204),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => answers.shift()?.()));
    const session = harness({ status: 'signed-in', user });
    await session.actions.logout();
    session.stop();
    expect(session.current()).toEqual({ status: 'signed-out', notice: '' });
  });

  it('stays logged in, with the first reason, when the second try fails too', async () => {
    const offline = () => {
      throw new TypeError('Failed to fetch');
    };
    const answers: (() => Response)[] = [
      () => reply(503, { error: WAKING }),
      offline,
      offline,
      () => reply(503, { error: WAKING }),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => answers.shift()?.()));
    const session = harness({ status: 'signed-in', user });
    await expect(session.actions.logout()).rejects.toMatchObject({ status: 503, message: WAKING });
    await expect(session.actions.logout()).rejects.toMatchObject({ status: 0 });
    session.stop();
    expect(session.current()).toEqual({ status: 'signed-in', user });
  });

  it('does not show the wake notice again for the second try', async () => {
    vi.useFakeTimers();
    let answerRetry: (response: Response) => void = () => {};
    const answers = [
      () => Promise.resolve(reply(503, { error: WAKING })),
      () => new Promise<Response>((resolve) => (answerRetry = resolve)),
    ];
    vi.stubGlobal('fetch', vi.fn(() => answers.shift()?.()));
    const slow: boolean[] = [];
    const stopSlow = onSlow((state) => slow.push(state));
    const session = harness({ status: 'signed-in', user });
    const pending = session.actions.logout();
    await vi.advanceTimersByTimeAsync(SLOW_MS + 1);
    answerRetry(reply(204));
    await pending;
    stopSlow();
    session.stop();
    expect(slow).toEqual([false]);
    expect(session.current()).toMatchObject({ status: 'signed-out' });
  });

  it('still ends a session logged in from this tab when a later request answers 401', async () => {
    const answers = [reply(200, user), reply(401, { error: 'Log in to continue.' })];
    vi.stubGlobal('fetch', vi.fn(async () => answers.shift()));
    const session = harness({ status: 'signed-out', notice: '' });
    await session.actions.login('ann', 'the-right-one');
    await expect(api('GET', '/rounds/open/my-scores')).rejects.toMatchObject({ status: 401 });
    session.stop();
    expect(session.current()).toEqual({ status: 'signed-out', notice: EXPIRED });
  });

  it('drops a logged-in user back to the login form when any call answers 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(401, { error: 'Log in to continue.' })));
    const session = harness({ status: 'signed-in', user });
    await expect(api('PUT', '/rounds/open/my-scores', { scores: {} })).rejects.toMatchObject({ status: 401 });
    session.stop();
    expect(session.current()).toEqual({ status: 'signed-out', notice: EXPIRED });
  });

  it('ignores a 401 for a request sent before the latest login', async () => {
    vi.useFakeTimers();
    let answerStale: (response: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url === '/api/auth/login'
          ? Promise.resolve(reply(200, user))
          : new Promise<Response>((resolve) => (answerStale = resolve)),
      ),
    );
    const session = harness({ status: 'signed-out', notice: EXPIRED });
    const stale = api('GET', '/rounds/open/my-scores').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    await session.actions.login('ann', 'the-right-one');
    answerStale(reply(401, { error: 'Log in to continue.' }));
    await stale;
    session.stop();
    expect(session.current()).toEqual({ status: 'signed-in', user });
  });

  it('stays logged in when the current password is wrong, which the server answers with 400', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(400, { error: 'Your current password is wrong.' })));
    const session = harness({ status: 'signed-in', user });
    await expect(api('PUT', '/me/password', { current: 'x', next: 'y' })).rejects.toMatchObject({
      status: 400,
      message: 'Your current password is wrong.',
    });
    session.stop();
    expect(session.current()).toEqual({ status: 'signed-in', user });
  });
});

describe('runLogout', () => {
  it('shows progress, then hands over to the signed-out page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(204)));
    const session = harness({ status: 'signed-in', user });
    const states: LogoutState[] = [];
    await runLogout(session.actions.logout, (state) => states.push(state));
    session.stop();
    expect(states).toEqual([{ kind: 'leaving' }, { kind: 'idle' }]);
    expect(session.current()).toEqual({ status: 'signed-out', notice: '' });
  });

  it('shows the failure and that the user is still logged in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(503, { error: WAKING })));
    const session = harness({ status: 'signed-in', user });
    const states: LogoutState[] = [];
    await runLogout(session.actions.logout, (state) => states.push(state));
    session.stop();
    expect(states).toEqual([{ kind: 'leaving' }, { kind: 'failed', message: `${WAKING} You are still logged in.` }]);
    expect(session.current()).toEqual({ status: 'signed-in', user });
  });

  it('shows the first reason, not the timeout, when the second try runs out of time', async () => {
    const timedOut = AbortSignal.abort(new DOMException('signal timed out', 'TimeoutError'));
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timedOut);
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.signal?.aborted) throw init.signal.reason;
      return reply(503, { error: WAKING });
    });
    vi.stubGlobal('fetch', fetchMock);
    const session = harness({ status: 'signed-in', user });
    const states: LogoutState[] = [];
    await runLogout(session.actions.logout, (state) => states.push(state));
    session.stop();
    expect(timeout).toHaveBeenCalledWith(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toEqual({ kind: 'failed', message: `${WAKING} You are still logged in.` });
    expect(session.current()).toEqual({ status: 'signed-in', user });
  });

  it('says plainly that the server could not be reached and the user is still logged in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const session = harness({ status: 'signed-in', user });
    const states: LogoutState[] = [];
    await runLogout(session.actions.logout, (state) => states.push(state));
    session.stop();
    const message =
      'Could not reach the ratings server. You are still logged in. Check your connection, then log out again.';
    expect(states.at(-1)).toEqual({ kind: 'failed', message });
    expect(session.current()).toEqual({ status: 'signed-in', user });
  });
});
