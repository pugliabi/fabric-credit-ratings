import { describe, expect, it, vi } from 'vitest';
import {
  afterSent,
  createNoteSaver,
  missingWhy,
  NOTE_MAX,
  notesToSend,
  noteTooLong,
  refreezeMissing,
  withDraft,
  withNote,
  type Edits,
} from './notes';

const clean = (notes: Record<string, string>): Edits => ({ notes, dirty: new Set() });

describe('note edits', () => {
  it('marks a typed note as unsaved', () => {
    expect(withNote(clean({ notebook: 'Old.' }), 'environment', 'New.')).toEqual({
      notes: { notebook: 'Old.', environment: 'New.' },
      dirty: new Set(['environment']),
    });
  });

  it('puts an AI draft in as an unsaved edit, except over typed text when only blanks are wanted', () => {
    const typed = withNote(clean({}), 'notebook', 'Typed.');
    expect(withDraft(typed, 'notebook', 'Drafted.', false).notes.notebook).toBe('Drafted.');
    expect(withDraft(typed, 'notebook', 'Drafted.', true)).toBe(typed);
    expect(withDraft(clean({ notebook: '  ' }), 'notebook', 'Drafted.', true).notes.notebook).toBe('Drafted.');
  });

  it('sends every unsaved note, an emptied one too, but not one over the limit', () => {
    let edits = withNote(clean({}), 'notebook', 'Because.');
    edits = withNote(edits, 'environment', '');
    edits = withNote(edits, 'lakehouse', 'x'.repeat(2001));
    expect(notesToSend(edits)).toEqual({ notebook: 'Because.', environment: '' });
  });

  it('after a save, keeps a note typed again meanwhile unsaved, so it goes out next', () => {
    let edits = withNote(withNote(clean({}), 'notebook', 'First.'), 'environment', 'Other.');
    const sent = notesToSend(edits);
    edits = withNote(edits, 'notebook', 'First, then more.');
    expect([...afterSent(edits, sent).dirty]).toEqual(['notebook']);
  });
});

describe('createNoteSaver', () => {
  it('sends one batch at a time, in order, and takes the next once the first is in', async () => {
    const releases: (() => void)[] = [];
    const put = vi.fn((_id: string, _body: string) => new Promise<void>((resolve) => releases.push(resolve)));
    const saver = createNoteSaver(put);
    const first = saver.send({ notebook: 'A.', environment: 'B.' });
    expect(saver.send({ notebook: 'A, then more.' })).toBeUndefined();
    releases.shift()?.();
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(saver.send({ notebook: 'A, then more.' })).toBeUndefined();
    releases.shift()?.();
    await first;
    expect(put.mock.calls).toEqual([
      ['notebook', 'A.'],
      ['environment', 'B.'],
    ]);
    expect(saver.send({ notebook: 'A, then more.' })).toBeDefined();
  });

  it('takes a new batch after one fails', async () => {
    const put = vi.fn(() => Promise.reject(new Error('down')));
    const saver = createNoteSaver(put);
    await expect(saver.send({ notebook: 'A.' })).rejects.toThrow('down');
    await expect(saver.send({ notebook: 'A.' })).rejects.toThrow('down');
    expect(put).toHaveBeenCalledTimes(2);
  });
});

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
  const items = ['notebook', 'environment', 'lakehouse'].map((id) => ({ artifact: { id } }));

  it('takes the items with no why yet; blank text counts as none', () => {
    expect([...missingWhy(items, { notebook: 'Because.', environment: '   ' })]).toEqual(['environment', 'lakehouse']);
  });

  it('keeps what it showed when the review reloads, adds newly blank items, and drops items no longer reviewed', () => {
    const shown = new Set(['environment', 'gone']);
    const notes = { notebook: 'Because.', environment: 'Typed while the filter was on.' };
    expect([...refreezeMissing(shown, items, notes)]).toEqual(['environment', 'lakehouse']);
  });
});
