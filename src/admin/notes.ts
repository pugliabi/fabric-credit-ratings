/** The server's limit on a why, counted on the trimmed text. */
export const NOTE_MAX = 2000;
/** The server's wording for a note over the limit. */
export const NOTE_TOO_LONG = 'Keep the write-up to 2,000 characters or fewer.';

/** A note over the limit is never sent; an empty one is (it clears the note). */
export function noteTooLong(text: string): boolean {
  return text.trim().length > NOTE_MAX;
}
