import Anthropic from '@anthropic-ai/sdk';
import { FACTORS } from '../../../src/data/factors.ts';
import type { Artifact, FactorValues, Workload } from '../../../src/domain/types.ts';

const DEFAULT_MODEL = 'claude-sonnet-5-5';
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

/** True when a draft leaks a grade, a total, or arithmetic. */
export function mentionsMath(text: string): boolean {
  return (
    /\b(AAA|AA\+|AA-|AA|A\+|A-|BBB\+|BBB-|BBB|BB\+|BB-|BB|B\+|B-|CCC|CC)\b/.test(text) ||
    /\/\s*21|out of 21|\/\s*7\b|out of 7/.test(text) ||
    /\d\s*\+\s*\d/.test(text)
  );
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
Workload: ${workload?.name ?? artifact.workload} (${workload?.blurb ?? ''})
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

/** Turns the two setup errors people actually hit into instructions. */
function explain(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('anthropic-workspace-id')) {
    return new Error(
      'This Anthropic key is not scoped to a workspace. Set ANTHROPIC_WORKSPACE_ID in the Function App settings (Claude Console, Settings, Workspaces), or create the key inside a workspace.',
    );
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new Error('Anthropic rejected ANTHROPIC_API_KEY. Check the key in the Function App settings.');
  }
  return error instanceof Error ? error : new Error(message);
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
  const client = new Anthropic({
    apiKey: settings.apiKey,
    ...(settings.workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': settings.workspaceId } } : {}),
  });
  const model = settings.model || DEFAULT_MODEL;

  /** One retry if the first draft leaks the math. Throws on API errors. */
  return async function draft(input: DraftInput): Promise<string> {
    const prompt = promptFor(input);
    let rejected = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const message = await client.messages
        .create({
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
        })
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
