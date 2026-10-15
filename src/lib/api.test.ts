import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, onSignedOut, onSlow, SLOW_MS } from './api';

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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

  it('sends GET bare and a body-less POST as an empty JSON object', async () => {
    const fetchMock = vi.fn(async () => reply(204));
    vi.stubGlobal('fetch', fetchMock);
    await api('GET', '/me');
    await api('POST', '/auth/logout');
    expect(fetchMock.mock.calls[0]).toStrictEqual(['/api/me', { method: 'GET', credentials: 'include' }]);
    expect(fetchMock.mock.calls[1]).toStrictEqual([
      '/api/auth/logout',
      { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    ]);
  });

  it('joins a configured base URL without a double slash', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com/');
    const fetchMock = vi.fn(async () => reply(204));
    vi.stubGlobal('fetch', fetchMock);
    await api('GET', '/me');
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/api/me', expect.anything());
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

  it('falls back to the status when the error body is not JSON, without signalling sign-out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })));
    const listener = vi.fn();
    const stop = onSignedOut(listener);
    await expect(api('GET', '/catalog')).rejects.toMatchObject({
      status: 502,
      message: 'The ratings server answered 502. Try again.',
    });
    stop();
    expect(listener).not.toHaveBeenCalled();
  });

  it('falls back to the status when the error field is not a string', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(500, { error: { code: 'boom' } })));
    await expect(api('GET', '/catalog')).rejects.toMatchObject({
      status: 500,
      message: 'The ratings server answered 500. Try again.',
    });
  });

  it('refuses a successful answer it cannot read instead of returning nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Sign in to the Wi-Fi</html>', { status: 200 })));
    await expect(api('GET', '/me')).rejects.toMatchObject({
      name: 'ApiError',
      status: 200,
      message: 'The ratings server sent an answer this page could not read. Try again.',
    });
  });

  it('treats a connection dropped mid-answer like a network failure', async () => {
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new TypeError('network error'));
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(broken, { status: 200 })));
    await expect(api('GET', '/me')).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      message: 'Could not reach the ratings server. Check your connection, then try again.',
    });
  });

  it('tells listeners when the session is gone, with when the request was sent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(401, { error: 'Log in to continue.' })));
    const listener = vi.fn();
    const stop = onSignedOut(listener);
    const before = performance.now();
    await expect(api('GET', '/me')).rejects.toMatchObject({ status: 401 });
    stop();
    expect(listener).toHaveBeenCalledOnce();
    const [startedAt] = listener.mock.calls[0] as [number];
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(startedAt).toBeLessThanOrEqual(performance.now());
  });

  it('does not call a wrong password a lost session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(401, { error: 'Wrong login or password.' })));
    const listener = vi.fn();
    const stop = onSignedOut(listener);
    await expect(api('POST', '/auth/login', { login: 'ann', password: 'not-it' })).rejects.toMatchObject({
      status: 401,
      message: 'Wrong login or password.',
    });
    stop();
    expect(listener).not.toHaveBeenCalled();
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

  it('passes an abort signal to fetch and lets the abort through as itself', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const states: boolean[] = [];
    const stop = onSlow((slow) => states.push(slow));
    const controller = new AbortController();
    const pending = api('GET', '/admin/rounds/7/review', undefined, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(SLOW_MS);
    controller.abort();
    const reason = await pending.catch((error: unknown) => error);
    stop();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal });
    expect(reason).not.toBeInstanceOf(ApiError);
    expect(reason).toMatchObject({ name: 'AbortError' });
    expect(states).toEqual([false, true, false]);
  });

  it('still reports a network failure as status 0 when the call carries a signal that was not aborted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(api('GET', '/me', undefined, { signal: new AbortController().signal })).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
    });
  });
});

describe('slow requests', () => {
  it('reports the current state as soon as a listener subscribes', async () => {
    vi.useFakeTimers();
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (finish = resolve))));
    const idle: boolean[] = [];
    onSlow((slow) => idle.push(slow))();
    expect(idle).toEqual([false]);
    const pending = api('GET', '/me');
    await vi.advanceTimersByTimeAsync(SLOW_MS);
    const late: boolean[] = [];
    const stop = onSlow((slow) => late.push(slow));
    expect(late).toEqual([true]);
    finish(reply(200, {}));
    await pending;
    stop();
    expect(late).toEqual([true, false]);
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
    expect(states).toEqual([false, true, false]);
  });

  it('never flags a request that answers within SLOW_MS', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, {})));
    const states: boolean[] = [];
    const stop = onSlow((slow) => states.push(slow));
    await api('GET', '/catalog');
    await vi.advanceTimersByTimeAsync(SLOW_MS * 2);
    stop();
    expect(states).toEqual([false]);
  });

  it('leaves out requests that opt out of the wake notice', async () => {
    vi.useFakeTimers();
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (finish = resolve))));
    const states: boolean[] = [];
    const stop = onSlow((slow) => states.push(slow));
    const pending = api('POST', '/admin/rounds/7/draft/notebook', undefined, { wakeNotice: false });
    await vi.advanceTimersByTimeAsync(SLOW_MS * 3);
    finish(reply(200, { why: 'Fast and cheap.' }));
    await expect(pending).resolves.toEqual({ why: 'Fast and cheap.' });
    stop();
    expect(states).toEqual([false]);
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
    expect(states.slice(1)).not.toContain(false);
    finishers[1]?.(reply(200, {}));
    await second;
    stop();
    expect(states.at(-1)).toBe(false);
    expect(states.slice(1).indexOf(false)).toBe(states.length - 2);
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
    expect(states).toEqual([false, true, false, true, false]);
  });
});
