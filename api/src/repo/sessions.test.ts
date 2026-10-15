import { describe, expect, it } from 'vitest';
import { varchar, type Db, type Params } from '../lib/db.ts';
import { createSession } from './sessions.ts';

function answering(rows: object[]): { calls: { text: string; params: Params }[]; fake: Db } {
  const calls: { text: string; params: Params }[] = [];
  const fake: Db = {
    query<T>(text: string, params: Params = {}): Promise<T[]> {
      calls.push({ text, params });
      return Promise.resolve(rows as T[]);
    },
  };
  return { calls, fake };
}

describe('createSession', () => {
  const expiresAt = new Date('2026-11-14T12:00:00Z');

  it('inserts only for a still-active user with the verified hash, holding the user row', async () => {
    const { calls, fake } = answering([{ userId: 7 }]);

    expect(await createSession(fake, 'token-hash', 7, expiresAt, 'scrypt$verified')).toBe(true);
    expect(calls).toHaveLength(1);
    const text = calls[0]?.text ?? '';
    expect(text).toMatch(/^INSERT INTO sessions \(token_hash, user_id, expires_at\)\s+OUTPUT inserted\.user_id/);
    expect(text).toMatch(/SELECT @tokenHash, u\.id, @expiresAt FROM users u WITH \(HOLDLOCK\)\s+WHERE /);
    expect(text).toMatch(/WHERE u\.id = @userId AND u\.active = 1 AND u\.password_hash = @passwordHash$/);
    expect(calls[0]?.params).toEqual({
      tokenHash: varchar('token-hash'),
      userId: 7,
      expiresAt,
      passwordHash: varchar('scrypt$verified'),
    });
  });

  it('reports false when the guard matched no user, so no session was created', async () => {
    const { fake } = answering([]);
    expect(await createSession(fake, 'token-hash', 7, expiresAt, 'scrypt$old')).toBe(false);
  });
});
