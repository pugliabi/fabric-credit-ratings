import { useEffect } from 'react';

/** While `active`, leaving or reloading the page asks first: for edits that live only in this tab. */
export function useWarnBeforeUnload(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [active]);
}
