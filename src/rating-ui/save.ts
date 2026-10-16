import type { MyScores } from '../domain/api-types';
import type { ScoreTriple } from '../domain/types';
import { api } from '../lib/api';
import { draftFromScores, sameDraft, type Draft } from './draft';

export const CHANGED_ELSEWHERE =
  'Your scores were changed somewhere else after this page opened, in another window or by the admin. ' +
  'Your edits here are kept on top of them. Check the sliders, then save again.';

export type SaveOutcome = { kind: 'saved' | 'changed'; card: MyScores };

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
