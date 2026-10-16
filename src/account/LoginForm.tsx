import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../lib/api';
import styles from './Account.module.css';

interface LoginFormProps {
  title: string;
  /** Shown above the fields, e.g. after a session expired. */
  notice?: string;
  onLogin: (login: string, password: string) => Promise<void>;
}

export function LoginForm({ title, notice, onLogin }: LoginFormProps) {
  const errorId = useId();
  const loginRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // After a logout or an expired session, the control that had focus is gone and focus sits on <body>.
  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body) loginRef.current?.focus();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onLogin(login.trim(), password);
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
      passwordRef.current?.focus();
      passwordRef.current?.select();
    }
  };

  // The button stays focusable while busy (aria-disabled, not disabled), so focus survives a failed login.
  return (
    <form className={styles.login} onSubmit={submit}>
      <h2 className={styles.title}>{title}</h2>
      {notice && (
        <p className={styles.notice} role="alert">
          {notice}
        </p>
      )}
      <label className={styles.field}>
        <span>Login</span>
        <input
          ref={loginRef}
          name="username"
          value={login}
          onChange={(event) => setLogin(event.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={error ? errorId : undefined}
          required
        />
      </label>
      <label className={styles.field}>
        <span>Password</span>
        <input
          ref={passwordRef}
          type="password"
          name="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          aria-describedby={error ? errorId : undefined}
          required
        />
      </label>
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} aria-disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </div>
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
      <p className={styles.muted}>The site admin creates accounts. Ask them if you need one or forgot your password.</p>
    </form>
  );
}
