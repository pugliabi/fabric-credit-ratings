import type { SessionUser } from '../../../src/domain/api-types.ts';
import { varchar, type Db } from '../lib/db.ts';

export async function createSession(db: Db, tokenHash: string, userId: number, expiresAt: Date): Promise<void> {
  await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (@tokenHash, @userId, @expiresAt)', {
    tokenHash: varchar(tokenHash),
    userId,
    expiresAt,
  });
}

/** Only live sessions of active users. */
export async function findSession(
  db: Db,
  tokenHash: string,
): Promise<{ user: SessionUser; expiresAt: Date } | undefined> {
  const [row] = await db.query<SessionUser & { expiresAt: Date }>(
    `SELECT u.id, u.login, u.display_name AS displayName, u.role, s.expires_at AS expiresAt
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = @tokenHash AND s.expires_at > SYSUTCDATETIME() AND u.active = 1`,
    { tokenHash: varchar(tokenHash) },
  );
  if (!row) return undefined;
  const { expiresAt, ...user } = row;
  return { user, expiresAt };
}

export async function renewSession(db: Db, tokenHash: string, expiresAt: Date): Promise<void> {
  await db.query('UPDATE sessions SET expires_at = @expiresAt WHERE token_hash = @tokenHash', {
    tokenHash: varchar(tokenHash),
    expiresAt,
  });
}

export async function deleteSession(db: Db, tokenHash: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = @tokenHash', { tokenHash: varchar(tokenHash) });
}

/** Ends every session of a user except, optionally, the caller's own. */
export async function deleteUserSessions(db: Db, userId: number, keepTokenHash = ''): Promise<void> {
  await db.query('DELETE FROM sessions WHERE user_id = @userId AND token_hash <> @keepTokenHash', {
    userId,
    keepTokenHash: varchar(keepTokenHash),
  });
}

export async function pruneExpiredSessions(db: Db): Promise<void> {
  await db.query('DELETE FROM sessions WHERE expires_at < SYSUTCDATETIME()');
}
