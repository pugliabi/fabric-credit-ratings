import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdminCatalog, RoundReview } from '../domain/api-types';
import { useFocusIfLost } from '../hooks/useFocusIfLost';
import { useUnsavedWork } from '../hooks/useUnsavedWork';
import { api, errorMessage } from '../lib/api';
import { hasChanges, rebase, sameDraft, summarize, type Draft, type DraftTuple } from '../rating-ui/draft';
import {
  cardFromReview,
  clashingRows,
  describeClashes,
  pressRaterSave,
  raterCardArtifacts,
  raterCardChanged,
  raterCardWorkloads,
  saveBlocked,
} from '../rating-ui/save';
import { ScoreMatrix } from '../rating-ui/ScoreMatrix';
import styles from './Admin.module.css';

interface RaterCardEditorProps {
  review: RoundReview;
  rater: { userId: number; name: string };
  /** The whole catalog, retired items included: a save replaces the whole card, so a missing id drops its score. */
  catalog: AdminCatalog;
  /** The save went through and nothing changed meanwhile: close the editor. */
  onSaved: (review: RoundReview) => void;
  /**
   * A newer review for the panel underneath. Pass it back as `review`: the editor stays open on top of it. Keep it
   * stable: the editor reads the card again on open, and a new function would read it again.
   */
  onRefreshed: (review: RoundReview) => void;
  onCancel: () => void;
}

/**
 * The admin edits any rater's card in any round. The card is rebuilt from the review's per-rater breakdown, so no extra
 * endpoint is needed, and nothing is stored in the browser. Key it by round and rater.
 */
/** Back to review while a save is out: the PUT has no timeout, so the button must not wait for it. */
export const SAVE_ON_ITS_WAY = 'Your save is already on its way and will go through. Go back without waiting?';

export function RaterCardEditor({ review, rater, catalog, onSaved, onRefreshed, onCancel }: RaterCardEditorProps) {
  const { round } = review;
  const saved = useMemo(() => cardFromReview(review, rater.userId), [review, rater.userId]);
  const [draft, setDraft] = useState<Draft>(saved);
  const [fresh, setFresh] = useState(false);
  const [freshNote, setFreshNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'warn' }>();
  const [attempt, setAttempt] = useState(0);
  const latestDraft = useRef(draft);
  useEffect(() => {
    latestDraft.current = draft;
  }, [draft]);
  const opened = useRef(saved);
  const latestNames = useRef<Readonly<Record<string, string>>>({});
  // A save still out after "Back to review" must not close, or announce over, whatever editor is open by then.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const toolbar = useFocusIfLost<HTMLDivElement>();

  // The panel's review can be hours old, so the card is read again before Save is offered. Edits made meanwhile go on
  // top of it.
  useEffect(() => {
    const controller = new AbortController();
    api<RoundReview>('GET', `/admin/rounds/${round.id}/review`, undefined, { signal: controller.signal }).then(
      (latest) => {
        const card = cardFromReview(latest, rater.userId);
        // A slider moved during the read, on a row the rater also changed: the admin's row wins, so name it, as a save
        // held back by a newer card does. Otherwise the rater's value would be overwritten without a word.
        const clashes = clashingRows(opened.current, latestDraft.current, card);
        if (clashes.length > 0) {
          const described = describeClashes(clashes, card, latestNames.current);
          setMessage({ text: raterCardChanged(rater.name, described), tone: 'error' });
        }
        setDraft((current) => rebase(opened.current, current, card));
        onRefreshed(latest);
        setFreshNote(sameDraft(card, opened.current) ? 'Card is up to date' : 'Newer scores loaded');
        setFresh(true);
      },
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        // Save still reads the card before it writes, so it can go ahead.
        setMessage({ text: errorMessage(reason), tone: 'error' });
        setFresh(true);
      },
    );
    return () => controller.abort();
  }, [round.id, rater.userId, onRefreshed]);

  // Items added after this page loaded are in the review but not the catalog; without them a save drops their scores.
  const artifacts = useMemo(() => raterCardArtifacts(catalog.artifacts, review), [catalog.artifacts, review]);
  const workloads = useMemo(() => raterCardWorkloads(catalog.workloads, artifacts), [catalog.workloads, artifacts]);
  const ids = useMemo(() => new Set(artifacts.map((artifact) => artifact.id)), [artifacts]);
  const names = useMemo(
    () => Object.fromEntries(artifacts.map((artifact) => [artifact.id, artifact.name])),
    [artifacts],
  );
  // The open-time read's handler was made at mount, so it reads the names through this ref.
  useEffect(() => {
    latestNames.current = names;
  }, [names]);
  const summary = summarize(draft, artifacts);
  const dirty = hasChanges(draft, saved, ids);
  const blocked = !fresh || saveBlocked(dirty, summary.partial.length, saving);
  useUnsavedWork(dirty);

  const setTriple = useCallback((artifactId: string, triple: DraftTuple) => {
    setDraft((current) => ({ ...current, [artifactId]: triple }));
  }, []);

  const save = () =>
    pressRaterSave(
      { blocked, roundId: round.id, rater, saved, sent: draft, scores: summary.scores, names },
      {
        saving: () => {
          setAttempt((count) => count + 1);
          setSaving(true);
          setFreshNote('');
          setMessage(undefined);
        },
        live: () => latestDraft.current,
        saved: (next) => {
          if (mounted.current) onSaved(next);
        },
        refreshed: (next, rebased, outcome) => {
          if (!mounted.current) return;
          setDraft(rebased);
          onRefreshed(next);
          setMessage({ text: outcome.text, tone: outcome.saved ? 'warn' : 'error' });
          setSaving(false);
        },
        failed: (text) => {
          setMessage({ text, tone: 'error' });
          setSaving(false);
        },
      },
    );

  const cancel = () => {
    const question = saving ? SAVE_ON_ITS_WAY : dirty ? `Discard your changes to ${rater.name}'s card?` : undefined;
    if (!question || confirm(question)) onCancel();
  };

  const status = saving ? 'Saving…' : fresh ? freshNote : 'Checking for newer scores…';

  return (
    <div className={styles.scoreTab}>
      <div ref={toolbar} tabIndex={-1} role="group" aria-label={`${rater.name}'s card`} className={styles.toolbar}>
        <div className={styles.toolbarText}>
          <strong>
            {rater.name} · {round.label} · {summary.rated} of {artifacts.length} rated
          </strong>
          {summary.partial.length > 0 && <span className={styles.warn}> · {summary.partial.length} incomplete</span>}
          <span aria-live="polite">{status && <span className={styles.muted}> · {status}</span>}</span>
          {message && (
            <span key={attempt} className={message.tone === 'warn' ? styles.warn : styles.error} role="alert">
              {' '}
              {message.text}
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
          ? `${round.label} is released. Saving changes its public averages at the next site update.`
          : `You are editing ${rater.name}'s card for the open round.`}{' '}
        Clear every item and save to remove the card.
      </p>
      <ScoreMatrix workloads={workloads} artifacts={artifacts} draft={draft} onChange={setTriple} />
    </div>
  );
}
