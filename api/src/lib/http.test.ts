import { HttpRequest, InvocationContext, type HttpFunctionOptions, type HttpResponseInit } from '@azure/functions';
import sql from 'mssql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientIp, corsHeaders, route } from './http.ts';

const registered = vi.hoisted(() => new Map<string, HttpFunctionOptions>());

vi.mock(import('@azure/functions'), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    app: {
      ...original.app,
      http: (name: string, options: HttpFunctionOptions) => {
        registered.set(name, options);
      },
    },
  };
});

describe('corsHeaders', () => {
  it('echoes allowed origins with credentials', () => {
    expect(corsHeaders('https://fabriccreditratings.com', ['https://fabriccreditratings.com'])).toMatchObject({
      'Access-Control-Allow-Origin': 'https://fabriccreditratings.com',
      'Access-Control-Allow-Credentials': 'true',
    });
  });

  it('sends no allow-origin for other sites', () => {
    expect(corsHeaders('https://evil.example', ['https://fabriccreditratings.com'])).not.toHaveProperty(
      'Access-Control-Allow-Origin',
    );
  });
});

describe('clientIp', () => {
  it('takes the last forwarded address without its port', () => {
    expect(clientIp('198.51.100.9, 203.0.113.7:51234')).toBe('203.0.113.7');
    expect(clientIp('203.0.113.7')).toBe('203.0.113.7');
    expect(clientIp('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(clientIp('2001:db8::1')).toBe('2001:db8::1');
    expect(clientIp('198.51.100.9, [2001:db8::1]:443')).toBe('2001:db8::1');
  });

  it('returns unknown for anything that is not an IP address', () => {
    expect(clientIp(null)).toBe('unknown');
    expect(clientIp('')).toBe('unknown');
    expect(clientIp('203.0.113.7, ')).toBe('unknown');
    expect(clientIp('not-an-ip')).toBe('unknown');
    expect(clientIp('a'.repeat(150))).toBe('unknown');
    expect(clientIp('203.0.113.7, not-an-ip')).toBe('unknown');
  });
});

describe('route registration', () => {
  it('registers under api/, with the preflight on the first route of each path', () => {
    const handler = vi.fn(async () => undefined);
    route('testAdminRounds', 'GET', 'admin/rounds', 'admin', handler);
    route('testAdminRoundCreate', 'POST', 'admin/rounds', 'admin', handler);
    expect(registered.get('testAdminRounds')).toMatchObject({ route: 'api/admin/rounds', methods: ['GET', 'OPTIONS'] });
    expect(registered.get('testAdminRoundCreate')).toMatchObject({ route: 'api/admin/rounds', methods: ['POST'] });
  });
});

describe('mutation checks', () => {
  const handler = vi.fn(async () => undefined);
  route('testBuildPost', 'POST', 'test/build', 'build', handler);
  route('testUserPost', 'POST', 'test/user', 'user', handler);
  route('testPublicPost', 'POST', 'test/public', 'public', handler);

  async function post(name: string, headers: Record<string, string>): Promise<HttpResponseInit> {
    const options = registered.get(name);
    if (!options) throw new Error(`${name} was not registered.`);
    const url = 'http://localhost/api/test';
    const request = new HttpRequest({ method: 'POST', url, headers, body: { string: '{}' } });
    return (await options.handler(request, new InvocationContext())) as HttpResponseInit;
  }

  const json = { 'content-type': 'application/json' };
  const token = { authorization: 'Bearer build-secret' };

  beforeEach(() => {
    handler.mockClear();
    vi.stubEnv('SNAPSHOT_TOKEN', 'build-secret');
    vi.stubEnv('ALLOWED_ORIGINS', 'https://fabriccreditratings.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lets a build POST with a valid token through without an Origin, since GitHub Actions sends none', async () => {
    expect((await post('testBuildPost', { ...json, ...token })).status).toBe(204);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('still requires JSON and the token on a build POST', async () => {
    expect((await post('testBuildPost', { ...token, 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post('testBuildPost', json)).status).toBe(401);
    expect((await post('testBuildPost', { ...json, authorization: 'Bearer wrong' })).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses user and public POSTs without an allowed Origin', async () => {
    for (const name of ['testUserPost', 'testPublicPost']) {
      expect((await post(name, json)).status).toBe(403);
      expect((await post(name, { ...json, ...token })).status).toBe(403);
      expect((await post(name, { ...json, origin: 'https://evil.example' })).status).toBe(403);
    }
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('error responses', () => {
  let thrown: unknown;
  route('testThrows', 'GET', 'test/throws', 'public', async () => {
    throw thrown;
  });

  /** What mssql rejects with when the server refuses a statement. */
  function sqlError(number: number): sql.RequestError {
    return new sql.RequestError(Object.assign(new Error(`SQL Server error ${number}`), { info: { number } }));
  }

  async function get(): Promise<HttpResponseInit> {
    const options = registered.get('testThrows');
    if (!options) throw new Error('testThrows was not registered.');
    const request = new HttpRequest({ method: 'GET', url: 'http://localhost/api/test/throws' });
    const log = new InvocationContext({ logHandler: () => undefined });
    return (await options.handler(request, log)) as HttpResponseInit;
  }

  it('answers a duplicate key from a concurrent change with 409', async () => {
    for (const number of [2601, 2627]) {
      thrown = sqlError(number);
      expect(await get()).toMatchObject({
        status: 409,
        jsonBody: { error: 'That conflicts with a change someone just made. Reload the page and try again.' },
      });
    }
  });

  it('answers a deadlock that outlasted its retries with 503', async () => {
    thrown = sqlError(1205);
    expect(await get()).toMatchObject({
      status: 503,
      jsonBody: { error: 'The ratings database is not responding. Try again in a minute.' },
    });
  });

  it('answers any other SQL error with 500', async () => {
    thrown = sqlError(547);
    expect(await get()).toMatchObject({
      status: 500,
      jsonBody: { error: 'Something went wrong on the server. Try again.' },
    });
  });
});
