import type { AdminUser, Role, SessionUser } from '../../../src/domain/api-types.ts';
import { varchar, type Db, type Param } from '../lib/db.ts';

export interface UserRecord extends SessionUser {
  active: boolean;
  passwordHash: string;
}

const COLUMNS = 'id, login, display_name AS displayName, role, active, password_hash AS passwordHash';

export async function findUserByLogin(db: Db, login: string): Promise<UserRecord | undefined> {
  const [row] = await db.query<UserRecord>(`SELECT ${COLUMNS} FROM users WHERE login = @login`, {
    login: varchar(login),
  });
  return row;
}

export async function findUserById(db: Db, id: number): Promise<UserRecord | undefined> {
  const [row] = await db.query<UserRecord>(`SELECT ${COLUMNS} FROM users WHERE id = @id`, { id });
  return row;
}

export function toSessionUser({ id, login, displayName, role }: SessionUser): SessionUser {
  return { id, login, displayName, role };
}

export async function listUsers(db: Db): Promise<AdminUser[]> {
  const rows = await db.query<Omit<AdminUser, 'createdAt'> & { createdAt: Date }>(
    `SELECT u.id, u.login, u.display_name AS displayName, u.role, u.active, u.created_at AS createdAt,
            (SELECT MAX(s.round_id) FROM scores s WHERE s.user_id = u.id) AS lastScoredRound
     FROM users u
     ORDER BY u.active DESC, u.display_name`,
  );
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function createUser(
  db: Db,
  user: { login: string; displayName: string; role: Role; passwordHash: string },
): Promise<number> {
  const [row] = await db.query<{ id: number }>(
    `INSERT INTO users (login, display_name, role, password_hash)
     OUTPUT inserted.id
     VALUES (@login, @displayName, @role, @passwordHash)`,
    {
      login: varchar(user.login),
      displayName: user.displayName,
      role: varchar(user.role),
      passwordHash: varchar(user.passwordHash),
    },
  );
  if (!row) throw new Error('Creating the user returned no id.');
  return row.id;
}

export interface UserChanges {
  displayName?: string;
  role?: Role;
  active?: boolean;
  passwordHash?: string;
}

export async function updateUser(db: Db, id: number, changes: UserChanges): Promise<void> {
  const sets: string[] = [];
  const params: Record<string, Param> = { id };
  if (changes.displayName !== undefined) {
    sets.push('display_name = @displayName');
    params.displayName = changes.displayName;
  }
  if (changes.role !== undefined) {
    sets.push('role = @role');
    params.role = varchar(changes.role);
  }
  if (changes.active !== undefined) {
    sets.push('active = @active');
    params.active = changes.active;
  }
  if (changes.passwordHash !== undefined) {
    sets.push('password_hash = @passwordHash', 'password_changed_at = SYSUTCDATETIME()');
    params.passwordHash = varchar(changes.passwordHash);
  }
  if (sets.length === 0) return;
  await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`, params);
}

export async function countActiveAdmins(db: Db): Promise<number> {
  const [row] = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1`);
  return row?.n ?? 0;
}
