import { useState } from 'react';
import { ARTIFACTS } from '../data/artifacts';
import { pointFor, publishedRounds } from '../domain/aggregate';
import type { RoundData } from '../domain/types';
import { formatFullDate } from '../lib/format';
import { api, type DeskState } from './api';
import { NewRoundForm } from './NewRoundForm';
import styles from './Desk.module.css';

interface PublishTabProps {
  state: DeskState;
  onRounds: (rounds: RoundData[]) => void;
}

function shipCommands(label: string): string {
  return [`git add src/data`, `git commit -m "Publish ${label} ratings"`, `git pull --rebase`, `git push`].join('\n');
}

export function PublishTab({ state, onRounds }: PublishTabProps) {
  const open = state.rounds.find((data) => data.round.status === 'open');
  const published = publishedRounds(state.rounds).reverse();
  const [date, setDate] = useState(state.today);
  const [force, setForce] = useState(false);
  const [error, setError] = useState('');
  const [justPublished, setJustPublished] = useState<string>();

  const run = async (action: () => Promise<RoundData[]>, label?: string) => {
    setError('');
    try {
      onRounds(await action());
      setJustPublished(label);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const scored = open
    ? ARTIFACTS.filter((artifact) => pointFor(artifact, open, '') !== undefined)
    : [];
  const missing = open ? scored.filter((artifact) => !open.notes[artifact.id]?.trim()) : [];
  const raters = open ? open.scorecards.filter((card) => Object.keys(card.scores).length > 0) : [];

  return (
    <div className={styles.publishTab}>
      {justPublished && (
        <section className={styles.panel} data-tone="success">
          <h2 className={styles.panelTitle}>{justPublished} is published locally</h2>
          <p className={styles.muted}>Commit and push to put it on the site. The push triggers the deploy.</p>
          <pre className={styles.commands}>{shipCommands(justPublished)}</pre>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void navigator.clipboard.writeText(shipCommands(justPublished))}
          >
            Copy commands
          </button>
        </section>
      )}

      {open ? (
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Publish {open.round.label}</h2>
          <ul className={styles.checklist}>
            <li data-ok={scored.length > 0}>
              {scored.length} of {ARTIFACTS.length} items scored
            </li>
            <li data-ok={raters.length > 0}>
              {raters.length} {raters.length === 1 ? 'rater' : 'raters'}
              {raters.length > 0 && `: ${raters.map((card) => card.rater).join(', ')}`}
            </li>
            <li data-ok={missing.length === 0}>
              {missing.length === 0
                ? 'Every scored item has a why'
                : `${missing.length} missing a why: ${missing.map((artifact) => artifact.name).join(', ')}`}
            </li>
          </ul>
          <p className={styles.muted}>
            Pull first if other raters may have submitted through GitHub: <code>git pull</code>, then reload this page.
          </p>
          <div className={styles.fields}>
            <label className={styles.field}>
              <span>Publication date</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </label>
            {missing.length > 0 && (
              <label className={styles.check}>
                <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
                Publish without them
              </label>
            )}
            <button
              type="button"
              className={styles.primary}
              disabled={scored.length === 0 || !date || (missing.length > 0 && !force)}
              onClick={() => run(() => api.setRoundStatus(open.round.id, 'published', date), open.round.label)}
            >
              Publish {open.round.label}
            </button>
          </div>
        </section>
      ) : (
        <NewRoundForm rounds={state.rounds} today={state.today} onCreated={onRounds} />
      )}

      {error && <p className={styles.error}>{error}</p>}

      {published.length > 0 && (
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Published rounds</h2>
          <ul className={styles.roundList}>
            {published.map((data, index) => (
              <li key={data.round.id}>
                <span>
                  <strong>{data.round.label}</strong> · published {formatFullDate(data.round.publishedOn ?? '')}
                </span>
                {index === 0 && !open && (
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => {
                      if (confirm(`Reopen ${data.round.label}? It disappears from the site until you publish again.`)) {
                        void run(() => api.setRoundStatus(data.round.id, 'open'));
                      }
                    }}
                  >
                    Reopen
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
