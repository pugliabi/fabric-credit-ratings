import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, newPasswordProblem } from './password-rules';
import styles from './Account.module.css';

type State = { kind: 'idle' | 'saving' | 'done' } | { kind: 'error'; message: string };

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => ref.current?.close();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
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

  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose}>
      {state.kind === 'done' ? (
        <div className={styles.dialogBody}>
          <h2 className={styles.title}>Password changed</h2>
          <p className={styles.muted}>You are still logged in here. Any other devices were logged out.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={close}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className={styles.dialogBody} onSubmit={submit}>
          <h2 className={styles.title}>Change password</h2>
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
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              required
            />
          </label>
          <label className={styles.field}>
            <span>New password again</span>
            <input
              type="password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
          {state.kind === 'error' && (
            <p className={styles.error} role="alert">
              {state.message}
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={close}>
              Cancel
            </button>
            <button type="submit" className={styles.primary} disabled={state.kind === 'saving'}>
              {state.kind === 'saving' ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
