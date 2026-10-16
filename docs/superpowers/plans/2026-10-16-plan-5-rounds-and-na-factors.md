# Plan 5: Delete Open Round, Monthly Suggestion, Not-Applicable Factors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin delete the open round (with its scores and notes), have the new-round form suggest the next month, and let the admin mark per item which factors are not applicable so raters score only those and the grade uses the applicable weights scaled up.

**Architecture:** One new admin route (`DELETE admin/rounds/{id}`) and one small repo function; `nextRound` becomes month-based. Applicability lives in the catalog (`artifacts.na_factors`), flows to clients through `Artifact.naFactors`, and is the single input the validator, the matrix, the aggregation and the site use; a not-applicable position in a card is `null`, and the score columns become nullable.

**Tech Stack:** TypeScript, Vitest (unit + `happy-dom` per file), React 19, Azure Functions v4, mssql on Fabric SQL, Vite.

**Spec:** `docs/superpowers/specs/2026-10-16-round-delete-monthly-na-factors-design.md`

## Global Constraints

- Only an `open` round can be deleted; a published one gets 409 "Published rounds can't be deleted. Reopen it first if it must change."; unknown id 404 "Round {id} does not exist."
- Confirm text: "Delete {label} and its {n} scorecards? This cannot be undone." (singular "scorecard" for 1; "Delete {label}? This cannot be undone." for 0). Notice: "{label} was deleted."
- Month ids are `YYYY-MMM` with `MMM` in `JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC`; labels "{Month} {year}" (English month names).
- `na_factors`: comma-separated factor ids in `FACTORS` order, at most three; API field `naFactors: FactorId[]`.
- A not-applicable position in a card is `null`; applicable positions are whole scores 1–7; validation error text: `"{id}" needs whole scores from 1 to 7 for {labels joined with ", "}.` (labels of the applicable factors, in `FACTORS` order).
- Grade over applicable factors only: `total = 3 × Σ(W_i·v_i) / Σ W_i` with `W` in hundredths (40/25/25/10), summed over raters before one division. 7s on every applicable factor give exactly 21.
- UI text: cell "Not applicable"; partial note "Set all {three|four}, or clear" (the count of applicable sliders); review and history "n/a"; FactorBars "Not applicable". No numeric total or weight anywhere.
- Protected API strings unchanged: "The model kept mentioning scores or grades. Write this one by hand." and "Anthropic did not answer in time. Try again."
- Formatting: 2 spaces, single quotes, semicolons, trailing commas, ≤120 chars. `npm run typecheck` and `npx vitest run` green before every commit (the shared types change in Task 3 is self-contained enough that each task's commit typechecks repo-wide; if a task finds otherwise, say so in its report and the controller rules).
- Branch `plan-5-rounds-na` in the main tree; one push at the end after `db:apply` on `fcr-dev` and `fcr`.

## File Structure

```
api/src/repo/rounds.ts                      deleteRound(tx, id)
api/src/functions/admin-rounds.ts           DELETE admin/rounds/{id}
src/admin/rounds.ts (+ test)                nextRound: month-based
src/admin/PublishTab.tsx (+ tests)          Delete round button in the open-round panel
src/domain/types.ts                         Artifact.naFactors; ScoreTuple / FactorValues with null
db/schema.sql                               artifacts.na_factors; nullable score columns
api/src/repo/catalog.ts, api/src/functions/admin-catalog.ts   naFactors read/write/validate
api/src/lib/validate.ts (+ test)            validateScores(raw, artifacts)
api/src/repo/scores.ts, api/src/domain/dataset.ts             nullable positions
api/src/domain/formula.ts, aggregate.ts (+ tests)             applicable-only grade and averages
api/src/lib/draft-why.ts (+ test)           prompt lists applicable factors
src/rating-ui/draft.ts, ScoreMatrix.tsx, ScorecardEditor.tsx (+ tests)   applicability-aware rows
src/admin/catalog-order.ts, catalog-write.ts, CatalogTab.tsx (+ tests)   Not applicable checkboxes
src/admin/ReviewTab.tsx, src/components/FactorBars.tsx, RatingHistory.tsx  "n/a" / "Not applicable"
scripts/snapshot-checks.ts (+ test)         score or null
api/src/integration.test.ts                 one N/A case
README.md                                   round deletion; not-applicable rule
```

Shared helper (Task 3): `applicableFactors(artifact: Pick<Artifact, 'naFactors'>): FactorId[]` in `src/domain/factors-applicable.ts`, importable by both the site and the API (it only imports `FACTORS` and types).

---

### Task 1: Delete an open round (API)

**Files:**
- Modify: `api/src/repo/rounds.ts`
- Modify: `api/src/functions/admin-rounds.ts`
- Test: `api/src/functions/admin-rounds.test.ts` (read how it mocks the repo and `transaction`; follow the same pattern as the reopen tests)

**Interfaces:**
- Produces: `deleteRound(tx: Db, id: string): Promise<void>` (deletes notes, scores, then the round row); route `adminRoundDelete` = `DELETE admin/rounds/{id}` (admin) returning `AdminRound[]`.

- [ ] **Step 1: Failing route tests.** In `admin-rounds.test.ts` add a `describe('adminRoundDelete')` mirroring the reopen tests' mocking style:

```ts
  it('deletes an open round with its scores and notes and returns the rounds', async () => {
    // lockRound resolves { id: '2026-Q4', status: 'open', … }; deleteRound is a mock; listRoundsWithCounts returns [].
    const reply = await call('adminRoundDelete', { params: { id: '2026-Q4' } });
    expect(reply.status).toBe(200);
    expect(deleteRound).toHaveBeenCalledWith(expect.anything(), '2026-Q4');
    expect(markChanged).not.toHaveBeenCalled();
  });

  it('refuses a published round', async () => {
    // lockRound resolves { id: '2026-Q3', label: 'Q3 2026', status: 'published', … }
    const reply = await call('adminRoundDelete', { params: { id: '2026-Q3' } });
    expect(reply.status).toBe(409);
    expect(reply.body).toEqual({ error: "Published rounds can't be deleted. Reopen it first if it must change." });
    expect(deleteRound).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown id', async () => {
    const reply = await call('adminRoundDelete', { params: { id: '1999-Q1' } });
    expect(reply.status).toBe(404);
  });
```

Adapt `call`, the mock names and the fixture shapes to what the file already uses (it has helpers for invoking routes by name with a fake context).

- [ ] **Step 2: Run to see them fail.** `npx vitest run api/src/functions/admin-rounds.test.ts` → FAIL (no such route).

- [ ] **Step 3: Repo.** In `api/src/repo/rounds.ts` add:

```ts
/** Removes an open round and everything in it. Run inside a transaction after lockRound on the same round. */
export async function deleteRound(tx: Db, id: string): Promise<void> {
  const params = { id: varchar(id) };
  await tx.query('DELETE FROM notes WHERE round_id = @id', params);
  await tx.query('DELETE FROM scores WHERE round_id = @id', params);
  await tx.query('DELETE FROM rounds WHERE id = @id', params);
}
```

- [ ] **Step 4: Route.** In `api/src/functions/admin-rounds.ts` (import `deleteRound`), after `adminRoundUpdate`:

```ts
route('adminRoundDelete', 'DELETE', 'admin/rounds/{id}', 'admin', async (ctx) => {
  const round = await requireRound(ctx.params.id);
  await transaction(async (tx) => {
    const current = await lockRound(tx, round.id);
    if (!current) throw noSuchRound(round.id);
    if (current.status !== 'open') {
      throw new HttpError(409, "Published rounds can't be deleted. Reopen it first if it must change.");
    }
    // An open round never reached the site, so site_state is not stamped.
    await deleteRound(tx, current.id);
  });
  return listRoundsWithCounts(db);
});
```

- [ ] **Step 5: Run and commit.** `npx vitest run api/src/functions/admin-rounds.test.ts` → PASS; `npm run typecheck` 0.

```powershell
git add api/src/repo/rounds.ts api/src/functions/admin-rounds.ts api/src/functions/admin-rounds.test.ts
git commit -m "API: delete an open round with its scores and notes"
```

---

### Task 2: Delete round in the Publish tab; monthly suggestion

**Files:**
- Modify: `src/admin/rounds.ts`, `src/admin/rounds.test.ts`
- Modify: `src/admin/PublishTab.tsx` (the `OpenRound`/`PublishForm` panel gets a secondary button), `src/admin/PublishTab.test.ts` or `PublishTab.dom.test.ts` (whichever tests the panel)
- Modify: `src/admin/NewRoundForm.tsx` only if it formats the suggestion itself (it calls `nextRound`; check)

**Interfaces:**
- Consumes: `DELETE /admin/rounds/:id` from Task 1 via `api<AdminRound[]>('DELETE', …)`.
- Produces: `nextRound(rounds, today)` returning month ids/labels; `MONTHS` constant exported from `rounds.ts`.

- [ ] **Step 1: Failing `nextRound` tests.** Replace the quarter expectations in `src/admin/rounds.test.ts` with:

```ts
describe('nextRound', () => {
  const today = '2026-10-16';
  it('suggests the month after the latest month round', () => {
    expect(nextRound([round('2026-NOV')], today)).toEqual({ id: '2026-DEC', label: 'December 2026' });
    expect(nextRound([round('2026-DEC')], today)).toEqual({ id: '2027-JAN', label: 'January 2027' });
  });
  it('suggests the month after the latest quarter round', () => {
    expect(nextRound([round('2026-Q4')], today)).toEqual({ id: '2027-JAN', label: 'January 2027' });
    expect(nextRound([round('2026-Q1')], today)).toEqual({ id: '2026-APR', label: 'April 2026' });
  });
  it('falls back to the month after today', () => {
    expect(nextRound([], today)).toEqual({ id: '2026-NOV', label: 'November 2026' });
    expect(nextRound([round('2026-H1')], '2026-12-02')).toEqual({ id: '2027-JAN', label: 'January 2027' });
  });
});
```

(`round(id)` is a tiny fixture helper: `{ id, label: id, status: 'published', publishedOn: null }`.)

- [ ] **Step 2: Run to see them fail.** `npx vitest run src/admin/rounds.test.ts` → FAIL.

- [ ] **Step 3: Implement.** Replace `nextRound` in `src/admin/rounds.ts`:

```ts
export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
];

/** { year, month (1-12) } of the period after the latest round, or after `today` when no round id can be read. */
function nextPeriod(rounds: readonly Round[], today: string): { year: number; month: number } {
  const latest = rounds.map((round) => round.id).sort().at(-1) ?? '';
  const month = /^(\d{4})-([A-Z]{3})$/.exec(latest);
  const quarter = /^(\d{4})-Q([1-4])$/.exec(latest);
  let year = Number(today.slice(0, 4));
  let next = Number(today.slice(5, 7)) + 1;
  if (month && MONTHS.includes(month[2] as (typeof MONTHS)[number])) {
    year = Number(month[1]);
    next = MONTHS.indexOf(month[2] as (typeof MONTHS)[number]) + 2;
  } else if (quarter) {
    year = Number(quarter[1]);
    next = Number(quarter[2]) * 3 + 1;
  }
  if (next > 12) {
    next = 1;
    year += 1;
  }
  return { year, month: next };
}

/** After 2026-OCT comes { id: '2026-NOV', label: 'November 2026' }; after 2026-Q4, January 2027. */
export function nextRound(rounds: readonly Round[], today: string): { id: string; label: string } {
  const { year, month } = nextPeriod(rounds, today);
  return { id: `${year}-${MONTHS[month - 1]}`, label: `${MONTH_NAMES[month - 1]} ${year}` };
}
```

Update `roundIdProblem`'s text to `'Round ids look like 2026-NOV or 2027-Q1.'` and the matching server text in `api/src/functions/admin-rounds.ts` (`'Round ids look like 2027-Q1.'` → `'Round ids look like 2026-NOV or 2027-Q1.'`) and any test asserting it.

- [ ] **Step 4: Failing Publish tab test.** In the file that tests the open-round panel, add: rendering with an open round with 2 scorecards shows a "Delete round" button; clicking it calls `confirm` with "Delete Q4 2026 and its 2 scorecards? This cannot be undone."; when `confirm` returns true the test's fake `api` receives `('DELETE', '/admin/rounds/2026-Q4')`, `onRounds` is called with the answer, and the notice "Q4 2026 was deleted." is shown; with 0 scorecards the question is "Delete Q4 2026? This cannot be undone."; a `confirm` of false sends nothing. Follow the file's existing patterns for `confirm` stubbing and `fakeApi`.

- [ ] **Step 5: Implement the button.** In `PublishTab.tsx`, inside `PublishTab` add:

```tsx
  const remove = async (round: AdminRound) => {
    if (busy) return;
    const cards =
      round.scorecards === 0
        ? ''
        : ` and its ${round.scorecards} ${round.scorecards === 1 ? 'scorecard' : 'scorecards'}`;
    if (!confirm(`Delete ${round.label}${cards}? This cannot be undone.`)) return;
    setBusy(true);
    setError('');
    setNotice(undefined);
    setAttempt((count) => count + 1);
    try {
      const rounds = await api<AdminRound[]>('DELETE', `/admin/rounds/${round.id}`, undefined, { wakeNotice: true });
      onRounds(rounds);
      setNotice({ title: `${round.label} was deleted.`, text: '' });
    } catch (reason) {
      setError(errorMessage(reason));
      setFailures((count) => count + 1);
    } finally {
      setBusy(false);
    }
  };
```

and pass `onDelete={() => void remove(open)}` and `deleting={busy}` into `OpenRound`/`PublishForm`; render, after the Publish button inside `.fields`:

```tsx
        <button type="button" className={styles.secondary} aria-disabled={busy || deleting} onClick={onDelete}>
          Delete round
        </button>
```

(Thread the two props through whichever component owns the panel; keep `PublishForm`'s exported signature working for its markup tests by making the new props optional.)

- [ ] **Step 6: Run and commit.** `npx vitest run src/admin; npm run typecheck` → green.

```powershell
git add src/admin api/src/functions/admin-rounds.ts api/src/functions/admin-rounds.test.ts
git commit -m "Admin: delete the open round from the Publish tab; monthly round suggestion"
```

---

### Task 3: Applicability in the catalog (types, schema, catalog API, admin checkboxes)

**Files:**
- Modify: `src/domain/types.ts`, `src/domain/api-types.ts`
- Create: `src/domain/factors-applicable.ts` (+ `factors-applicable.test.ts`)
- Modify: `db/schema.sql`
- Modify: `api/src/repo/catalog.ts`, `api/src/functions/admin-catalog.ts` (+ tests)
- Modify: `src/admin/catalog-order.ts` (`ArtifactChanges`, `artifactUpdate`, `artifactBody`), `src/admin/catalog-write.ts` (`addArtifact`), `src/admin/CatalogTab.tsx` (+ tests)
- Modify: `api/src/domain/fixtures.ts`, every test fixture building an `Artifact` literal (add `naFactors: []` where the type now requires it; `rg -n "status: 'ga'|status: 'preview'|status: 'retired'" src api scripts --glob '*.ts' --glob '*.tsx'` lists them)

**Interfaces:**
- Produces: `Artifact.naFactors: FactorId[]`; `applicableFactors(artifact): FactorId[]` and `NA_MAX = 3`; `naFactors` on `POST/PUT /admin/artifacts`; `GET /api/catalog` and the admin catalog return it; schema column `artifacts.na_factors`.
- `ScoreTuple`/`FactorValues` are NOT changed in this task (Task 4), so cards stay all-numbers here.

- [ ] **Step 1: Failing helper tests.** `src/domain/factors-applicable.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applicableFactors, naFactorsProblem, parseNaFactors, serializeNaFactors } from './factors-applicable.ts';

describe('applicable factors', () => {
  it('lists the factors not marked n/a, in FACTORS order', () => {
    expect(applicableFactors({ naFactors: [] })).toEqual(['capability', 'ux', 'cost', 'outlook']);
    expect(applicableFactors({ naFactors: ['cost'] })).toEqual(['capability', 'ux', 'outlook']);
    expect(applicableFactors({ naFactors: ['outlook', 'cost'] })).toEqual(['capability', 'ux']);
  });

  it('round-trips the stored form in FACTORS order', () => {
    expect(serializeNaFactors(['outlook', 'cost'])).toBe('cost,outlook');
    expect(parseNaFactors('')).toEqual([]);
    expect(parseNaFactors('cost,outlook')).toEqual(['cost', 'outlook']);
    expect(parseNaFactors('cost,bogus')).toEqual(['cost']);
  });

  it('refuses unknown ids and marking every factor', () => {
    expect(naFactorsProblem(['cost'])).toBeUndefined();
    expect(naFactorsProblem(['bogus'])).toBe('Unknown factor "bogus".');
    expect(naFactorsProblem(['capability', 'ux', 'cost', 'outlook'])).toBe('At least one factor must apply.');
    expect(naFactorsProblem('cost')).toBe('naFactors must be a list of factor ids.');
  });
});
```

- [ ] **Step 2: Run to see it fail.** `npx vitest run src/domain/factors-applicable.test.ts` → FAIL (module missing).

- [ ] **Step 3: Helper.** `src/domain/factors-applicable.ts`:

```ts
import { FACTORS } from '../data/factors.ts';
import type { FactorId } from './types.ts';

const IDS = FACTORS.map((factor) => factor.id);
/** At most this many factors can be not applicable: at least one must remain. */
export const NA_MAX = IDS.length - 1;

function isFactorId(value: unknown): value is FactorId {
  return typeof value === 'string' && (IDS as string[]).includes(value);
}

/** The factors a rater scores for the item, in FACTORS order. */
export function applicableFactors(artifact: { naFactors: readonly FactorId[] }): FactorId[] {
  return IDS.filter((id) => !artifact.naFactors.includes(id));
}

/** The stored form: ids in FACTORS order, comma-separated, '' for none. Unknown ids are dropped on read. */
export function serializeNaFactors(ids: readonly FactorId[]): string {
  return IDS.filter((id) => ids.includes(id)).join(',');
}

export function parseNaFactors(stored: string): FactorId[] {
  const ids = stored.split(',').filter(isFactorId);
  return IDS.filter((id) => ids.includes(id));
}

/** Why a request's naFactors can't be used, or undefined. */
export function naFactorsProblem(value: unknown): string | undefined {
  if (!Array.isArray(value)) return 'naFactors must be a list of factor ids.';
  const unknown = value.find((id) => !isFactorId(id));
  if (unknown !== undefined) return `Unknown factor "${String(unknown)}".`;
  if (new Set(value).size > NA_MAX) return 'At least one factor must apply.';
  return undefined;
}
```

Add `naFactors: FactorId[];` to `Artifact` in `src/domain/types.ts` (after `status`) with the comment `/** Factors the item is not scored on; see factors-applicable.ts. */`. Run the helper test → PASS. Run `npm run typecheck` and add `naFactors: []` to every `Artifact` literal it reports (fixtures and tests; `api/src/domain/fixtures.ts` too). The `src/data/index.ts` snapshot reader: snapshot artifacts don't carry `naFactors` (the site infers "Not applicable" from `null` scores in Task 6), so where the site builds `Artifact` values from the snapshot, add `naFactors: []` or widen the local type; keep `Snapshot`'s artifact shape unchanged.

- [ ] **Step 4: Schema.** In `db/schema.sql`, in `CREATE TABLE dbo.artifacts` after `status`: `na_factors varchar(40) NOT NULL CONSTRAINT df_artifacts_na_factors DEFAULT '',` and after that table's `GO`:

```sql
IF COL_LENGTH('dbo.artifacts', 'na_factors') IS NULL
ALTER TABLE dbo.artifacts ADD na_factors varchar(40) NOT NULL CONSTRAINT df_artifacts_na_factors DEFAULT '';
GO
```

(The nullable score columns come in Task 4.) `npm run db:apply` twice → "Applied 17 schema batches." both times.

- [ ] **Step 5: Catalog repo and routes.** `api/src/repo/catalog.ts`: `listArtifacts` and `adminCatalog` select `a.na_factors AS naFactors` and map rows through `parseNaFactors` (`{ ...row, naFactors: parseNaFactors(row.naFactors as unknown as string) }`); `ArtifactFields` gains `naFactors: FactorId[]`; `createArtifact`/`updateArtifact` write `na_factors = @naFactors` with `varchar(serializeNaFactors(fields.naFactors))`; `upsertArtifact` (seed path) writes `''`. In `api/src/functions/admin-catalog.ts` `artifactFields` adds:

```ts
    naFactors: naFactorsFrom(body, current),
```

with

```ts
/** PUT without naFactors keeps the current list; POST without it means every factor applies. */
function naFactorsFrom(body: Record<string, unknown>, current?: AdminArtifact): FactorId[] {
  if (body.naFactors === undefined) return current?.naFactors ?? [];
  const problem = naFactorsProblem(body.naFactors);
  if (problem) throw new HttpError(400, problem);
  return body.naFactors as FactorId[];
}
```

(`artifactFields(body, catalog, current?)`; the update route passes `current`.) Tests in `admin-catalog.test.ts`: create with `naFactors: ['cost']` stores `'cost'`; update without the field keeps it; `['bogus']` → 400 `Unknown factor "bogus".`; all four → 400.

- [ ] **Step 6: Admin Catalog tab.** `src/admin/catalog-order.ts`: `ArtifactChanges` gains `naFactors?: FactorId[]`; `artifactUpdate`/`artifactBody` include `naFactors: artifact.naFactors` (overridden by `changes.naFactors`). `catalog-write.ts` `addArtifact` sends `naFactors: []`. In `CatalogTab.tsx`'s `ArtifactRowEditor`, add a cell after the workload select:

```tsx
      <td>
        <fieldset className={styles.naFactors} disabled={busy}>
          <legend className={styles.srOnly}>{`${artifact.name} not applicable`}</legend>
          {FACTORS.map((factor) => (
            <label key={factor.id} className={styles.check}>
              <input
                type="checkbox"
                checked={artifact.naFactors.includes(factor.id)}
                onChange={(event) => {
                  const next = FACTORS.map((f) => f.id).filter((id) =>
                    id === factor.id ? event.target.checked : artifact.naFactors.includes(id),
                  );
                  if (next.length >= FACTORS.length) return;
                  update({ naFactors: next }, [keys.na(artifact.id, factor.id)]);
                }}
                ref={control(keys.na(artifact.id, factor.id))}
                aria-label={`${artifact.name}: ${factor.label} not applicable`}
              />
              {factor.label}
            </label>
          ))}
        </fieldset>
      </td>
```

Add a column heading "Not applicable", a `keys.na(itemId, factorId)` focus key in the tab's key helper, and a small CSS rule for `.naFactors` (inline-flex, wrap, gap 6px). DOM test: a row shows four checkboxes; checking "CU / Token Cost" sends `PUT /admin/artifacts/notebook` with `naFactors: ['cost']`; checking the fourth when three are checked sends nothing.

- [ ] **Step 7: Run and commit.** `npm run typecheck; npx vitest run` → green.

```powershell
git add src/domain db/schema.sql api/src src/admin
git commit -m "Catalog: per-item not-applicable factors (schema, API, admin checkboxes)"
```

---

### Task 4: Cards with not-applicable positions: validation, SQL, formula, aggregation, AI prompt

**Files:**
- Modify: `src/domain/types.ts` (`ScoreTuple`, `FactorValues`), `src/domain/api-types.ts` (no shape change; types follow)
- Modify: `api/src/lib/validate.ts` (+ test), `api/src/functions/rater.ts`, `api/src/functions/admin-rounds.ts` (callers)
- Modify: `db/schema.sql` (nullable score columns), `api/src/repo/scores.ts`, `api/src/domain/dataset.ts`
- Modify: `api/src/domain/formula.ts` (+ test), `api/src/domain/aggregate.ts` (+ test), `api/src/domain/review.ts`, `api/src/domain/snapshot.ts` (types only), `api/src/lib/draft-why.ts` (+ test)

**Interfaces:**
- Produces: `ScoreTuple = readonly [Score | null, Score | null, Score | null, Score | null]`; `FactorValues = Record<FactorId, number | null>`; `validateScores(raw, artifacts: ReadonlyMap<string, Pick<Artifact, 'naFactors'>>)`; `totalOf(values)` ignoring `null` with weights scaled; `gradeForTuples(artifact, tuples)` and `averageScores(tuples, applicable)`.

- [ ] **Step 1: Failing tests.**
  - `validate.test.ts`: with `artifacts = new Map([['notebook', { naFactors: [] }], ['git', { naFactors: ['cost'] }]])`: `{ git: [5, 6, null, 3] }` → `{ git: [5, 6, null, 3] }`; `{ git: [5, 6, 4, 3] }` → error `"git" needs whole scores from 1 to 7 for Feature Capability, User Experience, Outlook.`; `{ git: [5, 6, null, null] }` → same error; `{ notebook: [5, 6, null, 3] }` → `"notebook" needs whole scores from 1 to 7 for Feature Capability, User Experience, CU / Token Cost, Outlook.`; a 3-entry `[5, 6, 3]` for `git` is also accepted as `[5, 6, null, 3]`? **No**: positions are fixed; `[5, 6, 3]` is refused (wrong length). Keep the existing unknown-id and ten-error tests, adapted to the new signature.
  - `formula.test.ts`: `totalOf({ capability: 7, ux: 7, cost: null, outlook: 7 })` → `21`; `{ 4, 4, null, 4 }` → `12`; `{ 7, null, null, 7 }` → `21`; `{ 5.5, 5, null, 5 }` → `toBeCloseTo(3 * (220 + 125 + 50) / 75, 10)` = `15.8`; `weightedUnits` is unchanged for all-applicable values.
  - `aggregate.test.ts`: a `git` artifact `{ naFactors: ['cost'] }` scored `[7, 7, null, 7]` by two raters → point `scores` `{ capability: 7, ux: 7, cost: null, outlook: 7 }`, grade `AAA`; a stored value in a not-applicable position is ignored: `[7, 7, 1, 7]` for the same artifact → still `AAA` and `cost: null`.
  - `draft-why.test.ts`: the prompt for a cost-N/A item lists three factor lines and the sentence `CU / Token Cost does not apply to this item.`; `scoreLine` prints `cu / token cost n/a`.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Types.** In `src/domain/types.ts`: `export type ScoreTuple = readonly [Score | null, Score | null, Score | null, Score | null];` with the comment "null = the factor is not applicable to the item"; `export type FactorValues = Record<FactorId, number | null>;` ("null = not applicable"). `npm run typecheck` now points at every consumer; fix them in this task (site components in Task 6 may need `?? ` handling: use `formatScore(value)` only when `value !== null`, else the text the task specifies).

- [ ] **Step 4: Validation.**

```ts
export function validateScores(
  raw: unknown,
  artifacts: ReadonlyMap<string, Pick<Artifact, 'naFactors'>>,
): { scores: Record<string, ScoreTuple>; errors: string[] } {
  …
  for (const [id, tuple] of Object.entries(raw)) {
    const artifact = artifacts.get(id);
    if (!artifact) { errors.push(`Unknown item "${id}". Reload the page to get the current list.`); continue; }
    const applicable = applicableFactors(artifact);
    const ok =
      Array.isArray(tuple) &&
      tuple.length === FACTOR_IDS.length &&
      FACTOR_IDS.every((factorId, i) =>
        applicable.includes(factorId) ? isScore(tuple[i]) : tuple[i] === null || tuple[i] === undefined,
      );
    if (!ok) {
      const labels = applicable.map((factorId) => FACTOR_LABELS[factorId]).join(', ');
      errors.push(`"${id}" needs whole scores from 1 to 7 for ${labels}.`);
      continue;
    }
    scores[id] = FACTOR_IDS.map((factorId, i) => (applicable.includes(factorId) ? tuple[i] : null)) as [
      Score | null, Score | null, Score | null, Score | null,
    ];
  }
```

with `FACTOR_IDS = FACTORS.map((f) => f.id)` and `FACTOR_LABELS` from `FACTORS` (import `FACTORS` from `'../../../src/data/factors.ts'` as `draft-why.ts` does). Callers: `rater.ts` builds `new Map((await listArtifacts(db)).map((a) => [a.id, a]))`; `admin-rounds.ts` replaces `knownArtifactIds()` with `knownArtifacts()` returning that map (the notes route keeps a `.has` check on it).

- [ ] **Step 5: SQL.** `db/schema.sql`: one idempotent batch per column is overkill; one batch:

```sql
-- Plan 5: a not-applicable factor is stored as NULL (the CHECK constraints already allow NULL).
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.scores') AND name = 'cost' AND is_nullable = 0)
BEGIN
  ALTER TABLE dbo.scores ALTER COLUMN capability tinyint NULL;
  ALTER TABLE dbo.scores ALTER COLUMN ux tinyint NULL;
  ALTER TABLE dbo.scores ALTER COLUMN cost tinyint NULL;
  ALTER TABLE dbo.scores ALTER COLUMN outlook tinyint NULL;
END
GO
```

and in the `CREATE TABLE` branch make the four columns `tinyint NULL` (keep the CHECKs; drop `NOT NULL` and keep `df_scores_outlook`). `npm run db:apply` twice → "Applied 18 schema batches." `api/src/repo/scores.ts`: params bind `null` as is (`Param` allows `null`); `ScoreRow` fields become `number | null`; `dataset.ts` `tuple()` maps `null` through. `replaceScorecard` is unchanged apart from types.

- [ ] **Step 6: Formula and aggregation.** `formula.ts`:

```ts
/** Weighted units over the applicable (non-null) factors, and the weight they carry. */
export function weightedUnits(scores: FactorValues): { units: number; weight: number } {
  let units = 0;
  let weight = 0;
  for (const id of FACTOR_IDS) {
    const value = scores[id];
    if (value === null) continue;
    units += WEIGHT_UNITS[id] * value;
    weight += WEIGHT_UNITS[id];
  }
  return { units, weight };
}

/** Weighted mean of the applicable factors, scaled onto 3 to 21. An item with no applicable factor can't exist. */
export function totalOf(scores: FactorValues): number {
  const { units, weight } = weightedUnits(scores);
  return weight === 0 ? MIN_TOTAL : (3 * units) / weight;
}
```

`aggregate.ts`: `averageScores(tuples, artifact)` returns `null` for `artifact.naFactors` entries and the one-decimal mean of the non-null values otherwise (a `null` among applicable values, from a row written before the flag was cleared, is skipped in that factor's mean; if every value is null for an applicable factor, use `null`); `gradeForTuples(artifact, tuples)`: for each tuple build `FactorValues` with `null` for not-applicable factors, sum `units` and `weight` across tuples, `gradeForTotal((3 * units) / weight)` (guard `weight === 0` → `MIN_TOTAL`). `pointFor` passes `artifact`. `review.ts`: breakdown tuples get `null` in not-applicable positions (`tuple.map((v, i) => artifact.naFactors.includes(FACTOR_ORDER[i]) ? null : v)`), so the Review tab shows "n/a" consistently.

- [ ] **Step 7: AI prompt.** `draft-why.ts`: `scoreLine` prints `n/a` for `null`; `promptFor` lists only applicable factors in the "Scores" block and appends `${label} does not apply to this item.` lines for the others (from the artifact's `naFactors`; `DraftInput.artifact` already carries the artifact).

- [ ] **Step 8: Run everything and commit.** `npm run typecheck; npx vitest run` → green (site components that now see `number | null` may need the Task 6 rendering; if they only pass values through `formatScore`, add a `?? 0`-free guard: render `'n/a'` when null, which Task 6 then styles).

```powershell
git add src/domain db/schema.sql api/src
git commit -m "Cards with not-applicable positions: validation, nullable columns, applicable-only grade"
```

---

### Task 5: Rating UI: applicable sliders only

**Files:**
- Modify: `src/rating-ui/draft.ts` (+ test), `src/rating-ui/ScoreMatrix.tsx` (+ css), `src/rating-ui/ScorecardEditor.tsx` (+ tests), `src/rating-ui/save.ts` if it summarises cards

**Interfaces:**
- Consumes: `Artifact.naFactors`, `applicableFactors`.
- Produces: `isComplete(tuple, artifact)`, `isBlank(tuple)` unchanged, `summarize(draft, artifacts)` using applicability; matrix rows render "Not applicable" cells.

- [ ] **Step 1: Failing tests.** `draft.test.ts`: `isComplete([5, 6, null, 3], { naFactors: ['cost'] })` → true; `isComplete([5, 6, null, 3], { naFactors: [] })` → false; `summarize` with a cost-N/A artifact and draft `[5, 6, null, 3]` → `scores.git = [5, 6, null, 3]`, `rated 1`, `partial []`; with `[5, null, null, 3]` → `partial ['git']`. DOM test: a cost-N/A item renders three sliders and a cell with the text "Not applicable"; setting the three makes the row complete; the partial note after two reads "Set all three, or clear".

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `draft.ts`:

```ts
export function isComplete(tuple: DraftTuple, artifact: { naFactors: readonly FactorId[] }): tuple is ScoreTuple {
  const applicable = applicableFactors(artifact);
  return FACTORS.every((factor, i) => (applicable.includes(factor.id) ? tuple[i] !== null : true));
}
```

(`summarize` passes each artifact; a not-applicable position is forced to `null` in the summary so a stale stored value is never sent.) `ScoreMatrix.tsx` `MatrixRow`: compute `applicable = applicableFactors(artifact)`; render, per factor, either the `ScoreSlider` or `<span className={styles.notApplicable} aria-label={`${artifact.name}, ${factor.label}: not applicable`}>Not applicable</span>`; `complete = isComplete(tuple, artifact)`; the group progress counts complete rows the same way; the partial note: `Set all ${applicable.length === 4 ? 'four' : applicable.length === 3 ? 'three' : applicable.length === 2 ? 'two' : 'one'}, or clear` (a helper `countWord(n)`); `setAt` unchanged. `ScorecardEditor.tsx` hint: "Your scores on the factors that apply combine into the item's grade; …" (keep the rest). `save.ts`/`usePersistentDraft.ts`: wherever `isComplete` is called, pass the artifact (look the artifact up by id from the catalog the editor already holds).

- [ ] **Step 4: Run and commit.** `npm run typecheck; npx vitest run src` → green.

```powershell
git add src/rating-ui
git commit -m "Rating UI: score only the factors that apply to an item"
```

---

### Task 6: Review, site and snapshot checks show "n/a"

**Files:**
- Modify: `src/admin/ReviewTab.tsx` (+ test), `src/components/FactorBars.tsx` (+ css, + dom test), `src/components/RatingHistory.tsx`, `scripts/snapshot-checks.ts` (+ test), `src/data/index.ts` if it reads factor values

- [ ] **Step 1: Failing tests.** `snapshot-checks.test.ts`: a point with `cost: null` is accepted; `cost: 'x'` still refused with the existing message. FactorBars dom test: `{ capability: 6, ux: 5, cost: null, outlook: 4 }` renders three meters and one "Not applicable" cell with the factor label. ReviewTab test: a review item with `cost: null` shows `6 · 5 · n/a · 4` and a breakdown row `Ann 6 · 5 · n/a · 4`.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `snapshot-checks.ts`: `const scoreOrNa = leaf((value) => value === null || (typeof value === 'number' && value >= MIN_SCORE && value <= MAX_SCORE), \`is not a score from ${MIN_SCORE} to ${MAX_SCORE} or null\`);` and use it for the four score keys. `FactorBars.tsx`: when `scores[factor.id] === null` render `<li className={styles.factor} data-na><div className={styles.header}><span className={styles.label}>{factor.label}</span><span className={styles.value}>Not applicable</span></div></li>` (no meter). `RatingHistory.tsx` and `ReviewTab.tsx`: the `scoreText`/`scoreLabel` builders print `n/a` for `null` (`value === null ? 'n/a' : formatScore(value)`); the breakdown line maps `null` → `n/a`. `src/lib/format.ts`: add `export function formatScoreOrNa(value: number | null): string` and use it in the three places.

- [ ] **Step 4: Run, build, commit.** `npm run typecheck; npx vitest run; npx vite build` → green; the bundle grep from Plan 4 (`rg -l '21:"AAA"|capability:\.4|outlook:\.1|ux:\.25|weightedUnits' dist`) prints nothing.

```powershell
git add src scripts
git commit -m "Review, site and snapshot checks: n/a for not-applicable factors"
```

---

### Task 7: Docs, integration case, review round, rollout

**Files:**
- Modify: `README.md` ("How a round works": "Delete round discards an open round and its scores; publishing is the only way a round becomes history." and under "How ratings are computed": "Factors the admin marked not applicable for an item (Catalog tab) are skipped: raters don't score them, the site shows Not applicable, and the grade uses the remaining weights scaled up."), `api/src/integration.test.ts` (one case)

- [ ] **Step 1: Integration case.** After "shows the card in the admin review", add a test that: the admin marks the test item's cost as not applicable (`PUT /api/admin/artifacts/{id}` with the item's current fields plus `naFactors: ['cost']`), the rater's PUT with `[5, 6, null, 3]` is 200 and the review breakdown shows `[5, 6, null, 3]`, a PUT with `[5, 6, 4, 3]` is 400 mentioning "Feature Capability, User Experience, Outlook", and the admin restores `naFactors: []` (in the test's cleanup too, so a failed run never leaves the catalog changed). Note the catalog write stamps `site_state`: the suite's `afterAll` compares `site_state` before/after, so restore first and then assert; if the stamp still moves (it will: `markChanged` sets `changed_at`), record `siteBefore` AFTER the restore in `beforeAll`… simpler: run this case against a throwaway artifact the test creates (`POST /api/admin/artifacts` with `naFactors: ['cost']`) and deletes in `afterAll` before the site check, and accept that `changed_at` moves: assert `site.lastSnapshotAt` unchanged instead of the whole object. Document the choice in the test.

- [ ] **Step 2: Review round.** Dispatch the read-only review over the branch; fix; re-review. Then `integration-run-2.ps1 -Pin <HEAD>` → 14 passed.

- [ ] **Step 3: Rollout.** `npm run db:apply` on `fcr-dev` (done during tasks) and on `fcr` (`. ./infra/names.ps1; npm run db:apply -- --server $sqlServer --database $sqlDatabase` → "Applied 18 schema batches."); read-only state check; merge `--ff-only` to `main`; `git push origin main`; watch `api-deploy.yml` then `deploy.yml`; live check: Publish tab shows "Delete round" on the open round (do NOT click it on production unless the round is a throwaway), the Catalog tab shows the Not applicable checkboxes, mark one item's cost N/A, the Score tab shows "Not applicable" for it, then unmark it; the public How it works is unchanged. Close-out note in `.superpowers/sdd/`.

---

## Done When

- `DELETE /api/admin/rounds/:id` removes an open round with its scores and notes; published rounds get 409; the Publish tab offers Delete round with the confirm text and notice above.
- The new-round form suggests the next month (`2026-NOV` / "November 2026"; after `2026-Q4`, `2027-JAN`).
- `artifacts.na_factors` exists; the admin Catalog tab has per-item Not applicable checkboxes (at most three); `GET /api/catalog` returns `naFactors`.
- Cards store `null` in not-applicable positions; validation requires exactly the applicable scores; the grade uses the applicable weights scaled to 100; averages are `null` for not-applicable factors; the AI prompt lists only applicable factors.
- Raters see only the applicable sliders ("Not applicable" cells); the review, history and factor bars show "n/a" / "Not applicable"; snapshot checks accept `null`.
- Typecheck, unit suite, build, the 14-test integration run and both deploys are green; the live admin shows the new controls.
