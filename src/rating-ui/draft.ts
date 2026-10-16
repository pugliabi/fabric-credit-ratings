import { MAX_SCORE, MIN_SCORE } from '../domain/grades';
import type { Artifact, FactorValues, Score, ScoreTriple } from '../domain/types';

/** null = slider not touched yet. */
export type DraftScore = Score | null;
export type DraftTriple = readonly [DraftScore, DraftScore, DraftScore];
export type Draft = Readonly<Record<string, DraftTriple>>;

export const EMPTY_TRIPLE: DraftTriple = [null, null, null];

export function isComplete(triple: DraftTriple): triple is ScoreTriple {
  return triple.every((score) => score !== null);
}

export function isBlank(triple: DraftTriple): boolean {
  return triple.every((score) => score === null);
}

export function toScore(value: number): Score {
  return Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(value))) as Score;
}

export interface DraftSummary {
  /** Complete triples in catalog order, ready to save. */
  scores: Record<string, ScoreTriple>;
  rated: number;
  /** Artifact ids with some but not all three factors set. */
  partial: string[];
}

export function summarize(draft: Draft, artifacts: readonly Artifact[]): DraftSummary {
  const scores: Record<string, ScoreTriple> = {};
  const partial: string[] = [];
  for (const artifact of artifacts) {
    const triple = draft[artifact.id];
    if (!triple || isBlank(triple)) continue;
    if (isComplete(triple)) scores[artifact.id] = triple;
    else partial.push(artifact.id);
  }
  return { scores, rated: Object.keys(scores).length, partial };
}

function sameTriple(a: DraftTriple, b: DraftTriple): boolean {
  return a.every((score, i) => score === b[i]);
}

export function sameDraft(a: Draft, b: Draft): boolean {
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const id of ids) if (!sameTriple(a[id] ?? EMPTY_TRIPLE, b[id] ?? EMPTY_TRIPLE)) return false;
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
  const merged: Record<string, DraftTriple> = { ...saved };
  for (const id of new Set([...Object.keys(stored.draft), ...Object.keys(stored.base)])) {
    const row = stored.draft[id] ?? EMPTY_TRIPLE;
    if (!sameTriple(row, stored.base[id] ?? EMPTY_TRIPLE)) merged[id] = row;
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

function isRow(value: unknown): value is DraftTriple {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((score) => score === null || (Number.isInteger(score) && score >= MIN_SCORE && score <= MAX_SCORE))
  );
}

function isDraft(value: unknown): value is Draft {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every(isRow);
}

/** Parses what usePersistentDraft stored. Anything malformed counts as no draft. */
export function parseStoredDraft(raw: string | null): StoredDraft | undefined {
  try {
    const value: unknown = raw ? JSON.parse(raw) : undefined;
    if (typeof value === 'object' && value !== null && 'base' in value && 'draft' in value) {
      const { base, draft } = value;
      if (isDraft(base) && isDraft(draft)) return { base, draft };
    }
  } catch {
    // Unreadable JSON counts as no draft.
  }
  return undefined;
}

export function draftFromScores(scores: Readonly<Record<string, ScoreTriple>>): Draft {
  return { ...scores };
}

/** Rounds averaged values to whole scores so they can seed the sliders. */
export function draftFromValues(values: Readonly<Record<string, FactorValues>>): Draft {
  const draft: Record<string, DraftTriple> = {};
  for (const [id, v] of Object.entries(values)) draft[id] = [toScore(v.capability), toScore(v.ux), toScore(v.cost)];
  return draft;
}
