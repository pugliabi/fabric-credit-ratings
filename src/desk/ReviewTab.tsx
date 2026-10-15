import { useEffect, useMemo, useRef, useState } from 'react';
import { GradeBadge } from '../components/GradeBadge';
import { ARTIFACTS } from '../data/artifacts';
import { WORKLOADS } from '../data/workloads';
import { pointFor, previousPoint } from '../domain/aggregate';
import type { RoundData, RoundNotes } from '../domain/types';
import { formatScore } from '../lib/format';
import { api } from './api';
import { changeLabel } from './selectors';
import styles from './Desk.module.css';

const SAVE_DELAY = 700;

interface ReviewTabProps {
  rounds: readonly RoundData[];
  aiEnabled: boolean;
  onSaved: (data: RoundData) => void;
}

export function ReviewTab({ rounds, aiEnabled, onSaved }: ReviewTabProps) {
  const ordered = [...rounds].sort(
    (a, b) => Number(b.round.status === 'open') - Number(a.round.status === 'open') || b.round.id.localeCompare(a.round.id),
  );
  const [roundId, setRoundId] = useState(ordered[0]?.round.id ?? '');
  const data = rounds.find((item) => item.round.id === roundId);

  if (!data) return <p className={styles.panel}>No rounds yet. Open one from the Score tab.</p>;

  return (
    <div className={styles.reviewTab}>
      <label className={styles.roundPicker}>
        <span>Round</span>
        <select value={roundId} onChange={(event) => setRoundId(event.target.value)}>
          {ordered.map((item) => (
            <option key={item.round.id} value={item.round.id}>
              {item.round.label} ({item.round.status === 'open' ? 'open' : `published ${item.round.publishedOn}`})
            </option>
          ))}
        </select>
      </label>
      <RoundReview key={roundId} data={data} rounds={rounds} aiEnabled={aiEnabled} onSaved={onSaved} />
    </div>
  );
}

interface RoundReviewProps {
  data: RoundData;
  rounds: readonly RoundData[];
  aiEnabled: boolean;
  onSaved: (data: RoundData) => void;
}

function RoundReview({ data, rounds, aiEnabled, onSaved }: RoundReviewProps) {
  const roundId = data.round.id;
  const [notes, setNotes] = useState<RoundNotes>(data.notes);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState<string>();
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const cancelRef = useRef(false);

  const items = useMemo(
    () =>
      ARTIFACTS.flatMap((artifact) => {
        const point = pointFor(artifact, data, data.round.publishedOn ?? '');
        if (!point) return [];
        const breakdown = data.scorecards.flatMap((card) => {
          const triple = card.scores[artifact.id];
          return triple ? [{ rater: card.rater, triple }] : [];
        });
        return [{ artifact, point, previous: previousPoint(artifact, rounds, roundId), breakdown }];
      }),
    [data, rounds, roundId],
  );

  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      setSaveState('saving');
      api.saveNotes(roundId, notes).then(
        (next) => {
          onSaved(next);
          setDirty(false);
          setSaveState('saved');
        },
        (reason: unknown) => {
          setSaveState('error');
          setSaveError(reason instanceof Error ? reason.message : String(reason));
        },
      );
    }, SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [dirty, notes, roundId, onSaved]);

  const setNote = (id: string, text: string) => {
    setNotes((current) => ({ ...current, [id]: text }));
    setDirty(true);
  };

  const draftOne = async (id: string) => {
    setBusy(id);
    setDraftErrors(({ [id]: _, ...rest }) => rest);
    try {
      const { text } = await api.draft(roundId, id);
      setNote(id, text);
    } catch (reason) {
      setDraftErrors((current) => ({ ...current, [id]: reason instanceof Error ? reason.message : String(reason) }));
    } finally {
      setBusy(undefined);
    }
  };

  const blanks = items.filter(({ artifact }) => !notes[artifact.id]?.trim());

  const draftAllBlank = async () => {
    cancelRef.current = false;
    const queue = blanks.map(({ artifact }) => artifact.id);
    setProgress({ done: 0, total: queue.length });
    for (const [index, id] of queue.entries()) {
      if (cancelRef.current) break;
      await draftOne(id);
      setProgress({ done: index + 1, total: queue.length });
    }
    setProgress(undefined);
  };

  const raters = data.scorecards.filter((card) => Object.keys(card.scores).length > 0);
  const visible = onlyMissing ? blanks : items;

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.toolbarText}>
          <strong>
            {items.length} items scored by {raters.length} {raters.length === 1 ? 'rater' : 'raters'}
          </strong>
          <span className={styles.muted}>
            {' · '}
            {blanks.length} missing a why ·{' '}
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? '' : dirty ? 'Unsaved' : 'All notes saved'}
          </span>
          {saveState === 'error' && <span className={styles.error}> {saveError}</span>}
        </div>
        <div className={styles.toolbarActions}>
          <label className={styles.check}>
            <input type="checkbox" checked={onlyMissing} onChange={(event) => setOnlyMissing(event.target.checked)} />
            Only missing a why
          </label>
          {progress ? (
            <button type="button" className={styles.secondary} onClick={() => (cancelRef.current = true)}>
              Stop ({progress.done}/{progress.total})
            </button>
          ) : (
            <button
              type="button"
              className={styles.primary}
              onClick={draftAllBlank}
              disabled={!aiEnabled || blanks.length === 0 || busy !== undefined}
              title={aiEnabled ? undefined : 'Set ANTHROPIC_API_KEY in .env'}
            >
              Draft all blank with AI ({blanks.length})
            </button>
          )}
        </div>
      </div>

      {raters.length > 0 && (
        <p className={styles.hint}>Raters this round: {raters.map((card) => card.rater).join(', ')}</p>
      )}
      {items.length === 0 && <p className={styles.panel}>Nobody has scored anything in {data.round.label} yet.</p>}

      {WORKLOADS.map((workload) => {
        const group = visible.filter(({ artifact }) => artifact.workload === workload.id);
        if (group.length === 0) return null;
        return (
          <section key={workload.id} className={styles.reviewGroup}>
            <h2 className={styles.groupTitle}>{workload.name}</h2>
            {group.map(({ artifact, point, previous, breakdown }) => {
              const change = changeLabel(point, previous);
              const { capability, ux, cost } = point.scores;
              return (
                <article key={artifact.id} className={styles.card}>
                  <header className={styles.cardHeader}>
                    <div className={styles.cardName}>
                      <strong>{artifact.name}</strong>
                      <span className={styles.change} data-kind={change.kind}>
                        {change.text}
                      </span>
                    </div>
                    <span className={styles.cardScores} title="Feature capability · User experience · CU / token cost">
                      {formatScore(capability)} · {formatScore(ux)} · {formatScore(cost)}
                    </span>
                    <GradeBadge grade={point.grade} size="md" variant="pill" />
                  </header>
                  {breakdown.length > 1 && (
                    <p className={styles.breakdown}>
                      {breakdown.map(({ rater, triple }) => `${rater} ${triple.join(' · ')}`).join('   |   ')}
                    </p>
                  )}
                  <textarea
                    className={styles.note}
                    rows={3}
                    value={notes[artifact.id] ?? ''}
                    placeholder="Why this rating. Leave blank and use Draft with AI for a first pass."
                    aria-label={`Why this rating for ${artifact.name}`}
                    onChange={(event) => setNote(artifact.id, event.target.value)}
                  />
                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => {
                        if (notes[artifact.id]?.trim() && !confirm('Replace the current text with an AI draft?')) return;
                        void draftOne(artifact.id);
                      }}
                      disabled={!aiEnabled || busy !== undefined}
                    >
                      {busy === artifact.id ? 'Drafting…' : notes[artifact.id]?.trim() ? 'Redraft with AI' : 'Draft with AI'}
                    </button>
                    {draftErrors[artifact.id] && <span className={styles.error}>{draftErrors[artifact.id]}</span>}
                  </div>
                </article>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
