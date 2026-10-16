import { useId, useRef, useState, type FormEvent } from 'react';
import type { AdminRound } from '../domain/api-types';
import { useFocusIfLost } from '../hooks/useFocusIfLost';
import { api, errorMessage } from '../lib/api';
import { localToday, nextRound, roundIdProblem } from './rounds';
import styles from './Admin.module.css';

interface NewRoundFormProps {
  rounds: readonly AdminRound[];
  onCreated: (rounds: AdminRound[]) => void;
}

export function NewRoundForm({ rounds, onCreated }: NewRoundFormProps) {
  const suggested = nextRound(rounds, localToday());
  const [id, setId] = useState(suggested.id);
  const [label, setLabel] = useState(suggested.label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const heading = useFocusIfLost<HTMLHeadingElement>();
  const errorId = useId();
  const idInput = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setAttempt((count) => count + 1);
    // An IME composition can leave the id lowercase until here.
    const roundId = id.trim().toUpperCase();
    const problem = roundIdProblem(roundId);
    if (problem) {
      setError(problem);
      idInput.current?.focus();
      idInput.current?.select();
      return;
    }
    setBusy(true);
    setError('');
    try {
      onCreated(await api<AdminRound[]>('POST', '/admin/rounds', { id: roundId, label: label.trim() }));
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  };

  // The id and label rules come from the server's words (roundIdProblem, the API's 400s), not pattern/maxLength.
  // The button stays focusable while busy (aria-disabled, not disabled), so focus survives a failed attempt.
  return (
    <form className={styles.panel} onSubmit={submit}>
      <h2 ref={heading} tabIndex={-1} className={styles.panelTitle}>
        Start a new round
      </h2>
      <p className={styles.muted}>
        Opening a round lets raters log in and score it. Nothing shows on the public site until you publish it.
      </p>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Round id</span>
          <input
            ref={idInput}
            value={id}
            onChange={(event) => {
              const input = event.currentTarget;
              // Uppercased in place, so React has nothing to write back and the caret stays put. Not mid-composition:
              // writing the value would cut an IME's pre-edit text short.
              if (!(event.nativeEvent as InputEvent).isComposing) {
                const { selectionStart, selectionEnd } = input;
                input.value = input.value.toUpperCase();
                input.setSelectionRange(selectionStart, selectionEnd);
              }
              setId(input.value);
            }}
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error === roundIdProblem(id.trim().toUpperCase()) || undefined}
            required
          />
        </label>
        <label className={styles.field}>
          <span>Label</span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            aria-describedby={error ? errorId : undefined}
            required
          />
        </label>
        <button type="submit" className={styles.primary} aria-disabled={busy}>
          {busy ? 'Opening…' : 'Open round'}
        </button>
      </div>
      {error && (
        <p key={attempt} id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
