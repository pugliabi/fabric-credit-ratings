import { describe, expect, it } from 'vitest';
import { missingWhy, NOTE_MAX, noteTooLong, refreezeMissing } from './notes';

describe('noteTooLong', () => {
  it('accepts exactly the limit, counted after trimming', () => {
    expect(NOTE_MAX).toBe(2000);
    expect(noteTooLong('x'.repeat(2000))).toBe(false);
    expect(noteTooLong(`  ${'x'.repeat(2000)}  `)).toBe(false);
  });

  it('refuses one character more', () => {
    expect(noteTooLong('x'.repeat(2001))).toBe(true);
  });

  it('accepts an empty note, which clears it', () => {
    expect(noteTooLong('')).toBe(false);
  });
});

describe('the "Only missing a why" filter', () => {
  const items = [{ artifact: { id: 'notebook' } }, { artifact: { id: 'environment' } }, { artifact: { id: 'lakehouse' } }];

  it('takes the items with no why yet; blank text counts as none', () => {
    expect([...missingWhy(items, { notebook: 'Because.', environment: '   ' })]).toEqual(['environment', 'lakehouse']);
  });

  it('keeps what it showed when the review reloads, adds newly blank items, and drops items no longer reviewed', () => {
    const shown = new Set(['environment', 'gone']);
    const notes = { notebook: 'Because.', environment: 'Typed while the filter was on.' };
    expect([...refreezeMissing(shown, items, notes)]).toEqual(['environment', 'lakehouse']);
  });
});
