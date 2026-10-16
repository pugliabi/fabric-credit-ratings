import { describe, expect, it } from 'vitest';
import { NOTE_MAX, noteTooLong } from './notes';

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
