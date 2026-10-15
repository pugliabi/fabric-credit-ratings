import type { ApiErrorBody } from '../domain/api-types';

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface ApiOptions {
  /** False for calls that are slow by nature (AI drafting, the deploy trigger), so they never show the wake notice. */
  wakeNotice?: boolean;
  /**
   * Aborting rejects with the signal's reason, never an ApiError: an AbortError for abort(), a TimeoutError for
   * AbortSignal.timeout().
   */
  signal?: AbortSignal;
}

/** After this long without an answer, pages show the "waking the database" notice. */
export const SLOW_MS = 4000;

const OFFLINE = 'Could not reach the ratings server. Check your connection, then try again.';
const UNREADABLE = 'The ratings server sent an answer this page could not read. Try again.';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const signedOutListeners = new Set<(startedAt: number) => void>();
const slowListeners = new Set<(slow: boolean) => void>();
let slowCount = 0;

/** Empty in development, where Vite proxies /api to the local Functions host. Read per call so tests can stub it. */
function base(): string {
  return String(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
}

/**
 * Runs `listener(startedAt)` whenever the server answers 401, except to a login attempt. `startedAt` is the
 * `performance.now()` at which that request was sent. Returns an unsubscribe function.
 */
export function onSignedOut(listener: (startedAt: number) => void): () => void {
  signedOutListeners.add(listener);
  return () => {
    signedOutListeners.delete(listener);
  };
}

/** Runs `listener` with the current state at once, then `true` while any request is slow and `false` once none are. */
export function onSlow(listener: (slow: boolean) => void): () => void {
  slowListeners.add(listener);
  listener(slowCount > 0);
  return () => {
    slowListeners.delete(listener);
  };
}

function changeSlow(delta: number): void {
  slowCount += delta;
  for (const listener of slowListeners) listener(slowCount > 0);
}

export function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Calls `/api{path}` with the session cookie. Throws ApiError carrying the server's message. */
export async function api<T>(method: Method, path: string, body?: unknown, options: ApiOptions = {}): Promise<T> {
  const startedAt = performance.now();
  let slow = false;
  const timer =
    options.wakeNotice === false
      ? undefined
      : setTimeout(() => {
          slow = true;
          changeSlow(1);
        }, SLOW_MS);
  try {
    let response: Response;
    let raw: string;
    try {
      response = await fetch(`${base()}/api${path}`, {
        method,
        credentials: 'include',
        ...(method === 'GET'
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      raw = await response.text();
    } catch (reason) {
      if (options.signal?.aborted) throw reason;
      throw new ApiError(0, OFFLINE);
    }
    let data: unknown;
    try {
      data = raw ? JSON.parse(raw) : undefined;
    } catch {
      if (response.ok) throw new ApiError(response.status, UNREADABLE);
    }
    if (response.ok) return data as T;
    if (response.status === 401 && path !== '/auth/login') {
      for (const listener of signedOutListeners) listener(startedAt);
    }
    const error = (data as Partial<ApiErrorBody> | null | undefined)?.error;
    throw new ApiError(
      response.status,
      typeof error === 'string' && error ? error : `The ratings server answered ${response.status}. Try again.`,
    );
  } finally {
    clearTimeout(timer);
    if (slow) changeSlow(-1);
  }
}
