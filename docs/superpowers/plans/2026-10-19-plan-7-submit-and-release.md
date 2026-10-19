# Plan 7: Raters Submit, the Admin Releases the Round — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raters save drafts and then submit their card; only submitted cards count anywhere; the admin's existing publish step is worded "Release" and counts submitted cards only.

**Architecture:** A `submissions` table (one row per submitted card) is LEFT JOINed onto every score read, so each `ScoreRow` carries `submittedAt`. `assembleDataset` puts submitted cards in `RoundData.scorecards` (which all aggregation already reads) and the rest in a new `RoundData.drafts`, so the snapshot, averages and AI drafts ignore drafts without touching aggregation code. Two rater routes submit and withdraw; saving a submitted card is refused; the admin review lists drafts beside submitted cards; the UI gains Submit/Withdraw and the admin wording becomes "release".

**Tech Stack:** TypeScript, React 19, Vite, Vitest (+ happy-dom per file), Azure Functions, mssql (Fabric SQL), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-19-submit-and-release-design.md`

## Global Constraints

- Only submitted cards count: the public snapshot, the admin review's averages/grades/change labels, the AI draft's prompt, the release check, round counts, and the rater's "previous card" (`lastPublishedCard`).
- Internal names stay: round status `'published'`, column `published_on`, field `publishedOn`, `PublishTab`, `PublishResult`, `publishRound`, and the admin tab's label "Publish". Only user-facing words change ("publish" → "release").
- Protected strings, byte for byte, never change: "The model kept mentioning scores or grades. Write this one by hand." and "Anthropic did not answer in time. Try again."
- No numeric total or weight appears anywhere in the UI.
- Exact user-facing strings are the ones written in each task; copy them verbatim.
- Tasks never touch a database, Azure, or GitHub: no `npm run db:apply`, no integration run, no push. The controller does the rollout (Task 7).
- Formatting: 2 spaces, single quotes, semicolons, trailing commas, lines ≤ 120 characters; keep each file's existing line endings (most files are CRLF on disk); no prettier.
- Before each commit: `npm run typecheck` and `npx vitest run` both green. A changed shared type means updating every literal of it in tests; typecheck lists them.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BX4UjQbFR47NJaV35hiCor
  ```

---

### Task 1: The submissions table and its repository functions

**Files:**
- Modify: `db/schema.sql` (new batch after the `ix_scores_artifact` batch)
- Create: `api/src/repo/submissions.ts`, `api/src/repo/submissions.test.ts`
- Modify: `api/src/repo/scores.ts`, `api/src/repo/scores.test.ts`
- Modify: `api/src/repo/rounds.ts`, `api/src/repo/rounds.test.ts`
- Modify: `api/src/domain/dataset.ts` (type only), `api/src/domain/fixtures.ts`, `src/domain/api-types.ts` (type only)
- Modify every test literal of `ScoreRow` and `AdminRound` that typecheck flags (for example `api/src/functions/rater.test.ts`, `api/src/functions/admin-rounds.test.ts`, `api/src/lib/http.test.ts`, `src/admin/*.test.ts`)

**Interfaces:**
- Produces: `ScoreRow.submittedAt: Date | null`; `AdminRound.submitted: number`; `submitCard(db, roundId, userId)`, `withdrawCard(db, roundId, userId)`, `isSubmitted(db, roundId, userId): Promise<boolean>` in `api/src/repo/submissions.ts`; `countSubmitted(db, id): Promise<number>` in `api/src/repo/rounds.ts`. `countScorecards` stays for now (Task 4 removes it). No behaviour changes yet: `assembleDataset` ignores `submittedAt` until Task 2.

- [ ] **Step 1: Write the failing repo tests**

`api/src/repo/submissions.test.ts` (copy the `answering` fake from `rounds.test.ts` into the file):

```ts
import { describe, expect, it } from 'vitest';
import { varchar, type Db, type Params } from '../lib/db.ts';
import { isSubmitted, submitCard, withdrawCard } from './submissions.ts';

function answering(rows: object[]): { calls: { text: string; params: Params }[]; fake: Db } {
  const calls: { text: string; params: Params }[] = [];
  const fake: Db = {
    query<T>(text: string, params: Params = {}): Promise<T[]> {
      calls.push({ text, params });
      return Promise.resolve(rows as T[]);
    },
  };
  return { calls, fake };
}

const params = { roundId: varchar('2026-Q4'), userId: 7 };

describe('submitCard', () => {
  it('inserts the submission only when the card has none, so a repeat keeps the first time', async () => {
    const { calls, fake } = answering([]);
    await submitCard(fake, '2026-Q4', 7);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toMatch(/INSERT INTO submissions \(round_id, user_id\)/);
    expect(calls[0]?.text).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM submissions WHERE round_id = @roundId AND/);
    expect(calls[0]?.params).toEqual(params);
  });
});

describe('withdrawCard', () => {
  it('deletes the submission', async () => {
    const { calls, fake } = answering([]);
    await withdrawCard(fake, '2026-Q4', 7);
    expect(calls[0]?.text).toBe('DELETE FROM submissions WHERE round_id = @roundId AND user_id = @userId');
    expect(calls[0]?.params).toEqual(params);
  });
});

describe('isSubmitted', () => {
  it('is true when a submission row exists', async () => {
    expect(await isSubmitted(answering([{ n: 1 }]).fake, '2026-Q4', 7)).toBe(true);
  });

  it('is false when none does', async () => {
    expect(await isSubmitted(answering([{ n: 0 }]).fake, '2026-Q4', 7)).toBe(false);
  });
});
```

In `api/src/repo/scores.test.ts` (reuse the fake the file already has, or add `answering` as above), add:

```ts
describe('submission state on score reads', () => {
  it('allScores and scoresFor join each card to its submission', async () => {
    const all = answering([]);
    await allScores(all.fake);
    expect(all.calls[0]?.text).toMatch(/sub\.submitted_at AS submittedAt/);
    expect(all.calls[0]?.text).toMatch(
      /LEFT JOIN submissions sub ON sub\.round_id = s\.round_id AND sub\.user_id = s\.user_id/,
    );
    const one = answering([]);
    await scoresFor(one.fake, '2026-Q4', 7);
    expect(one.calls[0]?.text).toMatch(/LEFT JOIN submissions sub/);
  });

  it('replaceScorecard with an empty card deletes the card and its submission', async () => {
    const { calls, fake } = answering([]);
    await replaceScorecard(fake, '2026-Q4', 7, {});
    expect(calls.map((call) => call.text)).toEqual([
      'DELETE FROM scores WHERE round_id = @roundId AND user_id = @userId',
      'DELETE FROM submissions WHERE round_id = @roundId AND user_id = @userId',
    ]);
  });

  it('replaceScorecard with scores leaves the submission alone', async () => {
    const { calls, fake } = answering([]);
    await replaceScorecard(fake, '2026-Q4', 7, { notebook: [6, 5, 4, 4] });
    expect(calls.some((call) => call.text.includes('submissions'))).toBe(false);
  });

  it('lastPublishedCard only looks at rounds where the user submitted', async () => {
    const { calls, fake } = answering([]);
    expect(await lastPublishedCard(fake, 7)).toBeUndefined();
    expect(calls[0]?.text).toMatch(
      /EXISTS \(SELECT 1 FROM submissions sub WHERE sub\.round_id = r\.id AND sub\.user_id = @userId\)/,
    );
  });
});
```

In `api/src/repo/rounds.test.ts`, add:

```ts
describe('submission counts', () => {
  it('listRoundsWithCounts counts submitted cards beside all cards', async () => {
    const { calls, fake } = answering([]);
    await listRoundsWithCounts(fake);
    expect(calls[0]?.text).toMatch(/\(SELECT COUNT\(\*\) FROM submissions sub WHERE sub\.round_id = r\.id\) AS submitted/);
  });

  it('countSubmitted counts the round\'s submissions', async () => {
    const { calls, fake } = answering([{ n: 2 }]);
    expect(await countSubmitted(fake, '2026-Q4')).toBe(2);
    expect(calls[0]?.text).toBe('SELECT COUNT(*) AS n FROM submissions WHERE round_id = @id');
    expect(calls[0]?.params).toEqual({ id: varchar('2026-Q4') });
  });

  it('deleteRound removes the submissions before the round', async () => {
    const { calls, fake } = answering([]);
    await deleteRound(fake, '2026-Q4');
    expect(calls.map((call) => call.text)).toEqual([
      'DELETE FROM notes WHERE round_id = @id',
      'DELETE FROM scores WHERE round_id = @id',
      'DELETE FROM submissions WHERE round_id = @id',
      'DELETE FROM rounds WHERE id = @id',
    ]);
  });
});
```

Add the new names to the files' imports.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run api/src/repo`
Expected: FAIL (`submissions.ts` missing; the SQL assertions fail).

- [ ] **Step 3: Implement**

`db/schema.sql`, a new batch right after the `ix_scores_artifact` batch:

```sql
-- Submitted cards (Plan 7): one row per rater per round. Only submitted cards count toward a round's ratings. The
-- table is created with a one-time backfill: every card in an already-published round counted before submissions
-- existed. Re-running this file never backfills again, so a draft a release left out stays out.
IF OBJECT_ID('dbo.submissions') IS NULL
BEGIN
  CREATE TABLE dbo.submissions (
    round_id varchar(8) NOT NULL CONSTRAINT fk_submissions_round REFERENCES dbo.rounds (id),
    user_id int NOT NULL CONSTRAINT fk_submissions_user REFERENCES dbo.users (id),
    submitted_at datetime2 NOT NULL CONSTRAINT df_submissions_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_submissions PRIMARY KEY (round_id, user_id)
  );
  INSERT INTO dbo.submissions (round_id, user_id, submitted_at)
  SELECT s.round_id, s.user_id, MAX(s.updated_at)
  FROM dbo.scores s JOIN dbo.rounds r ON r.id = s.round_id
  WHERE r.status = 'published'
  GROUP BY s.round_id, s.user_id;
END
GO
```

`api/src/repo/submissions.ts`:

```ts
import { varchar, type Db } from '../lib/db.ts';

/**
 * Marks the rater's card in the round as submitted, keeping the first submission's time if it already is. Run inside
 * a transaction after lockRound on the same round, which keeps two writers of one card from racing.
 */
export async function submitCard(db: Db, roundId: string, userId: number): Promise<void> {
  await db.query(
    `INSERT INTO submissions (round_id, user_id)
     SELECT @roundId, @userId
     WHERE NOT EXISTS (SELECT 1 FROM submissions WHERE round_id = @roundId AND user_id = @userId)`,
    { roundId: varchar(roundId), userId },
  );
}

/** Turns the rater's card back into a draft. Nothing happens if it isn't submitted. */
export async function withdrawCard(db: Db, roundId: string, userId: number): Promise<void> {
  await db.query('DELETE FROM submissions WHERE round_id = @roundId AND user_id = @userId', {
    roundId: varchar(roundId),
    userId,
  });
}

/** Whether the rater's card in the round is submitted. */
export async function isSubmitted(db: Db, roundId: string, userId: number): Promise<boolean> {
  const [row] = await db.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM submissions WHERE round_id = @roundId AND user_id = @userId',
    { roundId: varchar(roundId), userId },
  );
  return (row?.n ?? 0) > 0;
}
```

`api/src/repo/scores.ts`:

```ts
const COLUMNS = `s.round_id AS roundId, s.user_id AS userId, u.display_name AS name, s.artifact_id AS artifactId,
  s.capability, s.ux, s.cost, s.outlook, s.updated_at AS updatedAt, sub.submitted_at AS submittedAt`;
/** Each score with its rater's name and, for a submitted card, when it was submitted. */
const FROM = `FROM scores s JOIN users u ON u.id = s.user_id
  LEFT JOIN submissions sub ON sub.round_id = s.round_id AND sub.user_id = s.user_id`;
```

`allScores` becomes `` `SELECT ${COLUMNS} ${FROM} ORDER BY s.round_id, u.display_name, s.user_id, s.artifact_id` `` and `scoresFor` becomes `` `SELECT ${COLUMNS} ${FROM} WHERE s.round_id = @roundId AND s.user_id = @userId` ``. In `replaceScorecard`, replace `if (entries.length === 0) return;` with:

```ts
  if (entries.length === 0) {
    // A card that no longer exists can't stay submitted.
    await db.query('DELETE FROM submissions WHERE round_id = @roundId AND user_id = @userId', {
      roundId: varchar(roundId),
      userId,
    });
    return;
  }
```

Update the docstring sentence "An empty card deletes it." to "An empty card deletes it and its submission." `lastPublishedCard`'s query and docstring become:

```ts
/** The user's submitted card from the newest published round they submitted in. */
// …
    `SELECT TOP 1 r.id, r.label FROM rounds r
     WHERE r.status = 'published'
       AND EXISTS (SELECT 1 FROM submissions sub WHERE sub.round_id = r.id AND sub.user_id = @userId)
     ORDER BY r.published_on DESC, r.id DESC`,
```

`api/src/repo/rounds.ts`: in `listRoundsWithCounts` add the line `(SELECT COUNT(*) FROM submissions sub WHERE sub.round_id = r.id) AS submitted,` between the `scorecards` and `notes` subqueries. Add after `countScorecards`:

```ts
/** How many cards in the round are submitted: the cards a release counts. */
export async function countSubmitted(db: Db, id: string): Promise<number> {
  const [row] = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM submissions WHERE round_id = @id', {
    id: varchar(id),
  });
  return row?.n ?? 0;
}
```

In `deleteRound`, add `await tx.query('DELETE FROM submissions WHERE round_id = @id', params);` after the scores delete and before the rounds delete.

Types: `api/src/domain/dataset.ts` `ScoreRow` gains `/** When the card was submitted; null for a draft. */ submittedAt: Date | null;`. `src/domain/api-types.ts` `AdminRound` gains `/** Submitted cards: the ones a release counts. */ submitted: number;` after `scorecards`. In `api/src/domain/fixtures.ts`, `row()` returns `submittedAt: at` as well. Every other `ScoreRow` literal in tests gets `submittedAt: null`, and every `AdminRound` literal gets a `submitted` count (use the same number as its `scorecards` unless the test is about drafts).

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run api/src/repo && npm run typecheck && npx vitest run`
Expected: all PASS. Count the schema's batches: `grep -c "^GO" db/schema.sql` prints 20.

- [ ] **Step 5: Commit**

```bash
git add db/schema.sql api/src src
git commit -m "Submissions: table with a one-time backfill, repository functions, submission state on score reads"
```

---

### Task 2: Drafts in the dataset and the admin review

**Files:**
- Modify: `src/domain/types.ts`, `src/domain/api-types.ts`
- Modify: `api/src/domain/dataset.ts`, `api/src/domain/review.ts`, `api/src/domain/fixtures.ts`
- Modify: `api/src/functions/admin-rounds.ts` (one message)
- Modify: `src/admin/ReviewTab.tsx`
- Test: `api/src/domain/aggregate.test.ts` (rename only), `api/src/domain/review.test.ts`, `api/src/domain/snapshot.test.ts`, `src/admin/ReviewTab.dom.test.ts`, and every literal typecheck flags (`RoundData`, `Scorecard`, `RoundReview`, `ReviewItem`)

**Interfaces:**
- Consumes: `ScoreRow.submittedAt` (Task 1).
- Produces: `Scorecard { rater; savedAt; submittedAt: string | null; scores }`; `RoundData.drafts: Scorecard[]`; `ReviewItem.point: RatingPoint | null`; `ReviewItem.breakdown[].submitted: boolean`; `RoundReview.raters[].submittedAt: string | null`; `ChangeKind` gains `'draft'`.

- [ ] **Step 1: Write the failing tests**

In `api/src/domain/fixtures.ts`, give `row()` a fifth parameter `submitted = true` and return `submittedAt: submitted ? at : null`. Add one draft row to `scoreRows`: `row('2026-Q4', 2, 'lakehouse', [1, 1, 1, 1], false)` (Bo saved Q4 but never submitted; Q4 is published).

`api/src/domain/review.test.ts`, add:

```ts
describe('drafts in the review', () => {
  it('lists a draft card beside the submitted ones and leaves it out of the averages', () => {
    const review = buildReview(dataset, '2026-Q4', '2026-10-19', false);
    const lakehouse = review?.items.find((item) => item.artifact.id === 'lakehouse');
    expect(lakehouse?.point?.scores.capability).toBe(7);
    expect(lakehouse?.point?.raters).toBe(1);
    expect(lakehouse?.breakdown).toEqual([
      { userId: 1, name: 'Ann', submitted: true, scores: [7, 7, 7, 7] },
      { userId: 2, name: 'Bo', submitted: false, scores: [1, 1, 1, 1] },
    ]);
    expect(review?.raters).toEqual([
      { userId: 1, name: 'Ann', submittedAt: '2026-09-30T12:00:00.000Z' },
      { userId: 2, name: 'Bo', submittedAt: null },
    ]);
  });

  it('lists an item only drafts scored, with no point', () => {
    const rows = [...scoreRows, row('2027-Q1', 2, 'unscored', [3, 3, 3, 3], false)];
    const data = assembleDataset(workloads, artifacts, rounds, rows, noteRows);
    const item = buildReview(data, '2027-Q1', '2026-10-19', false)?.items.find((i) => i.artifact.id === 'unscored');
    expect(item).toMatchObject({ point: null, previous: null, change: { kind: 'draft', text: 'Only in drafts' } });
    expect(item?.breakdown).toEqual([{ userId: 2, name: 'Bo', submitted: false, scores: [3, 3, 3, 3] }]);
  });
});
```

(Export `row` from `fixtures.ts` for this test.) In `api/src/domain/snapshot.test.ts`, add a test that `buildSnapshot` on `dataset` gives Lakehouse's Q4 history point capability 7 from 1 rater (Bo's draft ignored). Existing assertions that list 2026-Q4's raters or breakdowns now include Bo's draft: update them to the new shapes.

`src/admin/ReviewTab.dom.test.ts`, add one test rendering a review with Ann submitted and Bo as a draft, one item both scored and one item only Bo scored. Assert: the toolbar text contains "1 item · 1 submitted · 1 draft"; the first item's breakdown text contains "Bo (draft)"; the draft-only item's card shows "No submitted scores", no grade badge, and no "Draft with AI" button.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run api/src/domain src/admin/ReviewTab.dom.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/domain/types.ts`:

```ts
/** Everything one rater saved for one round. A save replaces it. */
export interface Scorecard {
  rater: string;
  /** The newest save of any score on the card. */
  savedAt: string;
  /** When the rater submitted the card; null for a draft. Only submitted cards count. */
  submittedAt: string | null;
  scores: Record<string, ScoreTuple>;
}
```

and in `RoundData`:

```ts
  /** Submitted cards: the only ones that count toward ratings. */
  scorecards: Scorecard[];
  /** Saved but not submitted. Never counted; the admin review lists them. */
  drafts: Scorecard[];
```

`api/src/domain/dataset.ts` `assembleDataset`: initialise each round as `{ round, notes: {}, scorecards: [], drafts: [] }` and build cards as:

```ts
    if (!card) {
      card = { rater: String(row.userId), savedAt: at, submittedAt: row.submittedAt?.toISOString() ?? null, scores: {} };
      cards.set(key, card);
      (card.submittedAt === null ? data.drafts : data.scorecards).push(card);
    }
    card.scores[row.artifactId] = tuple(row);
    if (at > card.savedAt) card.savedAt = at;
```

`src/domain/api-types.ts`:

```ts
export type ChangeKind = 'new' | 'up' | 'down' | 'same' | 'draft';

export interface ReviewItem {
  artifact: Artifact;
  /** From submitted cards only; null when only drafts scored the item. */
  point: RatingPoint | null;
  previous: RatingPoint | null;
  change: { kind: ChangeKind; text: string };
  /** Every card that scored the item, drafts included; only submitted ones are in `point`. */
  breakdown: { userId: number; name: string; submitted: boolean; scores: ScoreTuple }[];
}

export interface RoundReview {
  round: Round;
  /** Everyone with a card in the round: submitted cards first, then drafts. */
  raters: { userId: number; name: string; submittedAt: string | null }[];
  items: ReviewItem[];
  notes: RoundNotes;
  aiEnabled: boolean;
}
```

`api/src/domain/review.ts` `buildReview`, replacing the items and raters code:

```ts
const DRAFTS_ONLY = { kind: 'draft', text: 'Only in drafts' } as const;

  // …inside buildReview:
  const cards = [...target.scorecards, ...target.drafts];
  // An item only drafts scored is still listed, so the card editor (built from these breakdowns) never drops it.
  const items = data.artifacts.flatMap((artifact): ReviewItem[] => {
    const breakdown = cards.flatMap((card) => {
      const scores = card.scores[artifact.id];
      if (!scores) return [];
      const shown = scores.map((value, i) =>
        artifact.naFactors.includes(FACTOR_ORDER[i] ?? 'capability') ? null : value,
      ) as unknown as ScoreTuple;
      return [{ ...rater(card.rater), submitted: card.submittedAt !== null, scores: shown }];
    });
    if (breakdown.length === 0) return [];
    const point = pointFor(artifact, target, date);
    if (!point) return [{ artifact, point: null, previous: null, change: { ...DRAFTS_ONLY }, breakdown }];
    const previous = previousPoint(artifact, data.rounds, roundId);
    return [{ artifact, point, previous: previous ?? null, change: changeLabel(point, previous), breakdown }];
  });
  return {
    round: target.round,
    raters: cards.map((card) => ({ ...rater(card.rater), submittedAt: card.submittedAt })),
    items,
    notes: target.notes,
    aiEnabled,
  };
```

`api/src/functions/admin-rounds.ts` (the AI draft route): the message `` `${artifact.name} has no scores in ${target.round.label} yet.` `` becomes `` `${artifact.name} has no submitted scores in ${target.round.label} yet.` ``.

`src/admin/ReviewTab.tsx`:
- Before `blanks`, add `const counted = review.items.filter((item) => item.point !== null);` and change `blanks` to filter `counted` instead of `review.items` (an item only drafts scored won't go live, so it needs no why and no AI draft).
- Toolbar heading: replace the `{review.items.length} items scored by …` text with:

```tsx
              <strong>
                {pluralize(counted.length, 'item', 'items')} · {submittedCount} submitted
                {draftCount > 0 && ` · ${pluralize(draftCount, 'draft', 'drafts')}`}
              </strong>
```

  where `const submittedCount = review.raters.filter((rater) => rater.submittedAt !== null).length;` and `const draftCount = review.raters.length - submittedCount;` (import `pluralize` from `../lib/format`).
- In each item: `const scoreText = point ? FACTORS.map((factor) => formatScoreOrNa(point.scores[factor.id])).join(' · ') : 'No submitted scores';`, render the `GradeBadge` only when `point` is set, render the Draft with AI button only when `point` is set (its error span stays), and the breakdown line becomes `` `${row.name}${row.submitted ? '' : ' (draft)'} ${row.scores.map(formatScoreOrNa).join(' · ')}` ``.

Rename `submittedAt` to `savedAt` in every `Scorecard` literal in tests, and add `submittedAt` (a timestamp for counted cards) plus `drafts: []` to every `RoundData` literal; add `submitted: true`/`submittedAt` to review literals in `src` tests as typecheck requires.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src src
git commit -m "Drafts: split from submitted cards in the dataset; the review lists them without counting them"
```

---

### Task 3: Rater routes: submit, withdraw, and no saving over a submitted card

**Files:**
- Modify: `api/src/functions/rater.ts`, `api/src/functions/rater.test.ts`
- Modify: `src/domain/api-types.ts` (`MyScores`)
- Modify: `api/src/integration.test.ts`
- Modify every `MyScores` literal typecheck flags (`src/rating-ui/*.test.ts`, `src/admin/AdminPage.dom.test.ts`)

**Interfaces:**
- Consumes: `isSubmitted`, `submitCard`, `withdrawCard` (Task 1); `ScoreRow.submittedAt` (Task 1); review shapes (Task 2).
- Produces: `MyScores.submittedAt: string | null`; `POST /api/rounds/open/my-scores/submit` `{ round, updatedAt }` → `MyScores`; `POST /api/rounds/open/my-scores/withdraw` `{ round }` → `MyScores`.

- [ ] **Step 1: Write the failing tests**

In `api/src/functions/rater.test.ts`: mock `../repo/submissions.ts` (`vi.mock(import('../repo/submissions.ts'), () => ({ isSubmitted: vi.fn(), submitCard: vi.fn(), withdrawCard: vi.fn() }))`), default `isSubmitted` to `false` in `beforeEach`, add a `call(name, body)` helper like `save()` for any registered handler, and a `cardRow(overrides)` helper returning a complete `ScoreRow` for user 7 (`updatedAt` `2026-10-15T20:00:00Z`, `submittedAt: null`). Update the existing "was just published" expectation to `'Q4 2026 was just released. Reload the page.'` and add `submittedAt: null` to the expected `MyScores`. Add:

```ts
describe('saving a submitted card', () => {
  it('refuses with 409, writing nothing, once the card is submitted', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    vi.mocked(isSubmitted).mockResolvedValue(true);
    await expect(save({ round: round.id, scores: { notebook: [6, 5, 4, 4] } })).rejects.toMatchObject({
      status: 409,
      message: 'You submitted this card. Withdraw your submission to make changes.',
    });
    expect(isSubmitted).toHaveBeenCalledWith(tx, round.id, 7);
    expect(replaceScorecard).not.toHaveBeenCalled();
  });
});

describe('myScoresSubmit', () => {
  const seen = '2026-10-15T20:00:00.000Z';

  it('submits the card it was shown, after locking the round, and returns it with the time', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    const submittedAt = new Date('2026-10-19T15:02:00Z');
    vi.mocked(scoresFor).mockResolvedValueOnce([cardRow()]).mockResolvedValue([cardRow({ submittedAt })]);
    const result = await call('myScoresSubmit', { round: round.id, updatedAt: seen });
    expect(submitCard).toHaveBeenCalledWith(tx, round.id, 7);
    const [locked = 0] = vi.mocked(lockRound).mock.invocationCallOrder;
    const [submitted = 0] = vi.mocked(submitCard).mock.invocationCallOrder;
    expect(locked).toBeLessThan(submitted);
    expect(result).toMatchObject({ submittedAt: submittedAt.toISOString(), updatedAt: seen });
  });

  it.each([
    [{ round: '2026-Q3', updatedAt: seen }, 409, 'The open round is now Q4 2026. Reload the page to score it.'],
    [{ round: '2026-Q4' }, 400, 'Send updatedAt: the save time of the card you are submitting.'],
  ])('refuses %j before any transaction', async (body, status, message) => {
    await expect(call('myScoresSubmit', body)).rejects.toMatchObject({ status, message });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses when the round was released before the lock', async () => {
    vi.mocked(lockRound).mockResolvedValue({ ...round, status: 'published', publishedOn: '2026-10-19' });
    await expect(call('myScoresSubmit', { round: round.id, updatedAt: seen })).rejects.toMatchObject({
      status: 409,
      message: 'Q4 2026 was just released. Reload the page.',
    });
    expect(submitCard).not.toHaveBeenCalled();
  });

  it('refuses an unsaved card', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    vi.mocked(scoresFor).mockResolvedValue([]);
    await expect(call('myScoresSubmit', { round: round.id, updatedAt: seen })).rejects.toMatchObject({
      status: 400,
      message: 'Save your scores before submitting.',
    });
  });

  it('refuses a card that is already submitted', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    vi.mocked(scoresFor).mockResolvedValue([cardRow({ submittedAt: new Date('2026-10-18T10:00:00Z') })]);
    await expect(call('myScoresSubmit', { round: round.id, updatedAt: seen })).rejects.toMatchObject({
      status: 409,
      message: 'Your card is already submitted.',
    });
    expect(submitCard).not.toHaveBeenCalled();
  });

  it('refuses a card saved since the page loaded it', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    vi.mocked(scoresFor).mockResolvedValue([cardRow({ updatedAt: new Date('2026-10-16T09:00:00Z') })]);
    await expect(call('myScoresSubmit', { round: round.id, updatedAt: seen })).rejects.toMatchObject({
      status: 409,
      message: 'Your card changed since this page loaded. Reload the page to see it.',
    });
    expect(submitCard).not.toHaveBeenCalled();
  });
});

describe('myScoresWithdraw', () => {
  it('withdraws after locking the round and returns the draft', async () => {
    vi.mocked(lockRound).mockResolvedValue(round);
    vi.mocked(scoresFor).mockResolvedValue([cardRow()]);
    const result = await call('myScoresWithdraw', { round: round.id });
    expect(withdrawCard).toHaveBeenCalledWith(tx, round.id, 7);
    expect(result).toMatchObject({ submittedAt: null });
  });

  it('refuses once the round is released', async () => {
    vi.mocked(lockRound).mockResolvedValue({ ...round, status: 'published', publishedOn: '2026-10-19' });
    await expect(call('myScoresWithdraw', { round: round.id })).rejects.toMatchObject({
      status: 409,
      message: 'Q4 2026 was just released. Reload the page.',
    });
    expect(withdrawCard).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run api/src/functions/rater.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/domain/api-types.ts` `MyScores` gains, after `updatedAt`:

```ts
  /** When the rater submitted this card; null while it is a draft (or there is no card). */
  submittedAt: string | null;
```

`api/src/functions/rater.ts` (import `transaction` from `../lib/db.ts`, `isSubmitted`, `submitCard`, `withdrawCard` from `../repo/submissions.ts`, and `type ScoreRow` from `../domain/dataset.ts`):

```ts
const SUBMITTED = 'You submitted this card. Withdraw your submission to make changes.';
const released = (round: Round) => `${round.label} was just released. Reload the page.`;

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
```

`myScores` uses `newestSave(rows)` and returns `submittedAt: rows[0]?.submittedAt?.toISOString() ?? null` after `updatedAt`. `myScoresPut` starts with `const round = await openRoundFor(ctx.body.round);` (replacing its own mismatch check), and its transaction becomes:

```ts
  await saveForItems(ctx.log, CARD_ITEM_DELETED, async (tx) => {
    const locked = await lockRound(tx, round.id);
    if (locked?.status !== 'open') throw new HttpError(409, released(round));
    if (await isSubmitted(tx, round.id, ctx.user.id)) throw new HttpError(409, SUBMITTED);
    await replaceScorecard(tx, round.id, ctx.user.id, scores);
  });
```

New routes:

```ts
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
```

`api/src/integration.test.ts` (cannot run here; the controller runs it): keep the saved card's `updatedAt` from "saves a rater card in the open round only" in a suite-level `let savedAt = '';`; in "shows the card in the admin review" expect `{ userId: raterId, name: 'Integration Rater', submitted: false, scores: [5, 6, 7, 3] }`; then add:

```ts
  it('submits a card, refuses saving over it, and withdraws it', async () => {
    const submitted = await rater.send('POST', '/api/rounds/open/my-scores/submit', { round: roundId, updatedAt: savedAt });
    expect(submitted.status).toBe(200);
    expect(typeof submitted.body.submittedAt).toBe('string');
    const blocked = await rater.send('PUT', '/api/rounds/open/my-scores', { round: roundId, scores: {} });
    expect(blocked.status).toBe(409);
    const review = await admin.send('GET', `/api/admin/rounds/${roundId}/review`);
    expect(review.body.raters).toContainEqual(expect.objectContaining({ userId: raterId, submittedAt: expect.any(String) }));
    const withdrawn = await rater.send('POST', '/api/rounds/open/my-scores/withdraw', { round: roundId });
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.submittedAt).toBeNull();
  });
```

Wrap any line over 120 characters. Add `submittedAt: null` to every `MyScores` literal in `src` tests.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: all PASS (the integration suite stays skipped without its environment).

- [ ] **Step 5: Commit**

```bash
git add api/src src
git commit -m "Rater routes: submit and withdraw a card; a submitted card can't be saved over"
```

---

### Task 4: Admin routes: release counts submitted cards; corrections count; "release" wording

**Files:**
- Modify: `api/src/functions/admin-rounds.ts`, `api/src/functions/admin-rounds.test.ts`
- Modify: `api/src/lib/permissions.ts` and its test if it asserts the message
- Modify: `api/src/repo/rounds.ts` (remove `countScorecards`), its test if any

**Interfaces:**
- Consumes: `countSubmitted` (Task 1), `submitCard` (Task 1).

- [ ] **Step 1: Write the failing tests**

In `api/src/functions/admin-rounds.test.ts`: the `../repo/rounds.ts` mock replaces `countScorecards` with `countSubmitted`; mock `../repo/submissions.ts` (`submitCard: vi.fn()`). Update every expected message listed in Step 3. Add:
- Release with `countSubmitted` resolving `0` rejects `{ status: 400, message: 'Nobody has submitted Q4 2026 yet.' }` and never calls `publishRound` (use the file's open-round fixture label).
- `adminScoresPut` in a published round with a non-empty card calls `submitCard(tx, roundId, ownerId)` after `replaceScorecard`.
- `adminScoresPut` in an open round does not call `submitCard`.
- `adminScoresPut` in a published round with an empty card (`scores: {}`) does not call `submitCard`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run api/src/functions/admin-rounds.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In the release branch of `adminRoundUpdate`:

```ts
      if ((await countSubmitted(tx, current.id)) === 0) {
        throw new HttpError(400, `Nobody has submitted ${current.label} yet.`);
      }
```

In `adminScoresPut`, after `replaceScorecard(...)`:

```ts
    // A correction to a released round is live data, so the card counts, a draft the release left out included.
    if (current.status === 'published' && Object.keys(scores).length > 0) await submitCard(tx, round.id, owner.id);
```

(the existing `markChanged` line stays after it). Delete `countScorecards` from `rounds.ts` and its imports and tests.

Wording, exact replacements in `admin-rounds.ts`:

| Before | After |
|---|---|
| `` `Publish ${open.label} before starting a new round.` `` | `` `Release ${open.label} before starting a new round.` `` |
| `'Publish date'` (the field label passed to `text()`) | `'Release date'` |
| `'Publish dates look like 2026-10-15.'` | `'Release dates look like 2026-10-15.'` |
| `` `${current.label} is already published.` `` | `` `${current.label} is already released.` `` |
| `` `Publish dates can't be earlier than ${latest.label}'s (${latest.publishedOn}).` `` | `` `Release dates can't be earlier than ${latest.label}'s (${latest.publishedOn}).` `` |
| `` `Publish ${open.label} before reopening another round.` `` | `` `Release ${open.label} before reopening another round.` `` |
| `` `Only the most recent published round (${latest.label}) can be reopened.` `` | `` `Only the most recent released round (${latest.label}) can be reopened.` `` |
| `"Published rounds can't be deleted. Reopen it first if it must change."` | `"Released rounds can't be deleted. Reopen it first if it must change."` |

In `api/src/lib/permissions.ts`: `` `${round.label} is published, so scores can no longer be changed. Ask an admin if a score needs correcting.` `` becomes `` `${round.label} is released, so scores can no longer be changed. Ask an admin if a score needs correcting.` ``. Then `grep -rn "ublish" api/src --include=*.ts | grep -v test` and confirm no other user-facing message says "publish" (identifiers and comments may stay).

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src
git commit -m "Admin routes: release counts submitted cards, corrections to a released round count, release wording"
```

---

### Task 5: Rater page: Submit, the submitted card, Withdraw

**Files:**
- Modify: `src/rating-ui/ScoreMatrix.tsx` (`readOnly`), `src/rating-ui/ScorecardEditor.tsx`
- Test: `src/rating-ui/ScorecardEditor.dom.test.ts`, `src/rating-ui/ScoreMatrix` tests if any assert the Clear button

**Interfaces:**
- Consumes: `MyScores.submittedAt`, the submit and withdraw routes (Task 3).

- [ ] **Step 1: Write the failing DOM tests**

In `src/rating-ui/ScorecardEditor.dom.test.ts` (stub `fetch` and `confirm` as the file and `src/admin/PublishTab.dom.test.ts` do; render `CardForm` for the draft states and the new exported `SubmittedCard` for the submitted state):
- A saved, clean card (`card` fixture with `submittedAt: null`) shows a "Submit scores" button. After moving a slider it disappears; after Discard changes it is back. A card with `updatedAt: null` and no scores shows none.
- Clicking Submit with `confirm` returning true sends `POST /api/rounds/open/my-scores/submit` with body `{ round: '2026-Q4', updatedAt: '2026-10-15T23:00:00.000Z' }` and calls `onSaved` with the response. The confirm text is "Submit your Q4 2026 card? You can withdraw it to make changes until the round is released.". With `confirm` returning false nothing is sent.
- A 409 answer shows its message in an alert and a "Reload page" button.
- `SubmittedCard` with `submittedAt: '2026-10-19T20:02:00.000Z'` renders every slider `disabled`, no "Clear" buttons, no "Save scores" button, a "Withdraw submission" button, and text starting "Submitted " and containing "Your scores count when Q4 2026 is released.". Clicking Withdraw sends `POST /api/rounds/open/my-scores/withdraw` with `{ round: '2026-Q4' }` and calls `onWithdrawn` with the response.
- The draft form's hint contains "Submitted cards count toward the averages, which appear on the site when the admin releases Q4 2026." and no longer contains "is published".

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/rating-ui`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/rating-ui/ScoreMatrix.tsx`: `ScoreMatrixProps` gains `/** Shows the scores without letting them change: sliders disabled, no Clear buttons. */ readOnly?: boolean;` (default `false` in the destructuring), passed to each `MatrixRow` as `readOnly={readOnly}`. `MatrixRowProps` gains `readOnly: boolean`; each `ScoreSlider` gets `disabled={readOnly}`; the Clear button becomes `{readOnly ? <span /> : (<button …existing…>)}` (the span keeps the grid's column). `ScoreSliderProps` gains `disabled: boolean`, set on the `<input type="range" … disabled={disabled} />`.

`src/rating-ui/ScorecardEditor.tsx`:
- `ScorecardEditor`'s ready branch:

```tsx
  const ready = (card: MyScores) => setLoad({ kind: 'ready', catalog: load.catalog, card });
  if (load.card.submittedAt) {
    return (
      <SubmittedCard
        key={load.card.round.id}
        catalog={load.catalog}
        card={load.card}
        reference={reference}
        onWithdrawn={ready}
        onReload={onReload}
      />
    );
  }
  return (
    <CardForm
      key={load.card.round.id}
      user={user}
      catalog={load.catalog}
      card={load.card}
      reference={reference}
      onSaved={ready}
      onReload={onReload}
    />
  );
```

- In `CardForm`: `const [submitting, setSubmitting] = useState(false);` and
  `const canSubmit = card.updatedAt !== null && Object.keys(card.scores).length > 0 && !dirty && status.kind !== 'saving';`

```tsx
  const submit = async () => {
    if (submitting) return;
    if (!confirm(`Submit your ${round.label} card? You can withdraw it to make changes until the round is released.`)) {
      return;
    }
    setSubmitting(true);
    setAttempt((count) => count + 1);
    try {
      onSaved(await api<MyScores>('POST', '/rounds/open/my-scores/submit', { round: round.id, updatedAt: card.updatedAt }));
    } catch (reason) {
      setStatus({
        kind: 'error',
        message: errorMessage(reason),
        reload: reason instanceof ApiError && reason.status === 409,
      });
      setSubmitting(false);
    }
  };
```

  (wrap the long `onSaved(...)` line). After the Save scores button:

```tsx
          {canSubmit && (
            <button type="button" className={styles.primary} aria-disabled={submitting} onClick={() => void submit()}>
              {submitting ? 'Submitting…' : 'Submit scores'}
            </button>
          )}
```

- The hint paragraph's text becomes: "Drag or click a slider to set it; arrow keys adjust it and Enter sets an untouched one. Leave an item blank to skip it, or clear everything and save to remove your card. Your scores on the factors that apply combine into the item's grade; the public site shows the grade and the averaged factor scores, never a total. When your card is ready, submit it. Only the admin sees individual cards. Submitted cards count toward the averages, which appear on the site when the admin releases {round.label}."
- New exported component (import `formatTimestamp` from `../lib/format`):

```tsx
interface SubmittedCardProps {
  catalog: Catalog;
  card: MyScores;
  reference: Readonly<Record<string, FactorValues>>;
  /** Called with the card the withdraw returned: a draft again. */
  onWithdrawn: (card: MyScores) => void;
  onReload?: () => void;
}

const IGNORE = () => {};

/** A submitted card: read-only until the rater withdraws it. Exported for markup tests; pages use ScorecardEditor. */
export function SubmittedCard({ catalog, card, reference, onWithdrawn, onReload }: SubmittedCardProps) {
  const { round } = card;
  const draft = useMemo(() => draftFromScores(card.scores), [card.scores]);
  const summary = summarize(draft, catalog.artifacts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; reload: boolean }>();
  const [attempt, setAttempt] = useState(0);
  const toolbar = useFocusIfLost<HTMLDivElement>();

  const withdraw = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setAttempt((count) => count + 1);
    try {
      onWithdrawn(await api<MyScores>('POST', '/rounds/open/my-scores/withdraw', { round: round.id }));
    } catch (reason) {
      setError({ message: errorMessage(reason), reload: reason instanceof ApiError && reason.status === 409 });
      setBusy(false);
    }
  };

  return (
    <>
      <div ref={toolbar} tabIndex={-1} role="group" aria-label="Your scorecard" className={styles.toolbar}>
        <div className={styles.toolbarText}>
          <strong>
            {round.label} · {summary.rated} of {catalog.artifacts.length} rated
          </strong>
          <span className={styles.muted}> · Submitted</span>
          {error && (
            <span key={attempt} className={styles.error} role="alert">
              {' '}
              {error.message}
            </span>
          )}
        </div>
        <div className={styles.toolbarActions}>
          {error?.reload && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => (onReload ? onReload() : location.reload())}
            >
              Reload page
            </button>
          )}
          <button type="button" className={styles.secondary} aria-disabled={busy} onClick={() => void withdraw()}>
            {busy ? 'Withdrawing…' : 'Withdraw submission'}
          </button>
        </div>
      </div>
      <p className={styles.hint}>
        Submitted {formatTimestamp(card.submittedAt ?? '')}. Your scores count when {round.label} is released.
        Withdraw your submission to change them.
      </p>
      <ScoreMatrix
        workloads={catalog.workloads}
        artifacts={catalog.artifacts}
        draft={draft}
        onChange={IGNORE}
        reference={reference}
        readOnly
      />
    </>
  );
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "Rater page: Submit scores, a locked submitted card, Withdraw submission"
```

---

### Task 6: Publish tab and card editor: release wording, who has submitted, draft warning

**Files:**
- Modify: `src/admin/PublishTab.tsx`, `src/admin/RaterCardEditor.tsx`
- Test: `src/admin/PublishTab.dom.test.ts`, `src/admin/PublishTab.test.ts`, `src/admin/RaterCardEditor.dom.test.ts`, `src/admin/AdminPage.dom.test.ts` (wording only)

**Interfaces:**
- Consumes: `AdminRound.submitted` (Task 1); `RoundReview.raters[].submittedAt`, `ReviewItem.point` (Task 2).

- [ ] **Step 1: Write the failing tests**

In `src/admin/PublishTab.dom.test.ts` / `PublishTab.test.ts` (update every expectation that uses the old words to the table in Step 3), add:
- `PublishForm` with a review whose raters are Ann (submitted) and Bo (draft): the checklist reads "1 submitted · 1 saved but not submitted (Bo)"; the button reads "Release Q4 2026"; clicking it asks "Release Q4 2026, dated {date}? Raters can no longer change their cards. Bo's card isn't submitted and won't count." (build `{date}` with `formatFullDate` as the existing publish test does).
- With raters Ann (submitted), Bo and Cy (drafts): the confirm ends "These cards aren't submitted and won't count: Bo, Cy.".
- With every rater a draft: the button is `aria-disabled="true"` and a click sends nothing.
- An item with `point: null` is not counted in "{n} of {catalogSize} items scored" and is not listed as missing a why.
- `draftWarning([])` is `''`, `draftWarning(['Bo'])` is `" Bo's card isn't submitted and won't count."`, `draftWarning(['Bo', 'Cy'])` is `' These cards aren\'t submitted and won\'t count: Bo, Cy.'`.
- The rounds panel shows "Q4 2026 · open · 3 cards · 2 submitted" for an open round with `scorecards: 3, submitted: 2`, and a released round's line reads "Q3 2026 · released {date} · 2 cards · 2 submitted".

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/admin`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/admin/PublishTab.tsx`:

```ts
/** The release confirm's warning about cards that won't count, or '' when every card is submitted. Exported for tests. */
export function draftWarning(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return ` ${names[0]}'s card isn't submitted and won't count.`;
  return ` These cards aren't submitted and won't count: ${names.join(', ')}.`;
}
```

In `PublishForm`:

```ts
  const counted = review.items.filter((item) => item.point !== null);
  const missing = counted.filter((item) => !review.notes[item.artifact.id]?.trim());
  const submitted = review.raters.filter((rater) => rater.submittedAt !== null);
  const drafts = review.raters.filter((rater) => rater.submittedAt === null).map((rater) => rater.name);
  const blocked = busy || submitted.length === 0 || !date || (missing.length > 0 && !force);
```

The confirm: `` `Release ${round.label}, dated ${formatFullDate(date)}? Raters can no longer change their cards.${draftWarning(drafts)}` ``. The checklist's first line counts `counted.length` ("{counted.length} of {catalogSize} items scored", `data-ok={counted.length > 0}`); the raters line becomes:

```tsx
        <li data-ok={submitted.length > 0 && drafts.length === 0}>
          {submitted.length} submitted
          {drafts.length > 0 && ` · ${drafts.length} saved but not submitted (${drafts.join(', ')})`}
        </li>
```

`PublishedLine` reads `<strong>{round.label}</strong> · released {formatFullDate(round.publishedOn ?? '')} · {cardCount(round.scorecards)} · {round.submitted} submitted`, and the open round's line in `RoundsPanel` reads `<strong>{open.label}</strong> · open · {cardCount(open.scorecards)} · {open.submitted} submitted`.

Wording, exact replacements in `PublishTab.tsx`:

| Before | After |
|---|---|
| `` `Reopen ${round.label}? Raters can change their cards again until you publish it again.` `` | `` `Reopen ${round.label}? Raters can change their cards again until you release it again.` `` |
| `` `${open.label} is published` `` | `` `${open.label} is released` `` |
| `Published rounds` (panel title) | `Released rounds` |
| `No published rounds yet.` | `No released rounds yet.` |
| `To fix a published score or why without reopening, edit it on the Review tab.` | `To fix a released score or why without reopening, edit it on the Review tab.` |
| `· published {date}` in `PublishedLine` | `· released {date}` |
| ` · raters score this round; publish or delete it below` | ` · raters score this round; release or delete it below` |
| `` `Only one round can be open. Publish or delete ${open.label} to start the next one.` `` | `` `Only one round can be open. Release or delete ${open.label} to start the next one.` `` |
| `Publish {round.label}` (form heading) | `Release {round.label}` |
| `Items nobody scored stay off the public site.` | `Items with no submitted scores stay off the public site.` |
| `Publication date` | `Release date` |
| `Publish without them` | `Release without them` |
| `{busy ? 'Publishing…' : `Publish ${round.label}`}` | `{busy ? 'Releasing…' : `Release ${round.label}`}` |
| ` Published ratings, notes, or the catalog changed since then.` | ` Released ratings, notes, or the catalog changed since then.` |

`src/admin/RaterCardEditor.tsx`: `` `${round.label} is published. Saving changes its public averages at the next site update.` `` becomes `` `${round.label} is released. Saving changes its public averages at the next site update.` ``. Then `grep -rn "ublish" src --include=*.tsx | grep -v test` and confirm no other user-facing text says "publish" except the tab label "Publish" and "(Publish tab)" references to it.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm run typecheck && npx vitest run && npx vite build`
Expected: all PASS; the build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "Publish tab: Release wording, who has submitted, a warning for drafts that won't count"
```

---

### Task 7: Review, merge, schema, deploy (controller)

- [ ] Final whole-branch review (most capable model) against the spec; one fix round if needed.
- [ ] Gate on the branch: `npm run typecheck`, `npx vitest run`, `npx vite build`.
- [ ] `npm run db:apply` against `fcr-dev` twice: "Applied 20 schema batches." both times. Check: every card in a published round of `fcr-dev` has a submission; the open round's cards have none; the second run added nothing.
- [ ] Integration suite against a local Functions host on `fcr-dev` (as in earlier plans): all pass, including the new submit/withdraw test. Releasing is covered by unit tests only, because releasing would use up fcr-dev's open round.
- [ ] Merge `plan-7-submit-release` into `main` (fast-forward or merge commit; no force).
- [ ] `npm run db:apply` against production `fcr` once: "Applied 20 schema batches."; the same backfill check (production has no published rounds, so the table starts empty).
- [ ] Push `main`; watch the API deploy and the site deploy succeed.
- [ ] Live checks: the rater page shows Submit after a save; the Publish tab shows the submitted/draft line and "Release Q4 2026"; the public site is unchanged.
- [ ] Tell the user to submit their Q4 2026 card once, and to have their friend save and submit before the release.
