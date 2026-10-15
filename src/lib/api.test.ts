import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, onSignedOut, onSlow, SLOW_MS } from './api';

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('api', () => {
  it('sends JSON with the session cookie and returns the parsed body', async () => {
    const fetchMock = vi.fn(async () => reply(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api('PUT', '/rounds/open/my-scores', { round: '2026-Q4' })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/rounds/open/my-scores', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{"round":"2026-Q4"}',
    });
  });

  it('returns undefined for 204', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(204)));
    await expect(api('POST', '/auth/logout')).resolves.toBeUndefined();
  });

  it('throws the server message with the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(409, { error: 'No round is open for scoring right now.' })));
    await expect(api('GET', '/rounds/open/my-scores')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      message: 'No round is open for scoring right now.',
    });
  });

  it('tells listeners when the session is gone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(401, { error: 'Log in to continue.' })));
    const listener = vi.fn();
    const stop = onSignedOut(listener);
    await expect(api('GET', '/me')).rejects.toMatchObject({ status: 401 });
    stop();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('turns a network failure into a readable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(api('GET', '/me')).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('Could not reach the ratings server'),
    });
  });

  it('flags requests that take longer than SLOW_MS', async () => {
    vi.useFakeTimers();
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const states: boolean[] = [];
    const stop = onSlow((slow) => states.push(slow));
    const pending = api('GET', '/catalog');
    await vi.advanceTimersByTimeAsync(SLOW_MS);
    finish(reply(200, {}));
    await pending;
    stop();
    expect(states).toEqual([true, false]);
  });

  it('never flags a request that answers within SLOW_MS', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, {})));
    const states: boolean[] = [];
    const stop = onSlow((slow) => states.push(slow));
    await api('GET', '/catalog');
    await vi.advanceTimersByTimeAsync(SLOW_MS * 2);
    stop();
    expect(states).toEqual([]);
  });

  it('stays slow until the last slow request finishes', async () => {
    vi.useFakeTimers();
    const finishers: ((response: Response) => void)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => finishers.push(resolve))),
    );
    const states: boolean[] = [];
    const stop = onSlow((slow) => states.push(slow));
    const first = api('GET', '/me');
    await vi.advanceTimersByTimeAsync(1000);
    const second = api('GET', '/catalog');
    await vi.advanceTimersByTimeAsync(SLOW_MS);
    finishers[0]?.(reply(200, {}));
    await first;
    expect(states).not.toContain(false);
    finishers[1]?.(reply(200, {}));
    await second;
    stop();
    expect(states.at(-1)).toBe(false);
    expect(states.indexOf(false)).toBe(states.length - 1);
  });

  it('clears the slow flag when a slow request fails', async () => {
    vi.useFakeTimers();
    let answer: (response: Response) => void = () => {};
    let fail: (reason: Error) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
        .mockImplementationOnce(() => new Promise<Response>((_, reject) => (fail = reject))),
    );
    const states: boolean[] = [];
    const stop = onSlow((slow) => states.push(slow));
    const unavailable = api('GET', '/me');
    const assertUnavailable = expect(unavailable).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(SLOW_MS);
    answer(reply(503, { error: 'The ratings database is not responding. Try again in a minute.' }));
    await assertUnavailable;
    const offline = api('GET', '/me');
    const assertOffline = expect(offline).rejects.toMatchObject({ status: 0 });
    await vi.advanceTimersByTimeAsync(SLOW_MS);
    fail(new TypeError('Failed to fetch'));
    await assertOffline;
    stop();
    expect(states).toEqual([true, false, true, false]);
  });
});
