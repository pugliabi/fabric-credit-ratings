import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = new URL('../src/data/snapshot.json', import.meta.url);
const SETTINGS = new URL('../api/local.settings.json', import.meta.url);

/** The GET can wait about 150 s for a paused database; Functions cut a request off at 230 s. */
const TIMEOUT_MS = 200_000;

interface SnapshotShape {
  generatedAt: string;
  asOf: string;
  workloads: unknown[];
  ratings: unknown[];
}

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

function isSnapshot(value: unknown): value is SnapshotShape {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.generatedAt === 'string' &&
    typeof record.asOf === 'string' &&
    Array.isArray(record.workloads) &&
    Array.isArray(record.ratings)
  );
}

function sameContent(a: SnapshotShape, b: SnapshotShape): boolean {
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
  if (!isSnapshot(snapshot)) throw new Error('The response is not a snapshot.');
  const { generatedAt } = snapshot;
  const current: unknown = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : undefined;
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

const warn = (message: string) => console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message);
const base = (process.env.FCR_API_URL || 'http://localhost:7071').replace(/\/+$/, '');
const token = process.env.SNAPSHOT_TOKEN || localToken();

let fetched: { message: string; generatedAt: string } | undefined;
try {
  fetched = await refresh(base, token);
  console.log(fetched.message);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `generatedAt=${fetched.generatedAt}\n`);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  warn(`Snapshot not refreshed: ${reason} Keeping the committed src/data/snapshot.json.`);
}
if (fetched && process.argv.includes('--confirm')) {
  try {
    await confirm(base, token, fetched.generatedAt);
    console.log(`Confirmed the snapshot of ${fetched.generatedAt}.`);
  } catch (error) {
    warn(`Snapshot not confirmed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
