import { useState, type FormEvent } from 'react';
import type { AdminRound } from '../domain/api-types';
import { api, errorMessage } from '../lib/api';
import { localToday, nextRound } from './rounds';
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onCreated(await api<AdminRound[]>('POST', '/admin/rounds', { id: id.trim(), label: label.trim() }));
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  };

  return (
    <form className={styles.panel} onSubmit={submit}>
      <h2 className={styles.panelTitle}>Start a new round</h2>
      <p className={styles.muted}>
        Opening a round lets raters log in and score it. Nothing shows on the public site until you publish it.
      </p>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Round id</span>
          <input value={id} onChange={(event) => setId(event.target.value)} pattern="\d{4}-[A-Za-z0-9]{1,3}" required />
        </label>
        <label className={styles.field}>
          <span>Label</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={40} required />
        </label>
        <button type="submit" className={styles.primary} disabled={busy}>
          Open round
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}
