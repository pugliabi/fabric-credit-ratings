import type { AdminRound } from '../../../src/domain/api-types.ts';
import type { Round } from '../../../src/domain/types.ts';
import type { Db } from '../lib/db.ts';

/** published_on comes back as 'YYYY-MM-DD' text so no time zone can shift it. */
const ROUND = `r.id, r.label, r.status, CONVERT(char(10), r.published_on, 23) AS publishedOn`;

export async function listRounds(db: Db): Promise<Round[]> {
  return db.query<Round>(`SELECT ${ROUND} FROM rounds r ORDER BY r.id`);
}

export async function findRound(db: Db, id: string): Promise<Round | undefined> {
  const [round] = await db.query<Round>(`SELECT ${ROUND} FROM rounds r WHERE r.id = @id`, { id });
  return round;
}

export async function findOpenRound(db: Db): Promise<Round | undefined> {
  const [round] = await db.query<Round>(`SELECT ${ROUND} FROM rounds r WHERE r.status = 'open'`);
  return round;
}

export async function listRoundsWithCounts(db: Db): Promise<AdminRound[]> {
  return db.query<AdminRound>(
    `SELECT ${ROUND},
            (SELECT COUNT(DISTINCT s.user_id) FROM scores s WHERE s.round_id = r.id) AS scorecards,
            (SELECT COUNT(*) FROM notes n WHERE n.round_id = r.id) AS notes
     FROM rounds r
     ORDER BY r.id DESC`,
  );
}

export async function countScorecards(db: Db, id: string): Promise<number> {
  const [row] = await db.query<{ n: number }>(
    'SELECT COUNT(DISTINCT user_id) AS n FROM scores WHERE round_id = @id',
    { id },
  );
  return row?.n ?? 0;
}

export async function createRound(db: Db, id: string, label: string): Promise<void> {
  await db.query(`INSERT INTO rounds (id, label, status) VALUES (@id, @label, 'open')`, { id, label });
}

export async function publishRound(db: Db, id: string, publishedOn: string): Promise<void> {
  await db.query(
    `UPDATE rounds SET status = 'published', published_on = @publishedOn, updated_at = SYSUTCDATETIME() WHERE id = @id`,
    { id, publishedOn },
  );
}

export async function reopenRound(db: Db, id: string): Promise<void> {
  await db.query(
    `UPDATE rounds SET status = 'open', published_on = NULL, updated_at = SYSUTCDATETIME() WHERE id = @id`,
    { id },
  );
}

export async function upsertRound(db: Db, round: Round): Promise<void> {
  await db.query(
    `MERGE rounds AS t USING (SELECT @id AS id) AS s ON t.id = s.id
     WHEN MATCHED THEN UPDATE SET label = @label, status = @status, published_on = @publishedOn,
       updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (id, label, status, published_on) VALUES (@id, @label, @status, @publishedOn);`,
    { id: round.id, label: round.label, status: round.status, publishedOn: round.publishedOn },
  );
}
