import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredDraft } from './draft';
import { readDraft, writeDraft } from './usePersistentDraft';

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
});
