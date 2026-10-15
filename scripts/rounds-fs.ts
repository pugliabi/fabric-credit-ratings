import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACTS } from '../src/data/artifacts.ts';
import type { Round, RoundData, RoundNotes, Score, Scorecard, ScoreTriple } from '../src/domain/types.ts';

export const ROUND_ID = /^\d{4}-[A-Za-z0-9]{1,3}$/;
/** GitHub usernames: letters, digits, single hyphens, at most 39 characters. */
export const RATER_ID = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

const ARTIFACT_IDS = new Set(ARTIFACTS.map((artifact) => artifact.id));

function isScore(value: unknown): value is Score {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7;
}

/** Checks a raw { artifactId: [c, u, k] } object; unknown ids and bad triples become errors. */
export function validateScores(raw: unknown): { scores: Record<string, ScoreTriple>; errors: string[] } {
  const scores: Record<string, ScoreTriple> = {};
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { scores, errors: ['Scores must be an object keyed by artifact id.'] };
  }
  for (const [id, triple] of Object.entries(raw)) {
    if (!ARTIFACT_IDS.has(id)) {
      errors.push(`Unknown item "${id}".`);
      continue;
    }
    if (!Array.isArray(triple) || triple.length !== 3 || !triple.every(isScore)) {
      errors.push(`"${id}" needs three whole scores from 1 to 7.`);
      continue;
    }
    const [capability, ux, cost] = triple as [Score, Score, Score];
    scores[id] = [capability, ux, cost];
  }
  return { scores, errors };
}

/** One triple per line, catalog order, so diffs show exactly which items moved. */
export function formatScorecard(card: Scorecard): string {
  const lines = ARTIFACTS.flatMap((artifact) => {
    const triple = card.scores[artifact.id];
    return triple ? [`    ${JSON.stringify(artifact.id)}: [${triple.join(', ')}]`] : [];
  });
  const scores = lines.length > 0 ? `{\n${lines.join(',\n')}\n  }` : '{}';
  return `{\n  "rater": ${JSON.stringify(card.rater)},\n  "submittedAt": ${JSON.stringify(card.submittedAt)},\n  "scores": ${scores}\n}\n`;
}

export function formatNotes(notes: RoundNotes): string {
  const ordered: RoundNotes = {};
  for (const artifact of ARTIFACTS) {
    const text = notes[artifact.id]?.trim();
    if (text) ordered[artifact.id] = text;
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function formatRound(round: Round): string {
  const { id, label, status, publishedOn } = round;
  return `${JSON.stringify({ id, label, status, publishedOn }, null, 2)}\n`;
}

/** Today in the site's time zone, as YYYY-MM-DD. */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
}

/** File access for src/data/rounds and src/data/raters.json under `root`. */
export function createStore(root: string) {
  const roundsDir = join(root, 'src', 'data', 'rounds');
  const ratersFile = join(root, 'src', 'data', 'raters.json');

  function readRound(id: string): RoundData | undefined {
    const dir = join(roundsDir, id);
    const roundFile = join(dir, 'round.json');
    if (!existsSync(roundFile)) return undefined;
    const scoresDir = join(dir, 'scores');
    const scorecards = existsSync(scoresDir)
      ? readdirSync(scoresDir)
          .filter((file) => file.endsWith('.json'))
          .sort()
          .map((file) => readJson<Scorecard>(join(scoresDir, file), { rater: file, submittedAt: '', scores: {} }))
      : [];
    return {
      round: readJson<Round>(roundFile, { id, label: id, status: 'open', publishedOn: null }),
      notes: readJson<RoundNotes>(join(dir, 'notes.json'), {}),
      scorecards,
    };
  }

  function readRounds(): RoundData[] {
    if (!existsSync(roundsDir)) return [];
    return readdirSync(roundsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readRound(entry.name))
      .filter((data): data is RoundData => data !== undefined)
      .sort((a, b) => a.round.id.localeCompare(b.round.id));
  }

  function writeRound(round: Round): void {
    const dir = join(roundsDir, round.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'round.json'), formatRound(round));
    if (!existsSync(join(dir, 'notes.json'))) writeNotes(round.id, {});
  }

  function writeNotes(roundId: string, notes: RoundNotes): void {
    writeFileSync(join(roundsDir, roundId, 'notes.json'), formatNotes(notes));
  }

  /** Returns the repo-relative path that was written. */
  function writeScorecard(roundId: string, card: Scorecard): string {
    const dir = join(roundsDir, roundId, 'scores');
    mkdirSync(dir, { recursive: true });
    const file = `${card.rater.toLowerCase()}.json`;
    writeFileSync(join(dir, file), formatScorecard(card));
    return `src/data/rounds/${roundId}/scores/${file}`;
  }

  function readRaters(): string[] {
    const raters = readJson<unknown>(ratersFile, []);
    return Array.isArray(raters) ? raters.filter((r): r is string => typeof r === 'string') : [];
  }

  return { readRound, readRounds, writeRound, writeNotes, writeScorecard, readRaters };
}

export type Store = ReturnType<typeof createStore>;
