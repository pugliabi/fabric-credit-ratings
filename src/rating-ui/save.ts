import type { MyScores, RoundReview } from '../domain/api-types';
import type { Artifact, ScoreTriple, Workload } from '../domain/types';
import { api, ApiError, errorMessage } from '../lib/api';
import { formatTimestamp } from '../lib/format';
import {
  draftFromScores,
  EMPTY_TRIPLE,
  hasChanges,
  isBlank,
  rebase,
  sameDraft,
  sameTriple,
  type Draft,
  type DraftTriple,
} from './draft';

export const CHANGED_ELSEWHERE =
  'Your scores were changed somewhere else after this page opened, in another window or by an admin. ' +
  'Your edits here are kept on top of them. Check the sliders, then save again.';

export type SaveOutcome = { kind: 'saved' | 'changed'; card: MyScores };

/** `reload` offers a Reload button after a 409: the open round changed, and only a reload shows it. */
export type SaveStatus = { kind: 'idle' | 'saving' } | { kind: 'error'; message: string; reload: boolean };

/**
 * Saves the user's own card in the open round, unless the server's card no longer matches `saved` (the card this page
 * last loaded): a save replaces the whole card, so it would undo changes made elsewhere. Then nothing is saved and the
 * newer card comes back as `changed`. A newly opened round goes through, so the server refuses it in its own words.
 * A save that lands between the GET and the PUT is still overwritten; only a precondition on the PUT would close that.
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

/** What a finished save does to the draft (pass it to replace()) and to the status. */
export interface SettledSave {
  draft: (current: Draft) => Draft;
  status: SaveStatus;
}

/**
 * What a finished save does to the page. The draft is rebased, never replaced, so slider moves made while the request
 * was out survive its answer.
 */
export function settleSave(outcome: SaveOutcome, saved: Draft, sent: Draft, ids: ReadonlySet<string>): SettledSave {
  const card = draftFromScores(outcome.card.scores);
  if (outcome.kind === 'saved') return { draft: (current) => rebase(sent, current, card), status: { kind: 'idle' } };
  const left = hasChanges(rebase(saved, sent, card), card, ids);
  return {
    draft: (current) => rebase(saved, current, card),
    status: left ? { kind: 'error', message: CHANGED_ELSEWHERE, reload: false } : { kind: 'idle' },
  };
}

/** Save waits for a change, refuses incomplete rows (a save drops them, deleting their saved scores), and runs once. */
export function saveBlocked(dirty: boolean, partial: number, saving: boolean): boolean {
  return !dirty || partial > 0 || saving;
}

export interface SaveForm {
  /** saveBlocked() for the card as it is now. */
  blocked: boolean;
  roundId: string;
  /** The card this page last loaded. */
  saved: Draft;
  /** The draft at the moment Save was pressed. */
  sent: Draft;
  scores: Readonly<Record<string, ScoreTriple>>;
  ids: ReadonlySet<string>;
}

export interface SaveHandlers {
  saving: () => void;
  /** The server's card, and what to do with the draft and the status. */
  saved: (card: MyScores, settled: SettledSave) => void;
  /** The draft stays as it is; the stored copy too. */
  failed: (status: SaveStatus) => void;
}

/**
 * One press of Save. While Save is blocked nothing happens, so every caller (a click, Enter, a later shortcut) gets the
 * guard. Otherwise the checked save runs (saveCard) and its answer is settled onto the draft (settleSave).
 */
export async function pressSave(form: SaveForm, page: SaveHandlers): Promise<void> {
  if (form.blocked) return;
  page.saving();
  let outcome: SaveOutcome;
  try {
    outcome = await saveCard(form.roundId, form.saved, form.scores);
  } catch (reason) {
    const reload = reason instanceof ApiError && reason.status === 409;
    page.failed({ kind: 'error', message: saveFailureMessage(reason), reload });
    return;
  }
  page.saved(outcome.card, settleSave(outcome, form.saved, form.sent, form.ids));
}

/**
 * The admin's card editor, when the rater's card changed after the editor opened. `clashes` describes each row both
 * sides changed: there the admin's whole row wins, so the message has to say what it overrides.
 */
export function raterCardChanged(name: string, clashes: readonly string[] = []): string {
  const where = `${name}'s card changed after you opened it, on their page or in another admin window`;
  if (clashes.length === 0) {
    return `${where}. Your edits here are kept on top of it. Check the sliders, then save again.`;
  }
  const one = clashes.length === 1;
  return (
    `${where}, including ${one ? 'a row' : 'rows'} you changed too: ${new Intl.ListFormat('en').format(clashes)}. ` +
    `Your values are kept on ${one ? 'it' : 'them'}, and the rest of the card shows the newer scores. ` +
    `Check ${one ? 'it' : 'them'}, then save again.`
  );
}
export const CHANGED_WHILE_SAVING =
  'Saved. You changed scores while it was saving, and those changes are not saved yet. Save again to keep them.';

/** One rater's card, rebuilt from the per-rater breakdown of the whole review (never a filtered list of items). */
export function cardFromReview(review: RoundReview, userId: number): Draft {
  const card: Record<string, DraftTriple> = {};
  for (const item of review.items) {
    const entry = item.breakdown.find((row) => row.userId === userId);
    if (entry) card[item.artifact.id] = entry.scores;
  }
  return card;
}

/**
 * Every item an admin's view of a card can hold: the whole catalog (retired items included) plus any reviewed item
 * this page's catalog lacks (added after it loaded). A save replaces the whole card, so a missing item drops its score.
 */
export function raterCardArtifacts<A extends Artifact>(catalog: readonly A[], review: RoundReview): (A | Artifact)[] {
  const known = new Set(catalog.map((artifact) => artifact.id));
  return [...catalog, ...review.items.map((item) => item.artifact).filter((artifact) => !known.has(artifact.id))];
}

/** The catalog's workloads, plus a group named by its id for any item whose workload this page hasn't loaded. */
export function raterCardWorkloads(workloads: readonly Workload[], artifacts: readonly Artifact[]): Workload[] {
  const known = new Set(workloads.map((workload) => workload.id));
  const missing = [...new Set(artifacts.map((artifact) => artifact.workload))].filter((id) => !known.has(id));
  return [...workloads, ...missing.map((id) => ({ id, name: id, shortName: id, blurb: '' }))];
}

/** Rows that both `sent` and the newer `card` changed since `saved`, to different values. */
export function clashingRows(saved: Draft, sent: Draft, card: Draft): string[] {
  const ids = new Set([...Object.keys(saved), ...Object.keys(sent), ...Object.keys(card)]);
  const row = (draft: Draft, id: string) => draft[id] ?? EMPTY_TRIPLE;
  return [...ids].filter((id) => {
    const was = row(saved, id);
    const mine = row(sent, id);
    const theirs = row(card, id);
    return !sameTriple(mine, was) && !sameTriple(theirs, was) && !sameTriple(mine, theirs);
  });
}

export type RaterSaveOutcome = { kind: 'saved' | 'changed'; review: RoundReview };

/**
 * An admin saves a rater's card in any round, unless the rater's card in the round's latest review no longer matches
 * `saved` (the card the editor opened with): a save replaces the whole card, so it would undo the rater's newer save.
 * Then nothing is saved and the newer review comes back as `changed`. `raterId` is the number the server returned.
 * A save that lands between the GET and the PUT is still overwritten; only a precondition on the PUT would close that.
 */
export async function saveRaterCard(
  roundId: string,
  raterId: number,
  saved: Draft,
  scores: Readonly<Record<string, ScoreTriple>>,
): Promise<RaterSaveOutcome> {
  const latest = await api<RoundReview>('GET', `/admin/rounds/${roundId}/review`);
  if (!sameDraft(cardFromReview(latest, raterId), saved)) return { kind: 'changed', review: latest };
  const path = `/admin/rounds/${roundId}/scores/${String(raterId)}`;
  return { kind: 'saved', review: await api<RoundReview>('PUT', path, { scores }) };
}

export interface RaterSaveForm {
  /** saveBlocked() for the card as it is now. */
  blocked: boolean;
  roundId: string;
  rater: { userId: number; name: string };
  /** The card the editor opened with, or the newer one it was refreshed to. */
  saved: Draft;
  /** The draft at the moment Save was pressed. */
  sent: Draft;
  scores: Readonly<Record<string, ScoreTriple>>;
  /** Item names by id, in the order the editor lists them, for naming clashing rows. */
  names: Readonly<Record<string, string>>;
}

export interface RaterSaveHandlers {
  saving: () => void;
  /** The draft now: sliders may have moved while the save was out. */
  live: () => Draft;
  /** The card is saved as it is on screen: close the editor. */
  saved: (review: RoundReview) => void;
  /** Keep the editor open on the newer review, with the draft rebased onto it, and show `message`. */
  refreshed: (review: RoundReview, draft: (current: Draft) => Draft, message: string) => void;
  failed: (message: string) => void;
}

/**
 * One press of Save card. While Save is blocked nothing happens. Otherwise the checked save runs (saveRaterCard), and
 * the draft is rebased, never replaced, so the rater's newer save and slider moves made meanwhile both survive. The
 * comparison is by content, so a re-save of the same values isn't a conflict.
 */
export async function pressRaterSave(form: RaterSaveForm, page: RaterSaveHandlers): Promise<void> {
  if (form.blocked) return;
  page.saving();
  let outcome: RaterSaveOutcome;
  try {
    outcome = await saveRaterCard(form.roundId, form.rater.userId, form.saved, form.scores);
  } catch (reason) {
    page.failed(errorMessage(reason));
    return;
  }
  const card = cardFromReview(outcome.review, form.rater.userId);
  if (outcome.kind === 'changed') {
    const clashes = clashingRows(form.saved, form.sent, card);
    const ordered = [...new Set([...Object.keys(form.names), ...clashes])].filter((id) => clashes.includes(id));
    const described = ordered.map((id) => {
      const newer = card[id];
      return `${form.names[id] ?? id} (newer card: ${newer && !isBlank(newer) ? newer.join(' · ') : 'cleared'})`;
    });
    const message = raterCardChanged(form.rater.name, described);
    page.refreshed(outcome.review, (current) => rebase(form.saved, current, card), message);
  } else if (sameDraft(page.live(), form.sent)) {
    page.saved(outcome.review);
  } else {
    page.refreshed(outcome.review, (current) => rebase(form.sent, current, card), CHANGED_WHILE_SAVING);
  }
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
