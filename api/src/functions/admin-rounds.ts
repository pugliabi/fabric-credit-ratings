import type { PublishResult, RoundReview } from '../../../src/domain/api-types.ts';
import { pointFor, previousPoint } from '../../../src/domain/aggregate.ts';
import type { Round } from '../../../src/domain/types.ts';
import { buildReview } from '../domain/review.ts';
import type { Config } from '../lib/config.ts';
import { DatabaseUnavailableError, db, transaction } from '../lib/db.ts';
import { createDrafter, failureDetails, redactKey } from '../lib/draft-why.ts';
import { HttpError } from '../lib/errors.ts';
import { startDeploy } from '../lib/github.ts';
import { route } from '../lib/http.ts';
import { CARD_ITEM_DELETED, saveForItems } from '../lib/item-saves.ts';
import { cardWriteProblem } from '../lib/permissions.ts';
import { ROUND_ID, USER_ID, isIsoDate, oneOf, text, today, validateScores } from '../lib/validate.ts';
import { listArtifacts } from '../repo/catalog.ts';
import { loadDataset } from '../repo/dataset.ts';
import { saveNote } from '../repo/notes.ts';
import {
  countScorecards,
  createRound,
  findLatestPublishedRound,
  findOpenRound,
  findRound,
  listRoundsWithCounts,
  lockRound,
  publishRound,
  reopenRound,
} from '../repo/rounds.ts';
import { replaceScorecard } from '../repo/scores.ts';
import { markChanged } from '../repo/site.ts';
import { findUserById } from '../repo/users.ts';

// Every transaction locks the round row (lockRound) before site_state (markChanged), so writers can't deadlock, and
// decides on the locked row's status rather than an earlier read.

const NOTE_MAX = 2000;
/** Azure cuts HTTP functions off at about 230 seconds; this leaves time to answer. */
const DRAFT_DEADLINE_MS = 200_000;
/** Less than this left after the dataset load is too little for one real Anthropic call. */
const DRAFT_MIN_CALL_MS = 10_000;

const noSuchRound = (id: string) => new HttpError(404, `Round ${id} does not exist.`);

async function requireRound(id: string | undefined): Promise<Round> {
  const round = id && ROUND_ID.test(id) ? await findRound(db, id) : undefined;
  if (!round) throw noSuchRound(id ?? '');
  return round;
}

async function reviewFor(roundId: string, config: Config): Promise<RoundReview> {
  const review = buildReview(await loadDataset(db), roundId, today(), Boolean(config.anthropic.apiKey));
  if (!review) throw noSuchRound(roundId);
  return review;
}

async function knownArtifactIds(): Promise<Set<string>> {
  return new Set((await listArtifacts(db)).map((artifact) => artifact.id));
}
route('adminRounds', 'GET', 'admin/rounds', 'admin', async () => listRoundsWithCounts(db));

route('adminRoundCreate', 'POST', 'admin/rounds', 'admin', async (ctx) => {
  const id = text(ctx.body, 'id', 'Round id', 8);
  if (!ROUND_ID.test(id)) throw new HttpError(400, 'Round ids look like 2027-Q1.');
  const label = text(ctx.body, 'label', 'Label', 40);
  const open = await findOpenRound(db);
  if (open) throw new HttpError(409, `Publish ${open.label} before starting a new round.`);
  if (await findRound(db, id)) throw new HttpError(409, `Round ${id} already exists.`);
  await createRound(db, id, label);
  return listRoundsWithCounts(db);
});

route('adminRoundUpdate', 'PUT', 'admin/rounds/{id}', 'admin', async (ctx): Promise<PublishResult> => {
  const round = await requireRound(ctx.params.id);
  const status = oneOf(ctx.body, 'status', 'Status', ['open', 'published'] as const);
  if (status === 'published') {
    const publishedOn = text(ctx.body, 'publishedOn', 'Publish date', 10);
    if (!isIsoDate(publishedOn)) throw new HttpError(400, 'Publish dates look like 2026-10-15.');
    await transaction(async (tx) => {
      const current = await lockRound(tx, round.id);
      if (!current) throw noSuchRound(round.id);
      if (current.status === 'published') throw new HttpError(409, `${current.label} is already published.`);
      if ((await countScorecards(tx, current.id)) === 0) {
        throw new HttpError(400, `Nobody has scored ${current.label} yet.`);
      }
      // Unlocked is enough: only an open round can be published, only one round can be open, and this one holds it.
      const latest = await findLatestPublishedRound(tx);
      if (latest?.publishedOn && publishedOn < latest.publishedOn) {
        throw new HttpError(400, `Publish dates can't be earlier than ${latest.label}'s (${latest.publishedOn}).`);
      }
      await publishRound(tx, current.id, publishedOn);
      await markChanged(tx);
    });
    const deploy = await startDeploy(ctx.config);
    if (!deploy.started) ctx.log.warn('The site deploy did not start:', deploy.message);
    return { rounds: await listRoundsWithCounts(db), deploy };
  }
  await transaction(async (tx) => {
    const current = await lockRound(tx, round.id);
    if (!current) throw noSuchRound(round.id);
    if (current.status === 'open') throw new HttpError(409, `${current.label} is already open.`);
    const open = await findOpenRound(tx);
    if (open) throw new HttpError(409, `Publish ${open.label} before reopening another round.`);
    // Unlocked is enough: a round only becomes published from open, and findOpenRound refused while any was open.
    const latest = await findLatestPublishedRound(tx);
    if (latest && latest.id !== current.id) {
      throw new HttpError(409, `Only the most recent published round (${latest.label}) can be reopened.`);
    }
    await reopenRound(tx, current.id);
    await markChanged(tx);
  });
  return { rounds: await listRoundsWithCounts(db), deploy: null };
});

route('adminReview', 'GET', 'admin/rounds/{id}/review', 'admin', async (ctx) =>
  reviewFor((await requireRound(ctx.params.id)).id, ctx.config),
);

route('adminScoresPut', 'PUT', 'admin/rounds/{id}/scores/{userId}', 'admin', async (ctx) => {
  const round = await requireRound(ctx.params.id);
  const userId = ctx.params.userId ?? '';
  const owner = USER_ID.test(userId) ? await findUserById(db, Number(userId)) : undefined;
  if (!owner) throw new HttpError(404, 'That user does not exist.');
  const { scores, errors } = validateScores(ctx.body.scores, await knownArtifactIds());
  if (errors.length > 0) throw new HttpError(400, errors.join(' '));
  await saveForItems(ctx.log, CARD_ITEM_DELETED, async (tx) => {
    const current = await lockRound(tx, round.id);
    if (!current) throw noSuchRound(round.id);
    const problem = cardWriteProblem(ctx.user, current, owner.id);
    if (problem) throw new HttpError(403, problem);
    await replaceScorecard(tx, round.id, owner.id, scores);
    if (current.status === 'published') await markChanged(tx);
  });
  return reviewFor(round.id, ctx.config);
});

route('adminNotePut', 'PUT', 'admin/rounds/{id}/notes/{artifactId}', 'admin', async (ctx) => {
  const round = await requireRound(ctx.params.id);
  const artifactId = ctx.params.artifactId ?? '';
  if (!(await knownArtifactIds()).has(artifactId)) throw new HttpError(404, 'That item does not exist.');
  if (typeof ctx.body.body !== 'string') throw new HttpError(400, 'Send the write-up as text.');
  const body = ctx.body.body.trim();
  if (body.length > NOTE_MAX) throw new HttpError(400, 'Keep the write-up to 2,000 characters or fewer.');
  await saveForItems(ctx.log, 'That item was just deleted. Reload the page to get the current list.', async (tx) => {
    const current = await lockRound(tx, round.id);
    if (!current) throw noSuchRound(round.id);
    await saveNote(tx, round.id, artifactId, body, ctx.user.id);
    if (current.status === 'published') await markChanged(tx);
  });
  return undefined;
});

route('adminDraft', 'POST', 'admin/rounds/{id}/draft/{artifactId}', 'admin', async (ctx) => {
  // Started first, so a slow dataset load (a paused database can take 150 s) counts against it too.
  const started = Date.now();
  const deadline = AbortSignal.timeout(DRAFT_DEADLINE_MS);
  const drafter = createDrafter(ctx.config.anthropic);
  if (!drafter) throw new HttpError(400, 'Set ANTHROPIC_API_KEY in the Function App settings to draft with AI.');
  const data = await loadDataset(db);
  const loadMs = Date.now() - started;
  // The load can't be interrupted, so it may have used up the deadline or left too little of it for a call. That's the
  // database's time, not Anthropic's.
  if (deadline.aborted || DRAFT_DEADLINE_MS - loadMs < DRAFT_MIN_CALL_MS) {
    throw new DatabaseUnavailableError(`Loading the dataset for an AI draft took ${loadMs} ms.`);
  }
  const target = data.rounds.find((item) => item.round.id === ctx.params.id);
  if (!target) throw noSuchRound(ctx.params.id ?? '');
  const artifact = data.artifacts.find((item) => item.id === ctx.params.artifactId);
  if (!artifact) throw new HttpError(404, 'That item does not exist.');
  const point = pointFor(artifact, target, target.round.publishedOn ?? today());
  if (!point) throw new HttpError(400, `${artifact.name} has no scores in ${target.round.label} yet.`);
  const previous = previousPoint(artifact, data.rounds, target.round.id);
  try {
    const draft = await drafter(
      {
        artifact,
        workload: data.workloads.find((workload) => workload.id === artifact.workload),
        roundLabel: target.round.label,
        scores: point.scores,
        raters: point.raters,
        ...(previous
          ? { previous: { roundLabel: previous.roundLabel, scores: previous.scores, note: previous.note } }
          : {}),
      },
      deadline,
    );
    return { text: draft };
  } catch (error) {
    const timing = { loadMs, elapsedMs: Date.now() - started };
    ctx.log.warn('AI draft failed', { ...failureDetails(error, ctx.config.anthropic), ...timing });
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(502, redactKey(message, ctx.config.anthropic.apiKey));
  }
});
