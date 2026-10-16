import type { MyScores } from '../../../src/domain/api-types.ts';
import type { Round } from '../../../src/domain/types.ts';
import { CONSTRAINT_CONFLICT, db, hasSqlNumber, transaction } from '../lib/db.ts';
import { HttpError } from '../lib/errors.ts';
import { route } from '../lib/http.ts';
import { cardWriteProblem } from '../lib/permissions.ts';
import { validateScores } from '../lib/validate.ts';
import { listArtifacts, listWorkloads } from '../repo/catalog.ts';
import { findOpenRound, lockRound } from '../repo/rounds.ts';
import { lastPublishedCard, replaceScorecard, scoresFor, toTriples } from '../repo/scores.ts';

async function requireOpenRound(): Promise<Round> {
  const round = await findOpenRound(db);
  if (!round) throw new HttpError(409, 'No round is open for scoring right now.');
  return round;
}

async function myScores(round: Round, userId: number): Promise<MyScores> {
  const rows = await scoresFor(db, round.id, userId);
  const newest = rows.reduce<Date | undefined>(
    (latest, row) => (!latest || row.updatedAt > latest ? row.updatedAt : latest),
    undefined,
  );
  return {
    round,
    scores: toTriples(rows),
    updatedAt: newest?.toISOString() ?? null,
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
  const round = await requireOpenRound();
  if (ctx.body.round !== round.id) {
    throw new HttpError(409, `The open round is now ${round.label}. Reload the page to score it.`);
  }
  const problem = cardWriteProblem(ctx.user, round, ctx.user.id);
  if (problem) throw new HttpError(403, problem);
  const known = new Set((await listArtifacts(db)).map((artifact) => artifact.id));
  const { scores, errors } = validateScores(ctx.body.scores, known);
  if (errors.length > 0) throw new HttpError(400, errors.join(' '));
  try {
    await transaction(async (tx) => {
      const locked = await lockRound(tx, round.id);
      if (locked?.status !== 'open') throw new HttpError(409, `${round.label} was just published. Reload the page.`);
      await replaceScorecard(tx, round.id, ctx.user.id, scores);
    });
  } catch (error) {
    if (hasSqlNumber(error, CONSTRAINT_CONFLICT)) {
      throw new HttpError(409, 'An item on this card was just deleted. Reload the page to get the current list.');
    }
    throw error;
  }
  return myScores(round, ctx.user.id);
});
