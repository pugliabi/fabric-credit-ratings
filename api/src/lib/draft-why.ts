import Anthropic from '@anthropic-ai/sdk';
import { FACTORS } from '../../../src/data/factors.ts';
import type { Artifact, FactorValues, Workload } from '../../../src/domain/types.ts';

const DEFAULT_MODEL = 'claude-sonnet-5-5';
/** The admin's request waits on this call, and Azure cuts HTTP functions off at about 230 seconds. */
const REQUEST_TIMEOUT_MS = 40_000;
const STATUS_LABEL = { ga: 'general availability', preview: 'preview', retired: 'retired' } as const;

const EXAMPLES = [
  'The most complete authoring surface in Fabric: Spark, pure Python, T-SQL cells, Copilot, and Git integration. Session start-up and idle compute still cost more capacity than they should.',
  'Incremental copy and CDC turned a convenience item into a real ingestion tool. A guided setup with no pipeline to maintain makes it the default answer for bulk and incremental loads.',
  'Superseded by Dataflow Gen2. No CI/CD, no Fabric destinations, and a higher cost per row than any alternative.',
];

export interface AnthropicSettings {
  apiKey: string;
  workspaceId: string;
  model: string;
}

export interface DraftInput {
  artifact: Artifact;
  workload?: Workload;
  roundLabel: string;
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
  return FACTORS.map((factor) => `${factor.label.toLowerCase()} ${scores[factor.id]}`).join(', ');
}

export function promptFor(input: DraftInput): string {
  const { artifact, workload, roundLabel, scores, raters, previous } = input;
  const factors = FACTORS.map(
    (factor) =>
      `- ${factor.label} (${scores[factor.id]} of 7). 1 means "${factor.low}". 7 means "${factor.high}".`,
  ).join('\n');
  const prior = previous
    ? `Previous review (${previous.roundLabel}): ${scoreLine(previous.scores)}.${previous.note ? ` Its write-up: "${previous.note}"` : ''}`
    : 'This is the first review of this item.';

  return `Write the "why this rating" paragraph for a Microsoft Fabric item on a bond-style ratings site.

Item: ${artifact.name}
Workload: ${workload ? `${workload.name}${workload.blurb ? ` (${workload.blurb})` : ''}` : artifact.workload}
Release status: ${STATUS_LABEL[artifact.status]}
Review: ${roundLabel}, ${raters === 1 ? 'one rater' : `average of ${raters} raters`}
${prior}

Scores, for your judgment only:
${factors}

Voice, from earlier writeups. Match the length and tone. Do not copy them:
${EXAMPLES.map((example) => `- ${example}`).join('\n')}

Rules:
- 2 to 4 sentences, plain prose, no heading and no list.
- Say what the item is good at and what holds it back.
- If there is a previous review, describe the direction of change in words.
- If the item is retired, say so plainly and point readers to the replacement if there is an obvious one.
- Never mention scores, totals, letter grades, rater counts, or arithmetic. The reader must not be able to reconstruct the rating from the paragraph.`;
}

/** Turns the errors people actually hit into instructions, keeping the provider's error as the cause for the log. */
function explain(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const friendly = (text: string) => new Error(text, { cause: error });
  if (message.includes('anthropic-workspace-id')) {
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
    return friendly("Anthropic's rate limit for this key was reached. Wait a minute, then try again.");
  }
  if (error instanceof Anthropic.APIError && (error.status === 529 || error.type === 'overloaded_error')) {
    return friendly('Anthropic is overloaded right now. Try again in a minute.');
  }
  if (timedOut(error)) return friendly('Anthropic did not answer in time. Try again.');
  return friendly(message);
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
  details.error = chain.length > 0 ? chain.join(' <- ') : String(cause);
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
  if (!settings.apiKey) return undefined;
  // Each attempt gives up after 40 s. The SDK's waits between retries follow Retry-After with no cap, so only the
  // caller's signal bounds the whole draft.
  const client = new Anthropic({
    apiKey: settings.apiKey,
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
      if (signal?.aborted) throw explain(signal.reason);
      const message = await client.messages
        .create(
          {
            model,
            max_tokens: 400,
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
          throw explain(error);
        });
      const text = textOf(message);
      if (text && !mentionsMath(text)) return text;
      rejected = text;
    }
    throw new Error('The model kept mentioning scores or grades. Write this one by hand.');
  };
}

export type Drafter = NonNullable<ReturnType<typeof createDrafter>>;
