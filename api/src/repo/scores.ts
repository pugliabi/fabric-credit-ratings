import type { ScoreTriple } from '../../../src/domain/types.ts';
import { triple, type ScoreRow } from '../domain/dataset.ts';
import { varchar, type Db, type Param } from '../lib/db.ts';

const COLUMNS = `s.round_id AS roundId, s.user_id AS userId, u.display_name AS name, s.artifact_id AS artifactId,
  s.capability, s.ux, s.cost, s.updated_at AS updatedAt`;

export async function allScores(db: Db): Promise<ScoreRow[]> {
  return db.query<ScoreRow>(`SELECT ${COLUMNS} FROM scores s JOIN users u ON u.id = s.user_id`);
}

export async function scoresFor(db: Db, roundId: string, userId: number): Promise<ScoreRow[]> {
  return db.query<ScoreRow>(
    `SELECT ${COLUMNS} FROM scores s JOIN users u ON u.id = s.user_id
     WHERE s.round_id = @roundId AND s.user_id = @userId`,
    { roundId: varchar(roundId), userId },
  );
}

export function toTriples(rows: readonly ScoreRow[]): Record<string, ScoreTriple> {
  return Object.fromEntries(rows.map((row) => [row.artifactId, triple(row)]));
}

/** Replaces one rater's whole card for a round. An empty card deletes it. Run inside a transaction. */
export async function replaceScorecard(
  db: Db,
  roundId: string,
  userId: number,
  scores: Record<string, ScoreTriple>,
): Promise<void> {
  await db.query('DELETE FROM scores WHERE round_id = @roundId AND user_id = @userId', {
    roundId: varchar(roundId),
    userId,
  });
  const entries = Object.entries(scores);
  if (entries.length === 0) return;
  const params: Record<string, Param> = { roundId: varchar(roundId), userId };
  const rows = entries.map(([artifactId, [capability, ux, cost]], i) => {
    params[`a${i}`] = varchar(artifactId);
    params[`c${i}`] = capability;
    params[`u${i}`] = ux;
    params[`k${i}`] = cost;
    return `(@roundId, @userId, @a${i}, @c${i}, @u${i}, @k${i})`;
  });
  await db.query(
    `INSERT INTO scores (round_id, user_id, artifact_id, capability, ux, cost) VALUES ${rows.join(', ')}`,
    params,
  );
}

/** The user's card from the newest published round they scored. */
export async function lastPublishedCard(
  db: Db,
  userId: number,
): Promise<{ roundLabel: string; scores: Record<string, ScoreTriple> } | undefined> {
  const [round] = await db.query<{ id: string; label: string }>(
    `SELECT TOP 1 r.id, r.label FROM rounds r
     WHERE r.status = 'published' AND EXISTS (SELECT 1 FROM scores s WHERE s.round_id = r.id AND s.user_id = @userId)
     ORDER BY r.published_on DESC, r.id DESC`,
    { userId },
  );
  if (!round) return undefined;
  return { roundLabel: round.label, scores: toTriples(await scoresFor(db, round.id, userId)) };
}
