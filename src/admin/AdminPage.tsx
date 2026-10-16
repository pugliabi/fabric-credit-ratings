import { useCallback, useEffect, useRef, useState } from 'react';
import { AccountBar } from '../account/AccountBar';
import { LoginForm } from '../account/LoginForm';
import { Unavailable } from '../account/Unavailable';
import { useSession } from '../account/useSession';
import { WakeNotice } from '../account/WakeNotice';
import { currentValues } from '../data';
import type { AdminCatalog, AdminRound, AdminUser, SessionUser } from '../domain/api-types';
import { useFocusIfLost } from '../hooks/useFocusIfLost';
import { api, ApiError, errorMessage } from '../lib/api';
import { ScorecardEditor } from '../rating-ui/ScorecardEditor';
import { NewRoundForm } from './NewRoundForm';
import { ReviewTab } from './ReviewTab';
import styles from './Admin.module.css';

const CURRENT = currentValues();

const TABS = [
  { id: 'score', label: 'Score' },
  { id: 'review', label: 'Review & why' },
] as const;

type Tab = (typeof TABS)[number]['id'];

function tabFromHash(): Tab {
  return TABS.find((tab) => `#${tab.id}` === location.hash)?.id ?? 'score';
}

export function AdminPage() {
  const { session, login, logout, retry } = useSession();
  const isRater = session.status === 'signed-in' && session.user.role !== 'admin';
  // A 403 means this account is no longer an admin: re-reading /me sends it to /rate.
  const forbidden = useCallback(() => void retry(), [retry]);

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
              <LoginForm title="Admin login" notice={session.notice} onLogin={login} />
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
  /** Stable: `load` depends on it. */
  onForbidden: () => void;
}

function AdminShell({ user, onLogout, onForbidden }: AdminShellProps) {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [data, setData] = useState<AdminData>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);

  // Only the latest load lands: an older answer arriving late would bring back the open round a reload just dropped.
  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    try {
      const [rounds, catalog, users] = await Promise.all([
        api<AdminRound[]>('GET', '/admin/rounds'),
        api<AdminCatalog>('GET', '/admin/catalog'),
        api<AdminUser[]>('GET', '/admin/users'),
      ]);
      if (mine !== latest.current) return;
      setData({ rounds, catalog, users });
      setError('');
    } catch (reason) {
      if (mine !== latest.current) return;
      if (reason instanceof ApiError && reason.status === 403) {
        onForbidden();
      } else {
        setError(errorMessage(reason));
        setAttempt((count) => count + 1);
      }
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [onForbidden]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const follow = () => setTab(tabFromHash());
    addEventListener('hashchange', follow);
    return () => removeEventListener('hashchange', follow);
  }, []);

  const reload = useCallback(() => void load(), [load]);
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
        {error && <LoadFailed message={error} attempt={attempt} busy={loading} onRetry={reload} />}
        {!data && !error && <p className={styles.muted}>Loading…</p>}
        {data &&
          tab === 'score' &&
          (open ? (
            <div className={styles.scoreTab}>
              {/* Keyed by the open round too: when onClosed's reload finds another open round, the editor refetches. */}
              <ScorecardEditor key={`${user.id}:${open.id}`} user={user} reference={CURRENT} onClosed={reload} />
            </div>
          ) : (
            <NewRoundForm rounds={data.rounds} onCreated={setRounds} />
          ))}
        {data && tab === 'review' && <ReviewTab rounds={data.rounds} catalog={data.catalog} users={data.users} />}
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
