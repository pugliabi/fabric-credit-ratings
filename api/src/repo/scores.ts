import type { ScoreTuple } from '../../../src/domain/types.ts';
import { tuple, type ScoreRow } from '../domain/dataset.ts';
import { varchar, type Db, type Param } from '../lib/db.ts';

const COLUMNS = `s.round_id AS roundId, s.user_id AS userId, u.display_name AS name, s.artifact_id AS artifactId,
  s.capability, s.ux, s.cost, s.outlook, s.updated_at AS updatedAt, sub.submitted_at AS submittedAt`;
/** Each score with its rater's name and, for a submitted card, when it was submitted. */
const FROM = `FROM scores s JOIN users u ON u.id = s.user_id
  LEFT JOIN submissions sub ON sub.round_id = s.round_id AND sub.user_id = s.user_id`;

export async function allScores(db: Db): Promise<ScoreRow[]> {
  return db.query<ScoreRow>(
    `SELECT ${COLUMNS} ${FROM} ORDER BY s.round_id, u.display_name, s.user_id, s.artifact_id`,
  );
}

export async function scoresFor(db: Db, roundId: string, userId: number): Promise<ScoreRow[]> {
  return db.query<ScoreRow>(
    `SELECT ${COLUMNS} ${FROM} WHERE s.round_id = @roundId AND s.user_id = @userId`,
    { roundId: varchar(roundId), userId },
  );
}

export function toTuples(rows: readonly ScoreRow[]): Record<string, ScoreTuple> {
  return Object.fromEntries(rows.map((row) => [row.artifactId, tuple(row)]));
}

/**
 * Replaces one rater's whole card for a round. An empty card deletes it and its submission. Run inside a
 * transaction, after lockRound on the same round in that transaction, and check the round's status on the row
 * lockRound returned: a transaction alone lets two saves of one card interleave into a merged card or a duplicate-key
 * error, and a status read before the transaction can be stale by the time the card is written.
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
  if (entries.length === 0) {
    // A card that no longer exists can't stay submitted.
    await db.query('DELETE FROM submissions WHERE round_id = @roundId AND user_id = @userId', {
      roundId: varchar(roundId),
      userId,
    });
    return;
  }
  const params: Record<string, Param> = { roundId: varchar(roundId), userId };
  const rows = entries.map(([artifactId, [capability, ux, cost, outlook]], i) => {
    params[`a${i}`] = varchar(artifactId);
    params[`c${i}`] = capability;
    params[`u${i}`] = ux;
    params[`k${i}`] = cost;
    params[`o${i}`] = outlook;
    return `(@roundId, @userId, @a${i}, @c${i}, @u${i}, @k${i}, @o${i})`;
  });
  await db.query(
    `INSERT INTO scores (round_id, user_id, artifact_id, capability, ux, cost, outlook) VALUES ${rows.join(', ')}`,
    params,
  );
}

/** The user's submitted card from the newest published round they submitted in. */
export async function lastPublishedCard(
  db: Db,
  userId: number,
): Promise<{ roundLabel: string; scores: Record<string, ScoreTuple> } | undefined> {
  const [round] = await db.query<{ id: string; label: string }>(
    `SELECT TOP 1 r.id, r.label FROM rounds r
     WHERE r.status = 'published'
       AND EXISTS (SELECT 1 FROM submissions sub WHERE sub.round_id = r.id AND sub.user_id = @userId)
     ORDER BY r.published_on DESC, r.id DESC`,
    { userId },
  );
  if (!round) return undefined;
  return { roundLabel: round.label, scores: toTuples(await scoresFor(db, round.id, userId)) };
}
