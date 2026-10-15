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
