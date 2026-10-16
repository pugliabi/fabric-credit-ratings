import type { AdminArtifact, AdminWorkload } from '../domain/api-types';

/** The fields a workload PUT replaces; `sortOrder` goes alongside. */
export function workloadBody(workload: Pick<AdminWorkload, 'name' | 'shortName' | 'blurb'>) {
  return { name: workload.name, shortName: workload.shortName, blurb: workload.blurb };
}

export type WorkloadFields = ReturnType<typeof workloadBody>;

/** The fields an item PUT replaces; `sortOrder` goes alongside. */
export function artifactBody(artifact: AdminArtifact) {
  return { name: artifact.name, workload: artifact.workload, status: artifact.status };
}

export type ArtifactChanges = Partial<ReturnType<typeof artifactBody>>;

/** The whole-row PUT body for an item edit. An item moved to another workload goes to its end. */
export function artifactUpdate(artifact: AdminArtifact, changes: ArtifactChanges, artifacts: readonly AdminArtifact[]) {
  const body = { ...artifactBody(artifact), ...changes };
  const sortOrder = body.workload === artifact.workload ? artifact.sortOrder : endOfWorkload(artifacts, body.workload);
  return { ...body, sortOrder };
}

/**
 * What a field shows once the server's value goes from `before` to `after`: an untouched field takes the new value,
 * so its Save can't offer to undo another admin's change; a field being edited keeps what was typed.
 */
export function followServer(field: string, before: string, after: string): string {
  return field.trim() === before ? after : field;
}

/** New sort orders (10, 20, 30, ...) after moving the item at `from` to `to`. Unchanged items are left out. */
export function reorder<T extends { sortOrder: number }>(
  items: readonly T[],
  from: number,
  to: number,
): { item: T; sortOrder: number }[] {
  if (from === to || to < 0 || to >= items.length) return [];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (!moved) return [];
  next.splice(to, 0, moved);
  return next.flatMap((item, index) => {
    const sortOrder = (index + 1) * 10;
    return item.sortOrder === sortOrder ? [] : [{ item, sortOrder }];
  });
}

/** The sort order that puts an item moved into `workload` at its end; its old order could tie with items there. */
export function endOfWorkload(
  artifacts: readonly { workload: string; sortOrder: number }[],
  workload: string,
): number {
  return Math.max(0, ...artifacts.filter((item) => item.workload === workload).map((item) => item.sortOrder)) + 10;
}

/** "Copy job (Preview)" -> "copy-job-preview" */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 64)
    .replace(/^-+|-+$/g, '');
}

/** The API refuses these ids (validate.ts isReservedId): they already name built-ins on plain objects. */
const RESERVED_IDS: ReadonlySet<string> = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);

/** The API's refusal for a reserved id, or undefined. */
export function reservedIdProblem(label: 'Item id' | 'Workload id', id: string): string | undefined {
  return RESERVED_IDS.has(id) ? `${label} ${id} is reserved. Pick another id.` : undefined;
}
