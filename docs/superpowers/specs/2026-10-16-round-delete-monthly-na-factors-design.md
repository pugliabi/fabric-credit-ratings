# Delete an open round, monthly round suggestion, not-applicable factors per item

Date: 2026-10-16
Status: approved in conversation. Implementation plan: `docs/superpowers/plans/2026-10-16-plan-5-rounds-and-na-factors.md`.
Builds on `2026-10-15-login-fabric-backend-design.md` and `2026-10-16-outlook-factor-weighted-formula-design.md`; where they differ, this one wins for round deletion, the round suggestion and factor applicability.

## Goal

1. The admin can **delete the open round** (and its scores and notes) so a round can be abandoned and renamed. Publishing stays the only way a round becomes historical; raters still see only the one open round, which is therefore "the active round".
2. The "Start a new round" form suggests the **next month** (`2026-NOV` / "November 2026"); both fields stay editable.
3. The admin can mark, **per item in the catalog**, which factors are **not applicable** (for example CU / Token Cost for Git integration). Raters score only the applicable factors; the grade uses the applicable weights scaled up, so an item with a not-applicable factor can still be AAA; the public site shows "Not applicable" where the bar would be.

## Decisions

| Topic | Decision |
|---|---|
| Delete round | `DELETE /api/admin/rounds/:id` (admin). Only an `open` round can be deleted; a published one gets 409 "Published rounds can't be deleted. Reopen it first if it must change." One transaction: `lockRound`, status check, delete `notes`, `scores`, then the `rounds` row. Returns every round like the other round routes. No `site_state` stamp: an open round never reaches the site |
| Delete in the UI | Publish tab, in the open round's panel, a secondary **Delete round** button with the question "Delete {label} and its {n} scorecards? This cannot be undone." (n from the round counts; "and its scorecards" omitted when 0). Success notice "{label} was deleted."; the panel then shows the Start a new round form |
| Monthly suggestion | `nextRound` suggests the calendar month after the latest round's period: a month id `YYYY-MMM` (`MMM` = JAN…DEC) advances one month; a quarter id `YYYY-Qn` advances to the month after that quarter's last month; anything else falls back to the month after `today`'s month. Id `YYYY-MMM`, label "{Month name} {year}". The id rule (`^\d{4}-[A-Z0-9]{1,3}$`) is unchanged, so quarter ids still work |
| N/A storage | `artifacts.na_factors varchar(40) NOT NULL DEFAULT ''`: comma-separated factor ids in `FACTORS` order (`'cost'`, `'cost,outlook'`). At most three factors; validation refuses unknown ids and all four |
| N/A in the catalog API | `AdminArtifact`, `Artifact` (shared type and `GET /api/catalog`) gain `naFactors: FactorId[]` (empty by default). `POST /api/admin/artifacts` and `PUT /api/admin/artifacts/:id` accept `naFactors`; omitted on PUT keeps the current list. Changing it stamps `site_state` like other catalog edits (it changes the public bars and the grade) |
| N/A in the Catalog tab | Per item, four checkboxes under the heading "Not applicable" with the factor labels, saved with the item like status |
| Card shape | A card tuple keeps four positions; a not-applicable position holds `null`: `ScoreTuple = readonly [Score \| null, Score \| null, Score \| null, Score \| null]`. The `scores` columns become nullable (`ALTER COLUMN … tinyint NULL`; the CHECK constraints already allow NULL). `validateScores` takes the catalog's `naFactors` per item: every applicable position must be a whole 1–7 score and every not-applicable position must be `null` or absent ("{id}" needs whole scores from 1 to 7 for {applicable labels}.") |
| Rater and admin matrix | The applicable sliders only; a not-applicable cell shows the text "Not applicable". A row is complete when every applicable slider is set; the partial note names the count of sliders left ("Set all three, or clear" / "Set all four, or clear"). Clear still clears the row |
| Grade | Over the item's applicable factors only: `units = Σ W_i · v_i` and `total = 3 × units / Σ W_i` (hundredths, one final division, so 7s give exactly 21); averages per applicable factor; not-applicable factors are `null` in `FactorValues` (`Record<FactorId, number \| null>`). Applicability comes from the catalog, not from the card: a stored value in a now-not-applicable position is ignored, and clearing the flag later uses it again |
| Review tab | Shows "n/a" in the not-applicable column for the item's averages and in each rater's breakdown |
| Snapshot and site | `RatingPoint.scores[f]` is `null` for a not-applicable factor; `snapshot-checks` accepts `null` there; `FactorBars` renders "Not applicable" instead of a bar; the history line prints "n/a" for it. The AI draft prompt lists only applicable factors and says the others don't apply |
| Protected strings | "The model kept mentioning scores or grades. Write this one by hand." and "Anthropic did not answer in time. Try again." unchanged |
| Rollout | Schema first (`db:apply`: nullable score columns, `na_factors` column; idempotent), then one push. The old API keeps working against the new schema (it never writes NULL and ignores `na_factors`); the deploy window from Plan 4 applies again and is accepted (no rater activity expected) |

## Out of scope

Deleting published rounds; renaming a round's id or label after creation; a "closed but unpublished" state; per-rater N/A choices; re-grading published rounds when `na_factors` changes (the next snapshot reflects it, which is the existing "edits reach the site at the next update" rule).

## Where the change lands

| Area | Files |
|---|---|
| Types | `src/domain/types.ts` (`ScoreTuple` with `null`, `FactorValues` with `null`, `Artifact.naFactors`), `src/domain/api-types.ts` |
| Schema | `db/schema.sql` (nullable score columns; `artifacts.na_factors`) |
| API | `api/src/functions/admin-rounds.ts` (delete), `api/src/repo/rounds.ts` (`deleteRound`), `api/src/functions/admin-catalog.ts` + `api/src/repo/catalog.ts` (`naFactors`), `api/src/lib/validate.ts` (`validateScores(raw, catalog)`), `api/src/repo/scores.ts` (nullable), `api/src/domain/{formula,aggregate,dataset,review,snapshot}.ts`, `api/src/lib/draft-why.ts` |
| Admin | `src/admin/PublishTab.tsx` (Delete round), `src/admin/rounds.ts` (`nextRound`), `src/admin/CatalogTab.tsx` + `catalog-write.ts` (checkboxes), `src/admin/ReviewTab.tsx` ("n/a") |
| Rating UI | `src/rating-ui/draft.ts` (complete = applicable set), `ScoreMatrix.tsx`, `ScorecardEditor.tsx` |
| Site | `src/components/FactorBars.tsx`, `RatingHistory.tsx`; `scripts/snapshot-checks.ts` |
| Docs | README (How a round works: delete; How ratings are computed: not-applicable rule) |

## Testing

- Delete: 204 path removes notes, scores and the round in one transaction (opt-in DB test), 409 for a published round, 404 for an unknown id, admin only; UI confirm text and notice; the form reappears.
- `nextRound`: `2026-Q4` → `2027-JAN` / "January 2027"; `2026-NOV` → `2026-DEC`; `2026-DEC` → `2027-JAN`; unparseable → month after today.
- Validation: cost N/A item accepts `[5, 6, null, 3]`, refuses `[5, 6, 4, 3]` and `[5, 6, null, null]`; four-applicable items unchanged; `naFactors` rejects unknown ids and all four.
- Formula: cost N/A with 7/7/–/7 → 21 → AAA; 4/4/–/4 → 12 → BBB-; mixed raters; the mean uses one division.
- Matrix: three sliders for a cost-N/A item, "Not applicable" cell, complete after three; four-factor items unchanged.
- Snapshot/site: `null` cost accepted by the checks; FactorBars shows "Not applicable"; the committed empty snapshot still passes.
- Integration suite (opt-in) gains one case: an item marked N/A accepts a three-score card and shows "n/a" in the review.
