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
