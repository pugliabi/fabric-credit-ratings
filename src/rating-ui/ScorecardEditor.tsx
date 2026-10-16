import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Catalog, MyScores, SessionUser } from '../domain/api-types';
import type { FactorValues } from '../domain/types';
import { api, ApiError, errorMessage } from '../lib/api';
import { draftFromScores, draftFromValues, hasChanges, rebase, summarize, type Draft, type DraftTriple } from './draft';
import { CHANGED_ELSEWHERE, saveCard, saveFailureMessage, saveStateText, type SaveStatus } from './save';
import { ScoreMatrix } from './ScoreMatrix';
import { cardDraftPrefix, usePersistentDraft } from './usePersistentDraft';
import styles from './Editor.module.css';

const EMPTY: Draft = {};

type Load =
  | { kind: 'loading' }
  | { kind: 'closed' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; catalog: Catalog; card: MyScores };

/**
 * Focuses the returned element on mount if focus sits on <body>, as it does when the control that had it (Log in, Try
 * again) has just been removed.
 */
function useFocusIfLost<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body) ref.current?.focus();
  }, []);
  return ref;
}

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
  if (load.kind === 'failed') return <LoadFailed message={load.message} onRetry={() => void fetchCard()} />;
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

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  const heading = useFocusIfLost<HTMLHeadingElement>();
  return (
    <section className={styles.panel} role="alert">
      <h2 ref={heading} tabIndex={-1} className={styles.panelTitle}>
        Could not load your scorecard
      </h2>
      <p className={styles.muted}>{message}</p>
      <button type="button" className={styles.secondary} onClick={onRetry}>
        Try again
      </button>
    </section>
  );
}

function Closed() {
  const heading = useFocusIfLost<HTMLHeadingElement>();
  return (
    <section className={styles.panel}>
      <h2 ref={heading} tabIndex={-1} className={styles.panelTitle}>
        No review round is open right now
      </h2>
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

/** Exported for markup tests; pages use ScorecardEditor. */
export function CardForm({ user, catalog, card, reference, onSaved }: CardFormProps) {
  const { round, previous } = card;
  const saved = useMemo(() => draftFromScores(card.scores), [card.scores]);
  const { draft, setTriple, replace, restored } = usePersistentDraft(`${cardDraftPrefix(user.id)}${round.id}`, saved);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const toolbar = useFocusIfLost<HTMLDivElement>();

  const ids = useMemo(() => new Set(catalog.artifacts.map((artifact) => artifact.id)), [catalog.artifacts]);
  const summary = summarize(draft, catalog.artifacts);
  const dirty = hasChanges(draft, saved, ids);
  const touched = summary.rated + summary.partial.length > 0;
  const hasReference = Object.keys(reference).length > 0;
  const blocked = !dirty || summary.partial.length > 0 || status.kind === 'saving';

  // An old error no longer describes the card once the user changes it.
  const dropError = useCallback(
    () => setStatus((current) => (current.kind === 'error' ? { kind: 'idle' } : current)),
    [],
  );
  // Stable, so MatrixRow's memo holds.
  const edit = useCallback(
    (artifactId: string, triple: DraftTriple) => {
      setTriple(artifactId, triple);
      dropError();
    },
    [setTriple, dropError],
  );
  const change = (next: Draft) => {
    replace(next);
    dropError();
  };

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
        const nothingLeft = !hasChanges(rebase(saved, sent, next), next, ids);
        setStatus(nothingLeft ? { kind: 'idle' } : { kind: 'error', message: CHANGED_ELSEWHERE, reload: false });
        return;
      }
      replace((current) => rebase(sent, current, next));
      onSaved(outcome.card);
      setStatus({ kind: 'idle' });
    } catch (reason) {
      // The stored draft stays put on every failure; a 401 unmounts this form and the login notice says so.
      const reload = reason instanceof ApiError && reason.status === 409;
      setStatus({ kind: 'error', message: saveFailureMessage(reason), reload });
    }
  };

  const prefill = (next: Draft, what: string) => {
    if (touched && !confirm(`Replace your sliders with ${what}?`)) return;
    change(next);
  };

  const stateText = saveStateText(status, { dirty, restored, updatedAt: card.updatedAt });

  return (
    <>
      <div ref={toolbar} tabIndex={-1} role="group" aria-label="Your scorecard" className={styles.toolbar}>
        <div className={styles.toolbarText}>
          <strong>
            {round.label} · {summary.rated} of {catalog.artifacts.length} rated
          </strong>
          {summary.partial.length > 0 && <span className={styles.warn}> · {summary.partial.length} incomplete</span>}
          <span aria-live="polite">
            <span className={styles.muted}> · {stateText}</span>
          </span>
          {status.kind === 'error' && (
            <span key={attempt} className={styles.error} role="alert">
              {' '}
              {status.message}
            </span>
          )}
        </div>
        <div className={styles.toolbarActions}>
          {status.kind === 'error' && status.reload && (
            <button type="button" className={styles.secondary} onClick={() => location.reload()}>
              Reload page
            </button>
          )}
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
            <button type="button" className={styles.secondary} onClick={() => change(saved)}>
              Discard changes
            </button>
          )}
          {touched && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                if (confirm('Clear every slider?')) change(EMPTY);
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
        onChange={edit}
        reference={reference}
      />
    </>
  );
}
