import type { ScoreTriple } from './types.ts';

/** Issue bodies carrying scores start with this marker; the intake Action ignores anything else. */
export const PAYLOAD_MARKER = '<!-- fcr-scores v1 -->';
export const ISSUE_TITLE_PREFIX = 'Scores:';

/**
 * Plain-text issue body: one `artifactId capability ux cost` line per item
 * inside a fenced block, so a rater can read (and fix) it before submitting.
 */
export function encodeIssue(
  round: { id: string; label: string },
  scores: Readonly<Record<string, ScoreTriple>>,
): { title: string; body: string } {
  const lines = Object.entries(scores).map(([id, triple]) => `${id} ${triple.join(' ')}`);
  const body = [
    PAYLOAD_MARKER,
    `Round: ${round.id}`,
    '',
    '```text',
    ...lines,
    '```',
    '',
    `Scores for ${round.label}: feature capability, user experience, CU / token cost, each 1 to 7.`,
    'Submit this issue as is. Submitting again for the same round replaces your earlier scores.',
  ].join('\n');
  return { title: `${ISSUE_TITLE_PREFIX} ${round.id}`, body };
}

export interface ParsedIssue {
  round: string;
  /** Raw triples; run them through validation before trusting them. */
  scores: Record<string, number[]>;
  errors: string[];
}

/** Returns undefined when the body is not a scores submission at all. */
export function parseIssue(body: string): ParsedIssue | undefined {
  const text = body.replace(/\r\n?/g, '\n');
  if (!text.includes(PAYLOAD_MARKER)) return undefined;

  const round = /^Round:\s*(\S+)\s*$/m.exec(text)?.[1] ?? '';
  const block = /```(?:text)?\n([\s\S]*?)```/.exec(text)?.[1] ?? '';
  const scores: Record<string, number[]> = {};
  const errors: string[] = [];
  if (!round) errors.push('The "Round:" line is missing.');

  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^([a-z0-9-]+)\s+(\d+)\s+(\d+)\s+(\d+)$/.exec(line);
    if (!match) {
      errors.push(`Could not read the line "${line}".`);
      continue;
    }
    const [, id = '', c, u, k] = match;
    if (scores[id]) errors.push(`"${id}" appears more than once.`);
    scores[id] = [Number(c), Number(u), Number(k)];
  }
  return { round, scores, errors };
}
