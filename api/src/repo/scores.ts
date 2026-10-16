import type { ScoreTuple } from '../../../src/domain/types.ts';
import { tuple, type ScoreRow } from '../domain/dataset.ts';
import { varchar, type Db, type Param } from '../lib/db.ts';

const COLUMNS = `s.round_id AS roundId, s.user_id AS userId, u.display_name AS name, s.artifact_id AS artifactId,
  s.capability, s.ux, s.cost, s.updated_at AS updatedAt`;

export async function allScores(db: Db): Promise<ScoreRow[]> {
  return db.query<ScoreRow>(
    `SELECT ${COLUMNS} FROM scores s JOIN users u ON u.id = s.user_id
     ORDER BY s.round_id, u.display_name, s.user_id, s.artifact_id`,
  );
}

export async function scoresFor(db: Db, roundId: string, userId: number): Promise<ScoreRow[]> {
  return db.query<ScoreRow>(
    `SELECT ${COLUMNS} FROM scores s JOIN users u ON u.id = s.user_id
     WHERE s.round_id = @roundId AND s.user_id = @userId`,
    { roundId: varchar(roundId), userId },
  );
}

export function toTriples(rows: readonly ScoreRow[]): Record<string, ScoreTuple> {
  return Object.fromEntries(rows.map((row) => [row.artifactId, tuple(row)]));
}

/**
 * Replaces one rater's whole card for a round. An empty card deletes it. Run inside a transaction, after lockRound on
 * the same round in that transaction, and check the round's status on the row lockRound returned: a transaction alone
 * lets two saves of one card interleave into a merged card or a duplicate-key error, and a status read before the
 * transaction can be stale by the time the card is written.
 */
export async function replaceScorecard(
  db: Db,
  roundId: string,
  userId: number,
  scores: Record<string, ScoreTuple>,
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
): Promise<{ roundLabel: string; scores: Record<string, ScoreTuple> } | undefined> {
  const [round] = await db.query<{ id: string; label: string }>(
    `SELECT TOP 1 r.id, r.label FROM rounds r
     WHERE r.status = 'published' AND EXISTS (SELECT 1 FROM scores s WHERE s.round_id = r.id AND s.user_id = @userId)
     ORDER BY r.published_on DESC, r.id DESC`,
    { userId },
  );
  if (!round) return undefined;
  return { roundLabel: round.label, scores: toTriples(await scoresFor(db, round.id, userId)) };
}
