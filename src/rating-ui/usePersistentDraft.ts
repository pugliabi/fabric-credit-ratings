import { useCallback, useEffect, useState } from 'react';
import { parseStoredDraft, restorable, type Draft, type DraftTriple, type StoredDraft } from './draft';

export function readDraft(key: string): StoredDraft | undefined {
  try {
    return parseStoredDraft(localStorage.getItem(key));
  } catch {
    return undefined;
  }
}

export function writeDraft(key: string, stored: StoredDraft): void {
  try {
    localStorage.setItem(key, JSON.stringify(stored));
  } catch {
    // Storage is full or blocked; the draft lives only in this tab. An older record must not come back.
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage is blocked entirely.
    }
  }
}

/**
 * Slider state that survives reloads. `initial` is the saved card; keep it referentially stable (useMemo).
 * Only the rows a stored draft actually changed come back, re-applied on top of `initial`, so a save made
 * elsewhere is not hidden by an old draft. Each write records `initial` as the draft's base, so change
 * `initial` only together with `replace(...)` (as after a save) or by remounting. Remount (change the React
 * key) when `key` changes.
 */
export function usePersistentDraft(key: string, initial: Draft) {
  const [kept] = useState(() => restorable(readDraft(key), initial));
  const [draft, setDraft] = useState<Draft>(kept ?? initial);
  const [restored, setRestored] = useState(kept !== undefined);

  useEffect(() => {
    writeDraft(key, { base: initial, draft });
  }, [key, initial, draft]);

  const setTriple = useCallback((artifactId: string, triple: DraftTriple) => {
    setDraft((current) => ({ ...current, [artifactId]: triple }));
  }, []);

  /** Replace the whole draft, e.g. after saving or when prefilling. */
  const replace = useCallback((next: Draft) => {
    setDraft(next);
    setRestored(false);
  }, []);

  return { draft, setTriple, replace, restored };
}
