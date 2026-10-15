import { useCallback, useEffect, useState } from 'react';
import type { RoundData } from '../domain/types';
import { api, type DeskState } from './api';
import { NewRoundForm } from './NewRoundForm';
import { PublishTab } from './PublishTab';
import { ReviewTab } from './ReviewTab';
import { ScoreTab } from './ScoreTab';
import styles from './Desk.module.css';

const TABS = [
  { id: 'score', label: 'Score' },
  { id: 'review', label: 'Review & why' },
  { id: 'publish', label: 'Publish' },
] as const;

type Tab = (typeof TABS)[number]['id'];

export function Desk() {
  const [state, setState] = useState<DeskState>();
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('score');

  useEffect(() => {
    api.state().then(setState, (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const updateRound = useCallback((data: RoundData) => {
    setState((current) =>
      current && { ...current, rounds: current.rounds.map((item) => (item.round.id === data.round.id ? data : item)) },
    );
  }, []);

  const setRounds = useCallback((rounds: RoundData[]) => {
    setState((current) => current && { ...current, rounds });
  }, []);

  if (!state) {
    return (
      <main className={styles.loading}>
        {error ? (
          <p className={styles.error}>
            Could not reach the desk API: {error}. Start it with <code>npm run desk</code>.
          </p>
        ) : (
          <p>Loading rounds…</p>
        )}
      </main>
    );
  }

  const open = state.rounds.find((data) => data.round.status === 'open');

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Rating desk · local only</p>
          <h1 className={styles.title}>{open ? `${open.round.label} is open` : 'No round open'}</h1>
        </div>
        <nav className={styles.tabs} aria-label="Desk sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={styles.tab}
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <p className={styles.who}>
          Rating as <strong>{state.rater || 'nobody'}</strong>
          {!state.rater && <span className={styles.warn}> · set RATER in .env</span>}
        </p>
      </header>

      <main className={styles.main}>
        {tab === 'score' &&
          (open ? (
            <ScoreTab key={`${open.round.id}:${state.rater}`} data={open} rounds={state.rounds} rater={state.rater} onSaved={updateRound} />
          ) : (
            <NewRoundForm rounds={state.rounds} today={state.today} onCreated={setRounds} />
          ))}
        {tab === 'review' && <ReviewTab rounds={state.rounds} aiEnabled={state.aiEnabled} onSaved={updateRound} />}
        {tab === 'publish' && <PublishTab state={state} onRounds={setRounds} />}
      </main>
    </div>
  );
}
