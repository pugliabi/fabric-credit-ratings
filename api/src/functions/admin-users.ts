import { sessionToken } from '../lib/current-user.ts';
import { DUPLICATE_KEY, db, hasSqlNumber, transaction } from '../lib/db.ts';
import { HttpError } from '../lib/errors.ts';
import { route } from '../lib/http.ts';
import { hashPassword, passwordProblem } from '../lib/password.ts';
import { userChangeProblem } from '../lib/permissions.ts';
import { hashToken } from '../lib/session.ts';
import {
  LOGIN,
  USER_ID,
  oneOf,
  optionalBool,
  optionalOneOf,
  optionalText,
  rawString,
  text,
} from '../lib/validate.ts';
import { deleteUserSessions } from '../repo/sessions.ts';
import {
  countActiveAdminsLocked,
  createUser,
  findUserById,
  findUserByLogin,
  listUsers,
  updateUser,
} from '../repo/users.ts';

const ROLES = ['admin', 'rater'] as const;

const noSuchUser = () => new HttpError(404, 'That user does not exist.');

route('adminUsers', 'GET', 'admin/users', 'admin', async () => listUsers(db));

route('adminUserCreate', 'POST', 'admin/users', 'admin', async (ctx) => {
  const login = text(ctx.body, 'login', 'Login', 40).toLowerCase();
  if (!LOGIN.test(login)) {
    throw new HttpError(400, 'Logins use 2 to 40 lowercase letters, digits, dots, dashes, or underscores.');
  }
  const displayName = text(ctx.body, 'displayName', 'Name', 80);
  const role = oneOf(ctx.body, 'role', 'Role', ROLES);
  const password = rawString(ctx.body, 'password');
  const problem = passwordProblem(password);
  if (problem) throw new HttpError(400, problem);
  const taken = new HttpError(409, `The login ${login} is taken.`);
  if (await findUserByLogin(db, login)) throw taken;
  const passwordHash = await hashPassword(password);
  try {
    await createUser(db, { login, displayName, role, passwordHash });
  } catch (error) {
    if (hasSqlNumber(error, DUPLICATE_KEY)) throw taken;
    throw error;
  }
  return listUsers(db);
});

route('adminUserUpdate', 'PUT', 'admin/users/{id}', 'admin', async (ctx) => {
  const id = USER_ID.test(ctx.params.id ?? '') ? Number(ctx.params.id) : NaN;
  if (Number.isNaN(id) || !(await findUserById(db, id))) throw noSuchUser();
  const displayName = optionalText(ctx.body, 'displayName', 'Name', 80);
  const role = optionalOneOf(ctx.body, 'role', 'Role', ROLES);
  const active = optionalBool(ctx.body, 'active', 'Active');
  const password = ctx.body.password === undefined ? undefined : rawString(ctx.body, 'password');
  const weak = password === undefined ? undefined : passwordProblem(password);
  if (weak) throw new HttpError(400, weak);
  // Before the transaction, so slow scrypt work never holds the admin-count lock.
  const passwordHash = password === undefined ? undefined : await hashPassword(password);
  const own = id === ctx.user.id ? sessionToken(ctx.request.headers.get('cookie'), ctx.config) : undefined;
  await transaction(async (tx) => {
    const admins = await countActiveAdminsLocked(tx);
    // The session was checked before the lock, and a change that committed while this request waited can demote it.
    const actor = await findUserById(tx, ctx.user.id);
    if (!actor?.active || actor.role !== 'admin') throw new HttpError(403, 'Only admins can do that.');
    const target = await findUserById(tx, id);
    if (!target) throw noSuchUser();
    const problem = userChangeProblem(ctx.user, target, { role, active }, admins);
    if (problem) throw new HttpError(409, problem);
    await updateUser(tx, target.id, { displayName, role, active, passwordHash });
    if (active === false || passwordHash !== undefined) {
      await deleteUserSessions(tx, target.id, own ? hashToken(own) : '');
    }
  });
  return listUsers(db);
});
