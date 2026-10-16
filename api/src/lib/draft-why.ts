import Anthropic from '@anthropic-ai/sdk';
import { FACTORS } from '../../../src/data/factors.ts';
import type { Artifact, FactorValues, Workload } from '../../../src/domain/types.ts';

const DEFAULT_MODEL = 'claude-sonnet-5-5';
/** The admin's request waits on this call, and Azure cuts HTTP functions off at about 230 seconds. */
const REQUEST_TIMEOUT_MS = 40_000;
const STATUS_LABEL = { ga: 'general availability', preview: 'preview', retired: 'retired' } as const;

// The prose lines below run past 120 characters on purpose: the prompt is sent as written, with no wrapping.
export const SYSTEM_PROMPT = `You write the "Why this rating" note on Microsoft Fabric Credit Ratings, a site that grades each Microsoft Fabric item the way a credit agency grades a bond. Readers are data engineers, analysts, and architects deciding what to build on.

Write 2 or 3 short sentences, at most 350 characters in total, as plain prose with no heading, list, or quotation marks. Say what the item is good at and what holds it back. Use the item description for facts and the scores only to judge what to emphasise. If there is a previous review, say in words whether things improved or slipped. If the item is retired, say so and name the replacement when there is an obvious one. Do not mention factors that do not apply to the item.

Never mention scores, numbers out of seven, totals, letter grades, rater counts, weights, or arithmetic: the reader must not be able to reconstruct the rating. Do not invent features, dates, or prices that are not in the description and are not widely known about the item. Match the length and tone of the examples without copying them.`;

/** Notes from the original site, as the voice to match. */
export const EXAMPLES = [
  'The most complete authoring surface in Fabric: Spark, pure Python, T-SQL cells, Copilot, and Git integration. Session start-up and idle compute still cost more capacity than they should.',
  'Incremental copy and CDC turned a convenience item into a real ingestion tool. A guided setup with no pipeline to maintain makes it the default answer for bulk and incremental loads.',
  'The orchestration workhorse, with the widest set of activities and connectors. The authoring canvas is dated, and debugging nested pipelines still takes too many clicks.',
  'Excellent for logs and time series with very fast KQL. The experience is improving but still assumes you already know Kusto.',
  'Superseded by Dataflow Gen2. No CI/CD, no Fabric destinations, and a higher cost per row than any alternative.',
];

const MAX_DRAFT_CHARS = 350;

/**
 * At most three sentences, dropping trailing ones while over 350 characters; never fewer than one. A full stop after
 * "e.g.", "i.e.", "vs.", or "etc." doesn't end a sentence.
 */
export function shortenDraft(text: string): string {
  const sentences = text
    .trim()
    .split(/(?<!\b(?:e\.g|i\.e|vs|etc)\.)(?<=[.!?])\s+/)
    .filter(Boolean)
    .slice(0, 3);
  while (sentences.length > 1 && sentences.join(' ').length > MAX_DRAFT_CHARS) sentences.pop();
  return sentences.join(' ');
}

export interface AnthropicSettings {
  apiKey: string;
  workspaceId: string;
  model: string;
}

export interface DraftInput {
  artifact: Artifact;
  workload?: Workload;
  roundLabel: string;
  /** The item's admin-only description: facts for the draft, never shown on the public site. */
  description?: string;
  scores: FactorValues;
  raters: number;
  previous?: { roundLabel: string; scores: FactorValues; note: string };
}

// The bare one-letter grades (A, B, C, E) are ordinary words, so only their signed forms count. A sign followed by a
// letter is a hyphenated word ("B-tree"), but "AA-rated" still names AA.
const GRADE = /(?<![A-Za-z0-9+-])(?:AAA|AA[+-]?|A[+-]|BBB[+-]?|BB[+-]?|B[+-]|CCC|CC)(?![A-Za-z0-9+])/;
const OUT_OF =
  /\bout of (?:7|seven|21)\b|\b\d{1,2}\s*of\s*(?:7|21)\b|\b(?:[1-9]|1\d|2[01])(?:[.,]\d+)?\s*\/\s*(?:7|21)\b/i;

/** True when a draft leaks a grade, a total, or arithmetic. */
export function mentionsMath(text: string): boolean {
  return GRADE.test(text) || OUT_OF.test(text) || /\d\s*\+\s*\d/.test(text);
}

function scoreLine(scores: FactorValues): string {
  return FACTORS.map((factor) => `${factor.label.toLowerCase()} ${scores[factor.id] ?? 'n/a'}`).join(', ');
}

export function promptFor(input: DraftInput): string {
  const { artifact, workload, roundLabel, description, scores, raters, previous } = input;
  const factors = [
    ...FACTORS.filter((factor) => !artifact.naFactors.includes(factor.id)).map(
      (factor) =>
        `- ${factor.label} (${scores[factor.id] ?? 'n/a'} of 7). 1 means "${factor.low}". 7 means "${factor.high}".`,
    ),
    ...FACTORS.filter((factor) => artifact.naFactors.includes(factor.id)).map(
      (factor) => `${factor.label} does not apply to this item.`,
    ),
  ].join('\n');
  const prior = previous
    ? `Previous review (${previous.roundLabel}): ${scoreLine(previous.scores)}.${previous.note ? ` Its write-up: "${previous.note}"` : ''}`
    : 'This is the first review of this item.';

  return `Write the "why this rating" note for a Microsoft Fabric item on a bond-style ratings site.

Item: ${artifact.name}
Workload: ${workload ? `${workload.name}${workload.blurb ? ` (${workload.blurb})` : ''}` : artifact.workload}
What it is: ${description || '(no description yet; rely on the name and workload)'}
Release status: ${STATUS_LABEL[artifact.status]}
Review: ${roundLabel}, ${raters === 1 ? 'one rater' : `average of ${raters} raters`}
${prior}

Scores, for your judgment only:
${factors}

Voice examples from earlier notes:
${EXAMPLES.map((example) => `- ${example}`).join('\n')}`;
}

/** No real Anthropic key is shorter; real ones are about 100 characters. */
const KEY_MIN_LENGTH = 16;
/**
 * Anthropic keys are sk-ant-… in this alphabet. Anything else is a bad paste, and no JSON or URL escaping can change a
 * key in this form, so redaction always finds it in error text.
 */
const ANTHROPIC_KEY = new RegExp(`^[A-Za-z0-9_-]{${KEY_MIN_LENGTH},}$`);
const KEY_NOT_SENDABLE =
  "ANTHROPIC_API_KEY doesn't look like an Anthropic key: it's too short, or it has spaces, quotes, line breaks, " +
  'or other characters a key never has. Paste the key again in the Function App settings.';

/** Why ANTHROPIC_API_KEY can't be used as set, or undefined when it can be, or isn't set. */
export function keyProblem(settings: AnthropicSettings): string | undefined {
  const apiKey = settings.apiKey.trim();
  return apiKey && !ANTHROPIC_KEY.test(apiKey) ? KEY_NOT_SENDABLE : undefined;
}

/** Replaces the key, as set and trimmed, wherever error text quotes it. */
export function redactKey(text: string, apiKey: string): string {
  let redacted = text;
  for (const secret of new Set([apiKey, apiKey.trim()])) {
    // Shorter than any key, so it's no secret, and replacing it would mangle ordinary words.
    if (secret.length >= KEY_MIN_LENGTH) redacted = redacted.split(secret).join('[redacted]');
  }
  return redacted;
}

/** Turns the errors people actually hit into instructions, keeping the provider's error as the cause for the log. */
function explain(error: unknown, apiKey: string): Error {
  const raw = error instanceof Error ? error.message : String(error);
  const friendly = (text: string) => new Error(text, { cause: error });
  if (raw.includes('anthropic-workspace-id')) {
    return friendly(
      'This Anthropic key is not scoped to a workspace. Set ANTHROPIC_WORKSPACE_ID in the Function App settings (Claude Console, Settings, Workspaces), or create the key inside a workspace.',
    );
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return friendly('Anthropic rejected ANTHROPIC_API_KEY. Check the key in the Function App settings.');
  }
  if (error instanceof Anthropic.NotFoundError) {
    return friendly("ANTHROPIC_MODEL names a model this key can't use. Check the setting in the Function App.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return friendly("Anthropic's rate limit was reached. Wait a minute, then try again.");
  }
  if (error instanceof Anthropic.APIError && (error.status === 529 || error.type === 'overloaded_error')) {
    return friendly('Anthropic is overloaded right now. Try again in a minute.');
  }
  if (timedOut(error)) return friendly('Anthropic did not answer in time. Try again.');
  return friendly(redactKey(raw, apiKey));
}

/** One attempt's own timeout, or the caller's deadline: the SDK reports that as a user abort. */
function timedOut(error: unknown): boolean {
  return (
    error instanceof Anthropic.APIConnectionTimeoutError ||
    error instanceof Anthropic.APIUserAbortError ||
    (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError'))
  );
}

const modelFor = (settings: AnthropicSettings) => settings.model || DEFAULT_MODEL;

/**
 * What to log for a failed draft: the model asked, and the provider's status, request id, and error type from the
 * error's cause, then that cause's own chain, such as the fetch error and socket code behind a connection error. The
 * key travels only in request headers and the prompt only in the request body, and none of these errors keeps either.
 */
export function failureDetails(error: unknown, settings: AnthropicSettings): Record<string, unknown> {
  const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
  const details: Record<string, unknown> = { model: modelFor(settings) };
  if (cause instanceof Anthropic.APIError && cause.status !== undefined) {
    Object.assign(details, { status: cause.status, requestId: cause.requestID ?? null, type: cause.type });
  }
  const chain: string[] = [];
  for (let link: unknown = cause, depth = 0; link instanceof Error && depth < 3; link = link.cause, depth += 1) {
    const code = (link as { code?: unknown }).code;
    chain.push(`${link.constructor.name}: ${link.message}${typeof code === 'string' ? ` (${code})` : ''}`);
  }
  details.error = redactKey(chain.length > 0 ? chain.join(' <- ') : String(cause), settings.apiKey);
  return details;
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

/** Returns undefined when no API key is configured. */
export function createDrafter(settings: AnthropicSettings) {
  const apiKey = settings.apiKey.trim();
  if (!apiKey) return undefined;
  const problem = keyProblem(settings);
  if (problem) {
    // Never handed to the SDK, whose header error would quote the whole key.
    return async function draft(_input: DraftInput, _signal?: AbortSignal): Promise<string> {
      throw new Error(problem);
    };
  }
  // Each attempt gives up after 40 s. The SDK's waits between retries follow Retry-After with no cap, so only the
  // caller's signal bounds the whole draft.
  const client = new Anthropic({
    apiKey,
    // Otherwise the SDK reads ANTHROPIC_AUTH_TOKEN from the environment and sends it too.
    authToken: null,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
    ...(settings.workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': settings.workspaceId } } : {}),
  });
  const model = modelFor(settings);

  /** One retry if the first draft leaks the math. Throws on API errors, and once `signal` aborts. */
  return async function draft(input: DraftInput, signal?: AbortSignal): Promise<string> {
    const prompt = promptFor(input);
    let rejected = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (signal?.aborted) throw explain(signal.reason, settings.apiKey);
      const message = await client.messages
        .create(
          {
            model,
            max_tokens: 200,
            system: SYSTEM_PROMPT,
            messages: [
              {
                role: 'user',
                content:
                  attempt === 0
                    ? prompt
                    : `${prompt}\n\nThe draft below mentions a score, a total, or a letter grade. Rewrite it without any of those.\n\n${rejected}`,
              },
            ],
          },
          { signal },
        )
        .catch((error: unknown) => {
          throw explain(error, settings.apiKey);
        });
      const text = textOf(message);
      if (text && !mentionsMath(text)) return shortenDraft(text);
      rejected = text;
    }
    throw new Error('The model kept mentioning scores or grades. Write this one by hand.');
  };
}

export type Drafter = NonNullable<ReturnType<typeof createDrafter>>;
