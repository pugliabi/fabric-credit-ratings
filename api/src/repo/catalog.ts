import type { AdminArtifact, AdminCatalog, AdminWorkload } from '../../../src/domain/api-types.ts';
import { parseNaFactors, serializeNaFactors } from '../../../src/domain/factors-applicable.ts';
import type { Artifact, FactorId, ReleaseStatus, Workload } from '../../../src/domain/types.ts';
import { varchar, type Db } from '../lib/db.ts';

export async function listWorkloads(db: Db): Promise<Workload[]> {
  return db.query<Workload>('SELECT id, name, short_name AS shortName, blurb FROM workloads ORDER BY sort_order, name');
}

/** Catalog order: workload order, then item order within the workload. */
export async function listArtifacts(db: Db): Promise<Artifact[]> {
  const rows = await db.query<Artifact>(
    `SELECT a.id, a.name, a.workload_id AS workload, a.status, a.na_factors AS naFactors
     FROM artifacts a JOIN workloads w ON w.id = a.workload_id
     ORDER BY w.sort_order, a.sort_order, a.name`,
  );
  return rows.map((row) => ({ ...row, naFactors: parseNaFactors(row.naFactors as unknown as string) }));
}

export async function adminCatalog(db: Db): Promise<AdminCatalog> {
  const [workloads, artifacts] = await Promise.all([
    db.query<AdminWorkload>(
      'SELECT id, name, short_name AS shortName, blurb, sort_order AS sortOrder FROM workloads ORDER BY sort_order, name',
    ),
    db.query<AdminArtifact>(
      `SELECT a.id, a.name, a.workload_id AS workload, a.status, a.na_factors AS naFactors, a.sort_order AS sortOrder,
              a.description,
              CAST(CASE WHEN EXISTS (SELECT 1 FROM scores s WHERE s.artifact_id = a.id)
                          OR EXISTS (SELECT 1 FROM notes n WHERE n.artifact_id = a.id)
                        THEN 1 ELSE 0 END AS bit) AS referenced
       FROM artifacts a JOIN workloads w ON w.id = a.workload_id
       ORDER BY w.sort_order, a.sort_order, a.name`,
    ),
  ]);
  return {
    workloads,
    artifacts: artifacts.map((row) => ({ ...row, naFactors: parseNaFactors(row.naFactors as unknown as string) })),
  };
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
    { ...workload, id: varchar(workload.id) },
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
    { id: varchar(id), ...fields },
  );
}

interface ArtifactFields {
  name: string;
  workload: string;
  status: ReleaseStatus;
  naFactors: FactorId[];
}

export async function createArtifact(db: Db, artifact: ArtifactFields & { id: string }): Promise<void> {
  await db.query(
    `INSERT INTO artifacts (id, name, workload_id, status, na_factors, sort_order)
     SELECT @id, @name, @workload, @status, @naFactors, ISNULL(MAX(sort_order), 0) + 10
     FROM artifacts WHERE workload_id = @workload`,
    {
      ...artifact,
      id: varchar(artifact.id),
      workload: varchar(artifact.workload),
      status: varchar(artifact.status),
      naFactors: varchar(serializeNaFactors(artifact.naFactors)),
    },
  );
}

export async function updateArtifact(
  db: Db,
  id: string,
  fields: ArtifactFields & { sortOrder: number },
): Promise<void> {
  await db.query(
    `UPDATE artifacts
     SET name = @name, workload_id = @workload, status = @status, na_factors = @naFactors, sort_order = @sortOrder,
       updated_at = SYSUTCDATETIME()
     WHERE id = @id`,
    {
      ...fields,
      id: varchar(id),
      workload: varchar(fields.workload),
      status: varchar(fields.status),
      naFactors: varchar(serializeNaFactors(fields.naFactors)),
    },
  );
}

/** Admin-only prompt context for the AI draft. It isn't published, so callers don't mark the site changed. */
export async function setArtifactDescription(db: Db, id: string, description: string): Promise<void> {
  await db.query('UPDATE artifacts SET description = @description, updated_at = SYSUTCDATETIME() WHERE id = @id', {
    id: varchar(id),
    description,
  });
}

/** The item's description, or '' when it has none or the id is unknown. */
export async function findArtifactDescription(db: Db, id: string): Promise<string> {
  const [row] = await db.query<{ description: string }>('SELECT description FROM artifacts WHERE id = @id', {
    id: varchar(id),
  });
  return row?.description ?? '';
}

export async function deleteArtifact(db: Db, id: string): Promise<void> {
  await db.query('DELETE FROM artifacts WHERE id = @id', { id: varchar(id) });
}

export async function upsertWorkload(db: Db, workload: Workload, sortOrder: number): Promise<void> {
  await db.query(
    `MERGE workloads AS t USING (SELECT @id AS id) AS s ON t.id = s.id
     WHEN MATCHED THEN UPDATE SET name = @name, short_name = @shortName, blurb = @blurb, sort_order = @sortOrder,
       updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (id, name, short_name, blurb, sort_order)
       VALUES (@id, @name, @shortName, @blurb, @sortOrder);`,
    { id: varchar(workload.id), name: workload.name, shortName: workload.shortName, blurb: workload.blurb, sortOrder },
  );
}

export async function upsertArtifact(db: Db, artifact: Artifact, sortOrder: number): Promise<void> {
  await db.query(
    `MERGE artifacts AS t USING (SELECT @id AS id) AS s ON t.id = s.id
     WHEN MATCHED THEN UPDATE SET name = @name, workload_id = @workload, status = @status, sort_order = @sortOrder,
       updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (id, name, workload_id, status, sort_order)
       VALUES (@id, @name, @workload, @status, @sortOrder);`,
    {
      id: varchar(artifact.id),
      name: artifact.name,
      workload: varchar(artifact.workload),
      status: varchar(artifact.status),
      sortOrder,
    },
  );
}
