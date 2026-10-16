import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { MIN_PASSWORD_LENGTH, newPasswordProblem } from './password-rules';
import styles from './Account.module.css';

/** The input the error is about, for aria-describedby and aria-invalid; a mismatch is about both new-password inputs. */
type ErrorField = 'current' | 'next' | 'both-new';
type State = { kind: 'idle' | 'saving' | 'done' } | { kind: 'error'; message: string; field?: ErrorField };

interface ChangePasswordDialogProps {
  /** For password managers, which file a new password under the account's username. */
  login: string;
  onClose: () => void;
}

export function ChangePasswordDialog({ login, onClose }: ChangePasswordDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const currentRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const errorId = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const saving = state.kind === 'saving';
  const errorProps = (...fields: ErrorField[]) =>
    state.kind === 'error' && state.field && fields.includes(state.field)
      ? { 'aria-describedby': errorId, 'aria-invalid': true }
      : {};

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    if (!saving) return;
    // Chrome closes on a second Escape even when cancel was prevented; a prevented keydown never asks to close.
    const holdEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') event.preventDefault();
    };
    document.addEventListener('keydown', holdEscape, true);
    return () => document.removeEventListener('keydown', holdEscape, true);
  }, [saving]);

  const close = () => ref.current?.close();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setAttempt((count) => count + 1);
    const problem = newPasswordProblem(next, repeat);
    if (problem) {
      setState({ kind: 'error', message: problem, field: next === repeat ? 'next' : 'both-new' });
      return;
    }
    setState({ kind: 'saving' });
    try {
      await api('PUT', '/me/password', { current, next });
      setState({ kind: 'done' });
    } catch (reason) {
      // The new password already passed the server's rules here, so a 400 means the current password is wrong.
      const wrongCurrent = reason instanceof ApiError && reason.status === 400;
      setState({ kind: 'error', message: errorMessage(reason), field: wrongCurrent ? 'current' : undefined });
      if (wrongCurrent) {
        currentRef.current?.focus();
        currentRef.current?.select();
      }
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
              ref={currentRef}
              type="password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              autoComplete="current-password"
              {...errorProps('current')}
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
              {...errorProps('next', 'both-new')}
            />
          </label>
          <label className={styles.field}>
            <span>New password again</span>
            <input
              type="password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              autoComplete="new-password"
              {...errorProps('both-new')}
            />
          </label>
          {state.kind === 'error' && (
            <p key={attempt} id={errorId} className={styles.error} role="alert">
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
