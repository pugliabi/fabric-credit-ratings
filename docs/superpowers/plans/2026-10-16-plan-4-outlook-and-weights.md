# Plan 4: Outlook Factor and Weighted Formula Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth 1-to-7 factor, Outlook, weight the four factors 40/25/25/10 into the existing 3-to-21 grade ladder, split BBB+ to BBB- into a "Low investment grade" band, and replace E/Withdrawn with D/Deprecated, end to end: schema, API, snapshot, rater and admin pages, public site.

**Architecture:** The fixed factor set in `src/data/factors.ts` drives every list in the UI and the AI prompt; the shared tuple type becomes four entries; the weights live only in `api/src/domain/formula.ts` (server-side, never shipped). Grades are never stored, so the band and letter changes are code-only; the `scores` table gains one column through an idempotent schema batch.

**Tech Stack:** TypeScript, Vitest (unit + `happy-dom` per file), React 19, Azure Functions v4, mssql against Fabric SQL, Vite.

**Spec:** `docs/superpowers/specs/2026-10-16-outlook-factor-weighted-formula-design.md`

## Global Constraints

- Weights: capability 0.40, ux 0.25, cost 0.25, outlook 0.10; `totalOf = 3 × Σ(weight × value)`; `TOTAL_TO_GRADE` and `gradeForTotal` unchanged.
- Factor order everywhere: `capability, ux, cost, outlook`.
- Bands: `investment` AAA–A-, `lowInvestment` BBB+–BBB-, `speculative` BB+–B-, `distressed` CCC–C, `deprecated` D. `isInvestmentGrade` is true for `investment` and `lowInvestment`.
- No numeric total is shown in any UI. No live preview, no new API route. The Function App is called only to load and save a card.
- Protected API strings stay byte for byte: "The model kept mentioning scores or grades. Write this one by hand." and "Anthropic did not answer in time. Try again."
- Formatting: 2 spaces, single quotes, semicolons, trailing commas, lines up to 120 characters.
- Before every commit: `npm run typecheck` and `npm test` pass. Work on `main`; push once, at the end (Task 8), after `db:apply` on both databases.
- Record each task in `.superpowers/sdd/progress.md` (above "## Minor findings for the final review").

## File Structure

```
src/domain/types.ts                 FactorId + outlook; ScoreTuple (4); Grade E->D; Band with lowInvestment, deprecated
src/domain/grades.ts (+ test)       GRADES ends in D; bandOf; BAND_META/BAND_ORDER for five bands
src/data/factors.ts                 fourth Factor entry (Outlook)
src/styles/tokens.css               --band-low-investment*, --band-deprecated* (replaces --band-withdrawn*)
api/src/domain/formula.ts (+ test)  FACTOR_WEIGHTS, weighted totalOf, DEPRECATED_GRADE
api/src/domain/aggregate.ts (+ test) FACTOR_ORDER with outlook; tuplesFor/gradeForTuples
api/src/domain/dataset.ts, fixtures.ts   ScoreRow.outlook; tuple(); fixture rows with outlook
api/src/lib/validate.ts (+ test)    four whole scores per item
api/src/repo/scores.ts              outlook column read and written
db/schema.sql                       outlook column (CREATE TABLE + two idempotent ALTER batches)
src/rating-ui/draft.ts (+ tests)    DraftTuple (4), EMPTY_TUPLE, draftFromValues over FACTORS
src/rating-ui/ScoreMatrix.tsx (+ css)   four sliders per row; "Set all four, or clear"
src/rating-ui/ScorecardEditor.tsx   helper sentence
src/components/HowItWorks.tsx (+ css)   four factor cards, four bands, Deprecated block
src/components/RatingHistory.tsx (+ css)   scores over FACTORS; deprecated action
src/admin/ReviewTab.tsx             scores over FACTORS
scripts/snapshot-checks.ts (+ test) scores object requires outlook
README.md, docs/superpowers/specs/2026-10-15-login-fabric-backend-design.md   one-line updates
```

Renames (exported identifiers only; local variable names may stay): `ScoreTriple → ScoreTuple`, `DraftTriple → DraftTuple`, `EMPTY_TRIPLE → EMPTY_TUPLE`, `triplesFor → tuplesFor`, `gradeForTriples → gradeForTuples`, `triple() → tuple()` (dataset.ts), `toTriples → toTuples`, `WITHDRAWN_GRADE → DEPRECATED_GRADE`.

**Mechanical rule for existing tests (used by Tasks 2–5):** every three-value score literal `[a, b, c]` (digits 1–7) in a test or fixture becomes `[a, b, c, c]` (the fourth value repeats the third), unless the task lists a different value. Tests that only compare tuples for equality or change detection keep passing; tests that assert an average or a grade get the new expected values stated in the task. The same rule applies to three-key `FactorValues` object literals `{ capability, ux, cost }` in tests (add `outlook` with the cost value), which also live in `api/src/lib/draft-why.test.ts:32` and `src/admin/PublishTab.test.ts:16`. Files with such literals: `src/account/logout.test.ts`, `src/admin/AdminPage.dom.test.ts`, `src/admin/PublishTab.dom.test.ts`, `src/admin/RaterCardEditor.dom.test.ts`, `src/admin/ReviewTab.dom.test.ts`, `src/admin/ReviewTab.test.ts`, `src/rating-ui/draft.test.ts`, `src/rating-ui/save.test.ts`, `src/rating-ui/ScorecardEditor.dom.test.ts`, `src/rating-ui/ScorecardEditor.test.ts`, `src/rating-ui/usePersistentDraft.test.ts`, `api/src/domain/aggregate.test.ts`, `api/src/domain/fixtures.ts`, `api/src/domain/review.test.ts`, `api/src/functions/admin-rounds.test.ts`, `api/src/functions/rater.test.ts`, `api/src/integration.test.ts`, `api/src/lib/validate.test.ts`, `api/src/repo/rounds.test.ts`.

---

### Task 1: Types, grades, bands, colour tokens

**Files:**
- Modify: `src/domain/types.ts:1-33`
- Modify: `src/domain/grades.ts`
- Modify: `src/domain/grades.test.ts`
- Modify: `src/styles/tokens.css:17-24`
- Modify: `src/components/ArtifactRow.module.css:74-75`, `src/components/RatingHistory.module.css:61`, `src/rating-ui/ScoreMatrix.module.css:118-119` (token rename only)

**Interfaces:**
- Produces: `type FactorId = 'capability' | 'ux' | 'cost' | 'outlook'`; `type ScoreTuple = readonly [Score, Score, Score, Score]`; `type Grade` with `'D'` in place of `'E'`; `type Band = 'investment' | 'lowInvestment' | 'speculative' | 'distressed' | 'deprecated'`; `bandOf`, `isInvestmentGrade`, `BAND_META`, `BAND_ORDER` for the five bands.

- [ ] **Step 1: Write the failing grade tests.** Replace the first test in `src/domain/grades.test.ts`:

```ts
  it('splits bands at A-, BBB- and B-, with D outside them', () => {
    expect(bandOf('AAA')).toBe('investment');
    expect(bandOf('A-')).toBe('investment');
    expect(bandOf('BBB+')).toBe('lowInvestment');
    expect(bandOf('BBB-')).toBe('lowInvestment');
    expect(bandOf('BB+')).toBe('speculative');
    expect(bandOf('B-')).toBe('speculative');
    expect(bandOf('CCC')).toBe('distressed');
    expect(bandOf('C')).toBe('distressed');
    expect(bandOf('D')).toBe('deprecated');
  });

  it('counts both investment bands as investment grade', () => {
    expect(isInvestmentGrade('A-')).toBe(true);
    expect(isInvestmentGrade('BBB-')).toBe(true);
    expect(isInvestmentGrade('BB+')).toBe(false);
    expect(isInvestmentGrade('D')).toBe(false);
  });

  it('lists the five bands best to worst, each covering its grades', () => {
    expect(BAND_ORDER).toEqual(['investment', 'lowInvestment', 'speculative', 'distressed', 'deprecated']);
    expect(GRADES.at(-1)).toBe('D');
    expect(BAND_META.lowInvestment.label).toBe('Low investment grade');
    expect(BAND_META.lowInvestment.range).toBe('BBB+ to BBB-');
    expect(BAND_META.investment.range).toBe('AAA to A-');
    expect(BAND_META.deprecated.label).toBe('Deprecated');
    expect(BAND_META.deprecated.range).toBe('D');
  });
```

and change the import line to `import { BAND_META, BAND_ORDER, GRADES, bandOf, isInvestmentGrade, medianGrade, notchDelta, spokenGrade } from './grades.ts';`.

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/domain/grades.test.ts`
Expected: FAIL (type errors on `'D'`, `lowInvestment`; `bandOf('BBB+')` returns `investment`).

- [ ] **Step 3: Change the types.** In `src/domain/types.ts`: in `Grade`, replace `| 'E';` with `| 'D';`. Replace the `Band`, `FactorId` and `ScoreTriple` lines with:

```ts
export type Band = 'investment' | 'lowInvestment' | 'speculative' | 'distressed' | 'deprecated';

export type FactorId = 'capability' | 'ux' | 'cost' | 'outlook';

export type Score = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** One rater's scores for one item, in FACTORS order: capability, UX, cost, outlook. */
export type ScoreTuple = readonly [Score, Score, Score, Score];
```

(keep `Score` where it is; delete the old `ScoreTriple` line) and in `Scorecard` change `scores: Record<string, ScoreTriple>;` to `scores: Record<string, ScoreTuple>;`.

- [ ] **Step 4: Change the grades module.** In `src/domain/grades.ts`: in `GRADES` replace `'E',` with `'D',`. Replace `bandOf` with:

```ts
export function bandOf(grade: Grade): Band {
  if (grade === 'D') return 'deprecated';
  const i = gradeIndex(grade);
  if (i <= gradeIndex('A-')) return 'investment';
  if (i <= gradeIndex('BBB-')) return 'lowInvestment';
  if (i <= gradeIndex('B-')) return 'speculative';
  return 'distressed';
}

/** Both investment bands: the site's "investment grade" counts include BBB+ to BBB-. */
export function isInvestmentGrade(grade: Grade): boolean {
  const band = bandOf(grade);
  return band === 'investment' || band === 'lowInvestment';
}
```

Replace `BAND_META` and `BAND_ORDER` with:

```ts
export const BAND_META: Readonly<Record<Band, BandMeta>> = {
  investment: {
    label: 'Investment grade',
    shortLabel: 'Inv. grade',
    range: 'AAA to A-',
    color: 'var(--band-investment)',
    background: 'var(--band-investment-bg)',
  },
  lowInvestment: {
    label: 'Low investment grade',
    shortLabel: 'Low inv. grade',
    range: 'BBB+ to BBB-',
    color: 'var(--band-low-investment)',
    background: 'var(--band-low-investment-bg)',
  },
  speculative: {
    label: 'Speculative',
    shortLabel: 'Speculative',
    range: 'BB+ to B-',
    color: 'var(--band-speculative)',
    background: 'var(--band-speculative-bg)',
  },
  distressed: {
    label: 'Distressed',
    shortLabel: 'Distressed',
    range: 'CCC to C',
    color: 'var(--band-distressed)',
    background: 'var(--band-distressed-bg)',
  },
  deprecated: {
    label: 'Deprecated',
    shortLabel: 'Deprecated',
    range: 'D',
    color: 'var(--band-deprecated)',
    background: 'var(--band-deprecated-bg)',
  },
};

export const BAND_ORDER: readonly Band[] = ['investment', 'lowInvestment', 'speculative', 'distressed', 'deprecated'];
```

- [ ] **Step 5: Colour tokens.** In `src/styles/tokens.css` replace the band block with:

```css
  --band-investment: #117865;
  --band-investment-bg: #e6f3ef;
  --band-low-investment: #4f7d22;
  --band-low-investment-bg: #eef4e3;
  --band-speculative: #9a6700;
  --band-speculative-bg: #fbf1dc;
  --band-distressed: #b42318;
  --band-distressed-bg: #fdeceb;
  --band-deprecated: #5b5f5e;
  --band-deprecated-bg: #eef0ef;
```

Then rename every `--band-withdrawn` / `--band-withdrawn-bg` reference to `--band-deprecated` / `--band-deprecated-bg` in `src/components/ArtifactRow.module.css`, `src/components/RatingHistory.module.css`, `src/rating-ui/ScoreMatrix.module.css`.

Run: `rg -n "band-withdrawn" src` → no output.

- [ ] **Step 6: Run the grade tests.**

Run: `npx vitest run src/domain/grades.test.ts`
Expected: PASS (6 tests). `npm run typecheck` will still fail elsewhere (`ScoreTriple`, `'E'`): that is Tasks 2–5. Do not commit yet; Task 2 commits with the formula.

---

### Task 2: Formula, aggregation and the API's domain tests

**Files:**
- Modify: `api/src/domain/formula.ts`, `api/src/domain/formula.test.ts`
- Modify: `api/src/domain/aggregate.ts`, `api/src/domain/aggregate.test.ts`
- Modify: `api/src/domain/dataset.ts`, `api/src/domain/fixtures.ts`
- Modify: `api/src/domain/snapshot.test.ts:24`, `api/src/domain/review.test.ts`, `api/src/domain/review.ts` (type name only), `api/src/domain/snapshot.ts` (type name only if it names the tuple)

**Interfaces:**
- Consumes: `ScoreTuple`, `FactorId` from Task 1.
- Produces: `FACTOR_WEIGHTS: Readonly<Record<FactorId, number>>`, `totalOf(values: FactorValues): number`, `DEPRECATED_GRADE: Grade = 'D'`, `FACTOR_ORDER` (4 ids), `tuplesFor`, `averageScores`, `gradeForTuples`; `ScoreRow` gains `outlook: number`; `tuple(row)` returns a `ScoreTuple`.

- [ ] **Step 1: Failing formula tests.** Replace the `totalOf` describe in `api/src/domain/formula.test.ts` with:

```ts
describe('totalOf', () => {
  it('weights the four factors 40/25/25/10 and scales onto 3 to 21', () => {
    expect(totalOf({ capability: 7, ux: 7, cost: 7, outlook: 7 })).toBe(21);
    expect(totalOf({ capability: 1, ux: 1, cost: 1, outlook: 1 })).toBe(3);
    expect(totalOf({ capability: 5.5, ux: 5, cost: 4, outlook: 5 })).toBeCloseTo(14.85, 10);
  });

  it('lets the weights, not the sum, decide the notch', () => {
    // 7/1/1/7: the old sum was 9 (BB-); weighted it is 3 x (2.8 + 0.25 + 0.25 + 0.7) = 12 (BBB-).
    expect(gradeForTotal(totalOf({ capability: 7, ux: 1, cost: 1, outlook: 7 }))).toBe('BBB-');
    // 1/7/7/1: the old sum was 15 (A-); weighted it is 3 x (0.4 + 1.75 + 1.75 + 0.1) = 12 (BBB-).
    expect(gradeForTotal(totalOf({ capability: 1, ux: 7, cost: 7, outlook: 1 }))).toBe('BBB-');
  });

  it('exposes the weights, which sum to one', () => {
    expect(Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(DEPRECATED_GRADE).toBe('D');
  });
});
```

and the import to `import { DEPRECATED_GRADE, FACTOR_WEIGHTS, gradeForTotal, totalOf } from './formula.ts';`.

- [ ] **Step 2: Run to see them fail.** `npx vitest run api/src/domain/formula.test.ts` → FAIL (`FACTOR_WEIGHTS` undefined).

- [ ] **Step 3: Implement the formula.** In `api/src/domain/formula.ts` replace everything after `TOTAL_TO_GRADE` (the `WITHDRAWN_GRADE` and `totalOf` parts) with:

```ts
export const DEPRECATED_GRADE: Grade = 'D';

/** Share of each factor in the grade. The site never shows these, or any total. */
export const FACTOR_WEIGHTS: Readonly<Record<FactorId, number>> = {
  capability: 0.4,
  ux: 0.25,
  cost: 0.25,
  outlook: 0.1,
};

const FACTOR_IDS = Object.keys(FACTOR_WEIGHTS) as FactorId[];

/** The weights in hundredths, so whole scores give whole units and the arithmetic stays exact. */
const WEIGHT_UNITS: Readonly<Record<FactorId, number>> = { capability: 40, ux: 25, cost: 25, outlook: 10 };

/** 40·capability + 25·ux + 25·cost + 10·outlook: an integer for whole scores. */
export function weightedUnits(scores: FactorValues): number {
  return FACTOR_IDS.reduce((acc, id) => acc + WEIGHT_UNITS[id] * scores[id], 0);
}

/** Weighted mean of the four factors, scaled by 3 so it runs 3 to 21 like the old three-factor sum. */
export function totalOf(scores: FactorValues): number {
  return (3 * weightedUnits(scores)) / 100;
}
```

`FACTOR_WEIGHTS` stays exported for the tests and the docs; `WEIGHT_UNITS` is what the arithmetic uses, so `totalOf` of whole scores is a single correctly rounded division (no `21.000000000000004`), and a mean that is exactly `x.5` in real arithmetic is exactly `x.5` as a double, so `Math.round` can never drop it a notch. (The cloud review of the plan found the float-noise failure; the implementer's first version rounded to ten decimals instead, which this replaces.)

and change the import to `import type { FactorId, FactorValues, Grade } from '../../../src/domain/types.ts';`. Keep `gradeForTotal` as is.

- [ ] **Step 4: Aggregation.** In `api/src/domain/aggregate.ts`:
  - imports: `import { DEPRECATED_GRADE, gradeForTotal, totalOf } from './formula.ts';` and `ScoreTuple` instead of `ScoreTriple`;
  - `export const FACTOR_ORDER: readonly FactorId[] = ['capability', 'ux', 'cost', 'outlook'];` with the comment "Position of each factor inside a ScoreTuple.";
  - rename `triplesFor` → `tuplesFor` (parameter and return types `ScoreTuple[]`), `averageScores(tuples: readonly ScoreTuple[])`;
  - replace `gradeForTriples` with:

```ts
/** Grade from the unrounded mean of each rater's weighted total, so display rounding never moves a notch. */
export function gradeForTuples(artifact: Artifact, tuples: readonly ScoreTuple[]): RatingPoint['grade'] {
  if (artifact.status === 'retired') return DEPRECATED_GRADE;
  // Integer units summed first, one division at the end: an exact x.5 mean stays exactly x.5.
  const units = tuples.reduce((acc, tuple) => {
    const values = {} as FactorValues;
    FACTOR_ORDER.forEach((id, i) => {
      values[id] = tuple[i] ?? 0;
    });
    return acc + weightedUnits(values);
  }, 0);
  return gradeForTotal((3 * units) / (100 * tuples.length));
}
```

and `FACTOR_ORDER` is derived, not written twice: `export const FACTOR_ORDER: readonly FactorId[] = FACTORS.map((factor) => factor.id);` with `import { FACTORS } from '../../../src/data/factors.ts';` (the API already imports `FACTORS` in `draft-why.ts`), so the tuple position order has one source for the UI and the server.

  - in `pointFor`, use `tuplesFor` and `gradeForTuples`.
  - `src/domain/api-types.ts`, `api/src/domain/review.ts`, `api/src/domain/snapshot.ts`, `api/src/functions/*.ts`, `src/rating-ui/*.ts`: rename the type `ScoreTriple` → `ScoreTuple` wherever imported (`rg -l ScoreTriple src api db scripts` lists them; a global search-and-replace of the identifier is safe).

- [ ] **Step 5: Dataset and fixtures.** In `api/src/domain/dataset.ts`: add `outlook: number;` after `cost: number;` in `ScoreRow`; rename `triple` to:

```ts
export function tuple(row: Pick<ScoreRow, 'capability' | 'ux' | 'cost' | 'outlook'>): ScoreTuple {
  return [row.capability as Score, row.ux as Score, row.cost as Score, row.outlook as Score];
}
```

and use it in `assembleDataset` (`card.scores[row.artifactId] = tuple(row);`). In `api/src/domain/fixtures.ts` change `row` to take `scores: [number, number, number, number]`, destructure `[capability, ux, cost, outlook]`, include `outlook` in the object, and set the rows to:

```ts
  row('2026-Q3', 1, 'lakehouse', [6, 5, 4, 6]),
  row('2026-Q3', 2, 'lakehouse', [5, 5, 4, 4]),
  row('2026-Q3', 1, 'legacy', [7, 7, 7, 7]),
  row('2026-Q4', 1, 'lakehouse', [7, 7, 7, 7]),
  row('2027-Q1', 1, 'mcp-server', [4, 4, 4, 4]),
```

Expected values from these fixtures (used by `snapshot.test.ts`, `review.test.ts`, `admin-rounds.test.ts`): Q3 lakehouse scores `{ capability: 5.5, ux: 5, cost: 4, outlook: 5 }`, 2 raters, grade `A-` (total 14.85); Q4 lakehouse `{ 7, 7, 7, 7 }` → `AAA`; legacy → `D`; Q1 mcp-server `{ 4, 4, 4, 4 }` → `BBB-` (total 12).

- [ ] **Step 6: Aggregate tests.** In `api/src/domain/aggregate.test.ts`: the `rounds` fixture tuples become `lakehouse: [7, 7, 7, 7]` (Q4), `lakehouse: [6, 5, 4, 6]` and `legacy: [7, 7, 7, 7]` (ann, Q3), `lakehouse: [5, 5, 4, 4]` (bo, Q3), `fresh: [4, 4, 4, 4]` (Q1); the type import `ScoreTuple`. Update expectations:
  - "averages each factor…": `expect(q3?.scores).toEqual({ capability: 5.5, ux: 5, cost: 4, outlook: 5 });` grade stays `'A-'`.
  - six-raters test: `card('a', [4, 4, 4, 4])` and `[5, 5, 5, 5]`; `expect(point?.scores).toEqual({ capability: 4.8, ux: 4.8, cost: 4.8, outlook: 4.8 });` grade stays `'A-'` (3 × 4.8333 = 14.5).
  - rename the retired test to `'grades retired items D whatever the scores'` expecting `'D'`.
  - add the test the averaging review found missing (p4-averaging-check.md): an item scored by a subset of a round's raters averages over that subset only:

```ts
  it('averages an item over the raters who scored it, not every rater in the round', () => {
    const card = (rater: string, scores: Record<string, ScoreTuple>) => ({
      rater,
      submittedAt: '2026-06-30T00:00:00Z',
      scores,
    });
    const round: RoundData = {
      round: { id: '2026-Q3', label: 'Q3 2026', status: 'published', publishedOn: '2026-07-01' },
      notes: {},
      scorecards: [
        card('a', { lakehouse: [7, 7, 7, 7], fresh: [1, 1, 1, 1] }),
        card('b', { lakehouse: [7, 7, 7, 7], fresh: [3, 3, 3, 3] }),
        card('c', { lakehouse: [7, 7, 7, 7], fresh: [5, 5, 5, 5] }),
        card('d', { lakehouse: [1, 1, 1, 1] }),
        card('e', { lakehouse: [1, 1, 1, 1] }),
      ],
    };
    const byId = new Map(buildRatings([lakehouse, fresh], [round]).map((r) => [r.artifact.id, r]));
    expect(byId.get('fresh')?.current.raters).toBe(3);
    expect(byId.get('fresh')?.current.scores).toEqual({ capability: 3, ux: 3, cost: 3, outlook: 3 });
    expect(byId.get('lakehouse')?.current.raters).toBe(5);
    expect(byId.get('lakehouse')?.current.scores).toEqual({ capability: 4.6, ux: 4.6, cost: 4.6, outlook: 4.6 });
  });
```
  - `api/src/domain/snapshot.test.ts:24`: `toBe('D')`. In `snapshot.test.ts` and `review.test.ts`, add `outlook` to every expected `scores` object using the fixture values above (Q3 lakehouse outlook 5, Q4 7, Q1 4) and apply the mechanical rule to any literal tuples.

- [ ] **Step 7: Run the domain tests.**

Run: `npx vitest run api/src/domain`
Expected: PASS. Then `npm run typecheck` — remaining errors must be only in `validate.ts`, `repo/scores.ts`, `rating-ui`, components and tests not yet touched (Tasks 3–5). If `src/data/index.ts` errors on `FactorValues`, it is a type-only fix: no code reads factor keys there.

- [ ] **Step 8: Commit Tasks 1–2.**

```powershell
git add src/domain src/styles src/components/*.module.css src/rating-ui/ScoreMatrix.module.css api/src/domain src/domain/api-types.ts
git commit -m "Four factors and five bands in the types; weighted 40/25/25/10 formula; D replaces E"
```

(If `git status` shows other files already touched by the type rename, add them too; the tree need not typecheck at this commit, but every test file under `src/domain` and `api/src/domain` must pass.)

---

### Task 3: Validation, SQL, schema, API route tests

**Files:**
- Modify: `api/src/lib/validate.ts:36-56`, `api/src/lib/validate.test.ts:30-55`
- Modify: `api/src/repo/scores.ts`
- Modify: `db/schema.sql:74-84`
- Modify (mechanical rule): `api/src/functions/rater.test.ts`, `api/src/functions/admin-rounds.test.ts`, `api/src/repo/rounds.test.ts`, `api/src/integration.test.ts:235-246`

**Interfaces:**
- Consumes: `ScoreTuple`, `tuple()` from Task 2.
- Produces: `validateScores(raw, knownIds): { scores: Record<string, ScoreTuple>; errors: string[] }` requiring four entries; `replaceScorecard` writes `outlook`; `toTuples(rows)`.

- [ ] **Step 1: Failing validation tests.** In `api/src/lib/validate.test.ts` replace the first two `validateScores` tests with:

```ts
  it('keeps whole 1 to 7 four-score cards for known items', () => {
    expect(validateScores({ notebook: [7, 1, 4, 6] }, known)).toEqual({
      scores: { notebook: [7, 1, 4, 6] },
      errors: [],
    });
  });

  it('reports unknown items and bad cards, including three- and five-entry ones', () => {
    const { scores, errors } = validateScores(
      { ghost: [5, 5, 5, 5], notebook: [0, 5, 5, 5], pipeline: [5, 5, 5], spare: [5, 5, 5, 5, 5] },
      new Set([...known, 'spare']),
    );
    expect(scores).toEqual({});
    expect(errors).toEqual([
      'Unknown item "ghost". Reload the page to get the current list.',
      '"notebook" needs four whole scores from 1 to 7.',
      '"pipeline" needs four whole scores from 1 to 7.',
      '"spare" needs four whole scores from 1 to 7.',
    ]);
  });
```

and in the "at most ten problems" test use `[5, 5, 5, 5]`.

- [ ] **Step 2: Run to see them fail.** `npx vitest run api/src/lib/validate.test.ts` → FAIL ("needs three").

- [ ] **Step 3: Validation.** In `api/src/lib/validate.ts`: import `ScoreTuple`; change the doc comment to `{ itemId: [c, u, k, o] }`; return type `Record<string, ScoreTuple>`; replace the inner check with:

```ts
    if (!Array.isArray(tuple) || tuple.length !== 4 || !tuple.every(isScore)) {
      errors.push(`"${id}" needs four whole scores from 1 to 7.`);
      continue;
    }
    const [capability, ux, cost, outlook] = tuple as [Score, Score, Score, Score];
    scores[id] = [capability, ux, cost, outlook];
```

(renaming the loop variable from `triple` to `tuple`).

- [ ] **Step 4: SQL.** In `api/src/repo/scores.ts`: `COLUMNS` lists `s.capability, s.ux, s.cost, s.outlook, s.updated_at AS updatedAt`; import `tuple` instead of `triple` and rename `toTriples` → `toTuples` (update its two callers: `lastPublishedCard` here and `rg -n toTriples api db` elsewhere); in `replaceScorecard` destructure `[capability, ux, cost, outlook]`, add `params[\`o${i}\`] = outlook;`, the row template `(@roundId, @userId, @a${i}, @c${i}, @u${i}, @k${i}, @o${i})`, and the INSERT column list `(round_id, user_id, artifact_id, capability, ux, cost, outlook)`.

- [ ] **Step 5: Schema.** In `db/schema.sql`, inside the `CREATE TABLE dbo.scores` add after the `cost` line:

```sql
  outlook tinyint NOT NULL CONSTRAINT ck_scores_outlook CHECK (outlook BETWEEN 1 AND 7),
```

and after that table's `GO` add one batch:

```sql
-- Outlook (Plan 4). The default lets rows written by an API from before the column (the deploy window) and rows from
-- before the migration exist; the API always writes the column, so the default never applies to a real save.
IF COL_LENGTH('dbo.scores', 'outlook') IS NULL
ALTER TABLE dbo.scores ADD outlook tinyint NOT NULL CONSTRAINT df_scores_outlook DEFAULT 4
  CONSTRAINT ck_scores_outlook CHECK (outlook BETWEEN 1 AND 7);
GO

-- A database migrated by an earlier draft of this batch dropped the default; put it back.
IF OBJECT_ID('dbo.df_scores_outlook', 'D') IS NULL
ALTER TABLE dbo.scores ADD CONSTRAINT df_scores_outlook DEFAULT 4 FOR outlook;
GO
```

The default is kept on purpose (cloud review of the plan): the schema is applied to production before the new API is deployed, and the old API's `INSERT` names no `outlook`, so dropping the default would make every save fail during the deploy window. The `CREATE TABLE` branch for a fresh database carries the same default for consistency: `outlook tinyint NOT NULL CONSTRAINT df_scores_outlook DEFAULT 4 CONSTRAINT ck_scores_outlook CHECK (outlook BETWEEN 1 AND 7),`.

Run: `npm run db:apply` (against `fcr-dev` from `api/local.settings.json`). Expected: `Applied 16 schema batches.` Run it twice; the second run must also succeed (idempotent).

- [ ] **Step 6: Route and repo tests.** Apply the mechanical rule to `api/src/functions/rater.test.ts`, `api/src/functions/admin-rounds.test.ts`, `api/src/repo/rounds.test.ts` and `api/src/integration.test.ts` (`[5, 6, 7]` → `[5, 6, 7, 7]` in both places, and the breakdown expectation). Where a route test asserts a review `scores` object or a grade computed from the fixtures, use the Task 2 Step 5 values. Where a test asserts the 400 text, use "needs four whole scores from 1 to 7.".

- [ ] **Step 7: Run the API tests.**

Run: `npx vitest run api`
Expected: PASS (the opt-in DB tests stay skipped). `npm run typecheck` — remaining errors only under `src/rating-ui`, `src/components`, `src/admin`, `scripts`.

- [ ] **Step 8: Commit.**

```powershell
git add api/src/lib api/src/repo api/src/functions api/src/integration.test.ts db/schema.sql
git commit -m "API: four-score cards; outlook column; weighted review and snapshot values"
```

---

### Task 4: Factors, draft helpers and the rating matrix

**Files:**
- Modify: `src/data/factors.ts`
- Modify: `src/rating-ui/draft.ts`, `src/rating-ui/draft.test.ts`
- Modify: `src/rating-ui/ScoreMatrix.tsx`, `src/rating-ui/ScoreMatrix.module.css:63`
- Modify: `src/rating-ui/ScorecardEditor.tsx:263-267`
- Modify (mechanical rule): `src/rating-ui/save.test.ts`, `src/rating-ui/ScorecardEditor.test.ts`, `src/rating-ui/ScorecardEditor.dom.test.ts`, `src/rating-ui/usePersistentDraft.test.ts`, `src/admin/RaterCardEditor.dom.test.ts`, `src/admin/AdminPage.dom.test.ts`, `src/admin/PublishTab.dom.test.ts`, `src/admin/ReviewTab.dom.test.ts`, `src/admin/ReviewTab.test.ts`, `src/account/logout.test.ts`

**Interfaces:**
- Produces: `FACTORS` with four entries (ids `capability, ux, cost, outlook`); `type DraftTuple = readonly [DraftScore, DraftScore, DraftScore, DraftScore]`; `EMPTY_TUPLE`; `isComplete(t): t is ScoreTuple`; `draftFromValues` over `FACTORS`.

- [ ] **Step 1: Failing draft tests.** In `src/rating-ui/draft.test.ts` add:

```ts
  it('treats a card as complete only with all four factors set', () => {
    expect(isComplete([5, 5, 5, null])).toBe(false);
    expect(isComplete([5, 5, 5, 5])).toBe(true);
    expect(isBlank(EMPTY_TUPLE)).toBe(true);
    expect(EMPTY_TUPLE).toHaveLength(4);
  });

  it('seeds four sliders from averaged values', () => {
    expect(draftFromValues({ notebook: { capability: 6.4, ux: 5.5, cost: 4.4, outlook: 2.6 } })).toEqual({
      notebook: [6, 6, 4, 3],
    });
  });
```

(import `EMPTY_TUPLE`, `draftFromValues`, `isBlank`, `isComplete`), and apply the mechanical rule to the file's other literals (`[a, b, c]` → `[a, b, c, c]`, `[a, b, null]` → `[a, b, null, null]` for partial rows, `EMPTY_TRIPLE` → `EMPTY_TUPLE`).

- [ ] **Step 2: Run to see them fail.** `npx vitest run src/rating-ui/draft.test.ts` → FAIL.

- [ ] **Step 3: Factors.** Append to `FACTORS` in `src/data/factors.ts`:

```ts
  {
    id: 'outlook',
    label: 'Outlook',
    question: 'Where is it headed over the next year?',
    low: 'Stalled or on its way out',
    high: 'Clear momentum and investment',
  },
```

- [ ] **Step 4: Draft helpers.** In `src/rating-ui/draft.ts`: import `FACTORS` from `'../data/factors'` and `ScoreTuple`; `export type DraftTuple = readonly [DraftScore, DraftScore, DraftScore, DraftScore];`, `Draft = Readonly<Record<string, DraftTuple>>`, `export const EMPTY_TUPLE: DraftTuple = [null, null, null, null];`, `isComplete(tuple: DraftTuple): tuple is ScoreTuple`, `summarize` doc "some but not all four factors set"; `draftFromValues`:

```ts
export function draftFromValues(values: Readonly<Record<string, FactorValues>>): Draft {
  const draft: Record<string, DraftTuple> = {};
  for (const [id, v] of Object.entries(values)) {
    draft[id] = FACTORS.map((factor) => toScore(v[factor.id])) as [Score, Score, Score, Score];
  }
  return draft;
}
```

and `isRow` (near line 90) must require `Array.isArray(value) && value.length === 4` with each entry `null` or a whole 1–7 number. Rename every `DraftTriple` / `EMPTY_TRIPLE` / `ScoreTriple` use in `src/rating-ui/*.ts(x)`, `src/admin/*.tsx`, `src/rate/*.tsx` (`rg -l "DraftTriple|EMPTY_TRIPLE|ScoreTriple" src`).

- [ ] **Step 5: Matrix.** In `src/rating-ui/ScoreMatrix.tsx`: `setAt` builds `const next = [...tuple] as [DraftScore, DraftScore, DraftScore, DraftScore];`; the reference line becomes

```tsx
          <span className={styles.reference}>
            {referenceLabel}: {FACTORS.map((factor) => formatScore(reference[factor.id])).join(' · ')}
          </span>
```

the partial note reads `Set all four, or clear`; `EMPTY_TUPLE` replaces `EMPTY_TRIPLE`. In `src/rating-ui/ScoreMatrix.module.css:63` change `repeat(3, minmax(0, 1fr))` to `repeat(4, minmax(0, 1fr))`.

- [ ] **Step 6: Helper sentence.** In `src/rating-ui/ScorecardEditor.tsx` the hint paragraph becomes:

```tsx
      <p className={styles.hint}>
        Drag or click a slider to set it; arrow keys adjust it and Enter sets an untouched one. Leave an item blank to skip
        it, or clear everything and save to withdraw your card. Your four scores combine into the item's grade; the public
        site shows the grade and the averaged factor scores, never a total. Only the admin sees individual cards; the site
        shows averages once {round.label} is published.
      </p>
```

- [ ] **Step 6b: Stored drafts from before Outlook.** `parseStoredDraft`/`isRow` upgrade a valid 3-entry row `[a, b, c]` to the partial row `[a, b, c, null]` instead of discarding the whole stored draft; rows of any other length stay invalid. Two tests in `draft.test.ts` (an upgraded 3-entry draft; 2- and 5-entry rows rejected). Cloud review of the plan: without this a rater's unsaved draft vanishes on the first load after the release.

- [ ] **Step 7: Other front-end tests.** Apply the mechanical rule to the files listed above (object literals included: `src/admin/PublishTab.test.ts:16`). In `ScorecardEditor.dom.test.ts` and `RaterCardEditor.dom.test.ts`, where a test sets sliders by factor label, add the fourth (`Outlook`) where the test expects a complete card, and where it asserts the partial note, expect `Set all four, or clear`.

- [ ] **Step 8: Run the front-end tests and typecheck.**

Run: `npx vitest run src; npm run typecheck`
Expected: PASS except `src/components` tests touched in Task 5 (if any fail on `'E'` or band names, they are Task 5's). Typecheck errors only under `src/components`, `src/admin/ReviewTab.tsx`, `scripts`.

- [ ] **Step 9: Commit.**

```powershell
git add src/data/factors.ts src/rating-ui src/admin src/account src/rate
git commit -m "Rating UI: Outlook as the fourth factor; four-slider rows; helper sentence"
```

---

### Task 5: Public site and admin review display

**Files:**
- Modify: `src/components/HowItWorks.tsx`, `src/components/HowItWorks.module.css:36-40,119-123`
- Modify: `src/components/RatingHistory.tsx`, `src/components/RatingHistory.module.css` (the `[data-kind='withdrawn']` selector, if present)
- Modify: `src/admin/ReviewTab.tsx:342-366`
- Verify unchanged but working: `FactorBars.tsx`, `ScaleLegend.tsx`, `DistributionBar.tsx`, `HistorySparkline.tsx`, `GradeBadge.tsx`, `SiteHeader.tsx`, `WorkloadSection.tsx` (all iterate `FACTORS` / `BAND_ORDER`)

**Interfaces:**
- Consumes: `FACTORS` (4), `BAND_META`, `BAND_ORDER`, `Grade 'D'`.

- [ ] **Step 1: Failing DOM test for the legend and copy.** Create `src/components/HowItWorks.dom.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { render } from '../test/dom';
import { HowItWorks } from './HowItWorks';
import { ScaleLegend } from './ScaleLegend';

describe('HowItWorks', () => {
  it('lists four factors, four bands and the Deprecated grade', () => {
    const root = render(createElement(HowItWorks));
    const text = root.textContent ?? '';
    expect(text).toContain('four factors');
    expect(text).toContain('Outlook');
    expect(text).toContain('Where is it headed over the next year?');
    expect(text).toContain('Low investment grade');
    expect(text).toContain('Deprecated');
    expect(text).not.toContain('Withdrawn');
    expect(text).not.toMatch(/weight|out of 21|\b21\b/);
  });
});

describe('ScaleLegend', () => {
  it('shows five bands ending in D', () => {
    const root = render(createElement(ScaleLegend));
    const text = root.textContent ?? '';
    expect(text).toContain('Low investment grade');
    expect(text).toContain('Deprecated');
    expect(text.trim().endsWith('D')).toBe(true);
  });
});
```

Check `src/test/dom.ts` for the actual `render` helper's name and signature (it is the harness the other `*.dom.test.ts` files use) and adjust the import if it differs.

- [ ] **Step 2: Run to see it fail.** `npx vitest run src/components/HowItWorks.dom.test.ts` → FAIL ("four factors" missing).

- [ ] **Step 3: HowItWorks.** In `src/components/HowItWorks.tsx`:
  - `const BANDS = ['investment', 'lowInvestment', 'speculative', 'distressed'] as const satisfies readonly Band[];`
  - `BAND_COPY` gains `lowInvestment: 'Does the job today, with rough edges or costs to plan around.',`
  - lede: `…on four factors, where {MAX_SCORE} is best. Those scores, along with other factors such as release status and reliability, inform a rating from AAA down to C.`
  - bands text: `The scores and those other factors place an item in one of four bands. Deprecated items sit outside them.`
  - the last block: title `Deprecated`, `<GradeBadge grade="D" size="lg" />`, text `Retired items are rated D. Plan a migration.` (keep the CSS class name `styles.withdrawn` or rename it to `deprecated` in both files; either is fine, be consistent).
  - In `HowItWorks.module.css`: `.factors` and `.bands` use `repeat(4, minmax(0, 1fr))`; inside the existing narrow-width media query (around line 166) add `.factors, .bands { grid-template-columns: repeat(2, minmax(0, 1fr)); }` so four cards wrap to two columns on phones.

- [ ] **Step 4: RatingHistory.** In `src/components/RatingHistory.tsx`: `type ActionKind = 'initiated' | 'upgrade' | 'downgrade' | 'affirmed' | 'deprecated';`, the first `describe` line `if (point.grade === 'D' && previous?.grade !== 'D') return { kind: 'deprecated', label: 'Deprecated' };`, and render the scores over `FACTORS`:

```tsx
        const scoreText = FACTORS.map((factor) => formatScore(point.scores[factor.id])).join(' · ');
        const scoreLabel = FACTORS.map((factor) => `${factor.label} ${formatScore(point.scores[factor.id])}`).join(', ');
        …
              <span className={styles.scores} aria-label={scoreLabel}>
                <span aria-hidden="true">{scoreText}</span>
              </span>
```

(import `FACTORS` from `'../data/factors'`; drop the `capability, ux, cost` destructure). If `RatingHistory.module.css` styles `[data-kind='withdrawn']`, rename it to `deprecated`.

- [ ] **Step 5: ReviewTab.** In `src/admin/ReviewTab.tsx` replace the destructure and the two score spans with:

```tsx
                  const scoreText = FACTORS.map((factor) => formatScore(point.scores[factor.id])).join(' · ');
                  …
                        <span className={styles.cardScores} title={FACTORS.map((factor) => factor.label).join(' · ')}>
                          {scoreText}
                        </span>
```

(import `FACTORS`). The breakdown line already joins the whole tuple.

- [ ] **Step 5b: Hard-coded copy the first draft missed** (cloud review of the plan): `src/components/SiteHeader.tsx:23-24` ("from AAA down to C. Each item is scored 1 to 7 on feature capability, user experience, CU / token cost, and outlook."), `src/components/ArtifactDetail.tsx:32` ("Retired, so it's rated D regardless of scores."), `index.html:9` meta description (four factors, no E). Then `rg -n "\bE\b|three factors|rated E|down to E" src index.html rate.html admin.html` shows no stale copy.

- [ ] **Step 6: Run everything.**

Run: `npm run typecheck; npx vitest run`
Expected: typecheck exit 0 (apart from `scripts/`, Task 6, if it errors on the snapshot type); all tests pass. Then `npx vite build` and check the bundle with patterns that survive minification: `rg -l '21:"AAA"|capability:\.4|outlook:\.1|ux:\.25' dist` → no output (the weights never ship; `boundary.test.ts` still guards the formula file).

- [ ] **Step 7: Commit.**

```powershell
git add src/components src/admin/ReviewTab.tsx
git commit -m "Site: Outlook card, four bands with Low investment grade, D for deprecated"
```

---

### Task 6: Snapshot checks and docs

**Files:**
- Modify: `scripts/snapshot-checks.ts:65`, `scripts/snapshot-checks.test.ts:20` (+ one case)
- Modify: `README.md:63-67`, `docs/superpowers/specs/2026-10-15-login-fabric-backend-design.md:137,141-146`

- [ ] **Step 1: Failing check test.** In `scripts/snapshot-checks.test.ts`: the `point` helper's scores become `{ capability: 5, ux: 4.5, cost: 6, outlook: 3 }`; add to the table-driven problems test a row:

```ts
    ['a point without outlook', (s) => { delete (s.ratings[0].current.scores as Record<string, unknown>).outlook; }, 'snapshot.ratings[0].current.scores.outlook is missing'],
```

(match the file's existing row format and the exact message shape its `object()` helper produces: check a neighbouring row such as the "unknown grade" one at line 70 and mirror it). Also change any `'E'` grade literal in the file to `'D'`.

- [ ] **Step 2: Run to see it fail.** `npx vitest run scripts` → FAIL.

- [ ] **Step 3: Checks.** `scripts/snapshot-checks.ts:65`: `scores: object({ capability: score, ux: score, cost: score, outlook: score }),`.

- [ ] **Step 4: Docs.** README line 3 lists the four factors ("…**CU / Token Cost**, and **Outlook** (the feature's potential)."). README "How ratings are computed": first bullet "each of the four factors is averaged…", second bullet "The grade comes from the unrounded weighted average total (`api/src/domain/formula.ts`, server-side only; the weights are never published). Retired items are rated D." In the 2026-10-15 spec: line 137 → "The four factors (capability, ux, cost, outlook) stay in code…"; in "Grade math stays server-side" add "Plan 4 (`2026-10-16-outlook-factor-weighted-formula-design.md`) made the total a weighted one and renamed E to D; that spec wins for the factors, the formula and the bands."

- [ ] **Step 5: Run and commit.**

Run: `npm run typecheck; npx vitest run; npm run build` → all green, 650+ tests.

```powershell
git add scripts README.md docs
git commit -m "Snapshot checks require outlook; docs for the weighted formula and D"
```

---

### Task 7: Review round and live data checks

**Files:** none new (fixes go into the files above)

- [ ] **Step 1: Read-only review.** Dispatch a reviewer over `git diff <commit before Task 1>..HEAD` with the spec, asking specifically for: any place still assuming three entries (`length !== 3`, `[c, u, k]`, "three"), any UI text that shows a total or a weight, `isRow` in `draft.ts`, the schema batches' idempotence, and the fixture-derived expectations (Task 2 Step 5 values). Fix what it finds, re-run `npm run typecheck; npx vitest run; npm run build`, commit as "Plan 4 review fixes".

- [ ] **Step 2: Local end to end against `fcr-dev`.** `db:apply` already ran (Task 3). Start the API (`npm run api`, or `func start --port 7076` from `api/` with `FCR_API_TARGET=http://localhost:7076` for Vite) and the site (`npm run dev`); in the browser: log in at `/rate.html` as `p2-rater-a` (password in the fcr-dev notes under `.superpowers/`), set four sliders on one item, save, reload (four values back), then as the admin check the Review tab shows four averages and a grade, and the public dev build (`npm run snapshot` against the local API, then `npm run dev`) shows four bars. Do not commit the dev snapshot. Stop the servers.

- [ ] **Step 3: Integration suite locally.** `powershell -ExecutionPolicy Bypass -File .superpowers\sdd\integration-run-2.ps1 -Pin <HEAD short sha>` (the runbook pins HEAD; it builds the API, starts a host on 7076, runs the 13 tests against `fcr-dev`, cleans up). Expected: 13 passed.

---

### Task 8: Production schema, push, deploy, verify

**Files:** none

- [ ] **Step 1: Production schema.** `. ./infra/names.ps1; npm run db:apply -- --server $sqlServer --database $sqlDatabase` → `Applied 16 schema batches.` `fcr` has no score rows; the default stays so the old API can still save during the deploy window. Read-only check: `node .superpowers/sdd/p3-fcr-state.ts --server $sqlServer --database $sqlDatabase` still shows 78 artifacts, 2026-Q4 open, 0 scorecards.

- [ ] **Step 2: Push.** Both workflows start on the same push and the site usually lands minutes before the API, so for a few minutes the four-slider page talks to the three-entry API (saves get "needs three whole scores" until the API lands; a reload after the API deploy fixes it). Accepted for this release: production has no raters yet and the admin is the only user; push at a quiet moment and do not score during the window. `npm run typecheck; npx vitest run; npm run build; git status --short` clean; `git push origin main`. Watch `api-deploy.yml` (it runs first and then dispatches `deploy.yml`): `gh run watch (gh run list -R pugliabi/fabric-credit-ratings --workflow api-deploy.yml -L 1 --json databaseId --jq '.[0].databaseId') -R pugliabi/fabric-credit-ratings --exit-status`, then the same for `deploy.yml`. Expected: both green; the site run logs "Snapshot unchanged." (nothing published).

- [ ] **Step 3: Live check.** `https://fabriccreditratings.com` How it works shows four factor cards (Outlook last), four bands including "Low investment grade", and the "Deprecated" block with a D badge; the header's rating-scale legend ends in D. At `/admin.html`: the Score tab rows have four sliders and the hint sentence; set four sliders on one item, save, reload, clear it, save again (nothing stays scored); Publish tab still "up to date". Record the result in the ledger, and close the plan with a short note in `.superpowers/sdd/`.

---

## Done When

- `fcr` and `fcr-dev` have `scores.outlook` (default 4 kept for the deploy window); `db:apply` is idempotent at 16 batches.
- A card is four whole 1–7 scores; three- or five-entry cards get the 400 text "needs four whole scores from 1 to 7."
- `totalOf` is the weighted 3-to-21 total; 7/1/1/7 grades BBB-, 7/7/1/1 grades A-; retired items grade D.
- Bands: AAA–A- investment, BBB+–BBB- low investment, BB+–B- speculative, CCC–C distressed, D deprecated; the legend, the distribution bar, the sparkline and the badges use them.
- The rater matrix, the admin review, the history, the factor bars and the How it works section all show four factors from `FACTORS`; no UI shows a total or a weight; `dist/` contains neither the weights nor the formula.
- Snapshot checks require `outlook`; the committed empty snapshot still passes.
- Typecheck, unit suite, build, the local 13-test integration run and both deploys are green; the live site and admin show the new factor and bands.
