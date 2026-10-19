import type { Snapshot } from '../src/domain/api-types.ts';
import { GRADES, MAX_SCORE, MIN_SCORE } from '../src/domain/grades.ts';

/** `Date.prototype.toISOString()` output: what the API sends, and the only form its confirm accepts. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Where (`.ratings[0].artifact`) and what is wrong. */
type Problem = [path: string, message: string];
type Check = (value: unknown) => Problem | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function leaf(test: (value: unknown) => boolean, message: string): Check {
  return (value) => (value === undefined ? ['', 'is missing'] : test(value) ? undefined : ['', message]);
}

function isCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [y = 0, m = 0, d = 0] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === value;
}

const text = leaf((value) => typeof value === 'string', 'is not text');
const date = leaf(isCalendarDate, 'is not a YYYY-MM-DD date');
/** null is a factor that does not apply to the item. */
const scoreOrNa = leaf(
  (value) => value === null || (typeof value === 'number' && value >= MIN_SCORE && value <= MAX_SCORE),
  `is not a score from ${MIN_SCORE} to ${MAX_SCORE} or null`,
);
/** The public site never says how many people rated an item, so this field must be absent. */
const unpublished: Check = (value) => (value === undefined ? undefined : ['', 'must not be published']);
const oneOf = (allowed: readonly string[], what: string) =>
  leaf((value) => typeof value === 'string' && allowed.includes(value), `is not ${what}`);

function object(shape: Record<string, Check>): Check {
  return (value) => {
    if (value === undefined) return ['', 'is missing'];
    if (!isRecord(value)) return ['', 'is not an object'];
    for (const [key, check] of Object.entries(shape)) {
      const problem = check(value[key]);
      if (problem) return [`.${key}${problem[0]}`, problem[1]];
    }
    return undefined;
  };
}

function list(item: Check, { nonEmpty = false } = {}): Check {
  return (value) => {
    if (value === undefined) return ['', 'is missing'];
    if (!Array.isArray(value)) return ['', 'is not a list'];
    if (nonEmpty && value.length === 0) return ['', 'is empty'];
    for (const [index, entry] of value.entries()) {
      const problem = item(entry);
      if (problem) return [`[${index}]${problem[0]}`, problem[1]];
    }
    return undefined;
  };
}

const point = object({
  round: text,
  roundLabel: text,
  date,
  scores: object({ capability: scoreOrNa, ux: scoreOrNa, cost: scoreOrNa, outlook: scoreOrNa }),
  raters: unpublished,
  grade: oneOf(GRADES, 'a grade'),
  note: text,
});

const snapshotShape = object({
  generatedAt: text,
  asOf: leaf((value) => value === '' || isCalendarDate(value), "is neither '' nor a YYYY-MM-DD date"),
  workloads: list(object({ id: text, name: text, shortName: text, blurb: text })),
  ratings: list(
    object({
      artifact: object({
        id: text,
        name: text,
        workload: text,
        status: oneOf(['ga', 'preview', 'retired'], 'ga, preview, or retired'),
      }),
      current: point,
      history: list(point, { nonEmpty: true }),
    }),
  ),
});

/**
 * Why `value` can't be the public site's snapshot, or undefined when it can. Matches `Snapshot` and what the site
 * renders from it. The problem names a path, never a value from the response.
 */
export function snapshotProblem(value: unknown): string | undefined {
  const problem = snapshotShape(value);
  if (problem) return `snapshot${problem[0]} ${problem[1]}`;
  const { workloads, ratings } = value as Snapshot;
  const listed = new Set(workloads.map((workload) => workload.id));
  const stray = ratings.findIndex((rating) => !listed.has(rating.artifact.workload));
  return stray === -1 ? undefined : `snapshot.ratings[${stray}].artifact.workload is not one of the listed workloads`;
}

export function isSnapshot(value: unknown): value is Snapshot {
  return snapshotProblem(value) === undefined;
}

export function isIsoTimestamp(value: string): boolean {
  if (!ISO_TIME.test(value)) return false;
  const time = Date.parse(value);
  return !Number.isNaN(time) && new Date(time).toISOString() === value;
}

function codeOf(value: unknown): string {
  return isRecord(value) && typeof value.code === 'string' ? value.code : '';
}

/** The error's message plus Node's cause (`connect ECONNREFUSED …`, `getaddrinfo ENOTFOUND …`), as one sentence. */
export function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error.cause : undefined;
  const detail = (cause instanceof Error && cause.message) || codeOf(cause);
  const reason = detail && !message.includes(detail) ? `${message} (${detail})` : message;
  return /[.!?]$/.test(reason) ? reason : `${reason}.`;
}

/** The parts of a configured URL a log must not show: credentials, and everything from `?` or `#` on. */
export function urlSecrets(url: string): string[] {
  const found = [/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)@/i.exec(url)?.[1] ?? '', /[?#].*$/s.exec(url)?.[0] ?? ''];
  if (URL.canParse(url)) {
    const parsed = new URL(url);
    found.push(parsed.username && `${parsed.username}:${parsed.password}`, parsed.search, parsed.hash);
  }
  return [...new Set(found.filter(Boolean))];
}

/**
 * The token trimmed, as a header carries it, or undefined when what's left has a character outside 0x21-0x7E. Node
 * rejects such a header and quotes the (trimmed) value in its error, so it must never reach fetch.
 */
export function headerToken(raw: string): string | undefined {
  const token = raw.trim();
  return /[^\x21-\x7e]/.test(token) ? undefined : token;
}

/** Every form of the token an error could quote: as read, trimmed, and URL-encoded. */
export function tokenSecrets(raw: string): string[] {
  const forms = [raw, raw.trim()];
  for (const form of [...forms]) {
    try {
      forms.push(encodeURIComponent(form));
    } catch {
      // A lone surrogate can't be encoded, so it can't appear encoded either.
    }
  }
  return [...new Set(forms.filter(Boolean))];
}

/** Longest first, so a secret that contains another is replaced whole. */
export function redact(text: string, secrets: readonly string[]): string {
  return secrets
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .reduce((out, secret) => out.split(secret).join('[redacted]'), text);
}

/** Escapes a `::warning::` message so a line break in it can't start another workflow command. */
export function commandData(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/**
 * On Actions the token travels in a request header to a public host, so the base URL must be https. Locally, plain
 * http to a Functions host on localhost is the normal case.
 */
export function baseProblem(base: string, onActions: boolean): string | undefined {
  if (onActions && !/^https:\/\//i.test(base)) {
    return 'FCR_API_URL must start with https:// on Actions, because the snapshot token travels in a header.';
  }
  return undefined;
}
