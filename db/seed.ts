import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { closeDb, db, transaction } from '../api/src/lib/db.ts';
import { hashPassword, passwordProblem } from '../api/src/lib/password.ts';
import { LOGIN, validateScores } from '../api/src/lib/validate.ts';
import { listArtifacts, upsertArtifact, upsertWorkload } from '../api/src/repo/catalog.ts';
import { saveNote } from '../api/src/repo/notes.ts';
import { upsertRound } from '../api/src/repo/rounds.ts';
import { replaceScorecard } from '../api/src/repo/scores.ts';
import { createUser, findUserByLogin } from '../api/src/repo/users.ts';
import type { Round, RoundNotes, Scorecard } from '../src/domain/types.ts';
import { useTarget } from './target.ts';

const USAGE = 'Usage: npm run db:seed -- --admin <login> --name "<display name>" [--admin-only] [--database <name>]';

const args = useTarget(process.argv.slice(2));
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const adminOnly = args.includes('--admin-only');
const adminLogin = flag('admin')?.toLowerCase() ?? '';
const adminName = flag('name') ?? '';
if (!adminLogin || !adminName) throw new Error(USAGE);
if (!LOGIN.test(adminLogin)) throw new Error('Logins use 2 to 40 lowercase letters, digits, dots, dashes, or underscores.');

function readJson<T>(path: URL): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

async function ensureAdmin(): Promise<string> {
  if (await findUserByLogin(db, adminLogin)) return 'already exists, password unchanged';
  const password = process.env.FCR_ADMIN_PASSWORD ?? '';
  const problem = passwordProblem(password);
  if (problem) throw new Error(`Set FCR_ADMIN_PASSWORD first. ${problem}`);
  await createUser(db, { login: adminLogin, displayName: adminName, role: 'admin', passwordHash: await hashPassword(password) });
  return 'created';
}

async function seedCatalog(): Promise<string> {
  const { WORKLOADS } = await import('../src/data/workloads.ts');
  const { ARTIFACTS } = await import('../src/data/artifacts.ts');
  for (const [index, workload] of WORKLOADS.entries()) await upsertWorkload(db, workload, (index + 1) * 10);
  for (const workload of WORKLOADS) {
    const items = ARTIFACTS.filter((artifact) => artifact.workload === workload.id);
    for (const [index, artifact] of items.entries()) await upsertArtifact(db, artifact, (index + 1) * 10);
  }
  return `${WORKLOADS.length} workloads, ${ARTIFACTS.length} items`;
}

/** Round files name raters by GitHub login; they become rater accounts with no usable password. */
async function raterId(login: string): Promise<number> {
  const existing = await findUserByLogin(db, login.toLowerCase());
  if (existing) return existing.id;
  return createUser(db, { login: login.toLowerCase(), displayName: login, role: 'rater', passwordHash: 'unset' });
}

async function seedRounds(): Promise<string> {
  const root = new URL('../src/data/rounds/', import.meta.url);
  if (!existsSync(root)) return 'no round files';
  const known = new Set((await listArtifacts(db)).map((artifact) => artifact.id));
  const ids = readdirSync(root)
    .filter((id) => existsSync(new URL(`${id}/round.json`, root)))
    .sort();
  let cards = 0;
  let notes = 0;
  for (const id of ids) {
    const dir = new URL(`${id}/`, root);
    const round = readJson<Round>(new URL('round.json', dir));
    await upsertRound(db, round);
    const scoresDir = new URL('scores/', dir);
    const files = existsSync(scoresDir) ? readdirSync(scoresDir).filter((name) => name.endsWith('.json')) : [];
    for (const file of files) {
      const card = readJson<Scorecard>(new URL(file, scoresDir));
      const { scores, errors } = validateScores(card.scores, known);
      if (errors.length > 0) throw new Error(`${id}/scores/${file}: ${errors.join(' ')}`);
      const userId = await raterId(card.rater);
      await transaction((tx) => replaceScorecard(tx, round.id, userId, scores));
      cards += 1;
    }
    const notesPath = new URL('notes.json', dir);
    const roundNotes = existsSync(notesPath) ? readJson<RoundNotes>(notesPath) : {};
    for (const [artifactId, body] of Object.entries(roundNotes)) {
      await saveNote(db, round.id, artifactId, body.trim(), null);
      notes += 1;
    }
  }
  return `${ids.length} rounds, ${cards} scorecards, ${notes} notes`;
}

try {
  console.log(`Admin ${adminLogin}: ${await ensureAdmin()}`);
  if (!adminOnly) {
    console.log(`Catalog: ${await seedCatalog()}`);
    console.log(`Rounds: ${await seedRounds()}`);
  }
} finally {
  await closeDb();
}
