import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredDraft } from './draft';
import { memoryStorage } from './memory-storage';
import {
  cardDraftPrefix,
  clearDrafts,
  draftKeys,
  hasUnsavedDrafts,
  persistDraft,
  readDraft,
  restoredDraft,
  writeDraft,
} from './usePersistentDraft';

const stored: StoredDraft = { base: { notebook: [5, 5, 5] }, draft: { notebook: [6, 5, 5] } };

function fail(name: string): never {
  throw new DOMException('Storage is not available.', name);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('draft storage', () => {
  it('writes a record that reads back', () => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
    });
    writeDraft('fcr-card:1:2026-Q4', stored);
    expect(readDraft('fcr-card:1:2026-Q4')).toEqual(stored);
  });

  it('keeps going when storage is full or blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => fail('SecurityError'),
      setItem: () => fail('QuotaExceededError'),
    });
    expect(() => writeDraft('fcr-card:1:2026-Q4', stored)).not.toThrow();
    expect(readDraft('fcr-card:1:2026-Q4')).toBeUndefined();
  });

  it('removes the older record when a write fails, so it cannot come back later', () => {
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem: () => fail('QuotaExceededError'), removeItem });
    writeDraft('fcr-card:1:2026-Q4', stored);
    expect(removeItem).toHaveBeenCalledWith('fcr-card:1:2026-Q4');
  });

  it('keeps going when the cleanup after a failed write fails too', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => fail('QuotaExceededError'),
      removeItem: () => fail('SecurityError'),
    });
    expect(() => writeDraft('fcr-card:1:2026-Q4', stored)).not.toThrow();
  });

  it('drops the record once the draft matches the saved card again', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    persistDraft('fcr-card:1:2026-Q4', stored.base, stored.draft);
    expect(readDraft('fcr-card:1:2026-Q4')).toEqual(stored);
    persistDraft('fcr-card:1:2026-Q4', stored.base, stored.base);
    expect(storage.items.has('fcr-card:1:2026-Q4')).toBe(false);
  });
});

describe('restoredDraft', () => {
  const known = new Set(['notebook', 'lakehouse']);

  it('restores nothing when the only edit is for an item no longer in the catalog', () => {
    const phantom: StoredDraft = { base: stored.base, draft: { ...stored.base, deleted: [3, 3, 3] } };
    expect(restoredDraft(phantom, stored.base, known)).toBeUndefined();
  });

  it("drops a deleted item's row but keeps the other edits", () => {
    const mixed: StoredDraft = { base: stored.base, draft: { notebook: [6, 5, 5], deleted: [3, 3, 3] } };
    expect(restoredDraft(mixed, stored.base, known)).toEqual({ notebook: [6, 5, 5] });
  });

  it('restores every row when no catalog is given', () => {
    const phantom: StoredDraft = { base: stored.base, draft: { ...stored.base, deleted: [3, 3, 3] } };
    expect(restoredDraft(phantom, stored.base)).toEqual({ ...stored.base, deleted: [3, 3, 3] });
  });
});

describe('clearing drafts', () => {
  const clean = JSON.stringify({ base: stored.base, draft: stored.base });
  const unsaved = JSON.stringify(stored);

  it("clears only that user's cards", () => {
    const storage = memoryStorage({
      'fcr-card:7:2026-Q4': '{}',
      'fcr-card:7:2027-Q1': '{}',
      'fcr-card:70:2026-Q4': '{}',
      other: 'x',
    });
    vi.stubGlobal('localStorage', storage);
    expect(draftKeys(cardDraftPrefix(7)).sort()).toEqual(['fcr-card:7:2026-Q4', 'fcr-card:7:2027-Q1']);
    clearDrafts(cardDraftPrefix(7));
    expect([...storage.items.keys()].sort()).toEqual(['fcr-card:70:2026-Q4', 'other']);
  });

  it("counts only records holding edits as unsaved scores, and only that user's", () => {
    vi.stubGlobal('localStorage', memoryStorage({ 'fcr-card:7:2026-Q4': clean, 'fcr-card:70:2026-Q4': unsaved }));
    expect(hasUnsavedDrafts(cardDraftPrefix(7))).toBe(false);
    vi.stubGlobal('localStorage', memoryStorage({ 'fcr-card:7:2026-Q4': clean, 'fcr-card:7:2025-Q3': unsaved }));
    expect(hasUnsavedDrafts(cardDraftPrefix(7))).toBe(true);
    vi.stubGlobal('localStorage', memoryStorage({ 'fcr-card:7:2026-Q4': '{"base":null}' }));
    expect(hasUnsavedDrafts(cardDraftPrefix(7))).toBe(false);
  });

  it('keeps going when storage is blocked while clearing', () => {
    vi.stubGlobal('localStorage', {
      get length(): number {
        return fail('SecurityError');
      },
    });
    expect(draftKeys('fcr-card:7:')).toEqual([]);
    expect(hasUnsavedDrafts('fcr-card:7:')).toBe(false);
    expect(() => clearDrafts('fcr-card:7:')).not.toThrow();
  });
});
