import { useState, type FormEvent } from 'react';
import type { RoundData } from '../domain/types';
import { api } from './api';
import { nextRound } from './selectors';
import styles from './Desk.module.css';

interface NewRoundFormProps {
  rounds: readonly RoundData[];
  today: string;
  onCreated: (rounds: RoundData[]) => void;
}

export function NewRoundForm({ rounds, today, onCreated }: NewRoundFormProps) {
  const suggested = nextRound(rounds, today);
  const [id, setId] = useState(suggested.id);
  const [label, setLabel] = useState(suggested.label);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      onCreated(await api.createRound(id.trim(), label.trim()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <form className={styles.panel} onSubmit={submit}>
      <h2 className={styles.panelTitle}>Start a new round</h2>
      <p className={styles.muted}>
        Opening a round lets you and the other raters submit scores. Nothing shows on the site until you publish it.
      </p>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Round id</span>
          <input value={id} onChange={(event) => setId(event.target.value)} pattern="\d{4}-[A-Za-z0-9]{1,3}" required />
        </label>
        <label className={styles.field}>
          <span>Label</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} required />
        </label>
        <button type="submit" className={styles.primary}>
          Open round
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}
