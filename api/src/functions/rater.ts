import type { MyScores } from '../../../src/domain/api-types.ts';
import type { Round } from '../../../src/domain/types.ts';
import type { ScoreRow } from '../domain/dataset.ts';
import { db, transaction } from '../lib/db.ts';
import { HttpError } from '../lib/errors.ts';
import { route } from '../lib/http.ts';
import { CARD_ITEM_DELETED, saveForItems } from '../lib/item-saves.ts';
import { cardWriteProblem } from '../lib/permissions.ts';
import { validateScores } from '../lib/validate.ts';
import { listArtifacts, listWorkloads } from '../repo/catalog.ts';
import { findOpenRound, lockRound } from '../repo/rounds.ts';
import { lastPublishedCard, replaceScorecard, scoresFor, toTuples } from '../repo/scores.ts';
import { isSubmitted, submitCard, withdrawCard } from '../repo/submissions.ts';

const SUBMITTED = 'You submitted this card. Withdraw your submission to make changes.';
const released = (round: Round) => `${round.label} was just released. Reload the page.`;

async function requireOpenRound(): Promise<Round> {
  const round = await findOpenRound(db);
  if (!round) throw new HttpError(409, 'No round is open for scoring right now.');
  return round;
}

/** The open round, refusing a request made for another one: the page is out of date. */
async function openRoundFor(roundId: unknown): Promise<Round> {
  const round = await requireOpenRound();
  if (roundId !== round.id) {
    throw new HttpError(409, `The open round is now ${round.label}. Reload the page to score it.`);
  }
  return round;
}

/** The newest save of any score on the card. */
function newestSave(rows: readonly ScoreRow[]): Date | undefined {
  return rows.reduce<Date | undefined>(
    (latest, row) => (!latest || row.updatedAt > latest ? row.updatedAt : latest),
    undefined,
  );
}

async function myScores(round: Round, userId: number): Promise<MyScores> {
  const rows = await scoresFor(db, round.id, userId);
  return {
    round,
    scores: toTuples(rows),
    updatedAt: newestSave(rows)?.toISOString() ?? null,
    submittedAt: rows[0]?.submittedAt?.toISOString() ?? null,
    previous: (await lastPublishedCard(db, userId)) ?? null,
  };
}

route('catalog', 'GET', 'catalog', 'user', async () => {
  const [workloads, artifacts] = await Promise.all([listWorkloads(db), listArtifacts(db)]);
  return { workloads, artifacts };
});

route('openRound', 'GET', 'rounds/open', 'user', async () => ({ round: (await findOpenRound(db)) ?? null }));

route('myScoresGet', 'GET', 'rounds/open/my-scores', 'user', async (ctx) =>
  myScores(await requireOpenRound(), ctx.user.id),
);

route('myScoresPut', 'PUT', 'rounds/open/my-scores', 'user', async (ctx) => {
  const round = await openRoundFor(ctx.body.round);
  const problem = cardWriteProblem(ctx.user, round, ctx.user.id);
  if (problem) throw new HttpError(403, problem);
  const known = new Map((await listArtifacts(db)).map((artifact) => [artifact.id, artifact]));
  const { scores, errors } = validateScores(ctx.body.scores, known);
  if (errors.length > 0) throw new HttpError(400, errors.join(' '));
  await saveForItems(ctx.log, CARD_ITEM_DELETED, async (tx) => {
    const locked = await lockRound(tx, round.id);
    if (locked?.status !== 'open') throw new HttpError(409, released(round));
    if (await isSubmitted(tx, round.id, ctx.user.id)) throw new HttpError(409, SUBMITTED);
    await replaceScorecard(tx, round.id, ctx.user.id, scores);
  });
  return myScores(round, ctx.user.id);
});

route('myScoresSubmit', 'POST', 'rounds/open/my-scores/submit', 'user', async (ctx) => {
  const round = await openRoundFor(ctx.body.round);
  const seen = ctx.body.updatedAt;
  if (typeof seen !== 'string') {
    throw new HttpError(400, 'Send updatedAt: the save time of the card you are submitting.');
  }
  await transaction(async (tx) => {
    const locked = await lockRound(tx, round.id);
    if (locked?.status !== 'open') throw new HttpError(409, released(round));
    const rows = await scoresFor(tx, round.id, ctx.user.id);
    if (rows.length === 0) throw new HttpError(400, 'Save your scores before submitting.');
    if (rows.some((row) => row.submittedAt !== null)) throw new HttpError(409, 'Your card is already submitted.');
    // The card the rater looked at, not one saved since in another tab.
    if (newestSave(rows)?.toISOString() !== seen) {
      throw new HttpError(409, 'Your card changed since this page loaded. Reload the page to see it.');
    }
    await submitCard(tx, round.id, ctx.user.id);
  });
  return myScores(round, ctx.user.id);
});

route('myScoresWithdraw', 'POST', 'rounds/open/my-scores/withdraw', 'user', async (ctx) => {
  const round = await openRoundFor(ctx.body.round);
  await transaction(async (tx) => {
    const locked = await lockRound(tx, round.id);
    if (locked?.status !== 'open') throw new HttpError(409, released(round));
    await withdrawCard(tx, round.id, ctx.user.id);
  });
  return myScores(round, ctx.user.id);
});
