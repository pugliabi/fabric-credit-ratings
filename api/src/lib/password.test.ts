import { describe, expect, it } from 'vitest';
import { hashPassword, passwordProblem, verifyPassword } from './password.ts';

describe('password hashing', () => {
  it('stores scrypt parameters, salt, and key', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored).toMatch(/^scrypt\$32768\$8\$3\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'));
  });

  it('accepts the right password and rejects others', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batterz', stored)).toBe(false);
  });

  it('rejects malformed stored values instead of throwing', async () => {
    expect(await verifyPassword('anything', 'unset')).toBe(false);
    expect(await verifyPassword('anything', 'scrypt$1$2$3$xx$yy')).toBe(false);
    const good = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', `${good}$extra`)).toBe(false);
  });

  it('rejects stored values whose key is empty or too short', async () => {
    const good = await hashPassword('correct horse battery');
    const keyless = good.slice(0, good.lastIndexOf('$') + 1);
    expect(await verifyPassword('anything', `${keyless}=`)).toBe(false);
    expect(await verifyPassword('anything', `${keyless}AA`)).toBe(false);
    expect(await verifyPassword('anything', `scrypt$32768$8$1$${'A'.repeat(22)}==$=`)).toBe(false);
  });

  it('rejects stored values with parameters other than the current ones', async () => {
    const good = await hashPassword('correct horse battery');
    const tampered = good.replace(/^scrypt\$\d+\$\d+\$\d+\$/, 'scrypt$262144$1$262144$');
    expect(await verifyPassword('correct horse battery', tampered)).toBe(false);
  });
});

describe('passwordProblem', () => {
  it('asks for at least 10 characters', () => {
    expect(passwordProblem('short')).toBe('Use at least 10 characters.');
  });

  it('accepts long enough passwords', () => {
    expect(passwordProblem('long enough!')).toBeUndefined();
  });
});
