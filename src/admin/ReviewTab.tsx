import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { GradeBadge } from '../components/GradeBadge';
import type { AdminCatalog, AdminRound, AdminUser, RoundReview } from '../domain/api-types';
import type { RoundNotes } from '../domain/types';
import { useWarnBeforeUnload } from '../hooks/useWarnBeforeUnload';
import { api, ApiError, errorMessage } from '../lib/api';
import { formatScore } from '../lib/format';
import { stopDrafting, TIMED_OUT } from './draft-loop';
import { missingWhy, NOTE_TOO_LONG, noteTooLong, refreezeMissing } from './notes';
import { RaterCardEditor } from './RaterCardEditor';
import styles from './Admin.module.css';

const SAVE_DELAY = 700;

interface ReviewTabProps {
  rounds: readonly AdminRound[];
  catalog: AdminCatalog;
  users: readonly AdminUser[];
}

export function ReviewTab({ rounds, catalog, users }: ReviewTabProps) {
  const ordered = [...rounds].sort(
    (a, b) => Number(b.status === 'open') - Number(a.status === 'open') || b.id.localeCompare(a.id),
  );
  const [roundId, setRoundId] = useState(ordered[0]?.id ?? '');

  if (ordered.length === 0) return <p className={styles.panel}>No rounds yet. Start one on the Score tab.</p>;

  return (
    <div className={styles.reviewTab}>
      <label className={styles.roundPicker}>
        <span>Round</span>
        <select value={roundId} onChange={(event) => setRoundId(event.target.value)}>
          {ordered.map((round) => (
            <option key={round.id} value={round.id}>
              {round.label} ({round.status === 'open' ? 'open' : `published ${round.publishedOn ?? ''}`})
            </option>
          ))}
        </select>
      </label>
      <RoundLoader key={roundId} roundId={roundId} catalog={catalog} users={users} />
    </div>
  );
}

interface RoundLoaderProps {
  roundId: string;
  catalog: AdminCatalog;
  users: readonly AdminUser[];
}

function RoundLoader({ roundId, catalog, users }: RoundLoaderProps) {
  const [review, setReview] = useState<RoundReview>();
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api<RoundReview>('GET', `/admin/rounds/${roundId}/review`, undefined, { signal: controller.signal }).then(
      setReview,
      (reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      },
    );
    return () => controller.abort();
  }, [roundId]);

  if (error) {
    return (
      <p className={styles.error} role="alert">
        {error}
      </p>
    );
  }
  if (!review) return <p className={styles.muted}>Loading the round…</p>;
  return <RoundReviewPanel review={review} catalog={catalog} users={users} onReview={setReview} />;
}

interface RoundReviewPanelProps {
  review: RoundReview;
  catalog: AdminCatalog;
  users: readonly AdminUser[];
  onReview: (review: RoundReview) => void;
}

interface Edits {
  notes: RoundNotes;
  /** Item ids whose text has not reached the server yet. */
  dirty: ReadonlySet<string>;
}

/** Exported for markup tests; the page uses ReviewTab. */
export function RoundReviewPanel({ review, catalog, users, onReview }: RoundReviewPanelProps) {
  const roundId = review.round.id;
  const [edits, setEdits] = useState<Edits>({ notes: review.notes, dirty: new Set() });
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [saveError, setSaveError] = useState('');
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  /** What "Only missing a why" shows, or undefined while it's off. Frozen, so a box being filled in stays put. */
  const [missingOnly, setMissingOnly] = useState<ReadonlySet<string>>();
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [editing, setEditing] = useState<{ userId: number; name: string }>();
  const [cardNotice, setCardNotice] = useState('');
  const cancelRef = useRef(false);
  /** One save batch at a time: two PUTs for the same note could commit out of order. */
  const inFlight = useRef(false);
  const toolbar = useRef<HTMLDivElement>(null);
  const idPrefix = useId();
  const { notes } = edits;

  // Notes live only in this tab (a 401 or a reload loses them), so leaving with unsaved text asks first.
  useWarnBeforeUnload(edits.dirty.size > 0);

  // On arrival (after login, say) and back from the card editor, focus lands on the toolbar, not the page.
  useEffect(() => {
    if (!editing && (!document.activeElement || document.activeElement === document.body)) toolbar.current?.focus();
  }, [editing]);

  const notesNow = useRef(edits.notes);
  useEffect(() => {
    notesNow.current = edits.notes;
  }, [edits.notes]);
  useEffect(() => {
    setMissingOnly((shown) => shown && refreezeMissing(shown, review.items, notesNow.current));
  }, [review]);

  useEffect(() => {
    if (edits.dirty.size === 0 || inFlight.current) return;
    // A note over the limit stays unsaved, with its full text in the box, until it's shortened.
    const sent = Object.fromEntries(
      [...edits.dirty].map((id) => [id, edits.notes[id] ?? ''] as const).filter(([, body]) => !noteTooLong(body)),
    );
    if (Object.keys(sent).length === 0) return;
    const timer = setTimeout(() => {
      inFlight.current = true;
      setSaveState('saving');
      void (async () => {
        try {
          for (const [id, body] of Object.entries(sent)) {
            await api('PUT', `/admin/rounds/${roundId}/notes/${id}`, { body });
          }
          // Cleared first: this setEdits re-runs the effect, so text typed meanwhile goes out next.
          inFlight.current = false;
          setEdits((current) => ({
            ...current,
            dirty: new Set([...current.dirty].filter((id) => (current.notes[id] ?? '') !== sent[id])),
          }));
          setSaveState('saved');
        } catch (reason) {
          // Waits for Retry or the next keystroke, so a lasting error can't loop.
          inFlight.current = false;
          setSaveError(errorMessage(reason));
          setSaveAttempt((count) => count + 1);
          setSaveState('error');
        }
      })();
    }, SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [edits, roundId]);

  const setNote = useCallback((id: string, text: string) => {
    setEdits((current) => ({ notes: { ...current.notes, [id]: text }, dirty: new Set(current.dirty).add(id) }));
  }, []);

  /** Resolves to the failure, or undefined once the draft is in the box. */
  const draftOne = async (id: string, onlyIfBlank = false): Promise<unknown> => {
    setBusy(id);
    setDraftErrors(({ [id]: _, ...rest }) => rest);
    try {
      const path = `/admin/rounds/${roundId}/draft/${id}`;
      const { text } = await api<{ text: string }>('POST', path, undefined, { wakeNotice: false });
      // A draft lands as an edit, so the admin reads it before it autosaves like typed text.
      setEdits((current) =>
        onlyIfBlank && current.notes[id]?.trim()
          ? current
          : { notes: { ...current.notes, [id]: text }, dirty: new Set(current.dirty).add(id) },
      );
      return undefined;
    } catch (reason) {
      setDraftErrors((current) => ({ ...current, [id]: errorMessage(reason) }));
      return reason;
    } finally {
      setBusy(undefined);
    }
  };

  const blanks = review.items.filter(({ artifact }) => !notes[artifact.id]?.trim());

  /** One item at a time; fills only boxes still blank, since the admin may type in one meanwhile. */
  const draftAllBlank = async () => {
    cancelRef.current = false;
    const queue = blanks.map(({ artifact }) => artifact.id);
    setProgress({ done: 0, total: queue.length });
    let timeouts = 0;
    for (const [index, id] of queue.entries()) {
      if (cancelRef.current) break;
      const failure = await draftOne(id, true);
      setProgress({ done: index + 1, total: queue.length });
      timeouts = failure instanceof ApiError && failure.message === TIMED_OUT ? timeouts + 1 : 0;
      if (failure !== undefined && stopDrafting(failure, timeouts)) break;
    }
    setProgress(undefined);
  };

  const withCards = new Set(review.raters.map((rater) => rater.userId));
  const choices = [
    ...review.raters.map((rater) => ({ ...rater, hasCard: true })),
    ...users
      .filter((user) => user.active && !withCards.has(user.id))
      .map((user) => ({ userId: user.id, name: user.displayName, hasCard: false })),
  ];

  // The id comes from the server's number, never from the <select>'s string.
  const chooseCard = (value: string) => {
    const choice = choices.find((item) => String(item.userId) === value);
    if (!choice) return;
    setCardNotice('');
    setEditing({ userId: choice.userId, name: choice.name });
  };

  const drafting = busy !== undefined;
  const visible = missingOnly ? review.items.filter(({ artifact }) => missingOnly.has(artifact.id)) : review.items;
  const saveText = saveState === 'saving' ? 'Saving…' : edits.dirty.size > 0 ? 'Unsaved' : 'All notes saved';

  return (
    <>
      {editing ? (
        <RaterCardEditor
          key={`${roundId}:${editing.userId}`}
          review={review}
          rater={editing}
          catalog={catalog}
          onSaved={(next) => {
            onReview(next);
            setEditing(undefined);
            setCardNotice(`Saved ${editing.name}'s card.`);
          }}
          onRefreshed={onReview}
          onCancel={() => setEditing(undefined)}
        />
      ) : (
        <>
          <div
            ref={toolbar}
            tabIndex={-1}
            role="group"
            aria-label={`Review of ${review.round.label}`}
            className={styles.toolbar}
          >
            <div className={styles.toolbarText}>
              <strong>
                {review.items.length} items scored by {review.raters.length}{' '}
                {review.raters.length === 1 ? 'rater' : 'raters'}
              </strong>
              <span className={styles.muted}>
                {' · '}
                {blanks.length} missing a why
              </span>
              <span aria-live="polite">
                <span className={styles.muted}> · {saveText}</span>
              </span>
              {cardNotice && <span className={styles.muted}> · {cardNotice}</span>}
              {saveState === 'error' && (
                <span key={saveAttempt} className={styles.error} role="alert">
                  {' '}
                  {saveError}{' '}
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => {
                      // Retry disappears once the save starts.
                      toolbar.current?.focus();
                      setEdits((current) => ({ ...current }));
                    }}
                  >
                    Retry
                  </button>
                </span>
              )}
            </div>
            <div className={styles.toolbarActions}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={missingOnly !== undefined}
                  onChange={(event) => setMissingOnly(event.target.checked ? missingWhy(review.items, notes) : undefined)}
                />
                Only missing a why
              </label>
              <select
                className={styles.select}
                value=""
                onChange={(event) => chooseCard(event.target.value)}
                aria-label="Edit a rater's card"
              >
                <option value="">Edit a rater's card…</option>
                {choices.map((choice) => (
                  <option key={choice.userId} value={choice.userId}>
                    {choice.name}
                    {choice.hasCard ? '' : ' (no card yet)'}
                  </option>
                ))}
              </select>
              {/* One button either way, so focus stays on it when the loop starts or ends. */}
              {progress ? (
                <button type="button" className={styles.secondary} onClick={() => (cancelRef.current = true)}>
                  Stop ({progress.done}/{progress.total})
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.primary}
                  aria-disabled={!review.aiEnabled || blanks.length === 0 || drafting}
                  title={review.aiEnabled ? undefined : 'Set ANTHROPIC_API_KEY in the Function App settings'}
                  onClick={() => {
                    if (review.aiEnabled && blanks.length > 0 && !drafting) void draftAllBlank();
                  }}
                >
                  Draft all blank with AI ({blanks.length})
                </button>
              )}
            </div>
          </div>

          {review.round.status === 'published' && (
            <p className={styles.hint}>
              {review.round.label} is published. Score and note edits here reach the public site at the next site
              update (Publish tab).
            </p>
          )}
          {review.items.length === 0 && (
            <p className={styles.panel}>Nobody has scored anything in {review.round.label} yet.</p>
          )}

          {catalog.workloads.map((workload) => {
            const group = visible.filter(({ artifact }) => artifact.workload === workload.id);
            if (group.length === 0) return null;
            return (
              <section key={workload.id} className={styles.reviewGroup}>
                <h2 className={styles.groupTitle}>{workload.name}</h2>
                {group.map(({ artifact, point, change, breakdown }) => {
                  const { capability, ux, cost } = point.scores;
                  const note = notes[artifact.id] ?? '';
                  const tooLong = noteTooLong(note);
                  const limitId = `${idPrefix}-${artifact.id}-limit`;
                  return (
                    <article key={artifact.id} className={styles.card}>
                      <header className={styles.cardHeader}>
                        <div className={styles.cardName}>
                          <strong>{artifact.name}</strong>
                          <span className={styles.change} data-kind={change.kind}>
                            {change.text}
                          </span>
                        </div>
                        <span
                          className={styles.cardScores}
                          title="Feature capability · User experience · CU / token cost"
                        >
                          {formatScore(capability)} · {formatScore(ux)} · {formatScore(cost)}
                        </span>
                        <GradeBadge grade={point.grade} size="md" variant="pill" />
                      </header>
                      <p className={styles.breakdown}>
                        {breakdown.map((row) => `${row.name} ${row.scores.join(' · ')}`).join('   |   ')}
                      </p>
                      {/* No maxLength: it would cut a paste short without saying so, and count untrimmed text. */}
                      <textarea
                        className={styles.note}
                        rows={3}
                        value={note}
                        placeholder="Why this rating. Leave blank and use Draft with AI for a first pass."
                        aria-label={`Why this rating for ${artifact.name}`}
                        aria-invalid={tooLong || undefined}
                        aria-describedby={tooLong ? limitId : undefined}
                        onChange={(event) => setNote(artifact.id, event.target.value)}
                      />
                      {tooLong && (
                        <p id={limitId} className={styles.error} role="alert">
                          {NOTE_TOO_LONG}
                        </p>
                      )}
                      <div className={styles.cardActions}>
                        <button
                          type="button"
                          className={styles.secondary}
                          aria-disabled={!review.aiEnabled || drafting}
                          title={review.aiEnabled ? undefined : 'Set ANTHROPIC_API_KEY in the Function App settings'}
                          onClick={() => {
                            if (!review.aiEnabled || drafting) return;
                            if (note.trim() && !confirm('Replace the current text with an AI draft?')) return;
                            void draftOne(artifact.id);
                          }}
                        >
                          {busy === artifact.id ? 'Drafting…' : note.trim() ? 'Redraft with AI' : 'Draft with AI'}
                        </button>
                        {draftErrors[artifact.id] && (
                          <span className={styles.error} role="alert">
                            {draftErrors[artifact.id]}
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </section>
            );
          })}
        </>
      )}
      {/* Mounted in both views, so "Saved …'s card." is announced when the editor closes. */}
      <p className="visually-hidden" aria-live="polite">
        {cardNotice}
      </p>
    </>
  );
}
