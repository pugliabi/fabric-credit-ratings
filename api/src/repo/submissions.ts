import { varchar, type Db } from '../lib/db.ts';

/**
 * Marks the rater's card in the round as submitted, keeping the first submission's time if it already is. Run inside
 * a transaction after lockRound on the same round, which keeps two writers of one card from racing.
 */
export async function submitCard(db: Db, roundId: string, userId: number): Promise<void> {
  await db.query(
    `INSERT INTO submissions (round_id, user_id)
     SELECT @roundId, @userId
     WHERE NOT EXISTS (SELECT 1 FROM submissions WHERE round_id = @roundId AND user_id = @userId)`,
    { roundId: varchar(roundId), userId },
  );
}

/** Turns the rater's card back into a draft. Nothing happens if it isn't submitted. */
export async function withdrawCard(db: Db, roundId: string, userId: number): Promise<void> {
  await db.query('DELETE FROM submissions WHERE round_id = @roundId AND user_id = @userId', {
    roundId: varchar(roundId),
    userId,
  });
}

/** Whether the rater's card in the round is submitted. */
export async function isSubmitted(db: Db, roundId: string, userId: number): Promise<boolean> {
  const [row] = await db.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM submissions WHERE round_id = @roundId AND user_id = @userId',
    { roundId: varchar(roundId), userId },
  );
  return (row?.n ?? 0) > 0;
}
