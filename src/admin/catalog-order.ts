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
