import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { MIN_PASSWORD_LENGTH, newPasswordProblem } from './password-rules';
import styles from './Account.module.css';

type State = { kind: 'idle' | 'saving' | 'done' } | { kind: 'error'; message: string };

interface ChangePasswordDialogProps {
  /** For password managers, which file a new password under the account's username. */
  login: string;
  onClose: () => void;
}

export function ChangePasswordDialog({ login, onClose }: ChangePasswordDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const saving = state.kind === 'saving';

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => ref.current?.close();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setAttempt((count) => count + 1);
    const problem = newPasswordProblem(next, repeat);
    if (problem) {
      setState({ kind: 'error', message: problem });
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

  // Length limits come from newPasswordProblem, in the server's words, not from minLength/maxLength: maxLength
  // silently truncates a pasted password, and the browser's own wording differs from the server's.
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (saving) event.preventDefault();
      }}
      onClose={onClose}
    >
      {state.kind === 'done' ? (
        <div className={styles.dialogBody}>
          <h2 id={titleId} className={styles.title}>
            Password changed
          </h2>
          <p className={styles.muted}>You are still logged in here. Any other devices were logged out.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={close} autoFocus>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className={styles.dialogBody} onSubmit={submit}>
          <h2 id={titleId} className={styles.title}>
            Change password
          </h2>
          <input type="text" autoComplete="username" value={login} readOnly hidden />
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
            <span>New password ({MIN_PASSWORD_LENGTH} or more characters)</span>
            <input
              type="password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className={styles.field}>
            <span>New password again</span>
            <input
              type="password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          {state.kind === 'error' && (
            <p key={attempt} className={styles.error} role="alert">
              {state.message}
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={close} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className={styles.primary} aria-disabled={saving}>
              {saving ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
