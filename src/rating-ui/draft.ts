import { ARTIFACTS } from '../data/artifacts';
import { MAX_SCORE, MIN_SCORE } from '../domain/grades';
import type { FactorValues, Score, ScoreTriple } from '../domain/types';

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

export function summarize(draft: Draft): DraftSummary {
  const scores: Record<string, ScoreTriple> = {};
  const partial: string[] = [];
  for (const artifact of ARTIFACTS) {
    const triple = draft[artifact.id];
    if (!triple || isBlank(triple)) continue;
    if (isComplete(triple)) scores[artifact.id] = triple;
    else partial.push(artifact.id);
  }
  return { scores, rated: Object.keys(scores).length, partial };
}

export function sameDraft(a: Draft, b: Draft): boolean {
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const id of ids) {
    const x = a[id] ?? EMPTY_TRIPLE;
    const y = b[id] ?? EMPTY_TRIPLE;
    if (x.some((score, i) => score !== y[i])) return false;
  }
  return true;
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
