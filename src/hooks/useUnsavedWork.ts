import { useEffect } from 'react';

export const LEAVE_UNSAVED = 'Your unsaved whys or card edits will be lost. Leave anyway?';

const holds = new Set<symbol>();

/** Marks work on this page that lives only in this tab, until the returned function releases it. */
export function holdUnsaved(): () => void {
  const hold = Symbol('unsaved');
  holds.add(hold);
  return () => {
    holds.delete(hold);
  };
}

/** True while anything on the page holds unsaved work. */
export function hasUnsavedWork(): boolean {
  return holds.size > 0;
}

/** True when nothing on the page is unsaved, or the user agrees to lose it. Ask before switching a tab or a round. */
export function mayLeave(ask: (message: string) => boolean = (message) => confirm(message)): boolean {
  return !hasUnsavedWork() || ask(LEAVE_UNSAVED);
}

/** While `active`, leaving or reloading the page asks first, and so does mayLeave(). */
export function useUnsavedWork(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const release = holdUnsaved();
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener('beforeunload', warn);
    return () => {
      release();
      removeEventListener('beforeunload', warn);
    };
  }, [active]);
}
