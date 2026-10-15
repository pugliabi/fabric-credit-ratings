import { useMemo, useState } from 'react';
import { ARTIFACTS } from '../data/artifacts';
import { WORKLOADS } from '../data/workloads';
import type { RoundData } from '../domain/types';
import { draftFromScores, draftFromValues, sameDraft, summarize } from '../rating-ui/draft';
import { ScoreMatrix } from '../rating-ui/ScoreMatrix';
import { usePersistentDraft } from '../rating-ui/usePersistentDraft';
import { api } from './api';
import { currentValues, lastOwnScores } from './selectors';
import styles from './Desk.module.css';

interface ScoreTabProps {
  data: RoundData;
  rounds: readonly RoundData[];
  rater: string;
  onSaved: (data: RoundData) => void;
}

export function ScoreTab({ data, rounds, rater, onSaved }: ScoreTabProps) {
  const mine = data.scorecards.find((card) => card.rater.toLowerCase() === rater.toLowerCase());
  const saved = useMemo(() => draftFromScores(mine?.scores ?? {}), [mine]);
  const { draft, setTriple, replace, restored } = usePersistentDraft(`fcr-desk:${data.round.id}:${rater}`, saved);
  const current = useMemo(() => currentValues(rounds), [rounds]);
  const lastOwn = useMemo(() => lastOwnScores(rounds, rater), [rounds, rater]);
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>({ kind: 'idle' });

  const summary = summarize(draft, ARTIFACTS);
  const dirty = !sameDraft(draft, saved);
  const hasReference = Object.keys(current).length > 0;

  const save = async () => {
    setStatus({ kind: 'saving' });
    try {
      const next = await api.saveScores(data.round.id, summary.scores);
      onSaved(next);
      replace(draftFromScores(summary.scores));
      setStatus({ kind: 'saved' });
    } catch (reason) {
      setStatus({ kind: 'error', message: reason instanceof Error ? reason.message : String(reason) });
    }
  };

  const prefill = () => {
    if (summary.rated > 0 && !confirm('Replace your current sliders with your last round?')) return;
    replace(lastOwn ? draftFromScores(lastOwn) : draftFromValues(current));
  };

  return (
    <div className={styles.scoreTab}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarText}>
          <strong>
            {summary.rated} of {ARTIFACTS.length} rated
          </strong>
          {summary.partial.length > 0 && <span className={styles.warn}> · {summary.partial.length} incomplete</span>}
          <span className={styles.muted}>
            {' · '}
            {status.kind === 'saving'
              ? 'Saving…'
              : status.kind === 'error'
                ? ''
                : dirty
                  ? restored
                    ? 'Unsaved draft restored'
                    : 'Unsaved changes'
                  : mine
                    ? 'Saved'
                    : 'Nothing saved yet'}
          </span>
          {status.kind === 'error' && <span className={styles.error}> {status.message}</span>}
        </div>
        <div className={styles.toolbarActions}>
          {(lastOwn || hasReference) && (
            <button type="button" className={styles.secondary} onClick={prefill}>
              Start from last round
            </button>
          )}
          {dirty && (
            <button type="button" className={styles.secondary} onClick={() => replace(saved)}>
              Discard changes
            </button>
          )}
          <button
            type="button"
            className={styles.primary}
            onClick={save}
            disabled={!dirty || summary.partial.length > 0 || status.kind === 'saving'}
          >
            Save scores
          </button>
        </div>
      </div>

      <p className={styles.hint}>
        Drag or click a slider to set it; arrow keys adjust it and Enter sets an untouched one. Leave an item blank to skip
        it this round.
      </p>

      <ScoreMatrix workloads={WORKLOADS} artifacts={ARTIFACTS} draft={draft} onChange={setTriple} reference={current} />
    </div>
  );
}
