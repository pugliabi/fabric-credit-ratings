import { FACTORS } from '../data/factors';
import { MAX_SCORE, MIN_SCORE } from '../domain/grades';
import { applicableFactors } from '../domain/factors-applicable';
import type { Artifact, FactorId, FactorValues, Score, ScoreTuple } from '../domain/types';

/** null = slider not touched yet. */
export type DraftScore = Score | null;
export type DraftTuple = readonly [DraftScore, DraftScore, DraftScore, DraftScore];
export type Draft = Readonly<Record<string, DraftTuple>>;

export const EMPTY_TUPLE: DraftTuple = [null, null, null, null];

/** Every position the item's factors apply to is set; a not-applicable position is null and not looked at. */
export function isComplete(tuple: DraftTuple, artifact: { naFactors?: readonly FactorId[] }): tuple is ScoreTuple {
  const applicable = applicableFactors(artifact);
  return FACTORS.every((factor, i) => (applicable.includes(factor.id) ? tuple[i] !== null : true));
}

export function isBlank(tuple: DraftTuple): boolean {
  return tuple.every((score) => score === null);
}

export function toScore(value: number): Score {
  return Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(value))) as Score;
}

export interface DraftSummary {
  /** Complete tuples in catalog order, ready to save. */
  scores: Record<string, ScoreTuple>;
  rated: number;
  /** Artifact ids with some but not all of their applicable factors set. */
  partial: string[];
}

export function summarize(draft: Draft, artifacts: readonly Artifact[]): DraftSummary {
  const scores: Record<string, ScoreTuple> = {};
  const partial: string[] = [];
  for (const artifact of artifacts) {
    const tuple = draft[artifact.id];
    if (!tuple || isBlank(tuple)) continue;
    if (isComplete(tuple, artifact)) {
      const applicable = applicableFactors(artifact);
      // A not-applicable position goes out as null, whatever a stale draft holds there.
      scores[artifact.id] = FACTORS.map((factor, i) =>
        applicable.includes(factor.id) ? tuple[i] : null,
      ) as unknown as ScoreTuple;
    }
    else partial.push(artifact.id);
  }
  return { scores, rated: Object.keys(scores).length, partial };
}

export function sameTuple(a: DraftTuple, b: DraftTuple): boolean {
  return a.every((score, i) => score === b[i]);
}

export function sameDraft(a: Draft, b: Draft): boolean {
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const id of ids) if (!sameTuple(a[id] ?? EMPTY_TUPLE, b[id] ?? EMPTY_TUPLE)) return false;
  return true;
}

/** Unsaved changes, counting only items in the catalog: a row for a deleted item can't be seen or saved. */
export function hasChanges(draft: Draft, saved: Draft, ids: ReadonlySet<string>): boolean {
  return !sameDraft(Object.fromEntries(Object.entries(draft).filter(([id]) => ids.has(id))), saved);
}

/** What usePersistentDraft keeps in localStorage. */
export interface StoredDraft {
  /** The saved card the draft was edited from. */
  base: Draft;
  draft: Draft;
}

/**
 * The stored draft's edits, re-applied on top of the saved card. A row comes from the draft only if it differs from the
 * card the draft started from, so rows the rater never touched keep a newer save. A row changed both in the draft and
 * in a newer save keeps the draft's whole row, since that was the rater's last explicit choice.
 */
export function restorable(stored: StoredDraft | undefined, saved: Draft): Draft | undefined {
  if (!stored) return undefined;
  const merged: Record<string, DraftTuple> = { ...saved };
  for (const id of new Set([...Object.keys(stored.draft), ...Object.keys(stored.base)])) {
    const row = stored.draft[id] ?? EMPTY_TUPLE;
    if (!sameTuple(row, stored.base[id] ?? EMPTY_TUPLE)) merged[id] = row;
  }
  return sameDraft(merged, saved) ? undefined : merged;
}

/**
 * The draft once the saved card under it has changed (this tab's save, another window, or an admin edit): rows changed
 * since `base` stay as they are, and every other row takes the new card.
 */
export function rebase(base: Draft, current: Draft, card: Draft): Draft {
  return restorable({ base, draft: current }, card) ?? card;
}

function isEntry(score: unknown): boolean {
  if (score === null) return true;
  return typeof score === 'number' && Number.isInteger(score) && score >= MIN_SCORE && score <= MAX_SCORE;
}

/** A stored row with four entries, or an older three-entry row (from before Outlook) padded with an unset fourth. */
function toRow(value: unknown): DraftTuple | undefined {
  if (!Array.isArray(value) || !value.every(isEntry)) return undefined;
  if (value.length === 4) return value as unknown as DraftTuple;
  if (value.length === 3) return [...value, null] as unknown as DraftTuple;
  return undefined;
}

function toDraft(value: unknown): Draft | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const draft: Record<string, DraftTuple> = {};
  for (const [id, row] of Object.entries(value)) {
    const tuple = toRow(row);
    if (!tuple) return undefined;
    draft[id] = tuple;
  }
  return draft;
}

/** Parses what usePersistentDraft stored. Anything malformed counts as no draft. */
export function parseStoredDraft(raw: string | null): StoredDraft | undefined {
  try {
    const value: unknown = raw ? JSON.parse(raw) : undefined;
    if (typeof value === 'object' && value !== null && 'base' in value && 'draft' in value) {
      const { base, draft } = value;
      const parsedBase = toDraft(base);
      const parsedDraft = toDraft(draft);
      if (parsedBase && parsedDraft) return { base: parsedBase, draft: parsedDraft };
    }
  } catch {
    // Unreadable JSON counts as no draft.
  }
  return undefined;
}

/** The saved card as a draft. Rows go through the same upgrade as stored drafts: an old API's three-entry card is
 * padded with an unset Outlook, and a row of any other shape is dropped. */
export function draftFromScores(scores: Readonly<Record<string, ScoreTuple>>): Draft {
  const draft: Record<string, DraftTuple> = {};
  for (const [id, row] of Object.entries(scores)) {
    const tuple = toRow(row);
    if (tuple) draft[id] = tuple;
  }
  return draft;
}

/** Rounds averaged values to whole scores so they can seed the sliders. */
export function draftFromValues(values: Readonly<Record<string, FactorValues>>): Draft {
  const draft: Record<string, DraftTuple> = {};
  for (const [id, v] of Object.entries(values)) {
    draft[id] = FACTORS.map((factor) => {
      const value = v[factor.id];
      return value === null ? null : toScore(value);
    }) as unknown as DraftTuple;
  }
  return draft;
}
