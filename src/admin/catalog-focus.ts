/** Keys for the Catalog tab's controls, so focus can go back to one after a write re-renders or removes it. */
export const focusKeys = {
  heading: 'heading',
  section: (workload: string) => `section:${workload}`,
  workloadName: (workload: string) => `workload-name:${workload}`,
  /** `scope` is `item:<id>` or `workload:<id>`. */
  arrow: (scope: string, direction: 'up' | 'down') => `${scope}:${direction}`,
  name: (item: string) => `name:${item}`,
  status: (item: string) => `status:${item}`,
  place: (item: string) => `place:${item}`,
  remove: (item: string) => `delete:${item}`,
  add: (workload: string) => `add:${workload}`,
  addWorkload: 'add-workload',
};

/** After a move: the arrow that was pressed, on the moved row, or the other one once that row reaches the end. */
export function moveFocus(scope: string, step: number): string[] {
  const [pressed, other] = step < 0 ? (['up', 'down'] as const) : (['down', 'up'] as const);
  return [focusKeys.arrow(scope, pressed), focusKeys.arrow(scope, other)];
}

/**
 * After a delete: the row itself, if the server refused and kept it (its Delete, or its Status once Delete turns
 * disabled), else the next row's Delete, the previous row's, or the workload's heading.
 */
export function deleteFocus(ids: readonly string[], index: number, workload: string): string[] {
  const [self, next, previous] = [ids[index], ids[index + 1], ids[index - 1]];
  return [
    ...(self === undefined ? [] : [focusKeys.remove(self), focusKeys.status(self)]),
    ...[next, previous].flatMap((id) => (id === undefined ? [] : [focusKeys.remove(id)])),
    focusKeys.section(workload),
  ];
}

interface Focusable {
  matches(selector: string): boolean;
}

/** The first control in `keys` that is still on the page and not disabled. */
export function pickFocus<T extends Focusable>(keys: readonly string[], find: (key: string) => T | undefined) {
  for (const key of keys) {
    const element = find(key);
    if (element && !element.matches(':disabled')) return element;
  }
  return undefined;
}

/** Focus is lost on <body>, nowhere, or on a control that just turned disabled (keys no longer reach it). */
export function focusLost(active: Focusable | null, body: Focusable | null): boolean {
  return !active || active === body || active.matches(':disabled');
}
