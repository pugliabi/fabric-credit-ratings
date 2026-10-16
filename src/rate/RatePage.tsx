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
