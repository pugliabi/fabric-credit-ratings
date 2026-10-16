# Plan 2: Front End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rater page, a new admin page, and the public site run on the Plan 1 API. Raters log in and keep one card per open round. The admin reviews, edits any card (published ones too), writes the whys, publishes, and manages the catalog and users. The public site is built from `src/data/snapshot.json`, so items nobody rated never appear.

**Architecture:** One fetch wrapper (`src/lib/api.ts`) sends the session cookie and turns error bodies into readable messages. A session hook drives a login gate on `/rate` and `/admin`. The score matrix takes the catalog as props, so the same matrix serves a rater's own card and the admin's edits of anyone's card. The public site reads a snapshot JSON file baked in at build time; the deploy workflow refreshes it from the API.

**Tech Stack:** React 19, Vite 8 (Rolldown multi-page build), CSS modules, Vitest, the Plan 1 API on `http://localhost:7071` against `fcr-dev`.

**Spec:** `docs/superpowers/specs/2026-10-15-login-fabric-backend-design.md`

**Series:** Plan 2 of 3. Plan 1 built the API and database. Plan 3 sets up Azure, cuts over, and removes the repo round files.

**Branch:** `login-backend` (created in Plan 1). Nothing merges to `main` until Plan 3's cutover, because every push to `main` deploys the live site.

## Global Constraints

- Never print or commit secrets: `.env`, `api/local.settings.json`, passwords, tokens, keys.
- Front-end code reaches the API only through `src/lib/api.ts`.
- Front-end code must not import `src/domain/aggregate.ts` or `src/domain/formula.ts`. Grades come from the API (admin) or the snapshot (public site). `src/data/index.ts` still imports `aggregate.ts` until Task 10 removes it.
- Messages shown to users are full sentences that say what to do next.
- Formatting matches the repo: 2 spaces, single quotes, semicolons, trailing commas, lines up to 120 characters.
- Before every commit: `npm run typecheck` and `npm test` pass.
- Browser checks need two terminals: `npm run api` (Functions host on 7071, uses your `az login`) and `npm run dev` (Vite on 5173, proxies `/api`). Use `http://localhost:5173/rate.html` and `http://localhost:5173/admin.html` in development; the built site serves `/rate` and `/admin`.

## Refinements to the Spec

- The desk and the GitHub-issue intake are deleted in this plan (Tasks 4 and 5), since this plan replaces them. Plan 3 still removes `src/data/rounds/`, `artifacts.ts`, and `workloads.ts` after seeding production.
- A stored draft is restored only if it holds unsaved edits. Otherwise, the saved card wins, so a save on another device (or an admin's edit) is never hidden by a stale draft.
- `npm run snapshot` (`scripts/snapshot.ts`) fetches the snapshot for local checks, and the deploy workflow runs the same script. It skips the write when nothing but `generatedAt` changed, so deploys don't commit a new snapshot every time.
- The snapshot is loaded with `import.meta.glob<Snapshot>`, so TypeScript never infers types from the (large) JSON file.

## File Structure

```
.env.production                     VITE_API_URL for the built site
admin.html                          /admin entry (noindex)
scripts/snapshot.ts                 fetch /api/build/snapshot -> src/data/snapshot.json
src/lib/api.ts (+ test)             fetch wrapper: base URL, cookie, JSON, errors, slow-request signal
src/lib/format.ts                   + formatTimestamp
src/account/
  useSession.ts                     /me on load, login, logout, 401 -> logged out
  LoginForm.tsx  Unavailable.tsx  AccountBar.tsx  ChangePasswordDialog.tsx  WakeNotice.tsx
  Account.module.css
src/rating-ui/
  draft.ts (+ test)                 summarize takes the catalog; restorable()
  usePersistentDraft.ts             restores only unsaved edits
  ScoreMatrix.tsx                   workloads + artifacts props
  ScorecardEditor.tsx               the logged-in user's card (rate page, admin Score tab)
  Editor.module.css
src/rate/RatePage.tsx, RatePage.module.css
src/admin/
  main.tsx  AdminPage.tsx  Admin.module.css (moved from src/desk/Desk.module.css)
  NewRoundForm.tsx  rounds.ts (+ test)
  ReviewTab.tsx  RaterCardEditor.tsx
  PublishTab.tsx
  CatalogTab.tsx  catalog-order.ts (+ test)
  UsersTab.tsx  password.ts (+ test)
src/data/index.ts, snapshot.json    public data from the snapshot
src/App.tsx, src/components/        empty state; no unrated rows, no "of N", footer always links /rate
.github/workflows/deploy.yml        fetch + commit the snapshot before building
```

Deleted: `desk.html`, `src/desk/`, `scripts/desk-api.ts`, `scripts/rounds-fs.ts`, `scripts/draft-why.ts`, `scripts/intake.ts`, `.github/workflows/intake.yml`, `src/domain/payload.ts`, `src/data/site.ts`, `src/data/raters.json`, `.env.example`.

---

### Task 1: API client

**Files:**
- Create: `src/lib/api.ts`, `src/lib/api.test.ts`, `.env.production`
- Modify: `src/lib/format.ts`

- [ ] **Step 1: Write the failing test.** `src/lib/api.test.ts`:

```ts
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
});
```

Run: `npx vitest run src/lib/api.test.ts`
Expected: FAIL, cannot resolve `./api`.

- [ ] **Step 2: Implement `src/lib/api.ts`.**

```ts
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
```

Run: `npx vitest run src/lib/api.test.ts`
Expected: 6 tests pass.

- [ ] **Step 3: Point the built site at the API.** Create `.env.production`:

```
# The built site calls the API on its own subdomain. Development leaves this unset and uses the Vite proxy.
VITE_API_URL=https://api.fabriccreditratings.com
```

- [ ] **Step 4: Add `formatTimestamp` to `src/lib/format.ts`.** Add below `fullDate`:

```ts
const timestamp = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
```

And at the end of the file:

```ts
/** "Oct 15, 3:42 PM" in the reader's time zone. */
export function formatTimestamp(iso: string): string {
  return timestamp.format(new Date(iso));
}
```

- [ ] **Step 5: Commit.**

```powershell
npm run typecheck; npm test
git add src/lib/api.ts src/lib/api.test.ts src/lib/format.ts .env.production
git commit -m "Front end: API client with session-expiry and slow-request signals"
```

---

### Task 2: Login, account bar, password change, and the wake notice

**Files:**
- Create: `src/account/useSession.ts`, `src/account/LoginForm.tsx`, `src/account/Unavailable.tsx`, `src/account/AccountBar.tsx`, `src/account/ChangePasswordDialog.tsx`, `src/account/WakeNotice.tsx`, `src/account/Account.module.css`

- [ ] **Step 1: Create `src/account/useSession.ts`.** Logout doesn't swallow failures. The API clears the cookie before it deletes the session, so after an error answer the cookie is usually gone, but a gateway error, a lost answer, or a 400/403/415 refused before the handler leaves it. So on any failure the hook sends one more `POST /auth/logout`, which answers 204 without touching the database when no cookie is left. A 204 means signed out, with no message. Otherwise the hook rethrows the first error. As built on `p2-front-end` (`83ad1ed`), `api()` takes a fourth `options` argument (`wakeNotice: false` skips the wake notice, `signal` aborts the request), which the Task 1 block above doesn't show; that `src/lib/api.ts` wins. The Log out button runs `logout` through `runLogout` in `src/account/logout.ts`. It shows the first error followed by "You are still logged in.", or for status 0 "Could not reach the ratings server. You are still logged in. Check your connection, then log out again."

```ts
import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '../domain/api-types';
import { api, ApiError, errorMessage, onSignedOut } from '../lib/api';

export type Session =
  | { status: 'loading' }
  | { status: 'signed-out'; notice: string }
  | { status: 'signed-in'; user: SessionUser }
  | { status: 'unavailable'; message: string };

const EXPIRED = 'Your session ended. Log in again; unsaved scores are still in this browser.';

/** The second logout needs no database once the cookie is gone, so it answers fast or not at all. */
const LOGOUT_RETRY_MS = 5000;

/** Who is logged in. Any 401 from any API call drops back to the login form. */
export function useSession() {
  const [session, setSession] = useState<Session>({ status: 'loading' });

  const check = useCallback(async () => {
    setSession({ status: 'loading' });
    try {
      setSession({ status: 'signed-in', user: await api<SessionUser>('GET', '/me') });
    } catch (reason) {
      setSession(
        reason instanceof ApiError && reason.status === 401
          ? { status: 'signed-out', notice: '' }
          : { status: 'unavailable', message: errorMessage(reason) },
      );
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(
    () =>
      onSignedOut(() =>
        setSession((current) => (current.status === 'signed-in' ? { status: 'signed-out', notice: EXPIRED } : current)),
      ),
    [],
  );

  const login = useCallback(async (loginName: string, password: string) => {
    const user = await api<SessionUser>('POST', '/auth/login', { login: loginName, password });
    setSession({ status: 'signed-in', user });
  }, []);

  /** Rejects, with the first failure, when this browser may still hold the session cookie. */
  const logout = useCallback(async () => {
    try {
      await api('POST', '/auth/logout');
    } catch (reason) {
      const retry = { wakeNotice: false, signal: AbortSignal.timeout(LOGOUT_RETRY_MS) };
      await api('POST', '/auth/logout', undefined, retry).catch(() => Promise.reject(reason));
    }
    setSession({ status: 'signed-out', notice: '' });
  }, []);

  return { session, login, logout, retry: check };
}
```

- [ ] **Step 2: Create `src/account/Account.module.css`.**

```css
.login {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  max-width: 420px;
  margin: 24px auto;
  padding: 24px 26px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-lg);
  background: var(--white);
  box-shadow: var(--shadow-sm);
}

.title {
  font-family: var(--font-display);
  font-size: 21px;
  font-weight: 650;
}

.notice {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--band-speculative-bg);
  color: var(--ink);
  font-size: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
}

.field input {
  padding: 8px 10px;
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius-sm);
  font: inherit;
  font-weight: 400;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.primary,
.secondary {
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.primary {
  border: 1px solid var(--fabric-green);
  background: var(--fabric-green);
  color: var(--white);
}

.secondary {
  border: 1px solid var(--rule-strong);
  background: var(--white);
  color: var(--fabric-green-deep);
}

.primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.error {
  color: var(--band-distressed);
  font-size: 14px;
  font-weight: 600;
}

.muted {
  color: var(--ink-muted);
  font-size: 13.5px;
}

.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  padding: 6px 14px;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.85);
  color: var(--ink);
  font-size: 13px;
}

.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--fabric-green-deep);
  font: inherit;
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}

.dialog {
  width: min(420px, calc(100vw - 32px));
  padding: 0;
  border: 1px solid var(--rule);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.dialog::backdrop {
  background: rgb(0 0 0 / 0.35);
}

.dialogBody {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 22px 24px;
}

.wake {
  position: fixed;
  bottom: 16px;
  left: 50%;
  z-index: 50;
  max-width: calc(100vw - 32px);
  padding: 10px 18px;
  border-radius: 999px;
  background: var(--ink);
  box-shadow: var(--shadow-md);
  color: var(--white);
  font-size: 13.5px;
  transform: translateX(-50%);
}
```

- [ ] **Step 3: Create `src/account/LoginForm.tsx`.**

```tsx
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../lib/api';
import styles from './Account.module.css';

interface LoginFormProps {
  title: string;
  /** Shown above the fields, e.g. after a session expired. */
  notice?: string;
  onLogin: (login: string, password: string) => Promise<void>;
}

export function LoginForm({ title, notice, onLogin }: LoginFormProps) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onLogin(login.trim(), password);
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  };

  return (
    <form className={styles.login} onSubmit={submit}>
      <h2 className={styles.title}>{title}</h2>
      {notice && <p className={styles.notice}>{notice}</p>}
      <label className={styles.field}>
        <span>Login</span>
        <input
          value={login}
          onChange={(event) => setLogin(event.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
      </label>
      <label className={styles.field}>
        <span>Password</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <p className={styles.muted}>The site admin creates accounts. Ask them if you need one or forgot your password.</p>
    </form>
  );
}
```

- [ ] **Step 4: Create `src/account/Unavailable.tsx`.**

```tsx
import styles from './Account.module.css';

interface UnavailableProps {
  message: string;
  onRetry: () => void;
}

export function Unavailable({ message, onRetry }: UnavailableProps) {
  return (
    <section className={styles.login} role="alert">
      <h2 className={styles.title}>The ratings server is not responding</h2>
      <p className={styles.muted}>{message}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onRetry}>
          Try again
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Create `src/account/ChangePasswordDialog.tsx`.**

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import styles from './Account.module.css';

const MIN_LENGTH = 10;

type State = { kind: 'idle' | 'saving' | 'done' } | { kind: 'error'; message: string };

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => ref.current?.close();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (next !== repeat) {
      setState({ kind: 'error', message: 'The new passwords do not match. Type the same password twice.' });
      return;
    }
    setState({ kind: 'saving' });
    try {
      await api('PUT', '/me/password', { current, next });
      setState({ kind: 'done' });
    } catch (reason) {
      setState({ kind: 'error', message: errorMessage(reason) });
    }
  };

  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose}>
      {state.kind === 'done' ? (
        <div className={styles.dialogBody}>
          <h2 className={styles.title}>Password changed</h2>
          <p className={styles.muted}>You are still logged in here. Any other devices were logged out.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={close}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className={styles.dialogBody} onSubmit={submit}>
          <h2 className={styles.title}>Change password</h2>
          <label className={styles.field}>
            <span>Current password</span>
            <input
              type="password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className={styles.field}>
            <span>New password ({MIN_LENGTH} or more characters)</span>
            <input
              type="password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              autoComplete="new-password"
              minLength={MIN_LENGTH}
              maxLength={200}
              required
            />
          </label>
          <label className={styles.field}>
            <span>New password again</span>
            <input
              type="password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
          {state.kind === 'error' && (
            <p className={styles.error} role="alert">
              {state.message}
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={close}>
              Cancel
            </button>
            <button type="submit" className={styles.primary} disabled={state.kind === 'saving'}>
              {state.kind === 'saving' ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
```

- [ ] **Step 6: Create `src/account/AccountBar.tsx`.**

```tsx
import { useState } from 'react';
import type { SessionUser } from '../domain/api-types';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import styles from './Account.module.css';

interface AccountBarProps {
  user: SessionUser;
  onLogout: () => void;
  /** Adds a link to /admin for admins. */
  adminLink?: boolean;
}

export function AccountBar({ user, onLogout, adminLink = false }: AccountBarProps) {
  const [changing, setChanging] = useState(false);

  return (
    <div className={styles.bar}>
      <span>
        Logged in as <strong>{user.displayName}</strong>
      </span>
      {adminLink && user.role === 'admin' && (
        <a className={styles.link} href="/admin">
          Admin
        </a>
      )}
      <button type="button" className={styles.link} onClick={() => setChanging(true)}>
        Change password
      </button>
      <button type="button" className={styles.link} onClick={onLogout}>
        Log out
      </button>
      {changing && <ChangePasswordDialog onClose={() => setChanging(false)} />}
    </div>
  );
}
```

- [ ] **Step 7: Create `src/account/WakeNotice.tsx`.**

```tsx
import { useEffect, useState } from 'react';
import { onSlow } from '../lib/api';
import styles from './Account.module.css';

/** Fabric SQL pauses when idle; the first request afterwards can take a while. */
export function WakeNotice() {
  const [slow, setSlow] = useState(false);

  useEffect(() => onSlow(setSlow), []);

  if (!slow) return null;
  return (
    <p className={styles.wake} role="status">
      Waking the ratings database. The first request after a quiet spell can take up to a minute.
    </p>
  );
}
```

- [ ] **Step 8: Commit.** Nothing renders these yet; Task 4 wires them into `/rate`.

```powershell
npm run typecheck; npm test
git add src/account
git commit -m "Front end: session hook, login form, account bar, password change, wake notice"
```

---

### Task 3: Catalog-driven score matrix and safer draft restore

The matrix and `summarize` stop importing the static catalog, so they can render whatever `GET /api/catalog` returns. Drafts remember the saved card they started from, so an old draft can't hide a newer save.

**Files:**
- Create: `src/rating-ui/draft.test.ts`
- Modify: `src/rating-ui/draft.ts`, `src/rating-ui/usePersistentDraft.ts`, `src/rating-ui/ScoreMatrix.tsx`, `src/rate/RatePage.tsx`, `src/desk/ScoreTab.tsx`

- [ ] **Step 1: Write the failing test.** `src/rating-ui/draft.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Artifact } from '../domain/types';
import { draftFromValues, restorable, sameDraft, summarize, type Draft } from './draft';

const artifacts: Artifact[] = [
  { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga' },
  { id: 'lakehouse', name: 'Lakehouse', workload: 'storage', status: 'ga' },
  { id: 'kql', name: 'KQL database', workload: 'real-time', status: 'ga' },
];

describe('summarize', () => {
  it('keeps complete rows in catalog order and lists partial ones', () => {
    const summary = summarize({ kql: [4, 4, 4], notebook: [6, 5, null], lakehouse: [7, 6, 5] }, artifacts);
    expect(Object.keys(summary.scores)).toEqual(['lakehouse', 'kql']);
    expect(summary.rated).toBe(2);
    expect(summary.partial).toEqual(['notebook']);
  });

  it('ignores blank rows and items no longer in the catalog', () => {
    expect(summarize({ notebook: [null, null, null], gone: [1, 1, 1] }, artifacts)).toEqual({
      scores: {},
      rated: 0,
      partial: [],
    });
  });
});

describe('sameDraft', () => {
  it('treats a missing row and a blank row as equal', () => {
    expect(sameDraft({}, { notebook: [null, null, null] })).toBe(true);
    expect(sameDraft({ notebook: [1, 2, 3] }, { notebook: [1, 2, 4] })).toBe(false);
  });
});

describe('draftFromValues', () => {
  it('rounds averages to whole scores', () => {
    expect(draftFromValues({ notebook: { capability: 5.5, ux: 4.4, cost: 7 } })).toEqual({ notebook: [6, 4, 7] });
  });
});

describe('restorable', () => {
  const saved: Draft = { notebook: [5, 5, 5] };

  it('restores edits that were never saved', () => {
    expect(restorable({ base: saved, draft: { notebook: [6, 5, 5] } }, saved)).toEqual({ notebook: [6, 5, 5] });
  });

  it('lets a newer save win over an untouched draft', () => {
    const old: Draft = { notebook: [3, 3, 3] };
    expect(restorable({ base: old, draft: old }, saved)).toBeUndefined();
  });

  it('skips drafts that match the saved card, and missing drafts', () => {
    expect(restorable({ base: {}, draft: saved }, saved)).toBeUndefined();
    expect(restorable(undefined, saved)).toBeUndefined();
  });
});
```

Run: `npx vitest run src/rating-ui/draft.test.ts`
Expected: FAIL, `restorable` is not exported, and `summarize` takes one argument.

- [ ] **Step 2: Update `src/rating-ui/draft.ts`.** Replace the first three import lines with:

```ts
import { MAX_SCORE, MIN_SCORE } from '../domain/grades';
import type { Artifact, FactorValues, Score, ScoreTriple } from '../domain/types';
```

Replace `summarize` with:

```ts
export function summarize(draft: Draft, artifacts: readonly Artifact[]): DraftSummary {
  const scores: Record<string, ScoreTriple> = {};
  const partial: string[] = [];
  for (const artifact of artifacts) {
    const triple = draft[artifact.id];
    if (!triple || isBlank(triple)) continue;
    if (isComplete(triple)) scores[artifact.id] = triple;
    else partial.push(artifact.id);
  }
  return { scores, rated: Object.keys(scores).length, partial };
}
```

Add after `sameDraft`:

```ts
/** What usePersistentDraft keeps in localStorage. */
export interface StoredDraft {
  /** The saved card the draft was edited from. */
  base: Draft;
  draft: Draft;
}

/** A stored draft is worth restoring only if it holds edits that were never saved. */
export function restorable(stored: StoredDraft | undefined, saved: Draft): Draft | undefined {
  if (!stored || sameDraft(stored.draft, stored.base) || sameDraft(stored.draft, saved)) return undefined;
  return stored.draft;
}
```

- [ ] **Step 3: Replace `src/rating-ui/usePersistentDraft.ts`.**

```ts
import { useCallback, useEffect, useState } from 'react';
import { restorable, type Draft, type DraftTriple, type StoredDraft } from './draft';

function read(key: string): StoredDraft | undefined {
  try {
    const raw = localStorage.getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : undefined;
    if (typeof value === 'object' && value !== null && 'base' in value && 'draft' in value) {
      return value as StoredDraft;
    }
  } catch {
    // An unreadable draft is dropped.
  }
  return undefined;
}

/**
 * Slider state that survives reloads. `initial` is the saved card; keep it referentially stable (useMemo).
 * A stored draft comes back only if it holds edits that were never saved, so a save made elsewhere is not
 * hidden by an old draft. Remount (change the React key) when `key` changes.
 */
export function usePersistentDraft(key: string, initial: Draft) {
  const [kept] = useState(() => restorable(read(key), initial));
  const [draft, setDraft] = useState<Draft>(kept ?? initial);
  const [restored, setRestored] = useState(kept !== undefined);

  useEffect(() => {
    const stored: StoredDraft = { base: initial, draft };
    localStorage.setItem(key, JSON.stringify(stored));
  }, [key, initial, draft]);

  const setTriple = useCallback((artifactId: string, triple: DraftTriple) => {
    setDraft((current) => ({ ...current, [artifactId]: triple }));
  }, []);

  /** Replace the whole draft, e.g. after saving or when prefilling. */
  const replace = useCallback((next: Draft) => {
    setDraft(next);
    setRestored(false);
  }, []);

  return { draft, setTriple, replace, restored };
}
```

- [ ] **Step 4: Make `ScoreMatrix` take the catalog.** In `src/rating-ui/ScoreMatrix.tsx`, replace the imports above `import { formatScore }` with:

```tsx
import { memo, useState, type CSSProperties, type KeyboardEvent, type SyntheticEvent } from 'react';
import { Chevron } from '../components/Chevron';
import { scoreColor } from '../components/FactorBars';
import { FACTORS } from '../data/factors';
import { MAX_SCORE, MIN_SCORE } from '../domain/grades';
import type { Artifact, FactorValues, Score, Workload, WorkloadId } from '../domain/types';
```

Replace the props interface and the component head with:

```tsx
interface ScoreMatrixProps {
  workloads: readonly Workload[];
  artifacts: readonly Artifact[];
  draft: Draft;
  onChange: (artifactId: string, triple: DraftTriple) => void;
  /** Published values per artifact, shown under the name as a reminder. */
  reference?: Readonly<Record<string, FactorValues>>;
  referenceLabel?: string;
}

export function ScoreMatrix({
  workloads,
  artifacts,
  draft,
  onChange,
  reference,
  referenceLabel = 'Current',
}: ScoreMatrixProps) {
```

Replace the first two lines inside the `map`:

```tsx
      {WORKLOADS.map((workload) => {
        const items = ARTIFACTS.filter((artifact) => artifact.workload === workload.id);
```

with:

```tsx
      {workloads.map((workload) => {
        const items = artifacts.filter((artifact) => artifact.workload === workload.id);
        if (items.length === 0) return null;
```

- [ ] **Step 5: Keep the two callers compiling.** Both are replaced later (Task 4 rewrites the rate page; Task 5 deletes the desk).

In `src/rate/RatePage.tsx`, add `import { WORKLOADS } from '../data/workloads';` after the `ARTIFACTS` import, change `summarize(draft)` to `summarize(draft, ARTIFACTS)`, and change the matrix to:

```tsx
      <ScoreMatrix workloads={WORKLOADS} artifacts={ARTIFACTS} draft={draft} onChange={setTriple} reference={CURRENT} />
```

In `src/desk/ScoreTab.tsx`, add `import { WORKLOADS } from '../data/workloads';` after the `ARTIFACTS` import, change `summarize(draft)` to `summarize(draft, ARTIFACTS)`, and change the matrix to:

```tsx
      <ScoreMatrix workloads={WORKLOADS} artifacts={ARTIFACTS} draft={draft} onChange={setTriple} reference={current} />
```

- [ ] **Step 6: Verify and commit.**

Run: `npx vitest run src/rating-ui/draft.test.ts; npm run typecheck`
Expected: 7 tests pass, no type errors.

```powershell
npm test
git add src/rating-ui src/rate/RatePage.tsx src/desk/ScoreTab.tsx
git commit -m "Score matrix takes the catalog as props; drafts restore only unsaved edits"
```

---

### Task 4: Rater page on the API

**Files:**
- Create: `src/rating-ui/ScorecardEditor.tsx`, `src/rating-ui/Editor.module.css`
- Modify: `src/rate/RatePage.tsx` (rewrite), `src/rate/RatePage.module.css` (rewrite), `src/data/index.ts`
- Delete: `.github/workflows/intake.yml`, `scripts/intake.ts`, `src/domain/payload.ts`, `src/data/site.ts`

- [ ] **Step 1: Add `currentValues` to `src/data/index.ts`.** Add `FactorValues` to the type import from `../domain/types`, then append:

```ts
/** Published averages per item id, used to prefill score sliders. */
export function currentValues(): Record<string, FactorValues> {
  return Object.fromEntries(getRatings().map((rating) => [rating.artifact.id, rating.current.scores]));
}
```

- [ ] **Step 2: Create `src/rating-ui/Editor.module.css`.** These rules move out of `RatePage.module.css` (Step 5 removes them there), plus `.error`, `.hint`, and the disabled secondary button.

```css
.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 20px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-lg);
  background: var(--white);
}

.panelTitle {
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 650;
}

.muted {
  color: var(--ink-muted);
  font-size: 14px;
}

.warn {
  color: var(--band-speculative);
  font-weight: 600;
}

.error {
  color: var(--band-distressed);
  font-weight: 600;
}

.hint {
  color: var(--ink-faint);
  font-size: 13px;
}

.toolbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 60px;
  padding: 10px 16px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  background: rgb(255 255 255 / 0.96);
  box-shadow: var(--shadow-sm);
}

.toolbarText {
  font-size: 14px;
}

.toolbarActions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.primary,
.secondary {
  align-self: flex-start;
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.primary {
  border: 1px solid var(--fabric-green);
  background: var(--fabric-green);
  color: var(--white);
}

.secondary {
  border: 1px solid var(--rule-strong);
  background: var(--white);
  color: var(--fabric-green-deep);
}

.primary:disabled,
.secondary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Create `src/rating-ui/ScorecardEditor.tsx`.**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Catalog, MyScores, SessionUser } from '../domain/api-types';
import type { FactorValues } from '../domain/types';
import { api, ApiError, errorMessage } from '../lib/api';
import { formatTimestamp } from '../lib/format';
import { draftFromScores, draftFromValues, sameDraft, summarize, type Draft } from './draft';
import { ScoreMatrix } from './ScoreMatrix';
import { usePersistentDraft } from './usePersistentDraft';
import styles from './Editor.module.css';

const EMPTY: Draft = {};

type Load =
  | { kind: 'loading' }
  | { kind: 'closed' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; catalog: Catalog; card: MyScores };

interface ScorecardEditorProps {
  user: SessionUser;
  /** Published averages per item id, shown under each name and used by "Start from current ratings". */
  reference: Readonly<Record<string, FactorValues>>;
}

/** The logged-in user's own card in the open round. Used by /rate and the admin Score tab. */
export function ScorecardEditor({ user, reference }: ScorecardEditorProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  const fetchCard = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      const [catalog, card] = await Promise.all([
        api<Catalog>('GET', '/catalog'),
        api<MyScores>('GET', '/rounds/open/my-scores'),
      ]);
      setLoad({ kind: 'ready', catalog, card });
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) setLoad({ kind: 'closed' });
      else if (!(reason instanceof ApiError && reason.status === 401)) {
        setLoad({ kind: 'failed', message: errorMessage(reason) });
      }
    }
  }, []);

  useEffect(() => {
    void fetchCard();
  }, [fetchCard]);

  if (load.kind === 'loading') return <p className={styles.muted}>Loading your scorecard…</p>;
  if (load.kind === 'closed') return <Closed />;
  if (load.kind === 'failed') {
    return (
      <section className={styles.panel} role="alert">
        <h2 className={styles.panelTitle}>Could not load your scorecard</h2>
        <p className={styles.muted}>{load.message}</p>
        <button type="button" className={styles.secondary} onClick={() => void fetchCard()}>
          Try again
        </button>
      </section>
    );
  }
  return (
    <CardForm
      key={load.card.round.id}
      user={user}
      catalog={load.catalog}
      card={load.card}
      reference={reference}
      onSaved={(card) => setLoad({ kind: 'ready', catalog: load.catalog, card })}
    />
  );
}

function Closed() {
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>No review round is open right now</h2>
      <p className={styles.muted}>
        Scores are collected in rounds, usually once a quarter. Check back when the next one opens, or browse the{' '}
        <a href="/">current ratings</a>.
      </p>
    </section>
  );
}

interface CardFormProps {
  user: SessionUser;
  catalog: Catalog;
  card: MyScores;
  reference: Readonly<Record<string, FactorValues>>;
  onSaved: (card: MyScores) => void;
}

type Status = { kind: 'idle' | 'saving' } | { kind: 'error'; message: string };

function CardForm({ user, catalog, card, reference, onSaved }: CardFormProps) {
  const { round, previous } = card;
  const saved = useMemo(() => draftFromScores(card.scores), [card.scores]);
  const { draft, setTriple, replace, restored } = usePersistentDraft(`fcr-card:${user.id}:${round.id}`, saved);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const summary = summarize(draft, catalog.artifacts);
  const dirty = !sameDraft(draft, saved);
  const touched = summary.rated + summary.partial.length > 0;
  const hasReference = Object.keys(reference).length > 0;

  const save = async () => {
    setStatus({ kind: 'saving' });
    try {
      const next = await api<MyScores>('PUT', '/rounds/open/my-scores', { round: round.id, scores: summary.scores });
      replace(draftFromScores(next.scores));
      onSaved(next);
      setStatus({ kind: 'idle' });
    } catch (reason) {
      const kept = reason instanceof ApiError && reason.status !== 400 ? ' Your draft is kept in this browser.' : '';
      setStatus({ kind: 'error', message: `${errorMessage(reason)}${kept}` });
    }
  };

  const prefill = (next: Draft, what: string) => {
    if (touched && !confirm(`Replace your sliders with ${what}?`)) return;
    replace(next);
  };

  const stateText =
    status.kind === 'saving'
      ? 'Saving…'
      : status.kind === 'error'
        ? ''
        : dirty
          ? restored
            ? 'Unsaved draft restored'
            : 'Unsaved changes'
          : card.updatedAt
            ? `Saved ${formatTimestamp(card.updatedAt)}`
            : 'Nothing saved yet';

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.toolbarText}>
          <strong>
            {round.label} · {summary.rated} of {catalog.artifacts.length} rated
          </strong>
          {summary.partial.length > 0 && <span className={styles.warn}> · {summary.partial.length} incomplete</span>}
          {stateText && <span className={styles.muted}> · {stateText}</span>}
          {status.kind === 'error' && <span className={styles.error}> {status.message}</span>}
        </div>
        <div className={styles.toolbarActions}>
          {previous && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => prefill(draftFromScores(previous.scores), `your ${previous.roundLabel} scores`)}
            >
              Start from my {previous.roundLabel} scores
            </button>
          )}
          {hasReference && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => prefill(draftFromValues(reference), 'the current ratings')}
            >
              Start from current ratings
            </button>
          )}
          {dirty && (
            <button type="button" className={styles.secondary} onClick={() => replace(saved)}>
              Discard changes
            </button>
          )}
          {touched && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                if (confirm('Clear every slider?')) replace(EMPTY);
              }}
            >
              Clear all
            </button>
          )}
          <button
            type="button"
            className={styles.primary}
            onClick={() => void save()}
            disabled={!dirty || summary.partial.length > 0 || status.kind === 'saving'}
          >
            Save scores
          </button>
        </div>
      </div>

      <p className={styles.hint}>
        Drag or click a slider to set it; arrow keys adjust it and Enter sets an untouched one. Leave an item blank to skip
        it, or clear everything and save to withdraw your card. Only the admin sees individual cards; the site shows
        averages once {round.label} is published.
      </p>

      <ScoreMatrix
        workloads={catalog.workloads}
        artifacts={catalog.artifacts}
        draft={draft}
        onChange={setTriple}
        reference={reference}
      />
    </>
  );
}
```

- [ ] **Step 4: Rewrite `src/rate/RatePage.tsx`.**

```tsx
import { AccountBar } from '../account/AccountBar';
import { LoginForm } from '../account/LoginForm';
import { Unavailable } from '../account/Unavailable';
import { useSession } from '../account/useSession';
import { WakeNotice } from '../account/WakeNotice';
import { currentValues } from '../data';
import { ScorecardEditor } from '../rating-ui/ScorecardEditor';
import styles from './RatePage.module.css';

const CURRENT = currentValues();

export function RatePage() {
  const { session, login, logout, retry } = useSession();

  return (
    <>
      <header className={styles.header}>
        <div className={styles.inner}>
          <div className={styles.topline}>
            <a className={styles.back} href="/">
              ← Microsoft Fabric Credit Ratings
            </a>
            {session.status === 'signed-in' && <AccountBar user={session.user} onLogout={logout} adminLink />}
          </div>
          <h1 className={styles.title}>Score Fabric items</h1>
          <p className={styles.lede}>
            Rate the Fabric items you use from 1 to 7 on feature capability, user experience, and CU / token cost. Skip
            anything you have not used.
          </p>
        </div>
      </header>
      <main className={styles.main}>
        {session.status === 'loading' && <p className={styles.status}>Checking your login…</p>}
        {session.status === 'unavailable' && <Unavailable message={session.message} onRetry={() => void retry()} />}
        {session.status === 'signed-out' && (
          <LoginForm title="Log in to score" notice={session.notice} onLogin={login} />
        )}
        {session.status === 'signed-in' && (
          <ScorecardEditor key={session.user.id} user={session.user} reference={CURRENT} />
        )}
      </main>
      <WakeNotice />
    </>
  );
}
```

- [ ] **Step 5: Rewrite `src/rate/RatePage.module.css`.**

```css
.header {
  background: var(--header-gradient);
}

.inner {
  max-width: var(--content-width);
  margin: 0 auto;
  padding: 28px 24px 36px;
}

.topline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
}

.back {
  color: var(--white);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.back:hover {
  text-decoration: underline;
}

.title {
  margin-top: 18px;
  color: var(--white);
  font-family: var(--font-display);
  font-size: clamp(30px, 5vw, 44px);
  font-weight: 700;
  line-height: 1.1;
}

.lede {
  max-width: 60ch;
  margin-top: 10px;
  color: rgb(255 255 255 / 0.92);
  font-size: 16.5px;
}

.main {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 1120px;
  margin: 0 auto;
  padding: 24px 24px 80px;

  --matrix-sticky-top: 68px;
}

.status {
  color: var(--ink-muted);
  font-size: 14px;
}

@media (max-width: 760px) {
  .main {
    padding: 16px 12px 60px;

    --matrix-sticky-top: 112px;
  }
}
```

- [ ] **Step 6: Delete the GitHub-issue intake.** The rate page no longer files issues.

```powershell
git rm .github/workflows/intake.yml scripts/intake.ts src/domain/payload.ts src/data/site.ts
```

Run: `rg -n "payload|data/site|intake" src scripts .github`
Expected: no output.

- [ ] **Step 7: Check it in the browser.** Start `npm run api` and `npm run dev`. Create a throwaway rater with the admin session from Plan 1 Task 11 Step 8 (log in again if needed). It stays for the end-to-end check in Task 12.

```powershell
$rater = @{ login = 'rater-a'; displayName = 'Rater A'; role = 'rater'; password = 'rater-a-pass-123' } | ConvertTo-Json
Invoke-RestMethod -Method Post http://localhost:7071/api/admin/users -WebSession $web -Headers $headers -ContentType 'application/json' -Body $rater
```

Then, at `http://localhost:5173/rate.html`:
1. The login form shows. A wrong password shows "Wrong login or password."
2. Log in as `rater-a`. The bar shows "Logged in as Rater A", the toolbar shows "Q4 2026 · 0 of N rated · Nothing saved yet", and there is no Admin link.
3. Set all three sliders on two items and one slider on a third. Save stays disabled and the toolbar shows "1 incomplete". Clear the third item, then click Save scores. The toolbar shows "Saved <time>".
4. Reload. The two items come back as saved, with no "draft restored".
5. Change one slider without saving, then reload. The toolbar shows "Unsaved draft restored". Click Discard changes.
6. Change password: a wrong current password shows "Your current password is wrong."; a 9-character new password is blocked by the form. Change it to `rater-a-pass-456`, log out, and log back in with the new password.
7. Log in as your admin account in another browser. An Admin link shows in the bar.

- [ ] **Step 8: Commit.**

```powershell
npm run typecheck; npm test
git add src/rating-ui src/rate src/data/index.ts
git commit -m "Rater page: login, own scorecard in the open round, password change; remove GitHub intake"
```

---

### Task 5: Admin page with the Score tab; retire the desk

**Files:**
- Create: `admin.html`, `src/admin/main.tsx`, `src/admin/AdminPage.tsx`, `src/admin/NewRoundForm.tsx`, `src/admin/rounds.ts`, `src/admin/rounds.test.ts`
- Move: `src/desk/Desk.module.css` → `src/admin/Admin.module.css`
- Modify: `vite.config.ts`, `package.json`
- Delete: `desk.html`, the rest of `src/desk/`, `scripts/desk-api.ts`, `scripts/rounds-fs.ts`, `scripts/draft-why.ts`, `src/data/raters.json`, `.env.example`

- [ ] **Step 1: Write the failing test.** `src/admin/rounds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Round } from '../domain/types';
import { localToday, nextRound } from './rounds';

const round = (id: string): Round => ({ id, label: id, status: 'published', publishedOn: '2026-01-01' });

describe('nextRound', () => {
  it('follows the newest quarter', () => {
    expect(nextRound([round('2026-Q3'), round('2026-Q4')], '2026-12-01')).toEqual({ id: '2027-Q1', label: 'Q1 2027' });
    expect(nextRound([round('2026-Q2')], '2026-12-01')).toEqual({ id: '2026-Q3', label: 'Q3 2026' });
  });

  it('starts from the current quarter when there are no rounds', () => {
    expect(nextRound([], '2026-05-10')).toEqual({ id: '2026-Q2', label: 'Q2 2026' });
  });
});

describe('localToday', () => {
  it('formats the local date', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
```

Run: `npx vitest run src/admin/rounds.test.ts`
Expected: FAIL, cannot resolve `./rounds`.

- [ ] **Step 2: Create `src/admin/rounds.ts`** (moved from `src/desk/selectors.ts`, now taking plain rounds).

```ts
import type { Round } from '../domain/types';

/** After 2026-Q4 comes { id: '2027-Q1', label: 'Q1 2027' }. Other id styles fall back to the quarter of `today`. */
export function nextRound(rounds: readonly Round[], today: string): { id: string; label: string } {
  const latest = rounds.map((round) => round.id).sort().at(-1);
  const match = latest ? /^(\d{4})-Q([1-4])$/.exec(latest) : null;
  let year = Number(today.slice(0, 4));
  let quarter = Math.ceil(Number(today.slice(5, 7)) / 3);
  if (match) {
    year = Number(match[1]);
    quarter = Number(match[2]) + 1;
    if (quarter > 4) {
      quarter = 1;
      year += 1;
    }
  }
  return { id: `${year}-Q${quarter}`, label: `Q${quarter} ${year}` };
}

/** Today in the browser's time zone, as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
```

Run: `npx vitest run src/admin/rounds.test.ts`
Expected: 3 tests pass.

- [ ] **Step 3: Move the stylesheet, then delete the desk and its helpers.**

```powershell
git mv src/desk/Desk.module.css src/admin/Admin.module.css
git rm -r desk.html src/desk scripts/desk-api.ts scripts/rounds-fs.ts scripts/draft-why.ts src/data/raters.json .env.example
npm uninstall @anthropic-ai/sdk
```

The API has its own copy of `@anthropic-ai/sdk` in `api/package.json`; the root no longer needs it.

- [ ] **Step 4: Update `src/admin/Admin.module.css`.** Delete the `.who` and `.commands` rules. Replace the `.scoreTab` rule with:

```css
.scoreTab {
  display: flex;
  flex-direction: column;
  gap: 14px;

  --matrix-sticky-top: 68px;
}
```

Append these rules (used by this task and Tasks 6 to 9) after `.roundList li`, above the `@media` block:

```css
.stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field select {
  min-width: 140px;
  padding: 7px 10px;
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius-sm);
  font: inherit;
  font-weight: 400;
}

.grow {
  flex: 1 1 280px;
}

.grow input {
  width: 100%;
}

.select {
  padding: 7px 10px;
  border: 1px solid var(--rule-strong);
  border-radius: 999px;
  background: var(--white);
  font: inherit;
  font-size: 13.5px;
}

.small {
  padding: 4px 10px;
  border: 1px solid var(--rule-strong);
  border-radius: 999px;
  background: var(--white);
  color: var(--fabric-green-deep);
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.small:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.linkButton {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.workloadForm {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.table th,
.table td {
  padding: 7px 8px;
  border-bottom: 1px solid var(--rule);
  text-align: left;
  vertical-align: middle;
}

.table th {
  color: var(--ink-faint);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.table input,
.table select {
  padding: 5px 8px;
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius-sm);
  font: inherit;
}

.table tr[data-inactive='true'] td {
  color: var(--ink-faint);
}

.inline {
  display: flex;
  align-items: center;
  gap: 6px;
}

.inline input {
  width: 100%;
  min-width: 180px;
}

.rowActions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.code {
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 12.5px;
}

.badge {
  margin-left: 8px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--fabric-green-pale);
  color: var(--fabric-green-deep);
  font-size: 11.5px;
  font-weight: 700;
}
```

- [ ] **Step 5: Create `admin.html`.**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="%BASE_URL%favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <meta name="theme-color" content="#117865" />
    <title>Admin · Microsoft Fabric Credit Ratings</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/admin/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `src/admin/main.tsx`.**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminPage } from './AdminPage';
import '../styles/tokens.css';
import '../styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <AdminPage />
  </StrictMode>,
);
```

- [ ] **Step 7: Create `src/admin/NewRoundForm.tsx`.**

```tsx
import { useState, type FormEvent } from 'react';
import type { AdminRound } from '../domain/api-types';
import { api, errorMessage } from '../lib/api';
import { localToday, nextRound } from './rounds';
import styles from './Admin.module.css';

interface NewRoundFormProps {
  rounds: readonly AdminRound[];
  onCreated: (rounds: AdminRound[]) => void;
}

export function NewRoundForm({ rounds, onCreated }: NewRoundFormProps) {
  const suggested = nextRound(rounds, localToday());
  const [id, setId] = useState(suggested.id);
  const [label, setLabel] = useState(suggested.label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onCreated(await api<AdminRound[]>('POST', '/admin/rounds', { id: id.trim(), label: label.trim() }));
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  };

  return (
    <form className={styles.panel} onSubmit={submit}>
      <h2 className={styles.panelTitle}>Start a new round</h2>
      <p className={styles.muted}>
        Opening a round lets raters log in and score it. Nothing shows on the public site until you publish it.
      </p>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Round id</span>
          <input value={id} onChange={(event) => setId(event.target.value)} pattern="\d{4}-[A-Z0-9]{1,3}" required />
        </label>
        <label className={styles.field}>
          <span>Label</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={40} required />
        </label>
        <button type="submit" className={styles.primary} disabled={busy}>
          Open round
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}
```

- [ ] **Step 8: Create `src/admin/AdminPage.tsx`.** Tasks 6 to 9 each add one tab to `TABS` and one line to the tab switch.

```tsx
import { useCallback, useEffect, useState } from 'react';
import { AccountBar } from '../account/AccountBar';
import { LoginForm } from '../account/LoginForm';
import { Unavailable } from '../account/Unavailable';
import { useSession } from '../account/useSession';
import { WakeNotice } from '../account/WakeNotice';
import { currentValues } from '../data';
import type { AdminCatalog, AdminRound, AdminUser, SessionUser } from '../domain/api-types';
import { api, errorMessage } from '../lib/api';
import { ScorecardEditor } from '../rating-ui/ScorecardEditor';
import { NewRoundForm } from './NewRoundForm';
import styles from './Admin.module.css';

const CURRENT = currentValues();

const TABS = [{ id: 'score', label: 'Score' }] as const;

type Tab = (typeof TABS)[number]['id'];

function tabFromHash(): Tab {
  return TABS.find((tab) => `#${tab.id}` === location.hash)?.id ?? 'score';
}

export function AdminPage() {
  const { session, login, logout, retry } = useSession();
  const isRater = session.status === 'signed-in' && session.user.role !== 'admin';

  useEffect(() => {
    if (isRater) location.replace('/rate');
  }, [isRater]);

  if (session.status === 'signed-in' && !isRater) return <AdminShell user={session.user} onLogout={logout} />;

  return (
    <main className={styles.loading}>
      {session.status === 'signed-out' ? (
        <LoginForm title="Admin login" notice={session.notice} onLogin={login} />
      ) : session.status === 'unavailable' ? (
        <Unavailable message={session.message} onRetry={() => void retry()} />
      ) : (
        <p className={styles.muted}>Loading…</p>
      )}
      <WakeNotice />
    </main>
  );
}

interface AdminData {
  rounds: AdminRound[];
  catalog: AdminCatalog;
  users: AdminUser[];
}

function AdminShell({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [data, setData] = useState<AdminData>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [rounds, catalog, users] = await Promise.all([
        api<AdminRound[]>('GET', '/admin/rounds'),
        api<AdminCatalog>('GET', '/admin/catalog'),
        api<AdminUser[]>('GET', '/admin/users'),
      ]);
      setData({ rounds, catalog, users });
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setRounds = useCallback((rounds: AdminRound[]) => setData((current) => current && { ...current, rounds }), []);

  const choose = (next: Tab) => {
    setTab(next);
    history.replaceState(null, '', `#${next}`);
  };

  const open = data?.rounds.find((round) => round.status === 'open');

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Fabric Credit Ratings · Admin</p>
          <h1 className={styles.title}>{!data ? 'Loading…' : open ? `${open.label} is open` : 'No round open'}</h1>
        </div>
        <nav className={styles.tabs} aria-label="Admin sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={styles.tab}
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => choose(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <AccountBar user={user} onLogout={onLogout} />
      </header>

      <main className={styles.main}>
        {error && (
          <section className={styles.panel} role="alert">
            <p className={styles.error}>{error}</p>
            <button type="button" className={styles.secondary} onClick={() => void load()}>
              Try again
            </button>
          </section>
        )}
        {!data && !error && <p className={styles.muted}>Loading…</p>}
        {data &&
          tab === 'score' &&
          (open ? (
            <div className={styles.scoreTab}>
              <ScorecardEditor user={user} reference={CURRENT} />
            </div>
          ) : (
            <NewRoundForm rounds={data.rounds} onCreated={setRounds} />
          ))}
      </main>
      <WakeNotice />
    </div>
  );
}
```

- [ ] **Step 9: Update `vite.config.ts`.** Replace the whole file:

```ts
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served from the custom domain fabriccreditratings.com, so assets load from the root.
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    // FCR_API_TARGET points /api at a Functions host on another port; an empty value falls back to 7071.
    proxy: { '/api': process.env.FCR_API_TARGET || 'http://localhost:7071' },
  },
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        rate: fileURLToPath(new URL('rate.html', import.meta.url)),
        admin: fileURLToPath(new URL('admin.html', import.meta.url)),
      },
    },
  },
});
```

The desk is gone, so the proxy takes all of `/api`. Set `FCR_API_TARGET` in the shell, not in `.env`: `process.env` in `vite.config.ts` holds only the shell's variables. Running a second checkout alongside this one:
- The proxy keeps the browser's `Origin` (`changeOrigin` rewrites only `Host`). A Vite on any port other than 5173 needs that origin in its host's `ALLOWED_ORIGINS`, or every write, login included, gets 403.
- Vite moves to 5174 on its own when 5173 is taken, with only a console line. Either put `"ALLOWED_ORIGINS": "http://localhost:5173,http://localhost:5174,http://localhost:5175"` in each checkout's `api/local.settings.json`, or start Vite with `--port <n> --strictPort`.
- A second host starts with `cd api; npm run build; npx func start --port 7072`, and its Vite with `$env:FCR_API_TARGET = 'http://localhost:7072'; npm run dev`.

- [ ] **Step 10: Remove the desk script.** In `package.json`, delete the `"desk": "vite --open /desk.html",` line.

- [ ] **Step 11: Check it.** Run `npm run build`.
Expected: typecheck passes, and `dist/` contains `index.html`, `rate.html`, and `admin.html`.

Then, with `npm run api` and `npm run dev` running:
1. `http://localhost:5173/admin.html` shows "Admin login". Log in as `rater-a`: the page sends you to `/rate`.
2. Log in as your admin account. The title reads "Q4 2026 is open", and the Score tab shows your own card, the same editor as `/rate`. Save a few items.

- [ ] **Step 12: Commit.**

```powershell
npm test
git add admin.html src/admin vite.config.ts package.json package-lock.json
git commit -m "Admin page with login gate and Score tab; retire the local desk"
```

---

### Task 6: Review tab with rater card editing

**Files:**
- Create: `src/admin/ReviewTab.tsx`, `src/admin/RaterCardEditor.tsx`
- Modify: `src/admin/AdminPage.tsx`

- [ ] **Step 1: Create `src/admin/RaterCardEditor.tsx`.** The admin edits any rater's card in any round. The card is rebuilt from the review's per-rater breakdown, so no extra endpoint is needed.

```tsx
import { useCallback, useMemo, useState } from 'react';
import type { AdminCatalog, RoundReview } from '../domain/api-types';
import { api, errorMessage } from '../lib/api';
import { sameDraft, summarize, type Draft, type DraftTriple } from '../rating-ui/draft';
import { ScoreMatrix } from '../rating-ui/ScoreMatrix';
import styles from './Admin.module.css';

/** One rater's card, rebuilt from the per-rater breakdown in the review. */
export function cardFromReview(review: RoundReview, userId: number): Draft {
  const card: Record<string, DraftTriple> = {};
  for (const item of review.items) {
    const entry = item.breakdown.find((row) => row.userId === userId);
    if (entry) card[item.artifact.id] = entry.scores;
  }
  return card;
}

interface RaterCardEditorProps {
  review: RoundReview;
  rater: { userId: number; name: string };
  catalog: AdminCatalog;
  onSaved: (review: RoundReview) => void;
  onCancel: () => void;
}

export function RaterCardEditor({ review, rater, catalog, onSaved, onCancel }: RaterCardEditorProps) {
  const { round } = review;
  const saved = useMemo(() => cardFromReview(review, rater.userId), [review, rater.userId]);
  const [draft, setDraft] = useState<Draft>(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const summary = summarize(draft, catalog.artifacts);
  const dirty = !sameDraft(draft, saved);

  const setTriple = useCallback((artifactId: string, triple: DraftTriple) => {
    setDraft((current) => ({ ...current, [artifactId]: triple }));
  }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      onSaved(
        await api<RoundReview>('PUT', `/admin/rounds/${round.id}/scores/${rater.userId}`, { scores: summary.scores }),
      );
    } catch (reason) {
      setError(errorMessage(reason));
      setSaving(false);
    }
  };

  const cancel = () => {
    if (!dirty || confirm(`Discard your changes to ${rater.name}'s card?`)) onCancel();
  };

  return (
    <div className={styles.scoreTab}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarText}>
          <strong>
            {rater.name} · {round.label} · {summary.rated} of {catalog.artifacts.length} rated
          </strong>
          {summary.partial.length > 0 && <span className={styles.warn}> · {summary.partial.length} incomplete</span>}
          {error && <span className={styles.error}> {error}</span>}
        </div>
        <div className={styles.toolbarActions}>
          <button type="button" className={styles.secondary} onClick={cancel}>
            Back to review
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => void save()}
            disabled={!dirty || summary.partial.length > 0 || saving}
          >
            {saving ? 'Saving…' : 'Save card'}
          </button>
        </div>
      </div>
      <p className={styles.hint}>
        {round.status === 'published'
          ? `${round.label} is published. Saving changes its public averages at the next site update.`
          : `You are editing ${rater.name}'s card for the open round.`}{' '}
        Clear every item and save to remove the card.
      </p>
      <ScoreMatrix workloads={catalog.workloads} artifacts={catalog.artifacts} draft={draft} onChange={setTriple} />
    </div>
  );
}
```

- [ ] **Step 2: Create `src/admin/ReviewTab.tsx`.** Notes save per item through `PUT /admin/rounds/:id/notes/:artifactId`, 700 ms after typing stops. An item stays "unsaved" if its text changed while its save was in flight. The limit matches the server's: up to 2,000 characters after trimming are accepted. A longer note isn't sent; it stays unsaved, with the server's wording ("Keep the write-up to 2,000 characters or fewer.") under the box. The box has no `maxLength`, which would cut a paste short without saying so and would count the untrimmed text.

Drafts are slow by nature, so they skip the wake notice (`{ wakeNotice: false }`, the `api()` option noted in Task 2 Step 1). The API answers every draft within about 200 s, with the text or a 502 whose message is shown as is. So a status 0 there means the network failed, not a draft that ran too long. "Draft all blank" drafts one item at a time. It stops at the first rate-limit or overload message ("Anthropic's rate limit for this key was reached. …", "Anthropic is overloaded right now. …"), because every later draft would get the same answer. It keeps going past "The model kept mentioning scores or grades. Write this one by hand." and other per-item errors.

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { GradeBadge } from '../components/GradeBadge';
import type { AdminCatalog, AdminRound, AdminUser, RoundReview } from '../domain/api-types';
import type { RoundNotes } from '../domain/types';
import { api, errorMessage } from '../lib/api';
import { formatScore } from '../lib/format';
import { RaterCardEditor } from './RaterCardEditor';
import styles from './Admin.module.css';

const SAVE_DELAY = 700;
/** The server's limit, counted on the trimmed text, with its wording. */
const NOTE_MAX = 2000;
const NOTE_TOO_LONG = 'Keep the write-up to 2,000 characters or fewer.';
/** How the API's 502 starts when Anthropic refuses for the key or for everyone; every later draft would fail too. */
const PROVIDER_LIMITS = ["Anthropic's rate limit for this key was reached.", 'Anthropic is overloaded right now.'];

interface ReviewTabProps {
  rounds: readonly AdminRound[];
  catalog: AdminCatalog;
  users: readonly AdminUser[];
}

export function ReviewTab({ rounds, catalog, users }: ReviewTabProps) {
  const ordered = [...rounds].sort(
    (a, b) => Number(b.status === 'open') - Number(a.status === 'open') || b.id.localeCompare(a.id),
  );
  const [roundId, setRoundId] = useState(ordered[0]?.id ?? '');

  if (ordered.length === 0) return <p className={styles.panel}>No rounds yet. Start one on the Score tab.</p>;

  return (
    <div className={styles.reviewTab}>
      <label className={styles.roundPicker}>
        <span>Round</span>
        <select value={roundId} onChange={(event) => setRoundId(event.target.value)}>
          {ordered.map((round) => (
            <option key={round.id} value={round.id}>
              {round.label} ({round.status === 'open' ? 'open' : `published ${round.publishedOn ?? ''}`})
            </option>
          ))}
        </select>
      </label>
      <RoundLoader key={roundId} roundId={roundId} catalog={catalog} users={users} />
    </div>
  );
}

interface RoundLoaderProps {
  roundId: string;
  catalog: AdminCatalog;
  users: readonly AdminUser[];
}

function RoundLoader({ roundId, catalog, users }: RoundLoaderProps) {
  const [review, setReview] = useState<RoundReview>();
  const [error, setError] = useState('');

  useEffect(() => {
    api<RoundReview>('GET', `/admin/rounds/${roundId}/review`).then(setReview, (reason: unknown) =>
      setError(errorMessage(reason)),
    );
  }, [roundId]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!review) return <p className={styles.muted}>Loading the round…</p>;
  return <RoundReviewPanel review={review} catalog={catalog} users={users} onReview={setReview} />;
}

interface RoundReviewPanelProps {
  review: RoundReview;
  catalog: AdminCatalog;
  users: readonly AdminUser[];
  onReview: (review: RoundReview) => void;
}

interface Edits {
  notes: RoundNotes;
  /** Item ids whose text has not reached the server yet. */
  dirty: ReadonlySet<string>;
}

function RoundReviewPanel({ review, catalog, users, onReview }: RoundReviewPanelProps) {
  const roundId = review.round.id;
  const [edits, setEdits] = useState<Edits>({ notes: review.notes, dirty: new Set() });
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState<string>();
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [editing, setEditing] = useState<{ userId: number; name: string }>();
  const cancelRef = useRef(false);
  const { notes } = edits;

  useEffect(() => {
    if (edits.dirty.size === 0) return;
    // A note over the limit stays unsaved, with its full text in the box, until it's shortened.
    const sent = Object.fromEntries(
      [...edits.dirty]
        .map((id) => [id, edits.notes[id] ?? ''] as const)
        .filter(([, body]) => body.trim().length <= NOTE_MAX),
    );
    if (Object.keys(sent).length === 0) return;
    const timer = setTimeout(() => {
      setSaveState('saving');
      void (async () => {
        try {
          for (const [id, body] of Object.entries(sent)) {
            await api('PUT', `/admin/rounds/${roundId}/notes/${id}`, { body });
          }
          setEdits((current) => ({
            ...current,
            dirty: new Set([...current.dirty].filter((id) => (current.notes[id] ?? '') !== sent[id])),
          }));
          setSaveState('saved');
        } catch (reason) {
          setSaveError(errorMessage(reason));
          setSaveState('error');
        }
      })();
    }, SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [edits, roundId]);

  const setNote = useCallback((id: string, text: string) => {
    setEdits((current) => ({ notes: { ...current.notes, [id]: text }, dirty: new Set(current.dirty).add(id) }));
  }, []);

  /** Resolves to the error message, or '' once the draft is in the box. */
  const draftOne = async (id: string): Promise<string> => {
    setBusy(id);
    setDraftErrors(({ [id]: _, ...rest }) => rest);
    try {
      const path = `/admin/rounds/${roundId}/draft/${id}`;
      const { text } = await api<{ text: string }>('POST', path, undefined, { wakeNotice: false });
      setNote(id, text);
      return '';
    } catch (reason) {
      const message = errorMessage(reason);
      setDraftErrors((current) => ({ ...current, [id]: message }));
      return message;
    } finally {
      setBusy(undefined);
    }
  };

  const blanks = review.items.filter(({ artifact }) => !notes[artifact.id]?.trim());

  const draftAllBlank = async () => {
    cancelRef.current = false;
    const queue = blanks.map(({ artifact }) => artifact.id);
    setProgress({ done: 0, total: queue.length });
    for (const [index, id] of queue.entries()) {
      if (cancelRef.current) break;
      const failure = await draftOne(id);
      setProgress({ done: index + 1, total: queue.length });
      if (PROVIDER_LIMITS.some((start) => failure.startsWith(start))) break;
    }
    setProgress(undefined);
  };

  const withCards = new Set(review.raters.map((rater) => rater.userId));
  const choices = [
    ...review.raters.map((rater) => ({ ...rater, hasCard: true })),
    ...users
      .filter((user) => user.active && !withCards.has(user.id))
      .map((user) => ({ userId: user.id, name: user.displayName, hasCard: false })),
  ];

  const chooseCard = (value: string) => {
    const choice = choices.find((item) => String(item.userId) === value);
    if (choice) setEditing({ userId: choice.userId, name: choice.name });
  };

  if (editing) {
    return (
      <RaterCardEditor
        review={review}
        rater={editing}
        catalog={catalog}
        onSaved={(next) => {
          onReview(next);
          setEditing(undefined);
        }}
        onCancel={() => setEditing(undefined)}
      />
    );
  }

  const visible = onlyMissing ? blanks : review.items;
  const saveText =
    saveState === 'saving' ? 'Saving…' : saveState === 'error' ? '' : edits.dirty.size > 0 ? 'Unsaved' : 'All notes saved';

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.toolbarText}>
          <strong>
            {review.items.length} items scored by {review.raters.length}{' '}
            {review.raters.length === 1 ? 'rater' : 'raters'}
          </strong>
          <span className={styles.muted}>
            {' · '}
            {blanks.length} missing a why{saveText && ` · ${saveText}`}
          </span>
          {saveState === 'error' && (
            <span className={styles.error}>
              {' '}
              {saveError}{' '}
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => setEdits((current) => ({ ...current }))}
              >
                Retry
              </button>
            </span>
          )}
        </div>
        <div className={styles.toolbarActions}>
          <label className={styles.check}>
            <input type="checkbox" checked={onlyMissing} onChange={(event) => setOnlyMissing(event.target.checked)} />
            Only missing a why
          </label>
          <select
            className={styles.select}
            value=""
            onChange={(event) => chooseCard(event.target.value)}
            aria-label="Edit a rater's card"
          >
            <option value="">Edit a rater's card…</option>
            {choices.map((choice) => (
              <option key={choice.userId} value={choice.userId}>
                {choice.name}
                {choice.hasCard ? '' : ' (no card yet)'}
              </option>
            ))}
          </select>
          {progress ? (
            <button type="button" className={styles.secondary} onClick={() => (cancelRef.current = true)}>
              Stop ({progress.done}/{progress.total})
            </button>
          ) : (
            <button
              type="button"
              className={styles.primary}
              onClick={() => void draftAllBlank()}
              disabled={!review.aiEnabled || blanks.length === 0 || busy !== undefined}
              title={review.aiEnabled ? undefined : 'Set ANTHROPIC_API_KEY in the Function App settings'}
            >
              Draft all blank with AI ({blanks.length})
            </button>
          )}
        </div>
      </div>

      {review.round.status === 'published' && (
        <p className={styles.hint}>
          {review.round.label} is published. Score and note edits here reach the public site at the next site update
          (Publish tab).
        </p>
      )}
      {review.items.length === 0 && (
        <p className={styles.panel}>Nobody has scored anything in {review.round.label} yet.</p>
      )}

      {catalog.workloads.map((workload) => {
        const group = visible.filter(({ artifact }) => artifact.workload === workload.id);
        if (group.length === 0) return null;
        return (
          <section key={workload.id} className={styles.reviewGroup}>
            <h2 className={styles.groupTitle}>{workload.name}</h2>
            {group.map(({ artifact, point, change, breakdown }) => {
              const { capability, ux, cost } = point.scores;
              const note = notes[artifact.id] ?? '';
              return (
                <article key={artifact.id} className={styles.card}>
                  <header className={styles.cardHeader}>
                    <div className={styles.cardName}>
                      <strong>{artifact.name}</strong>
                      <span className={styles.change} data-kind={change.kind}>
                        {change.text}
                      </span>
                    </div>
                    <span className={styles.cardScores} title="Feature capability · User experience · CU / token cost">
                      {formatScore(capability)} · {formatScore(ux)} · {formatScore(cost)}
                    </span>
                    <GradeBadge grade={point.grade} size="md" variant="pill" />
                  </header>
                  <p className={styles.breakdown}>
                    {breakdown.map((row) => `${row.name} ${row.scores.join(' · ')}`).join('   |   ')}
                  </p>
                  <textarea
                    className={styles.note}
                    rows={3}
                    value={note}
                    placeholder="Why this rating. Leave blank and use Draft with AI for a first pass."
                    aria-label={`Why this rating for ${artifact.name}`}
                    aria-invalid={note.trim().length > NOTE_MAX || undefined}
                    onChange={(event) => setNote(artifact.id, event.target.value)}
                  />
                  {note.trim().length > NOTE_MAX && (
                    <p className={styles.error} role="alert">
                      {NOTE_TOO_LONG}
                    </p>
                  )}
                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => {
                        if (note.trim() && !confirm('Replace the current text with an AI draft?')) return;
                        void draftOne(artifact.id);
                      }}
                      disabled={!review.aiEnabled || busy !== undefined}
                    >
                      {busy === artifact.id ? 'Drafting…' : note.trim() ? 'Redraft with AI' : 'Draft with AI'}
                    </button>
                    {draftErrors[artifact.id] && <span className={styles.error}>{draftErrors[artifact.id]}</span>}
                  </div>
                </article>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
```

- [ ] **Step 3: Add the tab.** In `src/admin/AdminPage.tsx`, add `import { ReviewTab } from './ReviewTab';` after the `NewRoundForm` import. Replace `TABS` with:

```tsx
const TABS = [
  { id: 'score', label: 'Score' },
  { id: 'review', label: 'Review & why' },
] as const;
```

After the Score tab block inside `<main>`, add:

```tsx
        {data && tab === 'review' && <ReviewTab rounds={data.rounds} catalog={data.catalog} users={data.users} />}
```

- [ ] **Step 4: Check it.** With the API and dev server running, open `http://localhost:5173/admin.html#review`.
1. Q4 2026 lists the items scored in Task 4 and Task 5, each with its change label ("First rating"), averaged scores, grade, and a breakdown naming Rater A and you.
2. Type a why in one item. The toolbar goes "Unsaved", then "Saving…", then "All notes saved". Reload: the text is still there.
3. Choose "Rater A" in "Edit a rater's card…", change one score, and click Save card. The review comes back with Rater A's new numbers in the breakdown. Log in at `/rate.html` as `rater-a`: their card shows the admin's change.
4. If `ANTHROPIC_API_KEY` is set in `api/local.settings.json`, Draft with AI fills a blank why. If not, the AI buttons are disabled with a tooltip.

- [ ] **Step 5: Commit.**

```powershell
npm run typecheck; npm test
git add src/admin
git commit -m "Admin Review tab: per-item review, autosaved whys, AI drafts, editing any rater's card"
```

---

### Task 7: Publish tab and site status

**Files:**
- Create: `src/admin/PublishTab.tsx`
- Modify: `src/admin/AdminPage.tsx`

- [ ] **Step 1: Create `src/admin/PublishTab.tsx`.**

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { AdminRound, DeployResult, PublishResult, RoundReview, SiteStatus } from '../domain/api-types';
import { api, errorMessage } from '../lib/api';
import { formatFullDate, formatTimestamp } from '../lib/format';
import { NewRoundForm } from './NewRoundForm';
import { localToday } from './rounds';
import styles from './Admin.module.css';

interface PublishTabProps {
  rounds: readonly AdminRound[];
  catalogSize: number;
  onRounds: (rounds: AdminRound[]) => void;
}

export function PublishTab({ rounds, catalogSize, onRounds }: PublishTabProps) {
  const open = rounds.find((round) => round.status === 'open');
  const published = rounds
    .filter((round) => round.status === 'published')
    .sort((a, b) => (b.publishedOn ?? '').localeCompare(a.publishedOn ?? '') || b.id.localeCompare(a.id));
  const [site, setSite] = useState<SiteStatus>();
  const [notice, setNotice] = useState<{ title: string; text: string }>();
  const [error, setError] = useState('');

  const loadSite = useCallback(() => {
    api<SiteStatus>('GET', '/admin/site').then(setSite, (reason: unknown) => setError(errorMessage(reason)));
  }, []);

  useEffect(loadSite, [loadSite]);

  const setStatus = async (round: AdminRound, body: Record<string, string>, title: string, text?: string) => {
    setError('');
    setNotice(undefined);
    try {
      const result = await api<PublishResult>('PUT', `/admin/rounds/${round.id}`, body);
      onRounds(result.rounds);
      setNotice({ title, text: text ?? result.deploy?.message ?? '' });
      loadSite();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const updateSite = async () => {
    setError('');
    setNotice(undefined);
    try {
      const result = await api<DeployResult>('POST', '/admin/site/update');
      setNotice({ title: 'Site update started', text: result.message });
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const reopen = (round: AdminRound) => {
    if (!confirm(`Reopen ${round.label}? Raters can change their cards again until you publish it again.`)) return;
    void setStatus(
      round,
      { status: 'open' },
      `${round.label} is open again`,
      `The public site keeps showing ${round.label} until the next site update.`,
    );
  };

  return (
    <div className={styles.publishTab}>
      {notice && (
        <section className={styles.panel} data-tone="success">
          <h2 className={styles.panelTitle}>{notice.title}</h2>
          {notice.text && <p>{notice.text}</p>}
        </section>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {open ? (
        <OpenRound
          key={open.id}
          round={open}
          catalogSize={catalogSize}
          onPublish={(publishedOn) =>
            setStatus(open, { status: 'published', publishedOn }, `${open.label} is published`)
          }
        />
      ) : (
        <NewRoundForm rounds={rounds} onCreated={onRounds} />
      )}

      {site && (
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>
            {site.behind ? 'The public site is behind' : 'The public site is up to date'}
          </h2>
          <p className={styles.muted}>
            {site.lastSnapshotAt
              ? `The live site shows the database as of ${formatTimestamp(site.lastSnapshotAt)}.`
              : 'No deploy has confirmed a build from the database yet.'}
            {site.lastSnapshotAt && site.behind && ' Published ratings, notes, or the catalog changed since then.'}
          </p>
          <div className={styles.fields}>
            {site.deployConfigured ? (
              <button
                type="button"
                className={site.behind ? styles.primary : styles.secondary}
                onClick={() => void updateSite()}
              >
                Update public site
              </button>
            ) : (
              <p className={styles.warn}>
                Automatic site updates are not set up. Set GITHUB_DISPATCH_TOKEN and GITHUB_REPO in the Function App
                settings.
              </p>
            )}
            <button type="button" className={styles.secondary} onClick={loadSite}>
              Check again
            </button>
          </div>
        </section>
      )}

      {published.length > 0 && (
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Published rounds</h2>
          <ul className={styles.roundList}>
            {published.map((round, index) => (
              <li key={round.id}>
                <span>
                  <strong>{round.label}</strong> · published {formatFullDate(round.publishedOn ?? '')} ·{' '}
                  {round.scorecards} {round.scorecards === 1 ? 'card' : 'cards'}
                </span>
                {index === 0 && !open && (
                  <button type="button" className={styles.secondary} onClick={() => reopen(round)}>
                    Reopen
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className={styles.hint}>
            To fix a published score or why without reopening, edit it on the Review tab. The change reaches the public
            site at the next update.
          </p>
        </section>
      )}
    </div>
  );
}

interface OpenRoundProps {
  round: AdminRound;
  catalogSize: number;
  onPublish: (publishedOn: string) => Promise<void>;
}

function OpenRound({ round, catalogSize, onPublish }: OpenRoundProps) {
  const [review, setReview] = useState<RoundReview>();
  const [error, setError] = useState('');
  const [date, setDate] = useState(localToday);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<RoundReview>('GET', `/admin/rounds/${round.id}/review`).then(setReview, (reason: unknown) =>
      setError(errorMessage(reason)),
    );
  }, [round.id]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!review) return <p className={styles.muted}>Checking {round.label}…</p>;

  const missing = review.items.filter((item) => !review.notes[item.artifact.id]?.trim());
  const { raters } = review;

  const publish = async () => {
    if (!confirm(`Publish ${round.label}, dated ${formatFullDate(date)}? Raters can no longer change their cards.`)) {
      return;
    }
    setBusy(true);
    await onPublish(date);
    setBusy(false);
  };

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>Publish {round.label}</h2>
      <ul className={styles.checklist}>
        <li data-ok={review.items.length > 0}>
          {review.items.length} of {catalogSize} items scored
        </li>
        <li data-ok={raters.length > 0}>
          {raters.length} {raters.length === 1 ? 'rater' : 'raters'}
          {raters.length > 0 && `: ${raters.map((rater) => rater.name).join(', ')}`}
        </li>
        <li data-ok={missing.length === 0}>
          {missing.length === 0
            ? 'Every scored item has a why'
            : `${missing.length} missing a why: ${missing.map((item) => item.artifact.name).join(', ')}`}
        </li>
      </ul>
      <p className={styles.muted}>Items nobody scored stay off the public site.</p>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Publication date</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        {missing.length > 0 && (
          <label className={styles.check}>
            <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
            Publish without them
          </label>
        )}
        <button
          type="button"
          className={styles.primary}
          disabled={busy || review.items.length === 0 || !date || (missing.length > 0 && !force)}
          onClick={() => void publish()}
        >
          Publish {round.label}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Add the tab.** In `src/admin/AdminPage.tsx`, add `import { PublishTab } from './PublishTab';` after the `NewRoundForm` import, add `{ id: 'publish', label: 'Publish' },` to `TABS` after the review entry, and add after the review line:

```tsx
        {data && tab === 'publish' && (
          <PublishTab rounds={data.rounds} catalogSize={data.catalog.artifacts.length} onRounds={setRounds} />
        )}
```

- [ ] **Step 3: Check it** (don't publish yet; Task 12 does that end to end). At `http://localhost:5173/admin.html#publish`:
1. The checklist shows the scored count, both raters, and which items still need a why.
2. Publish stays disabled while whys are missing, until you tick "Publish without them".
3. The site panel reads "The public site is up to date", with the "Automatic site updates are not set up" warning, since `GITHUB_DISPATCH_TOKEN` is empty locally. On `fcr-dev`, the smoke test of Plan 1's Task 12–13 fix confirmed a deploy with `POST /api/build/snapshot/deployed`; fetching the snapshot sets nothing. If public data changed since that confirm (a publish, a reopen, an edit to a published round, or a catalog edit), the panel reads "behind" instead, which is also correct.

- [ ] **Step 4: Commit.**

```powershell
npm run typecheck; npm test
git add src/admin
git commit -m "Admin Publish tab: checklist, publish and reopen, public-site status and update"
```

---

### Task 8: Catalog tab

**Files:**
- Create: `src/admin/catalog-order.ts`, `src/admin/catalog-order.test.ts`, `src/admin/CatalogTab.tsx`
- Modify: `src/admin/AdminPage.tsx`

- [ ] **Step 1: Write the failing test.** `src/admin/catalog-order.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { reorder, slugify } from './catalog-order';

describe('reorder', () => {
  const items = [
    { id: 'a', sortOrder: 10 },
    { id: 'b', sortOrder: 20 },
    { id: 'c', sortOrder: 30 },
  ];

  it('swaps neighbors with two writes', () => {
    expect(reorder(items, 2, 1)).toEqual([
      { item: items[2], sortOrder: 20 },
      { item: items[1], sortOrder: 30 },
    ]);
  });

  it('renumbers uneven orders and skips items already in place', () => {
    const uneven = [
      { id: 'a', sortOrder: 10 },
      { id: 'b', sortOrder: 10 },
      { id: 'c', sortOrder: 15 },
    ];
    expect(reorder(uneven, 0, 1).map(({ item, sortOrder }) => [item.id, sortOrder])).toEqual([
      ['a', 20],
      ['c', 30],
    ]);
  });

  it('ignores moves past either end', () => {
    expect(reorder(items, 0, -1)).toEqual([]);
    expect(reorder(items, 2, 3)).toEqual([]);
  });
});

describe('slugify', () => {
  it('makes lowercase dashed ids', () => {
    expect(slugify('Copy job (Preview)')).toBe('copy-job-preview');
    expect(slugify('  Real-Time Hub ')).toBe('real-time-hub');
  });
});
```

Run: `npx vitest run src/admin/catalog-order.test.ts`
Expected: FAIL, cannot resolve `./catalog-order`.

- [ ] **Step 2: Create `src/admin/catalog-order.ts`.**

```ts
/** New sort orders (10, 20, 30, ...) after moving the item at `from` to `to`. Unchanged items are left out. */
export function reorder<T extends { sortOrder: number }>(
  items: readonly T[],
  from: number,
  to: number,
): { item: T; sortOrder: number }[] {
  if (from === to || to < 0 || to >= items.length) return [];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (!moved) return [];
  next.splice(to, 0, moved);
  return next.flatMap((item, index) => {
    const sortOrder = (index + 1) * 10;
    return item.sortOrder === sortOrder ? [] : [{ item, sortOrder }];
  });
}

/** "Copy job (Preview)" -> "copy-job-preview" */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
```

Run: `npx vitest run src/admin/catalog-order.test.ts`
Expected: 4 tests pass.

- [ ] **Step 3: Create `src/admin/CatalogTab.tsx`.**

```tsx
import { useState, type FormEvent } from 'react';
import type { AdminArtifact, AdminCatalog, AdminWorkload } from '../domain/api-types';
import type { ReleaseStatus } from '../domain/types';
import { api, errorMessage } from '../lib/api';
import { reorder, slugify } from './catalog-order';
import styles from './Admin.module.css';

const STATUSES: { id: ReleaseStatus; label: string }[] = [
  { id: 'ga', label: 'GA' },
  { id: 'preview', label: 'Preview' },
  { id: 'retired', label: 'Retired' },
];

const SLUG_PATTERN = '[a-z0-9]+(-[a-z0-9]+)*';

/** Runs one or more catalog writes; the last response is the new catalog. Resolves false on failure. */
type Run = (action: () => Promise<AdminCatalog>) => Promise<boolean>;

function workloadBody(workload: AdminWorkload) {
  return { name: workload.name, shortName: workload.shortName, blurb: workload.blurb };
}

function artifactBody(artifact: AdminArtifact) {
  return { name: artifact.name, workload: artifact.workload, status: artifact.status };
}

interface CatalogTabProps {
  catalog: AdminCatalog;
  onCatalog: (catalog: AdminCatalog) => void;
}

export function CatalogTab({ catalog, onCatalog }: CatalogTabProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run: Run = async (action) => {
    setBusy(true);
    setError('');
    try {
      onCatalog(await action());
      return true;
    } catch (reason) {
      setError(errorMessage(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const moveWorkload = (from: number, to: number) =>
    run(async () => {
      let latest = catalog;
      for (const { item, sortOrder } of reorder(catalog.workloads, from, to)) {
        latest = await api<AdminCatalog>('PUT', `/admin/workloads/${item.id}`, { ...workloadBody(item), sortOrder });
      }
      return latest;
    });

  return (
    <div className={styles.stack}>
      <p className={styles.hint}>
        Raters see catalog changes right away; the public site gets them at the next site update. Items with scores or
        notes can't be deleted. Mark them retired instead.
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {catalog.workloads.map((workload, index) => (
        <WorkloadBlock
          key={workload.id}
          workload={workload}
          catalog={catalog}
          busy={busy}
          run={run}
          canMoveUp={index > 0}
          canMoveDown={index < catalog.workloads.length - 1}
          onMove={(step) => void moveWorkload(index, index + step)}
        />
      ))}
      <AddWorkloadForm busy={busy} run={run} />
    </div>
  );
}

interface MoveProps {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (step: number) => void;
}

interface WorkloadBlockProps extends MoveProps {
  workload: AdminWorkload;
  catalog: AdminCatalog;
  busy: boolean;
  run: Run;
}

function WorkloadBlock({ workload, catalog, busy, run, canMoveUp, canMoveDown, onMove }: WorkloadBlockProps) {
  const [fields, setFields] = useState(() => workloadBody(workload));
  const items = catalog.artifacts.filter((artifact) => artifact.workload === workload.id);
  const changed =
    fields.name !== workload.name || fields.shortName !== workload.shortName || fields.blurb !== workload.blurb;

  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(() =>
      api<AdminCatalog>('PUT', `/admin/workloads/${workload.id}`, { ...fields, sortOrder: workload.sortOrder }),
    );
  };

  const moveItem = (from: number, to: number) =>
    run(async () => {
      let latest = catalog;
      for (const { item, sortOrder } of reorder(items, from, to)) {
        latest = await api<AdminCatalog>('PUT', `/admin/artifacts/${item.id}`, { ...artifactBody(item), sortOrder });
      }
      return latest;
    });

  return (
    <section className={styles.panel}>
      <form className={styles.workloadForm} onSubmit={save}>
        <label className={styles.field}>
          <span>Workload</span>
          <input
            value={fields.name}
            onChange={(event) => setFields({ ...fields, name: event.target.value })}
            maxLength={100}
            required
          />
        </label>
        <label className={styles.field}>
          <span>Short name</span>
          <input
            value={fields.shortName}
            onChange={(event) => setFields({ ...fields, shortName: event.target.value })}
            maxLength={30}
            required
          />
        </label>
        <label className={`${styles.field} ${styles.grow}`}>
          <span>Description</span>
          <input
            value={fields.blurb}
            onChange={(event) => setFields({ ...fields, blurb: event.target.value })}
            maxLength={300}
            required
          />
        </label>
        <div className={styles.rowActions}>
          {changed && (
            <button type="submit" className={styles.primary} disabled={busy}>
              Save
            </button>
          )}
          <MoveButtons
            name={workload.name}
            busy={busy}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMove={onMove}
          />
        </div>
      </form>
      {items.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Item</th>
              <th>Id</th>
              <th>Status</th>
              <th>Workload</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((artifact, index) => (
              <ArtifactRowEditor
                key={artifact.id}
                artifact={artifact}
                workloads={catalog.workloads}
                busy={busy}
                run={run}
                canMoveUp={index > 0}
                canMoveDown={index < items.length - 1}
                onMove={(step) => void moveItem(index, index + step)}
              />
            ))}
          </tbody>
        </table>
      )}
      <AddArtifactForm workloadId={workload.id} busy={busy} run={run} />
    </section>
  );
}

function MoveButtons({ name, busy, canMoveUp, canMoveDown, onMove }: MoveProps & { name: string; busy: boolean }) {
  return (
    <>
      <button
        type="button"
        className={styles.small}
        onClick={() => onMove(-1)}
        disabled={busy || !canMoveUp}
        aria-label={`Move ${name} up`}
      >
        ↑
      </button>
      <button
        type="button"
        className={styles.small}
        onClick={() => onMove(1)}
        disabled={busy || !canMoveDown}
        aria-label={`Move ${name} down`}
      >
        ↓
      </button>
    </>
  );
}

interface ArtifactRowEditorProps extends MoveProps {
  artifact: AdminArtifact;
  workloads: readonly AdminWorkload[];
  busy: boolean;
  run: Run;
}

function ArtifactRowEditor({ artifact, workloads, busy, run, canMoveUp, canMoveDown, onMove }: ArtifactRowEditorProps) {
  const [name, setName] = useState(artifact.name);

  const update = (changes: Partial<ReturnType<typeof artifactBody>>) =>
    void run(() =>
      api<AdminCatalog>('PUT', `/admin/artifacts/${artifact.id}`, {
        ...artifactBody(artifact),
        ...changes,
        sortOrder: artifact.sortOrder,
      }),
    );

  const remove = () => {
    if (confirm(`Delete ${artifact.name}? This cannot be undone.`)) {
      void run(() => api<AdminCatalog>('DELETE', `/admin/artifacts/${artifact.id}`));
    }
  };

  return (
    <tr>
      <td>
        <form
          className={styles.inline}
          onSubmit={(event) => {
            event.preventDefault();
            update({ name: name.trim() });
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label={`Name of ${artifact.name}`}
            maxLength={100}
            required
          />
          {name.trim() !== artifact.name && (
            <button type="submit" className={styles.small} disabled={busy}>
              Save
            </button>
          )}
        </form>
      </td>
      <td className={styles.code}>{artifact.id}</td>
      <td>
        <select
          value={artifact.status}
          onChange={(event) => update({ status: event.target.value as ReleaseStatus })}
          disabled={busy}
          aria-label={`Status of ${artifact.name}`}
        >
          {STATUSES.map((status) => (
            <option key={status.id} value={status.id}>
              {status.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          value={artifact.workload}
          onChange={(event) => update({ workload: event.target.value })}
          disabled={busy}
          aria-label={`Workload of ${artifact.name}`}
        >
          {workloads.map((workload) => (
            <option key={workload.id} value={workload.id}>
              {workload.shortName}
            </option>
          ))}
        </select>
      </td>
      <td>
        <div className={styles.rowActions}>
          <MoveButtons
            name={artifact.name}
            busy={busy}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMove={onMove}
          />
          <button
            type="button"
            className={styles.small}
            onClick={remove}
            disabled={busy || artifact.referenced}
            title={artifact.referenced ? 'Has scores or notes. Mark it retired instead.' : undefined}
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

function AddArtifactForm({ workloadId, busy, run }: { workloadId: string; busy: boolean; run: Run }) {
  const [name, setName] = useState('');
  const [id, setId] = useState<string>();
  const [status, setStatus] = useState<ReleaseStatus>('ga');
  const slug = id ?? slugify(name);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await run(() =>
      api<AdminCatalog>('POST', '/admin/artifacts', { id: slug, name: name.trim(), workload: workloadId, status }),
    );
    if (ok) {
      setName('');
      setId(undefined);
      setStatus('ga');
    }
  };

  return (
    <form className={styles.fields} onSubmit={submit}>
      <label className={styles.field}>
        <span>New item</span>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required />
      </label>
      <label className={styles.field}>
        <span>Id</span>
        <input
          value={slug}
          onChange={(event) => setId(event.target.value)}
          pattern={SLUG_PATTERN}
          maxLength={64}
          required
        />
      </label>
      <label className={styles.field}>
        <span>Status</span>
        <select value={status} onChange={(event) => setStatus(event.target.value as ReleaseStatus)}>
          {STATUSES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={styles.secondary} disabled={busy}>
        Add item
      </button>
    </form>
  );
}

function AddWorkloadForm({ busy, run }: { busy: boolean; run: Run }) {
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [blurb, setBlurb] = useState('');
  const [id, setId] = useState<string>();
  const slug = id ?? slugify(name);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await run(() =>
      api<AdminCatalog>('POST', '/admin/workloads', {
        id: slug,
        name: name.trim(),
        shortName: shortName.trim(),
        blurb: blurb.trim(),
      }),
    );
    if (ok) {
      setName('');
      setShortName('');
      setBlurb('');
      setId(undefined);
    }
  };

  return (
    <form className={styles.panel} onSubmit={submit}>
      <h2 className={styles.panelTitle}>Add a workload</h2>
      <div className={styles.workloadForm}>
        <label className={styles.field}>
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required />
        </label>
        <label className={styles.field}>
          <span>Short name</span>
          <input value={shortName} onChange={(event) => setShortName(event.target.value)} maxLength={30} required />
        </label>
        <label className={`${styles.field} ${styles.grow}`}>
          <span>Description</span>
          <input value={blurb} onChange={(event) => setBlurb(event.target.value)} maxLength={300} required />
        </label>
        <label className={styles.field}>
          <span>Id</span>
          <input
            value={slug}
            onChange={(event) => setId(event.target.value)}
            pattern={SLUG_PATTERN}
            maxLength={64}
            required
          />
        </label>
        <button type="submit" className={styles.secondary} disabled={busy}>
          Add workload
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Add the tab.** In `src/admin/AdminPage.tsx`, add `import { CatalogTab } from './CatalogTab';` before the `NewRoundForm` import, add `{ id: 'catalog', label: 'Catalog' },` to `TABS` after the publish entry, add below `setRounds`:

```tsx
  const setCatalog = useCallback(
    (catalog: AdminCatalog) => setData((current) => current && { ...current, catalog }),
    [],
  );
```

and add after the publish line:

```tsx
        {data && tab === 'catalog' && <CatalogTab catalog={data.catalog} onCatalog={setCatalog} />}
```

- [ ] **Step 5: Check it.** At `http://localhost:5173/admin.html#catalog`:
1. Add an item "Test item" to the first workload. The id fills in as `test-item`, and the row appears at the bottom of that workload.
2. Rename it, set it to Preview, and move it up. Each change sticks after a reload.
3. Delete it: it disappears. The Delete button on an item you scored in Task 4 is disabled, with the tooltip "Has scores or notes".
4. `/rate.html` (as `rater-a`) shows catalog changes after a reload.

- [ ] **Step 6: Commit.**

```powershell
npm run typecheck; npm test
git add src/admin
git commit -m "Admin Catalog tab: edit, reorder, move, retire, add, and delete workloads and items"
```

---

### Task 9: Users tab

**Files:**
- Create: `src/admin/password.ts`, `src/admin/password.test.ts`, `src/admin/UsersTab.tsx`
- Modify: `src/admin/AdminPage.tsx`

- [ ] **Step 1: Write the failing test.** `src/admin/password.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { generatePassword } from './password';

describe('generatePassword', () => {
  it('makes 16 characters without look-alikes', () => {
    expect(generatePassword()).toMatch(/^[a-hjkmnp-zA-HJ-NP-Z2-9]{16}$/);
  });

  it('differs between calls', () => {
    expect(generatePassword()).not.toBe(generatePassword());
  });
});
```

Run: `npx vitest run src/admin/password.test.ts`
Expected: FAIL, cannot resolve `./password`.

- [ ] **Step 2: Create `src/admin/password.ts`.**

```ts
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A random password the admin can read out or paste: no 0, O, 1, l, or I. */
export function generatePassword(length = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ALPHABET.charAt(byte % ALPHABET.length)).join('');
}
```

Run: `npx vitest run src/admin/password.test.ts`
Expected: 2 tests pass.

- [ ] **Step 3: Create `src/admin/UsersTab.tsx`.** Admin-set passwords are shown in clear text, because the admin has to hand them over.

```tsx
import { useState, type FormEvent } from 'react';
import type { AdminUser, Role, SessionUser } from '../domain/api-types';
import { api, errorMessage } from '../lib/api';
import { generatePassword } from './password';
import styles from './Admin.module.css';

type Editing = { id: number; kind: 'details' | 'password' };
type Save = (changes: Record<string, unknown>, done: string) => Promise<boolean>;

interface UsersTabProps {
  users: readonly AdminUser[];
  me: SessionUser;
  onUsers: (users: AdminUser[]) => void;
}

export function UsersTab({ users, me, onUsers }: UsersTabProps) {
  const [editing, setEditing] = useState<Editing>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const run = async (action: () => Promise<AdminUser[]>, done: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      onUsers(await action());
      setEditing(undefined);
      setNotice(done);
      return true;
    } catch (reason) {
      setError(errorMessage(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = (user: AdminUser) => {
    if (
      user.active &&
      !confirm(`Disable ${user.displayName}? They are logged out everywhere and can't log in until you enable them.`)
    ) {
      return;
    }
    void run(
      () => api<AdminUser[]>('PUT', `/admin/users/${user.id}`, { active: !user.active }),
      `${user.displayName} is ${user.active ? 'disabled' : 'enabled'}.`,
    );
  };

  return (
    <div className={styles.stack}>
      {notice && (
        <p className={styles.panel} data-tone="success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Raters and admins</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Login</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last scored</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) =>
              editing?.id === user.id ? (
                <EditUserRow
                  key={user.id}
                  user={user}
                  kind={editing.kind}
                  busy={busy}
                  onCancel={() => setEditing(undefined)}
                  onSave={(changes, done) =>
                    run(() => api<AdminUser[]>('PUT', `/admin/users/${user.id}`, changes), done)
                  }
                />
              ) : (
                <tr key={user.id} data-inactive={!user.active}>
                  <td>
                    {user.displayName}
                    {user.id === me.id && <span className={styles.badge}>you</span>}
                  </td>
                  <td className={styles.code}>{user.login}</td>
                  <td>{user.role === 'admin' ? 'Admin' : 'Rater'}</td>
                  <td>{user.active ? 'Active' : 'Disabled'}</td>
                  <td>{user.lastScoredRound ?? '—'}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.small}
                        disabled={busy}
                        onClick={() => setEditing({ id: user.id, kind: 'details' })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={styles.small}
                        disabled={busy}
                        onClick={() => setEditing({ id: user.id, kind: 'password' })}
                      >
                        Set password
                      </button>
                      <button type="button" className={styles.small} disabled={busy} onClick={() => toggleActive(user)}>
                        {user.active ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </section>
      <CreateUserForm
        busy={busy}
        onCreate={(body, done) => run(() => api<AdminUser[]>('POST', '/admin/users', body), done)}
      />
    </div>
  );
}

interface EditUserRowProps {
  user: AdminUser;
  kind: Editing['kind'];
  busy: boolean;
  onCancel: () => void;
  onSave: Save;
}

function EditUserRow({ user, kind, busy, onCancel, onSave }: EditUserRowProps) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<Role>(user.role);
  const [password, setPassword] = useState(generatePassword);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (kind === 'password') {
      void onSave(
        { password },
        `New password for ${user.displayName}: ${password}. Share it privately. Their other sessions were ended, and they can change it after logging in.`,
      );
    } else {
      void onSave({ displayName: displayName.trim(), role }, `${displayName.trim()} is saved.`);
    }
  };

  return (
    <tr>
      <td colSpan={6}>
        <form className={styles.fields} onSubmit={submit}>
          {kind === 'details' ? (
            <>
              <label className={styles.field}>
                <span>Name</span>
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} required />
              </label>
              <label className={styles.field}>
                <span>Role</span>
                <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
                  <option value="rater">Rater</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
            </>
          ) : (
            <>
              <label className={styles.field}>
                <span>New password for {user.displayName}</span>
                <input
                  className={styles.code}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={10}
                  maxLength={200}
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>
              <button type="button" className={styles.secondary} onClick={() => setPassword(generatePassword())}>
                Generate another
              </button>
            </>
          )}
          <button type="submit" className={styles.primary} disabled={busy}>
            Save
          </button>
          <button type="button" className={styles.secondary} onClick={onCancel}>
            Cancel
          </button>
        </form>
      </td>
    </tr>
  );
}

function CreateUserForm({ busy, onCreate }: { busy: boolean; onCreate: Save }) {
  const [login, setLogin] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('rater');
  const [password, setPassword] = useState(generatePassword);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = displayName.trim();
    const loginName = login.trim().toLowerCase();
    const ok = await onCreate(
      { login: loginName, displayName: name, role, password },
      `${name} can log in at /rate as ${loginName} with the password ${password}. Share it privately; they can change it after logging in.`,
    );
    if (ok) {
      setLogin('');
      setDisplayName('');
      setRole('rater');
      setPassword(generatePassword());
    }
  };

  return (
    <form className={styles.panel} onSubmit={submit}>
      <h2 className={styles.panelTitle}>Add a rater or admin</h2>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Login</span>
          <input
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{1,39}"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </label>
        <label className={styles.field}>
          <span>Name</span>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} required />
        </label>
        <label className={styles.field}>
          <span>Role</span>
          <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
            <option value="rater">Rater</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Password</span>
          <input
            className={styles.code}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={10}
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
        <button type="button" className={styles.secondary} onClick={() => setPassword(generatePassword())}>
          Generate another
        </button>
        <button type="submit" className={styles.primary} disabled={busy}>
          Add user
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Add the tab.** In `src/admin/AdminPage.tsx`, add `import { UsersTab } from './UsersTab';` after the `ReviewTab` import, add `{ id: 'users', label: 'Users' },` to `TABS` after the catalog entry, add below `setCatalog`:

```tsx
  const setUsers = useCallback((users: AdminUser[]) => setData((current) => current && { ...current, users }), []);
```

and add after the catalog line:

```tsx
        {data && tab === 'users' && <UsersTab users={data.users} me={user} onUsers={setUsers} />}
```

- [ ] **Step 5: Check it.** At `http://localhost:5173/admin.html#users`:
1. The table lists you (with a "you" badge) and Rater A.
2. Add `rater-b` (Rater B). The notice shows the login and the generated password. Log in as `rater-b` in a private window at `/rate.html`.
3. Set a new password for Rater B. Their private window's next action shows the login form with "Your session ended…". The new password works.
4. Try to make yourself a rater, or disable yourself. The API refuses with its message, shown in red.
5. Disable Rater B: their row greys out, and logging in as `rater-b` fails. Enable them again.

- [ ] **Step 6: Commit.**

```powershell
npm run typecheck; npm test
git add src/admin
git commit -m "Admin Users tab: create, rename, change role, set password, disable and enable"
```

---

### Task 10: Public site on `snapshot.json`

**Files:**
- Create: `src/data/snapshot.json`, `scripts/snapshot.ts`
- Modify: `src/data/index.ts` (rewrite), `src/App.tsx` (rewrite), `src/App.module.css`, `src/components/SiteHeader.tsx`, `src/components/WorkloadSection.tsx`, `src/components/ArtifactRow.tsx`, `src/components/ArtifactRow.module.css`, `src/components/SiteFooter.tsx` (rewrite), `package.json`

- [ ] **Step 1: Create the empty snapshot.** `src/data/snapshot.json`:

```json
{
  "generatedAt": "",
  "asOf": "",
  "workloads": [],
  "ratings": []
}
```

- [ ] **Step 2: Rewrite `src/data/index.ts`.**

```ts
import type { Snapshot } from '../domain/api-types';
import type { FactorValues, Rating, Workload, WorkloadId } from '../domain/types';

const EMPTY: Snapshot = { generatedAt: '', asOf: '', workloads: [], ratings: [] };

// Typed through the glob so TypeScript never infers a type from the (large) JSON file.
const files = import.meta.glob<Snapshot>('./snapshot.json', { eager: true, import: 'default' });

/** Published rounds only. `npm run snapshot` refreshes it from the API; the deploy workflow runs that first. */
const SNAPSHOT = files['./snapshot.json'] ?? EMPTY;

export function getRatings(): Rating[] {
  return SNAPSHOT.ratings;
}

/** Workloads with at least one published rating. */
export function getWorkloads(): readonly Workload[] {
  return SNAPSHOT.workloads;
}

export function groupByWorkload<T>(items: readonly T[], workloadOf: (item: T) => WorkloadId): Map<WorkloadId, T[]> {
  const groups = new Map<WorkloadId, T[]>(SNAPSHOT.workloads.map((workload) => [workload.id, []]));
  for (const item of items) groups.get(workloadOf(item))?.push(item);
  return groups;
}

/** Publication date of the newest published round, or '' before the first one. */
export function asOfDate(): string {
  return SNAPSHOT.asOf;
}

/** Published averages per item id, used to prefill score sliders. */
export function currentValues(): Record<string, FactorValues> {
  return Object.fromEntries(SNAPSHOT.ratings.map((rating) => [rating.artifact.id, rating.current.scores]));
}
```

- [ ] **Step 3: Rewrite `src/App.tsx`.** Unrated rows, the open-round lookup, and the unrated hash target go away, and an empty state covers the time before the first publish.

```tsx
import { useCallback, useEffect } from 'react';
import { HowItWorks } from './components/HowItWorks';
import { SiteFooter } from './components/SiteFooter';
import { SiteHeader } from './components/SiteHeader';
import { SiteNav, type NavItem } from './components/SiteNav';
import { WorkloadSection } from './components/WorkloadSection';
import { asOfDate, getRatings, getWorkloads, groupByWorkload } from './data';
import { useAccordionState } from './hooks/useAccordionState';
import { useActiveSection } from './hooks/useActiveSection';
import styles from './App.module.css';

const RATINGS = getRatings();
const WORKLOADS = getWorkloads();
const GROUPS = groupByWorkload(RATINGS, (r) => r.artifact.workload);
const AS_OF = asOfDate();
const WORKLOAD_IDS = WORKLOADS.map((w) => w.id);
const NAV_ITEMS: NavItem[] = [
  ...WORKLOADS.map((w) => ({ id: w.id, label: w.shortName })),
  { id: 'how-it-works', label: 'How It Works' },
];
const NAV_IDS = NAV_ITEMS.map((item) => item.id);
const NAV_OFFSET = 140;

function scrollToId(id: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    history.replaceState(null, '', id === 'top' ? location.pathname : `#${id}`);
  });
}

export function App() {
  const accordion = useAccordionState();
  const active = useActiveSection(NAV_IDS, NAV_OFFSET);
  const { openSection, openRow } = accordion;

  const navigate = useCallback(
    (id: string) => {
      if (WORKLOAD_IDS.includes(id)) openSection(id);
      scrollToId(id);
    },
    [openSection],
  );

  useEffect(() => {
    const applyHash = () => {
      const hash = decodeURIComponent(location.hash.slice(1));
      if (!hash) return;
      const rating = RATINGS.find((r) => `item-${r.artifact.id}` === hash);
      if (rating) {
        openRow(rating.artifact.workload, rating.artifact.id);
        scrollToId(hash);
      } else if (NAV_IDS.includes(hash)) {
        navigate(hash);
      }
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, [navigate, openRow]);

  return (
    <>
      <a className={styles.skipLink} href="#ratings">
        Skip to ratings
      </a>
      <SiteNav items={NAV_ITEMS} active={active} onNavigate={navigate} />
      <SiteHeader ratings={RATINGS} asOf={AS_OF} />

      <main id="ratings" className={styles.main}>
        {WORKLOADS.length === 0 ? (
          <p className={styles.empty}>
            No ratings are published yet. The first review round is being scored now; check back once it is published.
          </p>
        ) : (
          <>
            <div className={styles.toolbar}>
              <div>
                <h2 className={styles.toolbarTitle}>Ratings by workload</h2>
                <p className={styles.toolbarHint}>Open a workload, then an item, to see why it earned its rating.</p>
              </div>
              <div className={styles.controls}>
                <button type="button" className={styles.control} onClick={() => accordion.expandAll(WORKLOAD_IDS)}>
                  Expand all
                </button>
                <button type="button" className={styles.control} onClick={accordion.collapseAll}>
                  Collapse all
                </button>
              </div>
            </div>

            <div className={styles.sections}>
              {WORKLOADS.map((workload) => (
                <WorkloadSection
                  key={workload.id}
                  workload={workload}
                  ratings={GROUPS.get(workload.id) ?? []}
                  open={accordion.isSectionOpen(workload.id)}
                  openRowId={accordion.openRowIn(workload.id)}
                  asOf={AS_OF}
                  onToggle={() => accordion.toggleSection(workload.id)}
                  onToggleRow={(rowId) => accordion.toggleRow(workload.id, rowId)}
                  onCloseRow={() => accordion.closeRow(workload.id)}
                />
              ))}
            </div>
          </>
        )}

        <HowItWorks />
      </main>

      <SiteFooter asOf={AS_OF} />
    </>
  );
}
```

Append to `src/App.module.css`:

```css
.empty {
  padding: 28px 24px;
  border: 1px dashed var(--rule-strong);
  border-radius: var(--radius-lg);
  background: var(--white);
  color: var(--ink-muted);
  text-align: center;
}
```

- [ ] **Step 4: "Items rated" without a denominator.** In `src/components/SiteHeader.tsx`, delete `itemCount: number;` from the props, change the signature to `export function SiteHeader({ ratings, asOf }: SiteHeaderProps) {`, and replace:

```tsx
            <dd>
              {ratings.length}
              <span className={styles.statSub}> of {itemCount}</span>
            </dd>
```

with:

```tsx
            <dd>{ratings.length}</dd>
```

- [ ] **Step 5: No unrated rows.** In `src/components/WorkloadSection.tsx`:
- Change the imports to `import type { Rating, Workload } from '../domain/types';` and `import { ArtifactRow } from './ArtifactRow';`.
- Delete `unrated: Artifact[];` from the props and `unrated,` from the destructuring.
- Change `const itemCount = sorted.length + unrated.length;` to `const itemCount = sorted.length;`.
- Delete the block:

```tsx
            {sorted.length > 0 && unrated.length > 0 && (
              <span className={styles.summaryText}>{unrated.length} not rated</span>
            )}
```

- Delete the block:

```tsx
          {unrated.map((artifact) => (
            <li key={artifact.id}>
              <UnratedRow artifact={artifact} />
            </li>
          ))}
```

In `src/components/ArtifactRow.tsx`, delete the whole `UnratedRow` function (the `export function UnratedRow` block). In `src/components/ArtifactRow.module.css`, delete the rules `.trigger[data-static='true']`, `.row[data-unrated='true']`, `.row[data-unrated='true'] .name`, `.notRated`, `.notRatedGrade`, `.notRatedLabel`, and `.chevronSpacer`.

- [ ] **Step 6: Rewrite `src/components/SiteFooter.tsx`.**

```tsx
import { formatFullDate } from '../lib/format';
import styles from './SiteFooter.module.css';

interface SiteFooterProps {
  asOf: string;
}

export function SiteFooter({ asOf }: SiteFooterProps) {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p className={styles.brand}>Microsoft Fabric Credit Ratings</p>
        {asOf && <p>Ratings as of {formatFullDate(asOf)}.</p>}
        <p>
          Raters: <a href="/rate">log in</a> to score the open round.
        </p>
        <p className={styles.fine}>
          Independent and unofficial. Not affiliated with or endorsed by Microsoft. Microsoft Fabric is a trademark of
          Microsoft Corporation.
        </p>
      </div>
    </footer>
  );
}
```

- [ ] **Step 7: Create `scripts/snapshot.ts`.** Local runs read the token from `api/local.settings.json`; the deploy workflow passes `FCR_API_URL` and `SNAPSHOT_TOKEN`. A failure keeps the committed file, so a sleeping API never breaks a deploy.

The script also tells the deploy which snapshot it fetched. Its timeout is 200 seconds: the GET waits up to about 150 s for a paused database, plus the load, and Functions cut a request off at 230 s.
- After a successful fetch, whether it wrote the file or found it unchanged, append `generatedAt=<value>` to `$GITHUB_OUTPUT` when that variable is set.
- The value is the response's `generatedAt` string, byte for byte. It's not the committed file's, which is older when the write was skipped, so the admin page would stay behind. It's not a new `Date` either, which would mark changes made during the build as live.
- On any failure, write nothing to `$GITHUB_OUTPUT`.
- A 503 gets one retry. The database may still be waking, or the GET's clock read waited past mssql's 30 s request timeout behind a write transaction that stalled after stamping `changed_at`.
- With `--confirm` (local runs), after a successful fetch, POST `{ generatedAt }` to `/api/build/snapshot/deployed` with the token and `Content-Type: application/json`. Expect 204. Vite serves the written file at once, so locally the fetch is the deploy. A failed confirm is a warning, like a failed fetch.

Fetching the snapshot never marks the public site up to date. Only `POST /api/build/snapshot/deployed` moves `last_snapshot_at`: the deploy workflow's confirm step (Task 11), or `npm run snapshot -- --confirm` locally.

```ts
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = new URL('../src/data/snapshot.json', import.meta.url);
const SETTINGS = new URL('../api/local.settings.json', import.meta.url);

/** The GET can wait about 150 s for a paused database; Functions cut a request off at 230 s. */
const TIMEOUT_MS = 200_000;

interface SnapshotShape {
  generatedAt: string;
  asOf: string;
  workloads: unknown[];
  ratings: unknown[];
}

function localToken(): string {
  if (!existsSync(SETTINGS)) return '';
  const settings = JSON.parse(readFileSync(SETTINGS, 'utf8')) as { Values?: Record<string, string> };
  return settings.Values?.SNAPSHOT_TOKEN ?? '';
}

function isSnapshot(value: unknown): value is SnapshotShape {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.generatedAt === 'string' &&
    typeof record.asOf === 'string' &&
    Array.isArray(record.workloads) &&
    Array.isArray(record.ratings)
  );
}

function sameContent(a: SnapshotShape, b: SnapshotShape): boolean {
  return JSON.stringify({ ...a, generatedAt: '' }) === JSON.stringify({ ...b, generatedAt: '' });
}

async function refresh(base: string, token: string): Promise<{ message: string; generatedAt: string }> {
  const get = () =>
    fetch(`${base}/api/build/snapshot`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  let response = await get();
  if (response.status === 503) {
    // A database still waking, or a clock read that timed out behind a stalled write, answers 503.
    await response.body?.cancel();
    response = await get();
  }
  if (!response.ok) throw new Error(`${base} answered HTTP ${response.status}.`);
  const snapshot: unknown = await response.json();
  if (!isSnapshot(snapshot)) throw new Error('The response is not a snapshot.');
  const { generatedAt } = snapshot;
  const current: unknown = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : undefined;
  if (isSnapshot(current) && sameContent(current, snapshot)) return { message: 'Snapshot unchanged.', generatedAt };
  writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);
  const asOf = snapshot.asOf || 'no published round';
  return {
    message: `Wrote ${snapshot.ratings.length} ratings (as of ${asOf}) to src/data/snapshot.json.`,
    generatedAt,
  };
}

async function confirm(base: string, token: string, generatedAt: string): Promise<void> {
  const response = await fetch(`${base}/api/build/snapshot/deployed`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ generatedAt }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status !== 204) throw new Error(`${base} answered the confirmation with HTTP ${response.status}.`);
}

const warn = (message: string) => console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message);
const base = (process.env.FCR_API_URL || 'http://localhost:7071').replace(/\/+$/, '');
const token = process.env.SNAPSHOT_TOKEN || localToken();

let fetched: { message: string; generatedAt: string } | undefined;
try {
  fetched = await refresh(base, token);
  console.log(fetched.message);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `generatedAt=${fetched.generatedAt}\n`);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  warn(`Snapshot not refreshed: ${reason} Keeping the committed src/data/snapshot.json.`);
}
if (fetched && process.argv.includes('--confirm')) {
  try {
    await confirm(base, token, fetched.generatedAt);
    console.log(`Confirmed the snapshot of ${fetched.generatedAt}.`);
  } catch (error) {
    warn(`Snapshot not confirmed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
```

Add to the root `package.json` `scripts`, after `"db:seed"`:

```json
    "snapshot": "node scripts/snapshot.ts"
```

- [ ] **Step 8: Verify.**

Run: `rg -n "from '.*(aggregate|formula)" src --glob "!src/domain/**"`
Expected: no output. The front end no longer imports the grade math.

Run: `npm run build`
Expected: typecheck and build succeed.

With `npm run api` running, run `npm run snapshot`.
Expected: `Snapshot unchanged.` (nothing is published in `fcr-dev` yet). Run `npm run snapshot -- --confirm`. Expected: the same line, and it also prints `Confirmed the snapshot of <time>.` Stop the API and run `npm run snapshot` again. Expected: `Snapshot not refreshed: fetch failed … Keeping the committed src/data/snapshot.json.`, with exit code 0.

Open `http://localhost:5173/`. Expected: the header shows "Items rated 0", the main area shows the "No ratings are published yet" empty state, the nav has only "How It Works", and the footer says "Raters: log in to score the open round."

- [ ] **Step 9: Commit.**

```powershell
npm test
git add src/data src/App.tsx src/App.module.css src/components scripts/snapshot.ts package.json
git commit -m "Public site reads the published snapshot; unrated items no longer appear"
```

---

### Task 11: Deploy workflow fetches the snapshot

**Files:**
- Modify: `.github/workflows/deploy.yml` (rewrite)

- [ ] **Step 1: Rewrite `.github/workflows/deploy.yml`.** Before Plan 3 sets the `API_URL` variable, the fetch step is skipped and the committed snapshot is used. A commit pushed with `GITHUB_TOKEN` doesn't start another run.

One job, so re-running a failed deploy fetches the snapshot again instead of redeploying an older run's artifact. With two jobs, "Re-run failed jobs" on an older run would put its older data back on Pages, and the forward-only stamp would keep saying "up to date". After `deploy-pages` succeeds, the last step tells the API which snapshot is live. It warns rather than fails if the API doesn't answer, because the site is already live, and the admin page just shows it as behind until the next deploy. It's skipped when the fetch was skipped or failed, since the site then still shows the committed file. `--retry 2` covers the API's 503 while the database wakes. `jq` and `curl` come with `ubuntu-latest`.

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - run: npm ci

      - name: Fetch the published ratings
        id: snapshot
        if: ${{ vars.API_URL != '' }}
        env:
          FCR_API_URL: ${{ vars.API_URL }}
          SNAPSHOT_TOKEN: ${{ secrets.SNAPSHOT_TOKEN }}
        run: npm run snapshot

      - name: Commit the snapshot if it changed
        run: |
          if git diff --quiet -- src/data/snapshot.json; then exit 0; fi
          git config user.name 'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
          git add src/data/snapshot.json
          git commit -m "Snapshot $(node -p "require('./src/data/snapshot.json').asOf || 'empty'")"
          for attempt in 1 2 3; do
            if git pull --rebase origin "$GITHUB_REF_NAME" && git push origin "HEAD:$GITHUB_REF_NAME"; then exit 0; fi
            sleep 5
          done
          echo "::warning::Could not push the snapshot commit. This deploy still uses it."

      - run: npm run build

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

      - id: deployment
        uses: actions/deploy-pages@v4

      - name: Tell the API which snapshot is live
        if: ${{ steps.snapshot.outputs.generatedAt != '' }}
        env:
          FCR_API_URL: ${{ vars.API_URL }}
          SNAPSHOT_TOKEN: ${{ secrets.SNAPSHOT_TOKEN }}
          GENERATED_AT: ${{ steps.snapshot.outputs.generatedAt }}
        run: |
          body=$(jq -cn --arg at "$GENERATED_AT" '{generatedAt: $at}')
          if ! curl -sS --fail-with-body --max-time 200 --retry 2 -X POST \
              "${FCR_API_URL%/}/api/build/snapshot/deployed" \
              -H "Authorization: Bearer $SNAPSHOT_TOKEN" -H 'Content-Type: application/json' --data "$body"; then
            echo "::warning::The site is live, but the API wasn't told. The admin page shows it as behind until the next deploy."
          fi
```

- [ ] **Step 2: Check the commit step's shell logic locally** (Git Bash or WSL):

```bash
git diff --quiet -- src/data/snapshot.json; echo "unchanged=$?"
```

Expected: `unchanged=0` on a clean tree. Plan 3 runs the workflow for real once `API_URL` and `SNAPSHOT_TOKEN` exist.

- [ ] **Step 3: Commit.**

```powershell
git add .github/workflows/deploy.yml
git commit -m "Deploy workflow: refresh the snapshot from the API and commit it before building"
```

---

### Task 12: End-to-end check against `fcr-dev`

This exercises the whole flow on the dev database: scoring, review, publish, a silent edit, the next round, and session expiry. It ends with `fcr-dev` holding an open round again, which the Plan 1 integration test needs.

**Files:** none committed (the dev snapshot is thrown away in Step 9)

- [ ] **Step 1: Start both servers.** Run `npm run api` and `npm run dev`. Use one browser for the admin and a private window for `rater-a`.

- [ ] **Step 2: Score.** In the private window, log in at `/rate.html` as `rater-a` and save at least three items. As admin, save the same items plus one more on the Score tab.

- [ ] **Step 3: Review.** On `#review` for Q4 2026, each scored item shows both raters in its breakdown, except the admin-only item. Write a why for every item and wait for "All notes saved".

- [ ] **Step 4: Publish.** On `#publish`, the checklist is all green. Publish with today's date.
Expected:
- The notice reads "Q4 2026 is published", followed by the "Automatic site updates are not set up…" message.
- The title changes to "No round open".
- The site panel says "The public site is behind".
- In the private window, saving again shows the 409 message, and a reload shows "No review round is open right now".

- [ ] **Step 5: Build the public site from the database.** Run `npm run snapshot -- --confirm`.
Expected: `Wrote <n> ratings (as of <today>) …`, where `<n>` is the number of items scored in Step 2, then `Confirmed the snapshot of <time>.`

Open `http://localhost:5173/`.
Expected:
- Only the scored items appear, under only their workloads.
- "Items rated" equals `<n>`.
- Each item's detail shows its why.
- No "Not rated" rows.

On `#publish`, Check again shows "The public site is up to date". The confirm moved it, not the fetch: a plain `npm run snapshot` leaves the panel at "behind". If it still says "behind" after `--confirm`, read the `Snapshot not confirmed: …` warning; don't make the snapshot GET write the stamp.

- [ ] **Step 6: Silent edit of a published round.** On `#review`, choose Q4 2026 (published) and change one why. Then edit Rater A's card and change one score.
Expected: `#publish` → Check again shows "behind". Run `npm run snapshot -- --confirm`, reload `/`, and the new text and grade show. Check again shows "up to date".

- [ ] **Step 7: Next round.** On the Score tab, open the suggested `2027-Q1`.
Expected: the private window (after a reload) shows "Q1 2027 · 0 of N rated" and a "Start from my Q4 2026 scores" button that fills the matrix with Rater A's Q4 card.

- [ ] **Step 8: Session end.** On `#users`, disable Rater A. In the private window, change a slider and click Save scores.
Expected: the login form appears with "Your session ended…". Logging in as `rater-a` fails with "Wrong login or password." Enable Rater A again. That failed login leaves `login:rater-a` at `failures=1`. The integration test doesn't clean it, by design, so `fcr-dev` won't show 0 `login_attempts` after this task; that isn't a test leak.

- [ ] **Step 9: Clean up.** Throw away the dev snapshot so production never ships test data:

```powershell
git checkout -- src/data/snapshot.json
git status --short
```

Expected: a clean tree. `fcr-dev` keeps Q4 2026 (published) and Q1 2027 (open).

- [ ] **Step 10: Re-run the API integration test** (Plan 1 Task 17 Step 4). First log out of or close the admin window and the private window, and don't log in through any local site while it runs. Run one copy of the suite per database at a time, because each copy's `beforeAll` deletes every `itest-` row. Never run `db:seed --force` during it. From a second checkout, set `FCR_API_URL` to that checkout's host port, and check that its `api/local.settings.json` points at `fcr-dev`. The suite connects for its own checks with the settings file of the checkout it runs from. It refuses a database whose name doesn't start with `fcr-dev`, and fails if the host's database differs from its own.
Expected: `Tests  12 passed (12)` against the new open round, `2027-Q1`. "12 skipped" means `FCR_API_URL` wasn't set. After Steps 5 and 6, `site_state.changed_at` and `last_snapshot_at` are both set. The suite writes only to the open round, and its `afterAll` asserts the whole `site_state` row is unchanged. If a stamp moves, an open-round write stamped the site or something else wrote public data. Treat that as an API bug, and don't loosen the test.

---

## Done When

- `npm run typecheck`, `npm test`, and `npm run build` pass, and `dist/` contains `index.html`, `rate.html`, and `admin.html`.
- Against `fcr-dev`:
  - raters log in at `/rate`, keep one card for the open round, and change their password;
  - the admin scores, reviews, writes whys, edits any card (published ones too), publishes, reopens, edits the catalog, and manages users at `/admin`.
- The public site renders only from `src/data/snapshot.json`: items nobody rated never appear, and the committed snapshot is the empty one.
- `deploy.yml` refreshes and commits the snapshot whenever the `API_URL` variable is set, and tells the API which snapshot went live.
- `desk.html`, `src/desk/`, the desk scripts, the GitHub intake, `raters.json`, and `.env.example` are gone, and no front-end file imports `aggregate.ts` or `formula.ts`.
