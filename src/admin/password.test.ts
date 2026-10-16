import { afterEach, describe, expect, it, vi } from 'vitest';
import { newPasswordProblem } from '../account/password-rules';
import { generatePassword } from './password';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generatePassword', () => {
  it('makes 16 characters without look-alikes', () => {
    expect(generatePassword()).toMatch(/^[a-hjkmnp-zA-HJ-NP-Z2-9]{16}$/);
  });

  it('differs between calls', () => {
    expect(generatePassword()).not.toBe(generatePassword());
  });

  it('passes the server-worded password rules', () => {
    const password = generatePassword();
    expect(newPasswordProblem(password, password)).toBeUndefined();
  });

  it('skips the bytes that would favour the first characters, and draws more until it has enough', () => {
    // 220 is the first byte past the largest multiple of 55 that fits in a byte.
    const batches = [
      [255, 220, 0, 219],
      [54, 55, 1, 2],
    ];
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      if (array instanceof Uint8Array) array.set(batches.shift()!);
      return array;
    });
    expect(generatePassword(4)).toBe('a99a');
    expect(batches).toEqual([]);
  });
});
