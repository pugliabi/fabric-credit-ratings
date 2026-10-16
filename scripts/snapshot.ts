import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Snapshot } from '../src/domain/api-types.ts';
import {
  baseProblem,
  commandData,
  failureReason,
  headerToken,
  isIsoTimestamp,
  isSnapshot,
  redact,
  snapshotProblem,
  tokenSecrets,
  urlSecrets,
} from './snapshot-checks.ts';

const OUT = new URL('../src/data/snapshot.json', import.meta.url);
const SETTINGS = new URL('../api/local.settings.json', import.meta.url);

/** The GET can wait about 150 s for a paused database; Functions cut a request off at 230 s. */
const TIMEOUT_MS = 200_000;

function localToken(): string {
  if (!existsSync(SETTINGS)) return '';
  try {
    const raw = readFileSync(SETTINGS, 'utf8').replace(/^\uFEFF/, '');
    const settings = JSON.parse(raw) as { Values?: Record<string, string> };
    return settings.Values?.SNAPSHOT_TOKEN ?? '';
  } catch {
    // An unreadable settings file means no token: the fetch then fails with a warning, like any other failure.
    return '';
  }
}

/** SNAPSHOT_TOKEN as configured, untrimmed: the environment's (CI), else the settings file's (local runs). */
function configuredToken(): string {
  const fromEnv = process.env.SNAPSHOT_TOKEN ?? '';
  return fromEnv.trim() ? fromEnv : localToken();
}

/** The committed snapshot, or undefined when there is none or it isn't JSON, so the fetched one replaces it. */
function committedSnapshot(): unknown {
  if (!existsSync(OUT)) return undefined;
  try {
    return JSON.parse(readFileSync(OUT, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    warn('The committed src/data/snapshot.json is not valid JSON, so the fetched snapshot replaces it.');
    return undefined;
  }
}

function sameContent(a: Snapshot, b: Snapshot): boolean {
  return JSON.stringify({ ...a, generatedAt: '' }) === JSON.stringify({ ...b, generatedAt: '' });
}

async function refresh(base: string, token: string): Promise<{ message: string; generatedAt: string }> {
  const get = () =>
    fetch(`${base}/api/build/snapshot`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  let response = await get();
  if (response.status === 503) {
    // A database still waking, or a clock read that timed out behind a stalled write, answers 503.
    await response.body?.cancel();
    response = await get();
  }
  if (!response.ok) throw new Error(`${base} answered HTTP ${response.status}.`);
  const snapshot: unknown = await response.json();
  if (!isSnapshot(snapshot)) throw new Error(`The response is not a valid snapshot: ${snapshotProblem(snapshot)}.`);
  const { generatedAt } = snapshot;
  // Also keeps anything but one timestamp out of $GITHUB_OUTPUT.
  if (!isIsoTimestamp(generatedAt)) throw new Error("The snapshot's generatedAt is not an ISO timestamp.");
  const current = committedSnapshot();
  if (isSnapshot(current) && sameContent(current, snapshot)) return { message: 'Snapshot unchanged.', generatedAt };
  writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);
  const asOf = snapshot.asOf || 'no published round';
  return {
    message: `Wrote ${snapshot.ratings.length} ratings (as of ${asOf}) to src/data/snapshot.json.`,
    generatedAt,
  };
}

async function confirm(base: string, token: string, generatedAt: string): Promise<void> {
  const response = await fetch(`${base}/api/build/snapshot/deployed`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ generatedAt }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status !== 204) throw new Error(`${base} answered the confirmation with HTTP ${response.status}.`);
}

const base = (process.env.FCR_API_URL || 'http://localhost:7071').replace(/\/+$/, '');
const baseIssue = baseProblem(base, Boolean(process.env.GITHUB_ACTIONS));
if (baseIssue) {
  console.error(`::error::${commandData(baseIssue)}`);
  process.exit(1);
}
const rawToken = configuredToken();
const token = headerToken(rawToken);
// Node's errors can quote a header value or a whole URL, so warnings never show the token or the URL's secrets.
const secrets = [...tokenSecrets(rawToken), ...urlSecrets(base)];
const warn = (message: string) => {
  const safe = redact(message, secrets);
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${commandData(safe)}` : safe);
};

let fetched: { message: string; generatedAt: string } | undefined;
try {
  if (token === undefined) throw new Error("SNAPSHOT_TOKEN has characters a header can't carry.");
  fetched = await refresh(base, token);
  console.log(fetched.message);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `generatedAt=${fetched.generatedAt}\n`);
} catch (error) {
  warn(`Snapshot not refreshed: ${failureReason(error)} Keeping the committed src/data/snapshot.json.`);
}
if (fetched && token !== undefined && process.argv.includes('--confirm')) {
  try {
    await confirm(base, token, fetched.generatedAt);
    console.log(`Confirmed the snapshot of ${fetched.generatedAt}.`);
  } catch (error) {
    warn(`Snapshot not confirmed: ${failureReason(error)}`);
  }
}
