import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { useTarget } from '../../db/target.ts';
import { closeDb, db, varchar } from './lib/db.ts';
import { siteState } from './repo/site.ts';

const BASE = process.env.FCR_API_URL ?? '';
const ORIGIN = process.env.FCR_ORIGIN ?? 'http://localhost:5173';

// fcr-dev pauses when idle and can take minutes to answer the first request; the host gives up on one at 230 s.
vi.setConfig({ testTimeout: 300_000, hookTimeout: 600_000 });

interface Reply {
  status: number;
  // Response shapes vary per endpoint; assertions check the fields they need.
  body: any;
}

class Client {
  cookie = '';

  async send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
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

/**
 * Users can't be deleted through the API, so test users go here, after every row that references them. Every local
 * request shares the ip:unknown attempts row, so it goes too.
 */
async function clearTestRows(): Promise<void> {
  const pattern = varchar('itest-%');
  const testUsers = 'SELECT id FROM users WHERE login LIKE @pattern';
  await db.query(`DELETE FROM scores WHERE user_id IN (${testUsers})`, { pattern });
  await db.query(`DELETE FROM notes WHERE updated_by IN (${testUsers})`, { pattern });
  await db.query(`DELETE FROM sessions WHERE user_id IN (${testUsers})`, { pattern });
  await db.query('DELETE FROM users WHERE login LIKE @pattern', { pattern });
  await db.query(`DELETE FROM login_attempts WHERE attempt_key LIKE 'login:itest-%' OR attempt_key = 'ip:unknown'`);
}

describe.skipIf(!BASE)('API against the dev database', () => {
  const stamp = Date.now().toString(36);
  const admin = new Client();
  const rater = new Client();
  const raterLogin = `itest-${stamp}`;
  const raterPassword = `pass-${stamp}-long`;
  let raterId = 0;
  let roundId = '';
  let artifactId = '';
  let snapshotBefore: Date | null = null;

  beforeAll(async () => {
    useTarget([]);
    await clearTestRows();
    snapshotBefore = (await siteState(db)).lastSnapshotAt;
    const reply = await admin.send('POST', '/api/auth/login', {
      login: process.env.FCR_ADMIN_LOGIN,
      password: process.env.FCR_ADMIN_PASSWORD,
    });
    expect(reply.status, reply.body?.error).toBe(200);
    expect(reply.body.role).toBe('admin');
  });

  afterAll(async () => {
    try {
      // Ends the admin's session, the one row the suite leaves that clearTestRows can't tell from a real one.
      const loggedOut = await admin.send('POST', '/api/auth/logout').then(
        (reply) => reply.status,
        () => 0,
      );
      await clearTestRows();
      expect(loggedOut).toBe(204);
      expect((await siteState(db)).lastSnapshotAt).toEqual(snapshotBefore);
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
    expect((await rater.send('POST', '/api/auth/login', { login: raterLogin, password: raterPassword })).status).toBe(200);
    expect((await rater.send('GET', '/api/me')).body).toMatchObject({ login: raterLogin, role: 'rater' });
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
      Authorization: `Bearer ${process.env.FCR_SNAPSHOT_TOKEN ?? ''}`,
    });
    expect(reply.status).toBe(200);
    expect(JSON.stringify(reply.body)).not.toContain('Integration Rater');
  });

  it('takes deploy confirmations only with the build token, from no particular page', async () => {
    // A valid generatedAt would move fcr-dev's last_snapshot_at forward for good, so this sends one the API refuses.
    const confirm = (headers: Record<string, string>) =>
      fetch(`${BASE}/api/build/snapshot/deployed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ generatedAt: 'not-a-time' }),
      });
    expect((await confirm({})).status).toBe(401);
    expect((await confirm({ Authorization: `Bearer ${process.env.FCR_SNAPSHOT_TOKEN ?? ''}` })).status).toBe(400);
  });

  it('ends sessions when an admin disables the user', async () => {
    expect((await admin.send('PUT', `/api/admin/users/${raterId}`, { active: false })).status).toBe(200);
    expect((await rater.send('GET', '/api/me')).status).toBe(401);
  });

  // Last, and the only failed logins in the file: every local request shares ip:unknown, which stays locked until
  // afterAll clears it.
  it('locks a login after 10 failures', async () => {
    const stranger = new Client();
    const login = `itest-lock-${stamp}`;
    for (let i = 0; i < 10; i += 1) {
      expect((await stranger.send('POST', '/api/auth/login', { login, password: 'wrong-password' })).status).toBe(401);
    }
    expect((await stranger.send('POST', '/api/auth/login', { login, password: 'wrong-password' })).status).toBe(429);
  });
});
