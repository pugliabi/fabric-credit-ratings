import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { closeDb, db, transaction } from '../api/src/lib/db.ts';
import { hashPassword, passwordProblem } from '../api/src/lib/password.ts';
import { LOGIN, isReservedId, validateScores } from '../api/src/lib/validate.ts';
import { listArtifacts, listWorkloads, upsertArtifact, upsertWorkload } from '../api/src/repo/catalog.ts';
import { saveNote } from '../api/src/repo/notes.ts';
import { listRounds, upsertRound } from '../api/src/repo/rounds.ts';
import { replaceScorecard } from '../api/src/repo/scores.ts';
import { markChanged } from '../api/src/repo/site.ts';
import { createUser, findUserByLogin } from '../api/src/repo/users.ts';
import type { Round, RoundNotes, Scorecard } from '../src/domain/types.ts';
import { useTarget } from './target.ts';

const USAGE =
  'Usage: npm run db:seed -- --admin <login> --name "<display name>" [--admin-only] [--force] ' +
  '[--server <host>] [--database <name>]';
const VALUE_FLAGS = ['--admin', '--name'];
const SWITCHES = ['--admin-only', '--force'];

const args = useTarget(process.argv.slice(2));
const values: Record<string, string> = {};
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i] ?? '';
  if (VALUE_FLAGS.includes(arg)) {
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value. ${USAGE}`);
    values[arg.slice(2)] = value;
    i += 1;
  } else if (!SWITCHES.includes(arg)) {
    throw new Error(`Unknown argument "${arg}". Quote names that contain spaces. ${USAGE}`);
  }
}
const adminOnly = args.includes('--admin-only');
const force = args.includes('--force');
const adminLogin = values.admin?.toLowerCase() ?? '';
const adminName = values.name?.trim() ?? '';
if (!adminLogin || values.name === undefined) throw new Error(USAGE);
if (!LOGIN.test(adminLogin)) {
  throw new Error('Logins use 2 to 40 lowercase letters, digits, dots, dashes, or underscores.');
}
if (adminName.length < 1 || adminName.length > 80) throw new Error('Display names use 1 to 80 characters.');

function readJson<T>(path: URL): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

async function ensureAdmin(): Promise<string> {
  const existing = await findUserByLogin(db, adminLogin);
  if (existing) {
    const state = `${existing.role}, ${existing.active ? 'active' : 'inactive'}`;
    return `already exists (${state}), not changed. --name was not applied.`;
  }
  const password = process.env.FCR_ADMIN_PASSWORD ?? '';
  const problem = passwordProblem(password);
  if (problem) throw new Error(`Set FCR_ADMIN_PASSWORD first. ${problem}`);
  await createUser(db, {
    login: adminLogin,
    displayName: adminName,
    role: 'admin',
    passwordHash: await hashPassword(password),
  });
  return 'created';
}

function refuseReservedIds(file: string, rows: readonly { id: string }[]): void {
  const reserved = rows.find(({ id }) => isReservedId(id));
  if (reserved) throw new Error(`src/data/${file}: the id ${reserved.id} is reserved. Rename it, then seed again.`);
}

/** Loads and checks the catalog files; called before any database call, so a bad id writes nothing at all. */
async function catalogFiles() {
  const { WORKLOADS } = await import('../src/data/workloads.ts');
  const { ARTIFACTS } = await import('../src/data/artifacts.ts');
  refuseReservedIds('workloads.ts', WORKLOADS);
  refuseReservedIds('artifacts.ts', ARTIFACTS);
  return { WORKLOADS, ARTIFACTS };
}

async function seedCatalog({ WORKLOADS, ARTIFACTS }: Awaited<ReturnType<typeof catalogFiles>>): Promise<string> {
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
  const catalog = adminOnly ? undefined : await catalogFiles();
  if (catalog && !force && ((await listWorkloads(db)).length > 0 || (await listRounds(db)).length > 0)) {
    throw new Error(
      'This database already has a catalog or rounds, and /admin owns them now. Use --admin-only to add an admin, ' +
        'or --force to overwrite them with the repo files.',
    );
  }
  console.log(`Admin ${adminLogin}: ${await ensureAdmin()}`);
  if (catalog) {
    console.log(`Catalog: ${await seedCatalog(catalog)}`);
    console.log(`Rounds: ${await seedRounds()}`);
    await markChanged(db);
  }
} finally {
  await closeDb();
}
