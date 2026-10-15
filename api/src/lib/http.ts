import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import {
  app,
  type Cookie,
  type HttpMethod,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import type { SessionUser } from '../../../src/domain/api-types.ts';
import { loadConfig, type Config } from './config.ts';
import { resolveSession } from './current-user.ts';
import { DatabaseUnavailableError, isConnectionError } from './db.ts';
import { HttpError } from './errors.ts';

export type Access = 'public' | 'build' | 'user' | 'admin';
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface Ctx {
  request: HttpRequest;
  params: Record<string, string>;
  body: Record<string, unknown>;
  config: Config;
  ip: string;
  /** Cookies to set on the response. */
  cookies: Cookie[];
  log: InvocationContext;
}

export interface UserCtx extends Ctx {
  user: SessionUser;
}

type Handler<C> = (ctx: C) => Promise<unknown>;

const preflightPaths = new Set<string>();

export function corsHeaders(origin: string | null, allowed: readonly string[]): Record<string, string> {
  const base = { 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (!origin || !allowed.includes(origin)) return base;
  return { ...base, 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' };
}

/**
 * The caller's address for the per-IP lockout key. Takes the last X-Forwarded-For entry, the one the Azure front end
 * appends; earlier entries are whatever the client sent. Anything that isn't a bare IP address of at most 45
 * characters becomes 'unknown', so the key stays short and can't be made up. Which hop to trust must be confirmed on
 * the deployed Function App (Plan 3).
 */
export function clientIp(forwardedFor: string | null): string {
  const last = forwardedFor?.split(',').at(-1)?.trim() ?? '';
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(last);
  const parts = last.split(':');
  const candidate = bracketed?.[1] ?? (parts.length === 2 ? (parts[0] ?? '') : last);
  return candidate.length <= 45 && isIP(candidate) !== 0 ? candidate : 'unknown';
}

function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return expected !== '' && timingSafeEqual(digest(given), digest(expected));
}

/**
 * Cross-site form posts can't send JSON, and other sites' Origin headers are refused. Build calls skip the Origin
 * check: GitHub Actions sends none, and their bearer token is never attached by a browser, so CSRF can't use it.
 */
function checkMutation(request: HttpRequest, config: Config, access: Access): void {
  const origin = request.headers.get('origin');
  if (access !== 'build' && (!origin || !config.allowedOrigins.includes(origin))) {
    throw new HttpError(403, 'This request came from a page that is not allowed to change ratings.');
  }
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Send the request as JSON.');
}

async function readBody(request: HttpRequest): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // Falls through to the 400 below.
  }
  throw new HttpError(400, 'The request body must be a JSON object.');
}

function describe(error: unknown, log: InvocationContext): [number, string] {
  if (error instanceof HttpError) return [error.status, error.message];
  if (error instanceof DatabaseUnavailableError || isConnectionError(error)) {
    log.warn('Database unavailable', error);
    return [503, 'The ratings database is not responding. Try again in a minute.'];
  }
  log.error('Unhandled error', error);
  return [500, 'Something went wrong on the server. Try again.'];
}

async function handle(
  request: HttpRequest,
  log: InvocationContext,
  method: Method,
  access: Access,
  handler: Handler<UserCtx>,
): Promise<HttpResponseInit> {
  const config = loadConfig();
  const headers = corsHeaders(request.headers.get('origin'), config.allowedOrigins);
  if (request.method === 'OPTIONS') {
    return {
      status: 204,
      headers: {
        ...headers,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      },
    };
  }
  const cookies: Cookie[] = [];
  try {
    if (method !== 'GET') checkMutation(request, config, access);
    if (access === 'build') {
      const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      if (!sameSecret(given, config.snapshotToken)) throw new HttpError(401, 'A valid build token is required.');
    }
    const ctx: Ctx = {
      request,
      params: request.params,
      body: method === 'GET' ? {} : await readBody(request),
      config,
      ip: clientIp(request.headers.get('x-forwarded-for')),
      cookies,
      log,
    };
    let user: SessionUser | undefined;
    if (access === 'user' || access === 'admin') {
      user = await resolveSession(request.headers.get('cookie'), config, cookies);
      if (!user) throw new HttpError(401, 'Log in to continue.');
      if (access === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Only admins can do that.');
    }
    const result = await handler({ ...ctx, user } as UserCtx);
    if (result === undefined) return { status: 204, headers, cookies };
    return { status: 200, headers, cookies, jsonBody: result };
  } catch (error) {
    const [status, message] = describe(error, log);
    return { status, headers, cookies, jsonBody: { error: message } };
  }
}

/** Registers one endpoint. The first route on a path also answers its CORS preflight. */
export function route(
  name: string,
  method: Method,
  path: string,
  access: 'public' | 'build',
  handler: Handler<Ctx>,
): void;
export function route(
  name: string,
  method: Method,
  path: string,
  access: 'user' | 'admin',
  handler: Handler<UserCtx>,
): void;
export function route(name: string, method: Method, path: string, access: Access, handler: Handler<UserCtx>): void {
  const methods: HttpMethod[] = [method];
  if (!preflightPaths.has(path)) {
    preflightPaths.add(path);
    methods.push('OPTIONS');
  }
  app.http(name, {
    methods,
    authLevel: 'anonymous',
    route: path,
    handler: (request, log) => handle(request, log, method, access, handler),
  });
}
