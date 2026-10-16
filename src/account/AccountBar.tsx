import { useState } from 'react';
import type { SessionUser } from '../domain/api-types';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { logOutClearingDrafts, type LogoutState } from './logout';
import styles from './Account.module.css';

interface AccountBarProps {
  user: SessionUser;
  onLogout: () => Promise<void>;
  /** Adds a link to /admin for admins. */
  adminLink?: boolean;
}

export function AccountBar({ user, onLogout, adminLink = false }: AccountBarProps) {
  const [changing, setChanging] = useState(false);
  const [logout, setLogout] = useState<LogoutState>({ kind: 'idle' });
  const leaving = logout.kind === 'leaving';

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
      <button
        type="button"
        className={styles.link}
        aria-disabled={leaving}
        onClick={() => {
          if (!leaving) void logOutClearingDrafts(user.id, onLogout, setLogout);
        }}
      >
        {leaving ? 'Logging out…' : 'Log out'}
      </button>
      {logout.kind === 'failed' && (
        <span className={styles.error} role="alert">
          {logout.message}
        </span>
      )}
      {changing && <ChangePasswordDialog login={user.login} onClose={() => setChanging(false)} />}
    </div>
  );
}
