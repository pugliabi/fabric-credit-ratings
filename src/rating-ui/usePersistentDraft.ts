import { useCallback, useEffect, useState } from 'react';
import { parseStoredDraft, restorable, sameDraft, type Draft, type DraftTriple, type StoredDraft } from './draft';

/** Stored drafts of a user's own cards are keyed `fcr-card:<userId>:<roundId>`. */
export const cardDraftPrefix = (userId: number) => `fcr-card:${userId}:`;

export function readDraft(key: string): StoredDraft | undefined {
  try {
    return parseStoredDraft(localStorage.getItem(key));
  } catch {
    return undefined;
  }
}

export function removeDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage is blocked entirely.
  }
}

export function writeDraft(key: string, stored: StoredDraft): void {
  try {
    localStorage.setItem(key, JSON.stringify(stored));
  } catch {
    // Storage is full or blocked; the draft lives only in this tab. An older record must not come back.
    removeDraft(key);
  }
}

/** Keeps a record only while the draft differs from the saved card; a clean record could never be restored anyway. */
export function persistDraft(key: string, base: Draft, draft: Draft): void {
  if (sameDraft(draft, base)) removeDraft(key);
  else writeDraft(key, { base, draft });
}

export function draftKeys(prefix: string): string[] {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

/** True when any stored draft under `prefix` holds edits that were never saved. */
export function hasUnsavedDrafts(prefix: string): boolean {
  return draftKeys(prefix).some((key) => {
    const stored = readDraft(key);
    return stored !== undefined && !sameDraft(stored.draft, stored.base);
  });
}

export function clearDrafts(prefix: string): void {
  for (const key of draftKeys(prefix)) removeDraft(key);
}

/**
 * The stored draft re-applied on top of `initial`, without rows for items missing from `known`: those can't be seen or
 * saved, and a record kept alive only by them would make Log out ask about scores the user can't find.
 */
export function restoredDraft(
  stored: StoredDraft | undefined,
  initial: Draft,
  known?: ReadonlySet<string>,
): Draft | undefined {
  const merged = restorable(stored, initial);
  if (!merged || !known) return merged;
  const pruned: Draft = Object.fromEntries(Object.entries(merged).filter(([id]) => known.has(id)));
  return sameDraft(pruned, initial) ? undefined : pruned;
}

/**
 * Slider state that survives reloads. `initial` is the saved card; keep it referentially stable (useMemo).
 * Only the rows a stored draft actually changed come back, re-applied on top of `initial`, so a save made
 * elsewhere is not hidden by an old draft. Each write records `initial` as the draft's base, so change
 * `initial` only together with `replace(...)` (as after a save) or by remounting. Remount (change the React
 * key) when `key` changes. `known` is the catalog's item ids, read once at mount.
 */
export function usePersistentDraft(key: string, initial: Draft, known?: ReadonlySet<string>) {
  const [kept] = useState(() => restoredDraft(readDraft(key), initial, known));
  const [draft, setDraft] = useState<Draft>(kept ?? initial);
  const [restored, setRestored] = useState(kept !== undefined);

  useEffect(() => {
    persistDraft(key, initial, draft);
  }, [key, initial, draft]);

  const setTriple = useCallback((artifactId: string, triple: DraftTriple) => {
    setDraft((current) => ({ ...current, [artifactId]: triple }));
  }, []);

  /** Replace the whole draft, e.g. when prefilling. Pass a function to build it from the current one (after a save). */
  const replace = useCallback((next: Draft | ((current: Draft) => Draft)) => {
    setDraft(next);
    setRestored(false);
  }, []);

  return { draft, setTriple, replace, restored };
}
