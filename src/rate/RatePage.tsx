import { useState } from 'react';
import { getRatings, openRound } from '../data';
import { ARTIFACTS } from '../data/artifacts';
import { REPO } from '../data/site';
import { encodeIssue } from '../domain/payload';
import type { Round } from '../domain/types';
import { draftFromValues, summarize, type Draft } from '../rating-ui/draft';
import { ScoreMatrix } from '../rating-ui/ScoreMatrix';
import { usePersistentDraft } from '../rating-ui/usePersistentDraft';
import styles from './RatePage.module.css';

const ROUND = openRound();
const CURRENT = Object.fromEntries(getRatings().map((rating) => [rating.artifact.id, rating.current.scores]));
const NEW_ISSUE = `https://github.com/${REPO}/issues/new`;
/** GitHub starts rejecting prefilled issue links somewhere past 8,000 characters. */
const MAX_URL = 7500;
const EMPTY: Draft = {};

export function RatePage() {
  return (
    <>
      <header className={styles.header}>
        <div className={styles.inner}>
          <a className={styles.back} href="/">
            ← Microsoft Fabric Credit Ratings
          </a>
          <h1 className={styles.title}>{ROUND ? `Score ${ROUND.label}` : 'Submit scores'}</h1>
          <p className={styles.lede}>
            Rate the Fabric items you use from 1 to 7 on feature capability, user experience, and CU / token cost. Skip
            anything you have not used.
          </p>
        </div>
      </header>
      <main className={styles.main}>{ROUND ? <RateForm round={ROUND} /> : <Closed />}</main>
    </>
  );
}

function Closed() {
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>No review round is open</h2>
      <p className={styles.muted}>
        Scores are collected in rounds, usually once a quarter. Check back when the next one opens, or browse the{' '}
        <a href="/">current ratings</a>.
      </p>
    </section>
  );
}

function RateForm({ round }: { round: Round }) {
  const { draft, setTriple, replace, restored } = usePersistentDraft(`fcr-rate:${round.id}`, EMPTY);
  const [submitted, setSubmitted] = useState<{ title: string; body: string; linked: boolean }>();
  const summary = summarize(draft);
  const hasCurrent = Object.keys(CURRENT).length > 0;

  const issue = encodeIssue(round, summary.scores);
  const url = `${NEW_ISSUE}?title=${encodeURIComponent(issue.title)}&body=${encodeURIComponent(issue.body)}`;
  const linked = url.length <= MAX_URL;

  const submit = () => {
    if (linked) window.open(url, '_blank', 'noopener');
    setSubmitted({ ...issue, linked });
  };

  return (
    <>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>How submitting works</h2>
        <ol className={styles.steps}>
          <li>Set the sliders for the items you know. Your draft is kept in this browser until you submit.</li>
          <li>
            Submit opens a GitHub issue with your scores filled in. Click <strong>Create</strong> on GitHub to send it.
          </li>
          <li>
            A bot records it within a minute if your GitHub account is on the rater list. Submit again any time to replace
            your scores for {round.label}.
          </li>
        </ol>
        <p className={styles.muted}>
          The issue is public, so your GitHub username and scores are visible. The site only shows averages once the
          round is published.
        </p>
      </section>

      {submitted && (
        <section className={styles.panel} data-tone="success">
          <h2 className={styles.panelTitle}>Finish on GitHub</h2>
          {submitted.linked ? (
            <p>
              A new tab opened with your issue. Click <strong>Create</strong> there. If it did not open,{' '}
              <a href={url} target="_blank" rel="noopener">
                open it again
              </a>
              .
            </p>
          ) : (
            <>
              <p>
                Your scorecard is too long for a link. Copy it, then{' '}
                <a href={`${NEW_ISSUE}?title=${encodeURIComponent(submitted.title)}`} target="_blank" rel="noopener">
                  open a new issue
                </a>{' '}
                and paste it as the description.
              </p>
              <textarea className={styles.payload} readOnly rows={8} value={submitted.body} />
              <button
                type="button"
                className={styles.secondary}
                onClick={() => void navigator.clipboard.writeText(submitted.body)}
              >
                Copy scorecard
              </button>
            </>
          )}
        </section>
      )}

      <div className={styles.toolbar}>
        <div className={styles.toolbarText}>
          <strong>
            {summary.rated} of {ARTIFACTS.length} rated
          </strong>
          {summary.partial.length > 0 && <span className={styles.warn}> · {summary.partial.length} incomplete</span>}
          {restored && <span className={styles.muted}> · draft restored</span>}
        </div>
        <div className={styles.toolbarActions}>
          {hasCurrent && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                if (summary.rated === 0 || confirm('Replace your sliders with the current ratings?')) {
                  replace(draftFromValues(CURRENT));
                }
              }}
            >
              Start from current ratings
            </button>
          )}
          {summary.rated + summary.partial.length > 0 && (
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
          <button
            type="button"
            className={styles.primary}
            onClick={submit}
            disabled={summary.rated === 0 || summary.partial.length > 0}
          >
            Submit via GitHub
          </button>
        </div>
      </div>

      <ScoreMatrix draft={draft} onChange={setTriple} reference={CURRENT} />
    </>
  );
}
