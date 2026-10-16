import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
  const [siteError, setSiteError] = useState('');
  const [siteFailures, setSiteFailures] = useState(0);
  const siteRun = useRef(0);
  const [notice, setNotice] = useState<{ title: string; text: string }>();
  const [error, setError] = useState('');
  /** Remounts the notice, so each publish or reopen result takes focus again. */
  const [attempt, setAttempt] = useState(0);
  /** Remounts the alert, so each failure is announced again. */
  const [failures, setFailures] = useState(0);
  const [busy, setBusy] = useState(false);

  // Only the latest read lands, so a slow older answer can't overwrite a newer one.
  const loadSite = useCallback(() => {
    const mine = ++siteRun.current;
    api<SiteStatus>('GET', '/admin/site').then(
      (next) => {
        if (mine !== siteRun.current) return;
        setSite(next);
        setSiteError('');
      },
      (reason: unknown) => {
        if (mine !== siteRun.current) return;
        setSiteError(errorMessage(reason));
        setSiteFailures((count) => count + 1);
      },
    );
  }, []);

  useEffect(loadSite, [loadSite]);

  const setStatus = async (round: AdminRound, body: Record<string, string>, title: string, text?: string) => {
    setBusy(true);
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
      setFailures((count) => count + 1);
    } finally {
      setBusy(false);
    }
  };

  const reopen = (round: AdminRound) => {
    if (busy) return;
    if (!confirm(`Reopen ${round.label}? Raters can change their cards again until you publish it again.`)) return;
    void setStatus(
      round,
      { status: 'open' },
      `${round.label} is open again`,
      `The public site keeps showing ${round.label} until the next site update.`,
    );
  };

  const remove = async (round: AdminRound) => {
    if (busy) return;
    const cards =
      round.scorecards === 0
        ? ''
        : ` and its ${round.scorecards} ${round.scorecards === 1 ? 'scorecard' : 'scorecards'}`;
    if (!confirm(`Delete ${round.label}${cards}? This cannot be undone.`)) return;
    setBusy(true);
    setError('');
    setNotice(undefined);
    setAttempt((count) => count + 1);
    try {
      const rounds = await api<AdminRound[]>('DELETE', `/admin/rounds/${round.id}`, undefined, { wakeNotice: true });
      onRounds(rounds);
      setNotice({ title: `${round.label} was deleted.`, text: '' });
    } catch (reason) {
      setError(errorMessage(reason));
      setFailures((count) => count + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.publishTab}>
      {/* Before NewRoundForm: after a publish both mount, and the notice's focus effect runs first. */}
      {notice && <Notice key={`notice-${attempt}`} title={notice.title} text={notice.text} />}
      {error && (
        <p key={`error-${failures}`} className={styles.error} role="alert">
          {error}
        </p>
      )}

      <RoundsPanel open={open} published={published} />

      {open ? (
        <OpenRound
          key={open.id}
          round={open}
          catalogSize={catalogSize}
          earliestDate={published[0]?.publishedOn ?? undefined}
          onPublish={(publishedOn) =>
            setStatus(open, { status: 'published', publishedOn }, `${open.label} is published`)
          }
          onDelete={() => void remove(open)}
          deleting={busy}
        />
      ) : (
        <NewRoundForm rounds={rounds} onCreated={onRounds} />
      )}

      {(site || siteError) && (
        <SitePanel site={site} readError={siteError} readFailures={siteFailures} onCheck={loadSite} />
      )}

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Published rounds</h2>
        {published.length === 0 ? (
          <p className={styles.muted}>No published rounds yet.</p>
        ) : (
          <>
            <ul className={styles.roundList}>
              {published.map((round, index) => (
                <li key={round.id}>
                  <span>
                    <PublishedLine round={round} />
                  </span>
                  {index === 0 && !open && (
                    <button
                      type="button"
                      className={styles.secondary}
                      aria-disabled={busy}
                      onClick={() => reopen(round)}
                    >
                      {busy ? 'Reopening…' : 'Reopen'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className={styles.hint}>
              To fix a published score or why without reopening, edit it on the Review tab. The change reaches the
              public site at the next update.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

const cardCount = (count: number) => `${count} ${count === 1 ? 'card' : 'cards'}`;

function PublishedLine({ round }: { round: AdminRound }) {
  return (
    <>
      <strong>{round.label}</strong> · published {formatFullDate(round.publishedOn ?? '')} ·{' '}
      {cardCount(round.scorecards)}
    </>
  );
}

/** Always on the page, open round or not, so round management can be found at any time. */
function RoundsPanel({ open, published }: { open: AdminRound | undefined; published: readonly AdminRound[] }) {
  const titleId = useId();
  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.panelTitle}>
        Rounds
      </h2>
      <ul className={styles.roundList}>
        {open && (
          <li>
            <span>
              <strong>{open.label}</strong> · open · {cardCount(open.scorecards)}
              <span className={styles.muted}> · raters score this round; publish or delete it below</span>
            </span>
          </li>
        )}
        {published.map((round) => (
          <li key={round.id}>
            <span>
              <PublishedLine round={round} />
            </span>
          </li>
        ))}
        {!open && published.length === 0 && (
          <li>
            <span className={styles.muted}>No rounds yet. Start one below.</span>
          </li>
        )}
      </ul>
      <p className={styles.muted}>
        {open
          ? `Only one round can be open. Publish or delete ${open.label} to start the next one.`
          : 'Start the next round below. The form suggests the next month; the id and label can be changed.'}
      </p>
    </section>
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
  /** Undefined until a read has worked: the panel then shows only the failure and Check again. */
  site: SiteStatus | undefined;
  /** The latest read's failure. The last status that did load stays on screen beside it. */
  readError?: string;
  /** Remounts the read failure's alert, so each failure is announced again. */
  readFailures?: number;
  onCheck: () => void;
}

/**
 * "Behind" stays true until the deploy workflow confirms its build, about two minutes after an update starts.
 * Exported for markup tests.
 */
export function SitePanel({ site, readError = '', readFailures = 0, onCheck }: SitePanelProps) {
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
        {!site ? 'Public site status' : site.behind ? 'The public site is behind' : 'The public site is up to date'}
      </h2>
      <p className={styles.muted}>
        {!site
          ? "The site status didn't load."
          : site.lastSnapshotAt
            ? `The live site shows the database as of ${formatTimestamp(site.lastSnapshotAt)}.`
            : 'No deploy has confirmed a build from the database yet.'}
        {site?.lastSnapshotAt && site.behind && ' Published ratings, notes, or the catalog changed since then.'}
      </p>
      {/* Check again keeps its place with or without a status, so it keeps focus when a retry works. */}
      <div className={styles.fields}>
        {site &&
          (site.deployConfigured ? (
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
          ))}
        <button type="button" className={styles.secondary} onClick={onCheck}>
          Check again
        </button>
        <span className={styles.muted} aria-live="polite">
          {result}
        </span>
        {failure && (
          <span key={`update-${attempt}`} className={styles.error} role="alert">
            {failure}
          </span>
        )}
        {readError && (
          <span key={`read-${readFailures}`} className={styles.error} role="alert">
            {readError}
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
  onDelete?: () => void;
  /** A publish, reopen or delete is out; the page-level busy flag. */
  deleting?: boolean;
}

function OpenRound({ round, catalogSize, earliestDate, onPublish, onDelete, deleting }: OpenRoundProps) {
  const [review, setReview] = useState<RoundReview>();
  const [error, setError] = useState('');
  const [failures, setFailures] = useState(0);
  const [run, setRun] = useState(0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api<RoundReview>('GET', `/admin/rounds/${round.id}/review`, undefined, { signal: controller.signal }).then(
      setReview,
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(reason));
        setFailures((count) => count + 1);
        setRetrying(false);
      },
    );
    return () => controller.abort();
  }, [round.id, run]);

  if (!review && error) {
    return (
      <ReadFailed
        title={`Could not check ${round.label}`}
        message={error}
        attempt={failures}
        busy={retrying}
        onRetry={() => {
          setRetrying(true);
          setRun((count) => count + 1);
        }}
      />
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
      onDelete={onDelete}
      deleting={deleting}
    />
  );
}

interface ReadFailedProps {
  title: string;
  message: string;
  /** Remounts the alert, so the same message is announced again after another failed try. */
  attempt: number;
  busy: boolean;
  onRetry: () => void;
}

/** A failed read with Try again, which stays mounted and focusable while the retry runs. */
function ReadFailed({ title, message, attempt, busy, onRetry }: ReadFailedProps) {
  const heading = useFocusIfLost<HTMLHeadingElement>();
  return (
    <section className={styles.panel}>
      <h2 ref={heading} tabIndex={-1} className={styles.panelTitle}>
        {title}
      </h2>
      <p key={attempt} className={styles.error} role="alert">
        {message}
      </p>
      <button
        type="button"
        className={styles.secondary}
        aria-disabled={busy}
        onClick={() => {
          if (!busy) onRetry();
        }}
      >
        {busy ? 'Trying again…' : 'Try again'}
      </button>
    </section>
  );
}

interface PublishFormProps extends OpenRoundProps {
  review: RoundReview;
}

/** Exported for markup tests; the page uses PublishTab. */
export function PublishForm({
  round,
  review,
  catalogSize,
  earliestDate,
  onPublish,
  onDelete,
  deleting,
}: PublishFormProps) {
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
        <button type="button" className={styles.secondary} aria-disabled={busy || deleting} onClick={onDelete}>
          Delete round
        </button>
      </div>
    </section>
  );
}
