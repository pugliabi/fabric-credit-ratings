import { useCallback, useEffect, useId, useState } from 'react';
import type { AdminRound, DeployResult, PublishResult, RoundReview, SiteStatus } from '../domain/api-types';
import { useFocusIfLost } from '../hooks/useFocusIfLost';
import { api, errorMessage } from '../lib/api';
import { formatFullDate, formatTimestamp } from '../lib/format';
import { NewRoundForm } from './NewRoundForm';
import { localToday, publishDate } from './rounds';
import styles from './Admin.module.css';

interface PublishTabProps {
  rounds: readonly AdminRound[];
  catalogSize: number;
  onRounds: (rounds: AdminRound[]) => void;
}

export function PublishTab({ rounds, catalogSize, onRounds }: PublishTabProps) {
  const open = rounds.find((round) => round.status === 'open');
  // The server's order (published_on DESC, id DESC), so published[0] is the latest: the only one that can be reopened.
  const published = rounds
    .filter((round) => round.status === 'published')
    .sort((a, b) => (b.publishedOn ?? '').localeCompare(a.publishedOn ?? '') || b.id.localeCompare(a.id));
  const [site, setSite] = useState<SiteStatus>();
  const [notice, setNotice] = useState<{ title: string; text: string }>();
  const [error, setError] = useState('');
  /** Remounts the alert and the notice, so each result is announced (or focused) again. */
  const [attempt, setAttempt] = useState(0);

  const loadSite = useCallback(() => {
    api<SiteStatus>('GET', '/admin/site').then(setSite, (reason: unknown) => {
      setError(errorMessage(reason));
      setAttempt((count) => count + 1);
    });
  }, []);

  useEffect(loadSite, [loadSite]);

  const setStatus = async (round: AdminRound, body: Record<string, string>, title: string, text?: string) => {
    setError('');
    setNotice(undefined);
    setAttempt((count) => count + 1);
    try {
      // Publishing waits up to 10 s on GitHub's dispatch, which isn't the database waking; reopening doesn't.
      const options = { wakeNotice: body.status !== 'published' };
      const result = await api<PublishResult>('PUT', `/admin/rounds/${round.id}`, body, options);
      onRounds(result.rounds);
      setNotice({ title, text: text ?? result.deploy?.message ?? '' });
      loadSite();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const reopen = (round: AdminRound) => {
    if (!confirm(`Reopen ${round.label}? Raters can change their cards again until you publish it again.`)) return;
    void setStatus(
      round,
      { status: 'open' },
      `${round.label} is open again`,
      `The public site keeps showing ${round.label} until the next site update.`,
    );
  };

  return (
    <div className={styles.publishTab}>
      {/* Before NewRoundForm: after a publish both mount, and the notice's focus effect runs first. */}
      {notice && <Notice key={attempt} title={notice.title} text={notice.text} />}
      {error && (
        <p key={attempt} className={styles.error} role="alert">
          {error}
        </p>
      )}

      {open ? (
        <OpenRound
          key={open.id}
          round={open}
          catalogSize={catalogSize}
          earliestDate={published[0]?.publishedOn ?? undefined}
          onPublish={(publishedOn) =>
            setStatus(open, { status: 'published', publishedOn }, `${open.label} is published`)
          }
        />
      ) : (
        <NewRoundForm rounds={rounds} onCreated={onRounds} />
      )}

      {site && <SitePanel site={site} onCheck={loadSite} />}

      {published.length > 0 && (
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Published rounds</h2>
          <ul className={styles.roundList}>
            {published.map((round, index) => (
              <li key={round.id}>
                <span>
                  <strong>{round.label}</strong> · published {formatFullDate(round.publishedOn ?? '')} ·{' '}
                  {round.scorecards} {round.scorecards === 1 ? 'card' : 'cards'}
                </span>
                {index === 0 && !open && (
                  <button type="button" className={styles.secondary} onClick={() => reopen(round)}>
                    Reopen
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className={styles.hint}>
            To fix a published score or why without reopening, edit it on the Review tab. The change reaches the public
            site at the next update.
          </p>
        </section>
      )}
    </div>
  );
}

/** A publish or reopen result. Its heading takes focus when the button that caused it is gone. */
function Notice({ title, text }: { title: string; text: string }) {
  const heading = useFocusIfLost<HTMLHeadingElement>();
  const textId = useId();
  return (
    <section className={styles.panel} data-tone="success">
      <h2 ref={heading} tabIndex={-1} className={styles.panelTitle} aria-describedby={text ? textId : undefined}>
        {title}
      </h2>
      {text && <p id={textId}>{text}</p>}
    </section>
  );
}

interface SitePanelProps {
  site: SiteStatus;
  onCheck: () => void;
}

/**
 * "Behind" stays true until the deploy workflow confirms its build, about two minutes after an update starts.
 * Exported for markup tests.
 */
export function SitePanel({ site, onCheck }: SitePanelProps) {
  const [updating, setUpdating] = useState(false);
  const [result, setResult] = useState('');
  const [failure, setFailure] = useState('');
  const [attempt, setAttempt] = useState(0);

  // The button stays mounted and focused, so the outcome is announced next to it.
  const updateSite = async () => {
    if (updating) return;
    setAttempt((count) => count + 1);
    setUpdating(true);
    setResult('');
    setFailure('');
    try {
      const started = await api<DeployResult>('POST', '/admin/site/update', undefined, { wakeNotice: false });
      setResult(started.message);
    } catch (reason) {
      setFailure(errorMessage(reason));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>
        {site.behind ? 'The public site is behind' : 'The public site is up to date'}
      </h2>
      <p className={styles.muted}>
        {site.lastSnapshotAt
          ? `The live site shows the database as of ${formatTimestamp(site.lastSnapshotAt)}.`
          : 'No deploy has confirmed a build from the database yet.'}
        {site.lastSnapshotAt && site.behind && ' Published ratings, notes, or the catalog changed since then.'}
      </p>
      <div className={styles.fields}>
        {site.deployConfigured ? (
          <button
            type="button"
            className={site.behind ? styles.primary : styles.secondary}
            aria-disabled={updating}
            onClick={() => void updateSite()}
          >
            {updating ? 'Starting the update…' : 'Update public site'}
          </button>
        ) : (
          <p className={styles.warn}>
            Automatic site updates are not set up. Set GITHUB_DISPATCH_TOKEN and GITHUB_REPO in the Function App
            settings.
          </p>
        )}
        <button type="button" className={styles.secondary} onClick={onCheck}>
          Check again
        </button>
        <span className={styles.muted} aria-live="polite">
          {result}
        </span>
        {failure && (
          <span key={attempt} className={styles.error} role="alert">
            {failure}
          </span>
        )}
      </div>
    </section>
  );
}

interface OpenRoundProps {
  round: AdminRound;
  catalogSize: number;
  /** The latest published round's date; the API refuses anything earlier. */
  earliestDate?: string;
  onPublish: (publishedOn: string) => Promise<void>;
}

function OpenRound({ round, catalogSize, earliestDate, onPublish }: OpenRoundProps) {
  const [review, setReview] = useState<RoundReview>();
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api<RoundReview>('GET', `/admin/rounds/${round.id}/review`, undefined, { signal: controller.signal }).then(
      setReview,
      (reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      },
    );
    return () => controller.abort();
  }, [round.id]);

  if (error) {
    return (
      <p className={styles.error} role="alert">
        {error}
      </p>
    );
  }
  if (!review) return <p className={styles.muted}>Checking {round.label}…</p>;
  return (
    <PublishForm
      round={round}
      review={review}
      catalogSize={catalogSize}
      earliestDate={earliestDate}
      onPublish={onPublish}
    />
  );
}

interface PublishFormProps extends OpenRoundProps {
  review: RoundReview;
}

/** Exported for markup tests; the page uses PublishTab. */
export function PublishForm({ round, review, catalogSize, earliestDate, onPublish }: PublishFormProps) {
  // After a reopen, or on arrival after login, the button that had focus is gone.
  const heading = useFocusIfLost<HTMLHeadingElement>();
  const [date, setDate] = useState(() => publishDate(localToday(), earliestDate));
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);

  const missing = review.items.filter((item) => !review.notes[item.artifact.id]?.trim());
  const { raters } = review;
  const blocked = busy || review.items.length === 0 || !date || (missing.length > 0 && !force);

  const publish = async () => {
    if (blocked) return;
    if (!confirm(`Publish ${round.label}, dated ${formatFullDate(date)}? Raters can no longer change their cards.`)) {
      return;
    }
    setBusy(true);
    await onPublish(date);
    setBusy(false);
  };

  return (
    <section className={styles.panel}>
      <h2 ref={heading} tabIndex={-1} className={styles.panelTitle}>
        Publish {round.label}
      </h2>
      <ul className={styles.checklist}>
        <li data-ok={review.items.length > 0}>
          {review.items.length} of {catalogSize} items scored
        </li>
        <li data-ok={raters.length > 0}>
          {raters.length} {raters.length === 1 ? 'rater' : 'raters'}
          {raters.length > 0 && `: ${raters.map((rater) => rater.name).join(', ')}`}
        </li>
        <li data-ok={missing.length === 0}>
          {missing.length === 0
            ? 'Every scored item has a why'
            : `${missing.length} missing a why: ${missing.map((item) => item.artifact.name).join(', ')}`}
        </li>
      </ul>
      <p className={styles.muted}>Items nobody scored stay off the public site.</p>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Publication date</span>
          <input
            type="date"
            value={date}
            min={earliestDate}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </label>
        {missing.length > 0 && (
          <label className={styles.check}>
            <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
            Publish without them
          </label>
        )}
        {/* aria-disabled, not disabled: focus stays on it through the publish and after a refusal. */}
        <button type="button" className={styles.primary} aria-disabled={blocked} onClick={() => void publish()}>
          {busy ? 'Publishing…' : `Publish ${round.label}`}
        </button>
      </div>
    </section>
  );
}
