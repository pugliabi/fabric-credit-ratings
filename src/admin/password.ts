const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Bytes at or above this would favour the first characters, because 256 isn't a multiple of 55. */
const LIMIT = 256 - (256 % ALPHABET.length);

/** A random password the admin can read out or paste: no 0, O, 1, l, or I. */
export function generatePassword(length = 16): string {
  let password = '';
  while (password.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte < LIMIT && password.length < length) password += ALPHABET.charAt(byte % ALPHABET.length);
    }
  }
  return password;
}
