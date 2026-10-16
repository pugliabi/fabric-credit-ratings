import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountBar } from '../account/AccountBar';
import { LoginForm } from '../account/LoginForm';
import { Unavailable } from '../account/Unavailable';
import { adminNotice, useSession } from '../account/useSession';
import { WakeNotice } from '../account/WakeNotice';
import { currentValues } from '../data';
import type { AdminCatalog, AdminRound, AdminUser, SessionUser } from '../domain/api-types';
import { useFocusIfLost } from '../hooks/useFocusIfLost';
import { mayLeave } from '../hooks/useUnsavedWork';
import { api, ApiError, errorMessage } from '../lib/api';
import { ScorecardEditor } from '../rating-ui/ScorecardEditor';
import { CatalogTab } from './CatalogTab';
import { NewRoundForm } from './NewRoundForm';
import { PublishTab } from './PublishTab';
import { ReviewTab } from './ReviewTab';
import { UsersTab } from './UsersTab';
import styles from './Admin.module.css';

const CURRENT = currentValues();

const TABS = [
  { id: 'score', label: 'Score' },
  { id: 'review', label: 'Review & why' },
  { id: 'publish', label: 'Publish' },
  { id: 'catalog', label: 'Catalog' },
  { id: 'users', label: 'Users' },
] as const;

type Tab = (typeof TABS)[number]['id'];

function tabFromHash(): Tab {
  return TABS.find((tab) => `#${tab.id}` === location.hash)?.id ?? 'score';
}

export function AdminPage() {
  const { session, login, logout, retry } = useSession();
  const isRater = session.status === 'signed-in' && session.user.role !== 'admin';
  const rechecked = useRef(false);
  // A 403 means this account is no longer an admin: re-reading /me sends it to /rate. Once per page, so a 403 that
  // /me can't explain shows its message instead of reloading forever.
  const forbidden = useCallback(() => {
    if (rechecked.current) return false;
    rechecked.current = true;
    void retry();
    return true;
  }, [retry]);

  useEffect(() => {
    if (isRater) location.replace('/rate');
  }, [isRater]);

  // One WakeNotice outside the branches: its live region must stay mounted when a 401 swaps the shell for the login.
  return (
    <>
      {session.status === 'signed-in' && !isRater ? (
        <AdminShell user={session.user} onLogout={logout} onForbidden={forbidden} />
      ) : (
        <div className={styles.shell}>
          <header className={styles.header}>
            <div>
              <p className={styles.eyebrow}>Fabric Credit Ratings</p>
              <h1 className={styles.title}>Admin</h1>
            </div>
          </header>
          <main className={styles.loading}>
            {session.status === 'signed-out' ? (
              <LoginForm title="Admin login" notice={adminNotice(session.notice)} onLogin={login} />
            ) : session.status === 'unavailable' ? (
              <Unavailable message={session.message} onRetry={() => void retry()} />
            ) : (
              <p className={styles.muted}>Loading…</p>
            )}
          </main>
        </div>
      )}
      <WakeNotice />
    </>
  );
}

interface AdminData {
  rounds: AdminRound[];
  catalog: AdminCatalog;
  users: AdminUser[];
}

interface AdminShellProps {
  user: SessionUser;
  onLogout: () => Promise<void>;
  /** Stable: `load` depends on it. False when /me was already re-read; the 403 is then shown. */
  onForbidden: () => boolean;
}

function AdminShell({ user, onLogout, onForbidden }: AdminShellProps) {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [data, setData] = useState<AdminData>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);

  // Only the latest load lands: an older answer arriving late would bring back the open round a reload just dropped.
  // Resolves to the rounds it applied.
  const load = useCallback(async (): Promise<AdminRound[] | undefined> => {
    const mine = ++latest.current;
    setLoading(true);
    try {
      const [rounds, catalog, users] = await Promise.all([
        api<AdminRound[]>('GET', '/admin/rounds'),
        api<AdminCatalog>('GET', '/admin/catalog'),
        api<AdminUser[]>('GET', '/admin/users'),
      ]);
      if (mine !== latest.current) return undefined;
      setData({ rounds, catalog, users });
      setError('');
      return rounds;
    } catch (reason) {
      if (mine !== latest.current) return undefined;
      if (reason instanceof ApiError && reason.status === 403 && onForbidden()) return undefined;
      setError(errorMessage(reason));
      setAttempt((count) => count + 1);
      return undefined;
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [onForbidden]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const follow = () => {
      const next = tabFromHash();
      if (next === tab) return;
      if (mayLeave()) setTab(next);
      else history.replaceState(null, '', `#${tab}`);
    };
    addEventListener('hashchange', follow);
    return () => removeEventListener('hashchange', follow);
  }, [tab]);

  const reload = useCallback(() => void load(), [load]);
  const setRounds = useCallback((rounds: AdminRound[]) => setData((current) => current && { ...current, rounds }), []);
  const setCatalog = useCallback(
    (catalog: AdminCatalog) => setData((current) => current && { ...current, catalog }),
    [],
  );
  const setUsers = useCallback((users: AdminUser[]) => setData((current) => current && { ...current, users }), []);

  const choose = (next: Tab) => {
    if (next !== tab && !mayLeave()) return;
    setTab(next);
    history.replaceState(null, '', `#${next}`);
  };

  const open = data?.rounds.find((round) => round.status === 'open');
  // The session has no setter, so the header's name follows the Users tab's copy once you rename yourself.
  const self = data?.users.find((item) => item.id === user.id);
  // Log out judges stored score drafts by the catalog as it is now, not only when the Score tab mounts.
  const artifacts = data?.catalog.artifacts;
  const knownArtifacts = useMemo(() => artifacts && new Set(artifacts.map((item) => item.id)), [artifacts]);

  // The Score tab lost its round. If the reload still lists that round as open (published and reopened meanwhile, or a
  // 409 that a fresh card fixes), the editor remounts. A report from the editor's own load does that once per round,
  // so a 409 that keeps coming back can't loop; the Reload page button does it every time.
  const [scoreRun, setScoreRun] = useState(0);
  const remountedFor = useRef<string | undefined>(undefined);
  const openId = open?.id;
  const refreshScore = useCallback(
    (automatic: boolean) =>
      void load().then((rounds) => {
        if (!rounds?.some((round) => round.id === openId && round.status === 'open')) return;
        if (automatic && remountedFor.current === openId) return;
        if (automatic) remountedFor.current = openId;
        setScoreRun((count) => count + 1);
      }),
    [load, openId],
  );
  const scoreClosed = useCallback(() => refreshScore(true), [refreshScore]);
  const scoreReload = useCallback(() => refreshScore(false), [refreshScore]);

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
        <AccountBar
          user={self ? { ...user, displayName: self.displayName } : user}
          onLogout={onLogout}
          knownArtifacts={knownArtifacts}
        />
      </header>

      <main className={styles.main}>
        {error && <LoadFailed message={error} attempt={attempt} busy={loading} onRetry={reload} />}
        {!data && !error && <p className={styles.muted}>Loading…</p>}
        {data &&
          tab === 'score' &&
          (open ? (
            <div className={styles.scoreTab}>
              {/* Keyed by the open round too: when a reload finds another open round, the editor refetches. */}
              <ScorecardEditor
                key={`${user.id}:${open.id}:${scoreRun}`}
                user={user}
                reference={CURRENT}
                onClosed={scoreClosed}
                onReload={scoreReload}
              />
            </div>
          ) : (
            <NewRoundForm rounds={data.rounds} onCreated={setRounds} />
          ))}
        {data && tab === 'review' && <ReviewTab rounds={data.rounds} catalog={data.catalog} users={data.users} />}
        {data && tab === 'publish' && (
          <PublishTab rounds={data.rounds} catalogSize={data.catalog.artifacts.length} onRounds={setRounds} />
        )}
        {data && tab === 'catalog' && <CatalogTab catalog={data.catalog} onCatalog={setCatalog} />}
        {data && tab === 'users' && (
          <UsersTab users={data.users} me={user} onUsers={setUsers} onForbidden={onForbidden} />
        )}
      </main>
    </div>
  );
}

interface LoadFailedProps {
  message: string;
  /** Remounts the alert, so the same message is announced again after another failed try. */
  attempt: number;
  busy: boolean;
  onRetry: () => void;
}

function LoadFailed({ message, attempt, busy, onRetry }: LoadFailedProps) {
  const heading = useFocusIfLost<HTMLHeadingElement>();
  // Try again stays mounted and focusable while it runs, so keyboard focus survives a try that fails again.
  return (
    <section className={styles.panel}>
      <h2 ref={heading} tabIndex={-1} className={styles.panelTitle}>
        Could not load the admin page
      </h2>
      <p key={attempt} className={styles.error} role="alert">
        {message}
      </p>
      <button
        type="button"
        className={styles.secondary}
        aria-disabled={busy}
        onClick={() => {
          if (!busy) onRetry();
        }}
      >
        {busy ? 'Trying again…' : 'Try again'}
      </button>
    </section>
  );
}
