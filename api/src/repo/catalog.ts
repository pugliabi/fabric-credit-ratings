import type { AdminArtifact, AdminCatalog, AdminWorkload } from '../../../src/domain/api-types.ts';
import type { Artifact, ReleaseStatus, Workload } from '../../../src/domain/types.ts';
import type { Db } from '../lib/db.ts';

export async function listWorkloads(db: Db): Promise<Workload[]> {
  return db.query<Workload>('SELECT id, name, short_name AS shortName, blurb FROM workloads ORDER BY sort_order, name');
}

/** Catalog order: workload order, then item order within the workload. */
export async function listArtifacts(db: Db): Promise<Artifact[]> {
  return db.query<Artifact>(
    `SELECT a.id, a.name, a.workload_id AS workload, a.status
     FROM artifacts a JOIN workloads w ON w.id = a.workload_id
     ORDER BY w.sort_order, a.sort_order, a.name`,
  );
}

export async function adminCatalog(db: Db): Promise<AdminCatalog> {
  const [workloads, artifacts] = await Promise.all([
    db.query<AdminWorkload>(
      'SELECT id, name, short_name AS shortName, blurb, sort_order AS sortOrder FROM workloads ORDER BY sort_order, name',
    ),
    db.query<AdminArtifact>(
      `SELECT a.id, a.name, a.workload_id AS workload, a.status, a.sort_order AS sortOrder,
              CAST(CASE WHEN EXISTS (SELECT 1 FROM scores s WHERE s.artifact_id = a.id)
                          OR EXISTS (SELECT 1 FROM notes n WHERE n.artifact_id = a.id)
                        THEN 1 ELSE 0 END AS bit) AS referenced
       FROM artifacts a JOIN workloads w ON w.id = a.workload_id
       ORDER BY w.sort_order, a.sort_order, a.name`,
    ),
  ]);
  return { workloads, artifacts };
}

interface WorkloadFields {
  name: string;
  shortName: string;
  blurb: string;
}

export async function createWorkload(db: Db, workload: WorkloadFields & { id: string }): Promise<void> {
  await db.query(
    `INSERT INTO workloads (id, name, short_name, blurb, sort_order)
     SELECT @id, @name, @shortName, @blurb, ISNULL(MAX(sort_order), 0) + 10 FROM workloads`,
    { ...workload },
  );
}

export async function updateWorkload(
  db: Db,
  id: string,
  fields: WorkloadFields & { sortOrder: number },
): Promise<void> {
  await db.query(
    `UPDATE workloads
     SET name = @name, short_name = @shortName, blurb = @blurb, sort_order = @sortOrder, updated_at = SYSUTCDATETIME()
     WHERE id = @id`,
    { id, ...fields },
  );
}

interface ArtifactFields {
  name: string;
  workload: string;
  status: ReleaseStatus;
}

export async function createArtifact(db: Db, artifact: ArtifactFields & { id: string }): Promise<void> {
  await db.query(
    `INSERT INTO artifacts (id, name, workload_id, status, sort_order)
     SELECT @id, @name, @workload, @status, ISNULL(MAX(sort_order), 0) + 10 FROM artifacts WHERE workload_id = @workload`,
    { ...artifact },
  );
}

export async function updateArtifact(
  db: Db,
  id: string,
  fields: ArtifactFields & { sortOrder: number },
): Promise<void> {
  await db.query(
    `UPDATE artifacts
     SET name = @name, workload_id = @workload, status = @status, sort_order = @sortOrder, updated_at = SYSUTCDATETIME()
     WHERE id = @id`,
    { id, ...fields },
  );
}

export async function deleteArtifact(db: Db, id: string): Promise<void> {
  await db.query('DELETE FROM artifacts WHERE id = @id', { id });
}

export async function upsertWorkload(db: Db, workload: Workload, sortOrder: number): Promise<void> {
  await db.query(
    `MERGE workloads AS t USING (SELECT @id AS id) AS s ON t.id = s.id
     WHEN MATCHED THEN UPDATE SET name = @name, short_name = @shortName, blurb = @blurb, sort_order = @sortOrder,
       updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (id, name, short_name, blurb, sort_order)
       VALUES (@id, @name, @shortName, @blurb, @sortOrder);`,
    { id: workload.id, name: workload.name, shortName: workload.shortName, blurb: workload.blurb, sortOrder },
  );
}

export async function upsertArtifact(db: Db, artifact: Artifact, sortOrder: number): Promise<void> {
  await db.query(
    `MERGE artifacts AS t USING (SELECT @id AS id) AS s ON t.id = s.id
     WHEN MATCHED THEN UPDATE SET name = @name, workload_id = @workload, status = @status, sort_order = @sortOrder,
       updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (id, name, workload_id, status, sort_order)
       VALUES (@id, @name, @workload, @status, @sortOrder);`,
    { id: artifact.id, name: artifact.name, workload: artifact.workload, status: artifact.status, sortOrder },
  );
}
