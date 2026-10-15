import type { ApiErrorBody } from '../domain/api-types';

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Empty in development, where Vite proxies /api to the local Functions host. */
const BASE = String(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/** After this long without an answer, pages show the "waking the database" notice. */
export const SLOW_MS = 4000;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const signedOutListeners = new Set<() => void>();
const slowListeners = new Set<(slow: boolean) => void>();
let slowCount = 0;

/** Runs `listener` whenever the server answers 401. Returns an unsubscribe function. */
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => {
    signedOutListeners.delete(listener);
  };
}

/** Runs `listener(true)` while any request is slow and `listener(false)` once none are. */
export function onSlow(listener: (slow: boolean) => void): () => void {
  slowListeners.add(listener);
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

async function readJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Calls `/api{path}` with the session cookie. Throws ApiError carrying the server's message. */
export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let slow = false;
  const timer = setTimeout(() => {
    slow = true;
    changeSlow(1);
  }, SLOW_MS);
  try {
    let response: Response;
    try {
      response = await fetch(`${BASE}/api${path}`, {
        method,
        credentials: 'include',
        ...(method === 'GET'
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }),
      });
    } catch {
      throw new ApiError(0, 'Could not reach the ratings server. Check your connection, then try again.');
    }
    const data = await readJson(response);
    if (response.ok) return data as T;
    if (response.status === 401) for (const listener of signedOutListeners) listener();
    const message = (data as Partial<ApiErrorBody> | undefined)?.error;
    throw new ApiError(response.status, message ?? `The ratings server answered ${response.status}. Try again.`);
  } finally {
    clearTimeout(timer);
    if (slow) changeSlow(-1);
  }
}
