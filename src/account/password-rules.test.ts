import { describe, expect, it, vi } from 'vitest';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, newPasswordProblem } from './password-rules';

type PasswordProblem = (password: string) => string | undefined;

/** The browser tsconfig has no Node types, so the server module (node:crypto) is loaded untyped at run time. */
async function serverPasswordProblem(): Promise<PasswordProblem> {
  const server = await vi.importActual<{ passwordProblem: PasswordProblem }>('../../api/src/lib/password.ts');
  return server.passwordProblem;
}

describe('newPasswordProblem', () => {
  it('asks for the same password twice', () => {
    expect(newPasswordProblem('long enough!', 'long enough?')).toBe(
      'The new passwords do not match. Type the same password twice.',
    );
  });

  it("answers exactly like the server's passwordProblem for every length it checks", async () => {
    const passwordProblem = await serverPasswordProblem();
    const lengths = [0, 1, MIN_PASSWORD_LENGTH - 1, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH + 1];
    for (const length of lengths) {
      const password = 'x'.repeat(length);
      expect(newPasswordProblem(password, password), `length ${length}`).toBe(passwordProblem(password));
    }
    expect(passwordProblem('x'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe('Use at least 10 characters.');
    expect(passwordProblem('x'.repeat(MAX_PASSWORD_LENGTH + 1))).toBe('Use 200 characters or fewer.');
  });
});
