import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { ARTIFACTS } from '../src/data/artifacts.ts';
import { pointFor, previousPoint } from '../src/domain/aggregate.ts';
import type { RoundNotes } from '../src/domain/types.ts';
import { createDrafter, type DrafterEnv } from './draft-why.ts';
import { RATER_ID, ROUND_ID, createStore, today, validateScores } from './rounds-fs.ts';

export interface DeskEnv extends DrafterEnv {
  RATER?: string;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY = 1_000_000;

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request too large.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, 'Body must be a JSON object.');
}

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value.trim() : '';
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Local-only API behind `npm run desk`. Reads and writes src/data/rounds, and
 * calls Anthropic with keys that never reach the browser.
 */
export function deskApi(root: string, env: DeskEnv): Plugin {
  const store = createStore(root);
  const drafter = createDrafter(env);
  const rater = () => env.RATER?.trim() || store.readRaters()[0] || '';

  function openRoundOrThrow(roundId: string) {
    const data = store.readRound(roundId);
    if (!data) throw new HttpError(404, `Round ${roundId} does not exist.`);
    if (data.round.status !== 'open') throw new HttpError(409, `${data.round.label} is published. Reopen it to change scores.`);
    return data;
  }

  async function route(method: string, path: string, req: IncomingMessage): Promise<unknown> {
    if (method === 'GET' && path === '/state') {
      return {
        rater: rater(),
        raters: store.readRaters(),
        rounds: store.readRounds(),
        aiEnabled: drafter !== undefined,
        today: today(),
      };
    }

    const body = await readBody(req);

    if (method === 'PUT' && path === '/scores') {
      const who = rater();
      if (!RATER_ID.test(who)) throw new HttpError(400, 'Set RATER in .env to your GitHub username.');
      const roundId = str(body, 'round');
      openRoundOrThrow(roundId);
      const { scores, errors } = validateScores(body['scores']);
      if (errors.length > 0) throw new HttpError(400, errors.join(' '));
      store.writeScorecard(roundId, { rater: who, submittedAt: new Date().toISOString(), scores });
      return store.readRound(roundId);
    }

    if (method === 'PUT' && path === '/notes') {
      const roundId = str(body, 'round');
      if (!store.readRound(roundId)) throw new HttpError(404, `Round ${roundId} does not exist.`);
      const raw = body['notes'];
      if (typeof raw !== 'object' || raw === null) throw new HttpError(400, 'notes must be an object.');
      const notes: RoundNotes = {};
      for (const [id, text] of Object.entries(raw)) {
        if (typeof text === 'string' && ARTIFACTS.some((artifact) => artifact.id === id)) notes[id] = text;
      }
      store.writeNotes(roundId, notes);
      return store.readRound(roundId);
    }

    if (method === 'POST' && path === '/rounds') {
      const id = str(body, 'id');
      if (!ROUND_ID.test(id)) throw new HttpError(400, 'Round ids look like 2027-Q1.');
      const rounds = store.readRounds();
      if (rounds.some((data) => data.round.id === id)) throw new HttpError(409, `Round ${id} already exists.`);
      const open = rounds.find((data) => data.round.status === 'open');
      if (open) throw new HttpError(409, `Publish ${open.round.label} before starting a new round.`);
      store.writeRound({ id, label: str(body, 'label') || id, status: 'open', publishedOn: null });
      return store.readRounds();
    }

    const roundMatch = /^\/rounds\/([^/]+)$/.exec(path);
    if (method === 'PUT' && roundMatch?.[1]) {
      const id = decodeURIComponent(roundMatch[1]);
      const data = store.readRound(id);
      if (!data) throw new HttpError(404, `Round ${id} does not exist.`);
      const status = str(body, 'status');
      if (status === 'published') {
        const publishedOn = str(body, 'publishedOn') || today();
        if (!DATE.test(publishedOn)) throw new HttpError(400, 'publishedOn must be YYYY-MM-DD.');
        store.writeRound({ ...data.round, status: 'published', publishedOn });
      } else if (status === 'open') {
        const other = store.readRounds().find((r) => r.round.status === 'open' && r.round.id !== id);
        if (other) throw new HttpError(409, `${other.round.label} is already open.`);
        store.writeRound({ ...data.round, status: 'open', publishedOn: null });
      } else {
        throw new HttpError(400, 'status must be "open" or "published".');
      }
      return store.readRounds();
    }

    if (method === 'POST' && path === '/draft') {
      if (!drafter) throw new HttpError(400, 'Set ANTHROPIC_API_KEY in .env to draft with AI.');
      const artifact = ARTIFACTS.find((item) => item.id === str(body, 'artifactId'));
      if (!artifact) throw new HttpError(400, 'Unknown item.');
      const rounds = store.readRounds();
      const data = rounds.find((item) => item.round.id === str(body, 'round'));
      if (!data) throw new HttpError(404, 'Unknown round.');
      const point = pointFor(artifact, data, data.round.publishedOn ?? today());
      if (!point) throw new HttpError(400, `${artifact.name} has no scores in ${data.round.label} yet.`);
      const previous = previousPoint(artifact, rounds, data.round.id);
      try {
        const text = await drafter({
          artifact,
          roundLabel: data.round.label,
          scores: point.scores,
          raters: point.raters,
          ...(previous ? { previous: { roundLabel: previous.roundLabel, scores: previous.scores, note: previous.note } } : {}),
        });
        return { text };
      } catch (error) {
        throw new HttpError(502, error instanceof Error ? error.message : String(error));
      }
    }

    throw new HttpError(404, `No route for ${method} ${path}.`);
  }

  return {
    name: 'fcr-desk-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/desk', (req, res) => {
        const path = (req.url ?? '/').split('?')[0] ?? '/';
        route(req.method ?? 'GET', path, req).then(
          (body) => send(res, 200, body),
          (error: unknown) => {
            const status = error instanceof HttpError ? error.status : 500;
            send(res, status, { error: error instanceof Error ? error.message : String(error) });
          },
        );
      });
    },
  };
}
