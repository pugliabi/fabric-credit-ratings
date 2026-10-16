import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Catalog, MyScores, SessionUser } from '../domain/api-types';
import type { FactorValues } from '../domain/types';
import { api, ApiError, errorMessage } from '../lib/api';
import { formatTimestamp } from '../lib/format';
import { draftFromScores, draftFromValues, rebase, sameDraft, summarize, type Draft } from './draft';
import { CHANGED_ELSEWHERE, saveCard } from './save';
import { ScoreMatrix } from './ScoreMatrix';
import { cardDraftPrefix, usePersistentDraft } from './usePersistentDraft';
import styles from './Editor.module.css';

const EMPTY: Draft = {};

type Load =
  | { kind: 'loading' }
  | { kind: 'closed' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; catalog: Catalog; card: MyScores };

interface ScorecardEditorProps {
  user: SessionUser;
  /** Published averages per item id, shown under each name and used by "Start from current ratings". */
  reference: Readonly<Record<string, FactorValues>>;
}

/**
 * The logged-in user's own card in the open round. Used by /rate and the admin Score tab. Key it by the user's id, so
 * the stored draft's key never changes under a mounted form.
 */
export function ScorecardEditor({ user, reference }: ScorecardEditorProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  const fetchCard = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      const [catalog, card] = await Promise.all([
        api<Catalog>('GET', '/catalog'),
        api<MyScores>('GET', '/rounds/open/my-scores'),
      ]);
      setLoad({ kind: 'ready', catalog, card });
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) setLoad({ kind: 'closed' });
      else if (!(reason instanceof ApiError && reason.status === 401)) {
        setLoad({ kind: 'failed', message: errorMessage(reason) });
      }
    }
  }, []);

  useEffect(() => {
    void fetchCard();
  }, [fetchCard]);

  if (load.kind === 'loading') return <p className={styles.muted}>Loading your scorecard…</p>;
  if (load.kind === 'closed') return <Closed />;
  if (load.kind === 'failed') {
    return (
      <section className={styles.panel} role="alert">
        <h2 className={styles.panelTitle}>Could not load your scorecard</h2>
        <p className={styles.muted}>{load.message}</p>
        <button type="button" className={styles.secondary} onClick={() => void fetchCard()}>
          Try again
        </button>
      </section>
    );
  }
  return (
    <CardForm
      key={load.card.round.id}
      user={user}
      catalog={load.catalog}
      card={load.card}
      reference={reference}
      onSaved={(card) => setLoad({ kind: 'ready', catalog: load.catalog, card })}
    />
  );
}

function Closed() {
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>No review round is open right now</h2>
      <p className={styles.muted}>
        Scores are collected in rounds, usually once a quarter. Check back when the next one opens, or browse the{' '}
        <a href="/">current ratings</a>.
      </p>
    </section>
  );
}

interface CardFormProps {
  user: SessionUser;
  /** The whole catalog, retired items included: a save replaces the whole card, so a missing id drops its score. */
  catalog: Catalog;
  card: MyScores;
  reference: Readonly<Record<string, FactorValues>>;
  /**
   * Called with the server's newer card (after a save, or when a save found it changed elsewhere), together with
   * replace(), so the draft's base and the saved card change as one.
   */
  onSaved: (card: MyScores) => void;
}

type Status = { kind: 'idle' | 'saving' } | { kind: 'error'; message: string };

/** Exported for markup tests; pages use ScorecardEditor. */
export function CardForm({ user, catalog, card, reference, onSaved }: CardFormProps) {
  const { round, previous } = card;
  const saved = useMemo(() => draftFromScores(card.scores), [card.scores]);
  const { draft, setTriple, replace, restored } = usePersistentDraft(`${cardDraftPrefix(user.id)}${round.id}`, saved);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [attempt, setAttempt] = useState(0);

  const ids = useMemo(() => new Set(catalog.artifacts.map((artifact) => artifact.id)), [catalog.artifacts]);
  const summary = summarize(draft, catalog.artifacts);
  // A draft row for an item deleted since it was edited can't be seen or saved, so it doesn't count as a change.
  const dirty = !sameDraft(Object.fromEntries(Object.entries(draft).filter(([id]) => ids.has(id))), saved);
  const touched = summary.rated + summary.partial.length > 0;
  const hasReference = Object.keys(reference).length > 0;
  const blocked = !dirty || summary.partial.length > 0 || status.kind === 'saving';

  const save = async () => {
    const sent = draft;
    setAttempt((count) => count + 1);
    setStatus({ kind: 'saving' });
    try {
      const outcome = await saveCard(round.id, saved, summary.scores);
      const next = draftFromScores(outcome.card.scores);
      // Rebased, not replaced: slider moves made while the request was out must survive its answer.
      if (outcome.kind === 'changed') {
        replace((current) => rebase(saved, current, next));
        onSaved(outcome.card);
        const nothingLeft = sameDraft(rebase(saved, sent, next), next);
        setStatus(nothingLeft ? { kind: 'idle' } : { kind: 'error', message: CHANGED_ELSEWHERE });
        return;
      }
      replace((current) => rebase(sent, current, next));
      onSaved(outcome.card);
      setStatus({ kind: 'idle' });
    } catch (reason) {
      // The stored draft stays put on every failure; a 401 unmounts this form and the login notice says so.
      const kept = reason instanceof ApiError && reason.status !== 400 ? ' Your draft is kept in this browser.' : '';
      setStatus({ kind: 'error', message: `${errorMessage(reason)}${kept}` });
    }
  };

  const prefill = (next: Draft, what: string) => {
    if (touched && !confirm(`Replace your sliders with ${what}?`)) return;
    replace(next);
  };

  const stateText =
    status.kind === 'saving'
      ? 'Saving…'
      : status.kind === 'error'
        ? ''
        : dirty
          ? restored
            ? 'Unsaved draft restored'
            : 'Unsaved changes'
          : card.updatedAt
            ? `Saved ${formatTimestamp(card.updatedAt)}`
            : 'Nothing saved yet';

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.toolbarText}>
          <strong>
            {round.label} · {summary.rated} of {catalog.artifacts.length} rated
          </strong>
          {summary.partial.length > 0 && <span className={styles.warn}> · {summary.partial.length} incomplete</span>}
          <span aria-live="polite">{stateText && <span className={styles.muted}> · {stateText}</span>}</span>
          {status.kind === 'error' && (
            <span key={attempt} className={styles.error} role="alert">
              {' '}
              {status.message}
            </span>
          )}
        </div>
        <div className={styles.toolbarActions}>
          {previous && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => prefill(draftFromScores(previous.scores), `your ${previous.roundLabel} scores`)}
            >
              Start from my {previous.roundLabel} scores
            </button>
          )}
          {hasReference && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => prefill(draftFromValues(reference), 'the current ratings')}
            >
              Start from current ratings
            </button>
          )}
          {dirty && (
            <button type="button" className={styles.secondary} onClick={() => replace(saved)}>
              Discard changes
            </button>
          )}
          {touched && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                if (confirm('Clear every slider?')) replace(EMPTY);
              }}
            >
              Clear all
            </button>
          )}
          {/* aria-disabled, not disabled: a disabled button drops keyboard focus to the page when a save starts. */}
          <button
            type="button"
            className={styles.primary}
            aria-disabled={blocked}
            onClick={() => {
              if (!blocked) void save();
            }}
          >
            Save scores
          </button>
        </div>
      </div>

      <p className={styles.hint}>
        Drag or click a slider to set it; arrow keys adjust it and Enter sets an untouched one. Leave an item blank to skip
        it, or clear everything and save to withdraw your card. Only the admin sees individual cards; the site shows
        averages once {round.label} is published.
      </p>

      <ScoreMatrix
        workloads={catalog.workloads}
        artifacts={catalog.artifacts}
        draft={draft}
        onChange={setTriple}
        reference={reference}
      />
    </>
  );
}
