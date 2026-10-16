/** The server's limit on a why, counted on the trimmed text. */
export const NOTE_MAX = 2000;
/** The server's wording for a note over the limit. */
export const NOTE_TOO_LONG = 'Keep the write-up to 2,000 characters or fewer.';

/** A note over the limit is never sent; an empty one is (it clears the note). */
export function noteTooLong(text: string): boolean {
  return text.trim().length > NOTE_MAX;
}

type Reviewed = readonly { artifact: { id: string } }[];

/** The reviewed items with no why yet. */
export function missingWhy(items: Reviewed, notes: Readonly<Record<string, string>>): Set<string> {
  return new Set(items.map(({ artifact }) => artifact.id).filter((id) => !notes[id]?.trim()));
}

/**
 * "Only missing a why" after the review reloads. The filter is frozen while it's on, so a box being filled in stays
 * put; a reload keeps what it showed and adds items that are blank now.
 */
export function refreezeMissing(
  shown: ReadonlySet<string>,
  items: Reviewed,
  notes: Readonly<Record<string, string>>,
): Set<string> {
  const blank = missingWhy(items, notes);
  return new Set(items.map(({ artifact }) => artifact.id).filter((id) => shown.has(id) || blank.has(id)));
}
