import type { NoteRow } from '../domain/dataset.ts';
import { varchar, type Db } from '../lib/db.ts';

export async function allNotes(db: Db): Promise<NoteRow[]> {
  return db.query<NoteRow>('SELECT round_id AS roundId, artifact_id AS artifactId, body FROM notes');
}

/** An empty body deletes the note. */
export async function saveNote(
  db: Db,
  roundId: string,
  artifactId: string,
  body: string,
  userId: number | null,
): Promise<void> {
  if (!body) {
    await db.query('DELETE FROM notes WHERE round_id = @roundId AND artifact_id = @artifactId', {
      roundId: varchar(roundId),
      artifactId: varchar(artifactId),
    });
    return;
  }
  await db.query(
    `MERGE notes AS t
     USING (SELECT @roundId AS round_id, @artifactId AS artifact_id) AS s
       ON t.round_id = s.round_id AND t.artifact_id = s.artifact_id
     WHEN MATCHED THEN UPDATE SET body = @body, updated_at = SYSUTCDATETIME(), updated_by = @userId
     WHEN NOT MATCHED THEN INSERT (round_id, artifact_id, body, updated_by)
       VALUES (@roundId, @artifactId, @body, @userId);`,
    { roundId: varchar(roundId), artifactId: varchar(artifactId), body, userId },
  );
}
