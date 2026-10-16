import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdminCatalog, RoundReview } from '../domain/api-types';
import { useFocusIfLost } from '../hooks/useFocusIfLost';
import { useWarnBeforeUnload } from '../hooks/useWarnBeforeUnload';
import { hasChanges, summarize, type Draft, type DraftTriple } from '../rating-ui/draft';
import { cardFromReview, pressRaterSave, saveBlocked } from '../rating-ui/save';
import { ScoreMatrix } from '../rating-ui/ScoreMatrix';
import styles from './Admin.module.css';

interface RaterCardEditorProps {
  review: RoundReview;
  rater: { userId: number; name: string };
  /** The whole catalog, retired items included: a save replaces the whole card, so a missing id drops its score. */
  catalog: AdminCatalog;
  /** The save went through and nothing changed meanwhile: close the editor. */
  onSaved: (review: RoundReview) => void;
  /** A newer review for the panel underneath. Pass it back as `review`: the editor stays open on top of it. */
  onRefreshed: (review: RoundReview) => void;
  onCancel: () => void;
}

/**
 * The admin edits any rater's card in any round. The card is rebuilt from the review's per-rater breakdown, so no extra
 * endpoint is needed, and nothing is stored in the browser. Key it by round and rater.
 */
export function RaterCardEditor({ review, rater, catalog, onSaved, onRefreshed, onCancel }: RaterCardEditorProps) {
  const { round } = review;
  const saved = useMemo(() => cardFromReview(review, rater.userId), [review, rater.userId]);
  const [draft, setDraft] = useState<Draft>(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const latestDraft = useRef(draft);
  useEffect(() => {
    latestDraft.current = draft;
  }, [draft]);
  const toolbar = useFocusIfLost<HTMLDivElement>();

  const ids = useMemo(() => new Set(catalog.artifacts.map((artifact) => artifact.id)), [catalog.artifacts]);
  const summary = summarize(draft, catalog.artifacts);
  const dirty = hasChanges(draft, saved, ids);
  const blocked = saveBlocked(dirty, summary.partial.length, saving);
  useWarnBeforeUnload(dirty);

  const setTriple = useCallback((artifactId: string, triple: DraftTriple) => {
    setDraft((current) => ({ ...current, [artifactId]: triple }));
  }, []);

  const save = () =>
    pressRaterSave(
      { blocked, roundId: round.id, rater, saved, sent: draft, scores: summary.scores },
      {
        saving: () => {
          setAttempt((count) => count + 1);
          setSaving(true);
          setError('');
        },
        live: () => latestDraft.current,
        saved: onSaved,
        refreshed: (next, rebased, message) => {
          setDraft(rebased);
          onRefreshed(next);
          setError(message);
          setSaving(false);
        },
        failed: (message) => {
          setError(message);
          setSaving(false);
        },
      },
    );

  const cancel = () => {
    if (!dirty || confirm(`Discard your changes to ${rater.name}'s card?`)) onCancel();
  };

  return (
    <div className={styles.scoreTab}>
      <div ref={toolbar} tabIndex={-1} role="group" aria-label={`${rater.name}'s card`} className={styles.toolbar}>
        <div className={styles.toolbarText}>
          <strong>
            {rater.name} · {round.label} · {summary.rated} of {catalog.artifacts.length} rated
          </strong>
          {summary.partial.length > 0 && <span className={styles.warn}> · {summary.partial.length} incomplete</span>}
          <span aria-live="polite">{saving && <span className={styles.muted}> · Saving…</span>}</span>
          {error && (
            <span key={attempt} className={styles.error} role="alert">
              {' '}
              {error}
            </span>
          )}
        </div>
        <div className={styles.toolbarActions}>
          <button type="button" className={styles.secondary} onClick={cancel}>
            Back to review
          </button>
          {/* aria-disabled, not disabled: a disabled button drops keyboard focus to the page when a save starts. */}
          <button type="button" className={styles.primary} aria-disabled={blocked} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save card'}
          </button>
        </div>
      </div>
      <p className={styles.hint}>
        {round.status === 'published'
          ? `${round.label} is published. Saving changes its public averages at the next site update.`
          : `You are editing ${rater.name}'s card for the open round.`}{' '}
        Clear every item and save to remove the card.
      </p>
      <ScoreMatrix workloads={catalog.workloads} artifacts={catalog.artifacts} draft={draft} onChange={setTriple} />
    </div>
  );
}
