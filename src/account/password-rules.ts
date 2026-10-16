/** The server's passwordProblem rules (api/src/lib/password.ts), which the browser bundle can't import. */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

export function newPasswordProblem(next: string, repeat: string): string | undefined {
  if (next !== repeat) return 'The new passwords do not match. Type the same password twice.';
  if (next.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (next.length > MAX_PASSWORD_LENGTH) return `Use ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  return undefined;
}
