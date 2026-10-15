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

  // One WakeNotice outside the branches: its live region must stay mounted when a 401 swaps the shell for the login.
  return (
    <>
      {session.status === 'signed-in' && !isRater ? (
        <AdminShell user={session.user} onLogout={logout} />
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

function AdminShell({ user, onLogout }: { user: SessionUser; onLogout: () => Promise<void> }) {
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
              <ScorecardEditor key={user.id} user={user} reference={CURRENT} />
            </div>
          ) : (
            <NewRoundForm rounds={data.rounds} onCreated={setRounds} />
          ))}
      </main>
    </div>
  );
}
