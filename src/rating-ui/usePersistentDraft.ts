import { useCallback, useEffect, useState } from 'react';
import { sameDraft, type Draft, type DraftTriple } from './draft';

function read(key: string): Draft | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Slider state that survives reloads. `initial` is only used when nothing is
 * stored under `key`; `restored` is true when the stored draft differs from it.
 * Remount (change the React key) when `key` changes.
 */
export function usePersistentDraft(key: string, initial: Draft) {
  const [stored] = useState(() => read(key));
  const [draft, setDraft] = useState<Draft>(stored ?? initial);
  const [restored, setRestored] = useState(stored !== undefined && !sameDraft(stored, initial));

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(draft));
  }, [key, draft]);

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
