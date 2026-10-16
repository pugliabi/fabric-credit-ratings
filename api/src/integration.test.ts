import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, db, varchar } from './lib/db.ts';
import { hashToken } from './lib/session.ts';
import { siteState, type SiteState } from './repo/site.ts';
import { useDevTarget } from './test-target.ts';

const BASE = process.env.FCR_API_URL ?? '';
const ORIGIN = process.env.FCR_ORIGIN ?? 'http://localhost:5173';
const ADMIN_LOGIN = process.env.FCR_ADMIN_LOGIN?.trim() ?? '';
// Not trimmed: the API takes passwords exactly as sent.
const ADMIN_PASSWORD = process.env.FCR_ADMIN_PASSWORD ?? '';
const SNAPSHOT_TOKEN = process.env.FCR_SNAPSHOT_TOKEN?.trim() ?? '';

// fcr-dev pauses when idle and can take minutes to answer the first request; the host gives up on one at 230 s.
vi.setConfig({ testTimeout: 300_000, hookTimeout: 600_000 });

const RUN = Date.now() % 200;
/**
 * A documentation address (TEST-NET-3, RFC 5737) for this run, one per slot. Locally nothing appends to
 * X-Forwarded-For, so the host keys these attempts off it instead of the ip:unknown row every local host shares.
 */
const testIp = (slot: number) => `203.0.113.${1 + ((RUN + slot) % 254)}`;

interface Reply {
  status: number;
  // Response shapes vary per endpoint; assertions check the fields they need.
  body: any;
}

class Client {
  cookie = '';
  readonly forwardedFor: string;

  constructor(forwardedFor = testIp(0)) {
    this.forwardedFor = forwardedFor;
  }

  async send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        'X-Forwarded-For': this.forwardedFor,
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers,
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';')[0] ?? '';
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const raw = await response.text();
    try {
      return { status: response.status, body: raw ? JSON.parse(raw) : undefined };
    } catch {
      return { status: response.status, body: raw };
    }
  }
}

/** The hash the API stores for a client's session cookie, read the way the API reads it. */
function sessionHash(client: Client): string {
  return client.cookie ? hashToken(decodeURIComponent(client.cookie.slice(client.cookie.indexOf('=') + 1))) : '';
}

/**
 * Users can't be deleted through the API, so test users go here, after every row that references them. The suite's
 * addresses go too, and ip:unknown in case the host ever stops reading X-Forwarded-For.
 */
async function clearTestRows(): Promise<void> {
  const pattern = varchar('itest-%');
  const testUsers = 'SELECT id FROM users WHERE login LIKE @pattern';
  await db.query(`DELETE FROM scores WHERE user_id IN (${testUsers})`, { pattern });
  await db.query(`DELETE FROM notes WHERE updated_by IN (${testUsers})`, { pattern });
  await db.query(`DELETE FROM sessions WHERE user_id IN (${testUsers})`, { pattern });
  await db.query('DELETE FROM users WHERE login LIKE @pattern', { pattern });
  await db.query(
    `DELETE FROM login_attempts
     WHERE attempt_key LIKE 'login:itest-%' OR attempt_key LIKE 'ip:203.0.113.%' OR attempt_key = 'ip:unknown'`,
  );
}

describe.skipIf(!BASE)('API against the dev database', () => {
  const stamp = Date.now().toString(36);
  const admin = new Client();
  const rater = new Client();
  const raterLogin = `itest-${stamp}`;
  const raterPassword = `pass-${stamp}-long`;
  const nextPassword = `next-${stamp}-long`;
  let adminId = 0;
  let raterId = 0;
  let roundId = '';
  let artifactId = '';
  let onDevDatabase = false;
  let siteBefore: SiteState | undefined;

  beforeAll(async () => {
    const missing = Object.entries({
      FCR_ADMIN_LOGIN: ADMIN_LOGIN,
      FCR_ADMIN_PASSWORD: ADMIN_PASSWORD,
      FCR_SNAPSHOT_TOKEN: SNAPSHOT_TOKEN,
    })
      .filter(([, value]) => !value)
      .map(([name]) => name);
    // Before any request, so a missing password can't count as a failed admin login that the cleanup can't undo.
    if (missing.length > 0) throw new Error(`Set ${missing.join(', ')} before running the integration suite.`);
    useDevTarget();
    onDevDatabase = true;
    await clearTestRows();
    siteBefore = await siteState(db);
    const reply = await admin.send('POST', '/api/auth/login', { login: ADMIN_LOGIN, password: ADMIN_PASSWORD });
    expect(reply.status, reply.body?.error).toBe(200);
    expect(reply.body.role).toBe('admin');
    adminId = reply.body.id;
    // The host just wrote this session, so finding it proves the host and the suite share a database before any test
    // writes through the API.
    const [found] = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = @hash', {
      hash: varchar(sessionHash(admin)),
    });
    if (found?.n !== 1) throw new Error('FCR_API_URL and api/local.settings.json must use the same database.');
  });

  afterAll(async () => {
    try {
      if (!onDevDatabase) return;
      const adminSession = sessionHash(admin);
      // Ends the admin's session, the one row the suite leaves that clearTestRows can't tell from a real one.
      const loggedOut = await admin.send('POST', '/api/auth/logout').then(
        (reply) => reply.status,
        () => 0,
      );
      await clearTestRows();
      const [left] = await db.query<{ users: number; attempts: number; adminSessions: number }>(
        `SELECT (SELECT COUNT(*) FROM users WHERE login LIKE 'itest-%') AS users,
                (SELECT COUNT(*) FROM login_attempts
                 WHERE attempt_key LIKE 'login:itest-%' OR attempt_key LIKE 'ip:203.0.113.%') AS attempts,
                (SELECT COUNT(*) FROM sessions WHERE token_hash = @adminSession) AS adminSessions`,
        { adminSession: varchar(adminSession) },
      );
      // Every write in the suite goes to the open round, so neither stamp may move.
      const site = siteBefore ? await siteState(db) : undefined;
      // One assertion, so a failed logout can't hide whether the cleanup worked, or the other way round.
      expect({ loggedOut, left, site }).toEqual({
        loggedOut: 204,
        left: { users: 0, attempts: 0, adminSessions: 0 },
        site: siteBefore,
      });
    } finally {
      await closeDb();
    }
  });

  it('refuses writes from pages that are not allowed', async () => {
    const reply = await new Client().send(
      'POST',
      '/api/auth/login',
      { login: 'x', password: 'y' },
      { Origin: 'https://evil.example' },
    );
    expect(reply.status).toBe(403);
  });

  it('lets an admin create a rater who can log in', async () => {
    const created = await admin.send('POST', '/api/admin/users', {
      login: raterLogin,
      displayName: 'Integration Rater',
      role: 'rater',
      password: raterPassword,
    });
    expect(created.status).toBe(200);
    raterId = created.body.find((user: { login: string }) => user.login === raterLogin).id;
    const [row] = await db.query<{ id: number }>('SELECT id FROM users WHERE login = @login', {
      login: varchar(raterLogin),
    });
    expect(row?.id, 'FCR_API_URL and api/local.settings.json must use the same database').toBe(raterId);
    const loggedIn = await rater.send('POST', '/api/auth/login', { login: raterLogin, password: raterPassword });
    expect(loggedIn.status).toBe(200);
    expect((await rater.send('GET', '/api/me')).body).toMatchObject({ login: raterLogin, role: 'rater' });
  });

  it('refuses a second user with a login that is taken', async () => {
    const again = await admin.send('POST', '/api/admin/users', {
      login: raterLogin,
      displayName: 'Integration Rater',
      role: 'rater',
      password: raterPassword,
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe(`The login ${raterLogin} is taken.`);
  });

  it('refuses to let an admin remove their own admin access', async (ctx) => {
    // With one active admin, the last-admin rule refuses this too, so a broken self rule can't demote anyone.
    const [admins] = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1`,
    );
    ctx.skip(admins?.n !== 1, `Runs only with exactly one active admin; this database has ${admins?.n ?? 0}.`);
    const reply = await admin.send('PUT', `/api/admin/users/${adminId}`, { role: 'rater' });
    expect(reply.status).toBe(409);
    expect(reply.body.error).toBe('You cannot remove your own admin access. Ask another admin to make this change.');
    expect((await admin.send('GET', '/api/me')).body).toMatchObject({ id: adminId, role: 'admin' });
  });

  it('keeps raters out of admin routes', async () => {
    expect((await rater.send('GET', '/api/admin/users')).status).toBe(403);
  });

  it('saves a rater card in the open round only', async () => {
    const open = await rater.send('GET', '/api/rounds/open');
    expect(open.body.round, 'fcr-dev needs an open round (the seed creates 2026-Q4)').toBeTruthy();
    roundId = open.body.round.id;
    artifactId = (await rater.send('GET', '/api/catalog')).body.artifacts[0].id;
    const saved = await rater.send('PUT', '/api/rounds/open/my-scores', {
      round: roundId,
      scores: { [artifactId]: [5, 6, 7] },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.scores).toEqual({ [artifactId]: [5, 6, 7] });
    const stale = await rater.send('PUT', '/api/rounds/open/my-scores', { round: '1999-Q1', scores: {} });
    expect(stale.status).toBe(409);
  });

  it('shows the card in the admin review', async () => {
    const review = await admin.send('GET', `/api/admin/rounds/${roundId}/review`);
    const item = review.body.items.find((entry: { artifact: { id: string } }) => entry.artifact.id === artifactId);
    expect(item.breakdown).toContainEqual({ userId: raterId, name: 'Integration Rater', scores: [5, 6, 7] });
  });

  it('serves the snapshot only with the build token', async () => {
    expect((await new Client().send('GET', '/api/build/snapshot')).status).toBe(401);
    const reply = await new Client().send('GET', '/api/build/snapshot', undefined, {
      Authorization: `Bearer ${SNAPSHOT_TOKEN}`,
    });
    expect(reply.status).toBe(200);
    expect(JSON.stringify(reply.body)).not.toContain('Integration Rater');
  });

  it('takes deploy confirmations only with the build token, from no particular page', async () => {
    // A valid generatedAt would move fcr-dev's last_snapshot_at forward for good, so this sends one the API refuses.
    const confirm = (headers: Record<string, string>) =>
      fetch(`${BASE}/api/build/snapshot/deployed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': testIp(0), ...headers },
        body: JSON.stringify({ generatedAt: 'not-a-time' }),
      });
    expect((await confirm({})).status).toBe(401);
    expect((await confirm({ Authorization: `Bearer ${SNAPSHOT_TOKEN}` })).status).toBe(400);
  });

  // Only ever the test rater's password; the unit tests cover an admin resetting their own.
  it('ends sessions and swaps the password when an admin resets it', async () => {
    expect((await admin.send('PUT', `/api/admin/users/${raterId}`, { password: nextPassword })).status).toBe(200);
    expect((await rater.send('GET', '/api/me')).status).toBe(401);
    const old = await new Client().send('POST', '/api/auth/login', { login: raterLogin, password: raterPassword });
    expect(old.status).toBe(401);
    const next = await rater.send('POST', '/api/auth/login', { login: raterLogin, password: nextPassword });
    expect(next.status).toBe(200);
    expect((await rater.send('GET', '/api/me')).body).toMatchObject({ login: raterLogin });
  });

  // Only ever the suite's own rater, created above.
  it('ends sessions when an admin disables the user, who then cannot log in', async () => {
    expect((await admin.send('PUT', `/api/admin/users/${raterId}`, { active: false })).status).toBe(200);
    expect((await rater.send('GET', '/api/me')).status).toBe(401);
    const disabled = await new Client().send('POST', '/api/auth/login', { login: raterLogin, password: nextPassword });
    expect(disabled.status).toBe(401);
  });

  // Last: the locked login key stays locked until afterAll clears it.
  it('locks a login after 10 failures', async () => {
    const login = `itest-lock-${stamp}`;
    // A new address per try, so only the login's own key can reach the limit.
    const attempt = (slot: number) =>
      new Client(testIp(slot)).send('POST', '/api/auth/login', { login, password: 'wrong-password' });
    for (let slot = 1; slot <= 10; slot += 1) expect((await attempt(slot)).status).toBe(401);
    expect((await attempt(11)).status).toBe(429);
  });
});
