/** The server's limit on a why, counted on the trimmed text. */
export const NOTE_MAX = 2000;
/** The server's wording for a note over the limit. */
export const NOTE_TOO_LONG = 'Keep the write-up to 2,000 characters or fewer.';

/** A note over the limit is never sent; an empty one is (it clears the note). */
export function noteTooLong(text: string): boolean {
  return text.trim().length > NOTE_MAX;
}

/** The Review tab's whys as typed, and which of them haven't reached the server yet. */
export interface Edits {
  notes: Readonly<Record<string, string>>;
  dirty: ReadonlySet<string>;
}

export function withNote(edits: Edits, id: string, text: string): Edits {
  return { notes: { ...edits.notes, [id]: text }, dirty: new Set(edits.dirty).add(id) };
}

/**
 * An AI draft lands as an edit, so the admin reads it before it autosaves like typed text. With `onlyIfBlank`, a box
 * typed in while the draft was out keeps its text.
 */
export function withDraft(edits: Edits, id: string, text: string, onlyIfBlank: boolean): Edits {
  return onlyIfBlank && edits.notes[id]?.trim() ? edits : withNote(edits, id, text);
}

/** The unsaved notes to send. One over the limit stays unsaved, with its full text in the box, until it's shortened. */
export function notesToSend(edits: Edits): Record<string, string> {
  return Object.fromEntries(
    [...edits.dirty].map((id) => [id, edits.notes[id] ?? ''] as const).filter(([, body]) => !noteTooLong(body)),
  );
}

/** After a save: notes still as sent are saved; one typed again meanwhile stays unsaved, so it goes out next. */
export function afterSent(edits: Edits, sent: Readonly<Record<string, string>>): Edits {
  return { ...edits, dirty: new Set([...edits.dirty].filter((id) => (edits.notes[id] ?? '') !== sent[id])) };
}

export interface NoteSaver {
  /** Undefined while another batch is out: offer it again once that one settles. */
  send(sent: Readonly<Record<string, string>>): Promise<void> | undefined;
}

/** Saves one batch of notes at a time, in order: two PUTs for the same note could commit out of order. */
export function createNoteSaver(put: (id: string, body: string) => Promise<unknown>): NoteSaver {
  let out = false;
  return {
    send(sent) {
      if (out) return undefined;
      out = true;
      return (async () => {
        try {
          for (const [id, body] of Object.entries(sent)) await put(id, body);
        } finally {
          out = false;
        }
      })();
    },
  };
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
