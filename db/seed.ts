import { closeDb, db } from '../api/src/lib/db.ts';
import { hashPassword, passwordProblem } from '../api/src/lib/password.ts';
import { LOGIN } from '../api/src/lib/validate.ts';
import { createUser, findUserByLogin } from '../api/src/repo/users.ts';
import { useTarget } from './target.ts';

const USAGE = 'Usage: npm run db:seed -- --admin <login> --name "<display name>" [--server <host>] [--database <name>]';

const args = useTarget(process.argv.slice(2));
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const adminLogin = flag('admin')?.toLowerCase() ?? '';
const adminName = flag('name')?.trim() ?? '';
if (!adminLogin || !adminName) throw new Error(USAGE);
if (!LOGIN.test(adminLogin)) throw new Error('Logins use 2 to 40 lowercase letters, digits, dots, dashes, or underscores.');
if (adminName.length > 80) throw new Error('Display names use 1 to 80 characters.');

/** The first admin of an empty database. The catalog and rounds are then managed in /admin. */
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

try {
  console.log(`Admin ${adminLogin}: ${await ensureAdmin()}`);
} finally {
  await closeDb();
}
