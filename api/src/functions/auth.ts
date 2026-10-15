import { sessionToken } from '../lib/current-user.ts';
import { db, transaction } from '../lib/db.ts';
import { HttpError } from '../lib/errors.ts';
import { route } from '../lib/http.ts';
import { isLocked } from '../lib/lockout.ts';
import { dummyHash, hashPassword, passwordProblem, verifyPassword } from '../lib/password.ts';
import { clearedCookie, expiryFrom, hashToken, newToken, sessionCookie } from '../lib/session.ts';
import { LOGIN, rawString, text } from '../lib/validate.ts';
import { clearAttempt, getAttempts, releaseAttempt, reserveAttempt } from '../repo/attempts.ts';
import { createSession, deleteSession, deleteUserSessions, pruneExpiredSessions } from '../repo/sessions.ts';
import { findUserById, findUserByLogin, toSessionUser, updateUser } from '../repo/users.ts';

const LOCKED = 'Too many failed tries. Wait 15 minutes, then try again.';
const WRONG = 'Wrong login or password.';

route('login', 'POST', 'auth/login', 'public', async (ctx) => {
  const login = text(ctx.body, 'login', 'Login', 40).toLowerCase();
  if (!LOGIN.test(login)) throw new HttpError(401, WRONG);
  const password = rawString(ctx.body, 'password');
  const now = new Date();
  const loginKey = `login:${login}`;
  const ipKey = `ip:${ctx.ip}`;
  const keys = [loginKey, ipKey];
  // Lock-free first look, so a flood on a locked key gets its 429 without queuing on the key's row lock.
  const attempts = await getAttempts(db, keys);
  if (keys.some((key) => isLocked(attempts.get(key), now))) throw new HttpError(429, LOCKED);
  // Counted before the password check, so parallel guesses can't outrun the limit; a failure needs no write.
  const reservation = await reserveAttempt(keys, now);
  if (reservation.locked) throw new HttpError(429, LOCKED);
  const user = await findUserByLogin(db, login);
  const matches = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));
  if (!user || !user.active || !matches) throw new HttpError(401, WRONG);
  await clearAttempt(db, loginKey);
  const ipRow = reservation.rows.get(ipKey);
  if (ipRow) {
    await releaseAttempt(db, ipKey, ipRow).catch((error: unknown) =>
      ctx.log.warn('Releasing the IP attempt failed', error),
    );
  }
  await pruneExpiredSessions(db);
  const token = newToken();
  // False when an admin reset the password or disabled the user after the check above.
  if (!(await createSession(db, hashToken(token), user.id, expiryFrom(now), user.passwordHash))) {
    throw new HttpError(401, WRONG);
  }
  ctx.cookies.push(sessionCookie(ctx.config.cookieSecure, token));
  return toSessionUser(user);
});

route('logout', 'POST', 'auth/logout', 'public', async (ctx) => {
  // Cleared first: an error response still sends ctx.cookies, so a failed delete still logs this browser out.
  ctx.cookies.push(clearedCookie(ctx.config.cookieSecure));
  const token = sessionToken(ctx.request.headers.get('cookie'), ctx.config);
  if (token) await deleteSession(db, hashToken(token));
  return undefined;
});

route('me', 'GET', 'me', 'user', async (ctx) => ctx.user);

route('changePassword', 'PUT', 'me/password', 'user', async (ctx) => {
  const current = rawString(ctx.body, 'current');
  const next = rawString(ctx.body, 'next');
  const record = await findUserById(db, ctx.user.id);
  if (!record || !(await verifyPassword(current, record.passwordHash))) {
    throw new HttpError(400, 'Your current password is wrong.');
  }
  const problem = passwordProblem(next);
  if (problem) throw new HttpError(400, problem);
  const passwordHash = await hashPassword(next);
  const token = sessionToken(ctx.request.headers.get('cookie'), ctx.config);
  await transaction(async (tx) => {
    await updateUser(tx, record.id, { passwordHash });
    await deleteUserSessions(tx, record.id, token ? hashToken(token) : '');
  });
  return undefined;
});
