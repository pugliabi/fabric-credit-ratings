import { useCallback, useEffect, useState } from 'react';
import { restorable, type Draft, type DraftTriple, type StoredDraft } from './draft';

function read(key: string): StoredDraft | undefined {
  try {
    const raw = localStorage.getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : undefined;
    if (typeof value === 'object' && value !== null && 'base' in value && 'draft' in value) {
      return value as StoredDraft;
    }
  } catch {
    // An unreadable draft is dropped.
  }
  return undefined;
}

/**
 * Slider state that survives reloads. `initial` is the saved card; keep it referentially stable (useMemo).
 * A stored draft comes back only if it holds edits that were never saved, so a save made elsewhere is not
 * hidden by an old draft. Remount (change the React key) when `key` changes.
 */
export function usePersistentDraft(key: string, initial: Draft) {
  const [kept] = useState(() => restorable(read(key), initial));
  const [draft, setDraft] = useState<Draft>(kept ?? initial);
  const [restored, setRestored] = useState(kept !== undefined);

  useEffect(() => {
    const stored: StoredDraft = { base: initial, draft };
    localStorage.setItem(key, JSON.stringify(stored));
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
