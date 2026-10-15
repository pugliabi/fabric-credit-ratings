import { appendFileSync, writeFileSync } from 'node:fs';
import { parseIssue } from '../src/domain/payload.ts';
import { ROUND_ID, createStore, validateScores } from './rounds-fs.ts';

/**
 * Run by .github/workflows/intake.yml for each new "Scores:" issue. Writes the
 * rater's scorecard, then leaves the reply in intake-result.md and the outcome
 * in $GITHUB_OUTPUT for the commit and comment steps.
 */
const RESULT_FILE = process.env['INTAKE_RESULT_FILE'] || 'intake-result.md';

function finish(ok: boolean, message: string, outputs: Record<string, string> = {}): never {
  writeFileSync(RESULT_FILE, `${message}\n`);
  const output = process.env['GITHUB_OUTPUT'];
  if (output) {
    const lines = Object.entries({ ok: String(ok), ...outputs }).map(([key, value]) => `${key}=${value}`);
    appendFileSync(output, `${lines.join('\n')}\n`);
  }
  console.log(message);
  process.exit(0);
}

const body = process.env['ISSUE_BODY'] ?? '';
const author = (process.env['ISSUE_AUTHOR'] ?? '').trim();
const store = createStore(process.cwd());

const parsed = parseIssue(body);
if (!parsed) {
  finish(false, 'This issue does not contain a scorecard. Use the form at https://fabriccreditratings.com/rate to submit scores.');
}

const rater = store.readRaters().find((name) => name.toLowerCase() === author.toLowerCase());
if (!author || !rater) {
  finish(
    false,
    `@${author} is not on the rater list yet, so these scores were not recorded. Ask the maintainer to add you to \`src/data/raters.json\`, then submit again.`,
  );
}

if (!ROUND_ID.test(parsed.round)) finish(false, 'The "Round:" line is missing or not a round id like 2026-Q4.');
const data = store.readRound(parsed.round);
if (!data) finish(false, `There is no review round called \`${parsed.round}\`.`);
if (data.round.status !== 'open') {
  finish(false, `${data.round.label} is closed, so these scores were not recorded.`);
}

const { scores, errors } = validateScores(parsed.scores);
const problems = [...parsed.errors, ...errors];
if (problems.length > 0) {
  finish(false, ['Nothing was recorded. Fix these and submit again:', '', ...problems.map((p) => `- ${p}`)].join('\n'));
}

const count = Object.keys(scores).length;
if (count === 0) finish(false, 'The scorecard is empty, so nothing was recorded.');

const file = store.writeScorecard(data.round.id, { rater, submittedAt: new Date().toISOString(), scores });
finish(
  true,
  `Recorded ${count} ${count === 1 ? 'item' : 'items'} for ${data.round.label} from @${author}. They count once the round is published. Submit again any time before then to replace them.`,
  { round: data.round.id, file },
);
