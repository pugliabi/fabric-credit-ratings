import type { MyScores } from '../domain/api-types';
import type { ScoreTriple } from '../domain/types';
import { api, ApiError, errorMessage } from '../lib/api';
import { formatTimestamp } from '../lib/format';
import { draftFromScores, sameDraft, type Draft } from './draft';

export const CHANGED_ELSEWHERE =
  'Your scores were changed somewhere else after this page opened, in another window or by the admin. ' +
  'Your edits here are kept on top of them. Check the sliders, then save again.';

export type SaveOutcome = { kind: 'saved' | 'changed'; card: MyScores };

/** `reload` offers a Reload button, for the 409s whose message asks for one. */
export type SaveStatus = { kind: 'idle' | 'saving' } | { kind: 'error'; message: string; reload: boolean };

/**
 * Saves the user's own card in the open round, unless the server's card no longer matches `saved` (the card this page
 * last loaded): a save replaces the whole card, so it would undo changes made elsewhere. Then nothing is saved and the
 * newer card comes back as `changed`. A newly opened round goes through, so the server refuses it in its own words.
 */
export async function saveCard(
  roundId: string,
  saved: Draft,
  scores: Readonly<Record<string, ScoreTriple>>,
): Promise<SaveOutcome> {
  const latest = await api<MyScores>('GET', '/rounds/open/my-scores');
  if (latest.round.id === roundId && !sameDraft(draftFromScores(latest.scores), saved)) {
    return { kind: 'changed', card: latest };
  }
  return { kind: 'saved', card: await api<MyScores>('PUT', '/rounds/open/my-scores', { round: roundId, scores }) };
}

/** A failed save: the server's words, plus a reminder that nothing typed here was lost. */
export function saveFailureMessage(reason: unknown): string {
  return `${errorMessage(reason)}${reason instanceof ApiError ? ' Your draft is kept in this browser.' : ''}`;
}

/** The toolbar's state words. A failed save's message shows beside them, so they keep describing the card. */
export function saveStateText(
  status: SaveStatus,
  card: { dirty: boolean; restored: boolean; updatedAt: string | null },
): string {
  if (status.kind === 'saving') return 'Saving…';
  if (card.dirty) return card.restored ? 'Unsaved draft restored' : 'Unsaved changes';
  return card.updatedAt ? `Saved ${formatTimestamp(card.updatedAt)}` : 'Nothing saved yet';
}
