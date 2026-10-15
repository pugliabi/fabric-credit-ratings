import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 200;
const COST = 32768;
const BLOCK_SIZE = 8;
const PARALLELISM = 3;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;
const PREFIX = `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELISM}$`;

function derive(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keyLength, { ...options, maxmem: MAX_MEMORY }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Stored as scrypt$N$r$p$salt$key, with salt and key in base64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLELISM });
  return ['scrypt', COST, BLOCK_SIZE, PARALLELISM, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Accepts only the current parameters and key length, so a tampered or truncated row can never match. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const options = { N: COST, r: BLOCK_SIZE, p: PARALLELISM };
  try {
    const [salt, key, ...extra] = stored.startsWith(PREFIX) ? stored.slice(PREFIX.length).split('$') : [];
    const expected = Buffer.from(key ?? '', 'base64');
    if (!salt || extra.length > 0 || expected.length !== KEY_LENGTH) {
      // Same scrypt work as a real check, so a login without a usable password can't be spotted by response time.
      await derive(password, randomBytes(16), KEY_LENGTH, options);
      return false;
    }
    const actual = await derive(password, Buffer.from(salt, 'base64'), KEY_LENGTH, options);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function passwordProblem(password: string): string | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  return undefined;
}

let dummy: Promise<string> | undefined;

/** A real hash to check against when the login does not exist, so both paths take the same time. */
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(16).toString('hex'));
  return dummy;
}
