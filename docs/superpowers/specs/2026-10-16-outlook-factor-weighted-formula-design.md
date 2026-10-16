# Outlook factor, weighted formula, low-investment band, D for deprecated

Date: 2026-10-16
Status: approved in conversation (approach A). Implementation plan: `docs/superpowers/plans/2026-10-16-plan-4-outlook-and-weights.md`.
Builds on `2026-10-15-login-fabric-backend-design.md`; where the two differ, this one wins for the factors, the formula and the grade scale.

## Goal

1. Add a fourth factor, **Outlook**: the potential of the feature, scored 1 to 7 like the others, by every rater on every item.
2. Replace the plain sum with a weighted total: Feature Capability 40 %, User Experience 25 %, CU / Token Cost 25 %, Outlook 10 %.
3. Split the investment band: **Investment grade** is AAA to A-; **Low investment grade** is BBB+ to BBB-.
4. Rename the special grade: **D, Deprecated** replaces E, Withdrawn. Retired items get D automatically, as they got E.

The public site shows Outlook like the other factors (averages, bars, a How it works card). It never shows the weights or the weighted total; the grade is the only derived value on the site.

## Decisions

| Topic | Decision |
|---|---|
| Factor model | The fixed factor set grows to four (`FactorId` gains `outlook`); no factors table, no editable weights |
| Score tuple | `ScoreTuple` = four `Score`s in `FACTORS` order: capability, ux, cost, outlook. The name `ScoreTriple` goes away |
| Formula | `totalOf(values) = 3 × (0.40·capability + 0.25·ux + 0.25·cost + 0.10·outlook)`, so totals still run 3 to 21 and the 19-notch `TOTAL_TO_GRADE` table and `gradeForTotal` (round to the nearest notch) are unchanged. 7 everywhere is AAA, 1 everywhere is C |
| Averaging | Unchanged: per factor across the raters who scored the item, display rounded to one decimal, grade from the unrounded weighted total |
| Bands | `Band` = `investment` (AAA–A-), `lowInvestment` (BBB+–BBB-), `speculative` (BB+–B-), `distressed` (CCC–C), `deprecated` (D). `isInvestmentGrade` is true for both investment bands |
| Deprecated | `Grade` swaps `E` for `D`. `DEPRECATED_GRADE = 'D'` replaces `WITHDRAWN_GRADE`. Labels: "Deprecated". CSS tokens `--band-deprecated*` replace `--band-withdrawn*`; a new `--band-low-investment*` pair sits between the investment green and the speculative amber |
| Outlook copy | `factors.ts`: label "Outlook", question "Where is it headed over the next year?", low "Stalled or on its way out", high "Clear momentum and investment" |
| Database | `scores.outlook tinyint NOT NULL CHECK (outlook BETWEEN 1 AND 7)`, added by an idempotent batch with a temporary default of 4 (so existing rows survive), followed by a batch that drops the default. Grades are never stored, so bands and D need no data change |
| Existing data | Production `fcr` has no score rows. `fcr-dev`'s test rows get outlook 4 from the default; they are test data |
| API | Shapes keep their structure; tuples have four entries and `FactorValues` four keys everywhere (rater card, admin review, snapshot, history points). `validateScores` requires exactly four whole numbers 1–7 per item. The AI draft prompt lists Outlook with the other factors |
| Snapshot | `scores` objects carry `outlook`; `snapshot-checks.ts` requires it. The committed empty snapshot stays valid |
| Protected strings | "The model kept mentioning scores or grades. Write this one by hand." and "Anthropic did not answer in time. Try again." are unchanged |
| Rollout | One push to `main` after `db:apply` on `fcr-dev` and `fcr`; `api-deploy.yml` deploys the API and then rebuilds the site, so the site never sees a snapshot the API cannot produce |

## Where the change lands

| Area | Files | Change |
|---|---|---|
| Types | `src/domain/types.ts` | `FactorId` + `outlook`; `ScoreTuple`; `Grade` E→D; `Band` with `lowInvestment` and `deprecated` |
| Grades | `src/domain/grades.ts` | `GRADES` ends in `D`; `bandOf`, `BAND_META`, `BAND_ORDER` for five bands; `isInvestmentGrade` covers both |
| Formula | `api/src/domain/formula.ts`, `formula.test.ts` | `FACTOR_WEIGHTS`, weighted `totalOf`, `DEPRECATED_GRADE`; tests for the scaling and the extremes |
| Aggregation | `api/src/domain/aggregate.ts`, tests, `dataset.ts`, `fixtures.ts`, `review.ts`, `snapshot.ts` | four-factor averages; D for retired |
| Validation and SQL | `api/src/lib/validate.ts`, `api/src/repo/scores.ts`, `db/schema.sql` | four entries; `outlook` column read, written, checked |
| AI draft | `api/src/lib/draft-why.ts` | Outlook in the prompt's factor list (protected strings untouched) |
| Factors and UI | `src/data/factors.ts`, `src/rating-ui/*`, `src/admin/ReviewTab.tsx`, `src/rate/RatePage.tsx`, `src/components/*` (FactorBars, HowItWorks, ScaleLegend, DistributionBar, GradeBadge, HistorySparkline, RatingHistory, SiteHeader, WorkloadSection), `src/styles/tokens.css`, module CSS using the band tokens | fourth column/bar/card; five bands; D/Deprecated |
| Snapshot script | `scripts/snapshot-checks.ts`, tests | `outlook` required |
| Docs | README "How ratings are computed", the Plan 1/2/3 as-built notes where they list the three factors or E | one sentence each |

## Testing

- Formula: 7/7/7/7 → 21 → AAA; 1/1/1/1 → 3 → C; a mixed card where the weights decide the notch (e.g. 7/1/1/7 = 3 × (2.8 + 0.25 + 0.25 + 0.7) = 12.0 → BBB-, where the old three-factor sum 9 gave BB-; and 7/7/1/1 = 3 × (2.8 + 1.75 + 0.25 + 0.1) = 14.7 → A- where the old sum 15 gave A-); averaged fractional totals round to the nearest notch; retired → D.
- Bands: A- investment, BBB+ and BBB- low investment, BB+ speculative, C distressed, D deprecated; `isInvestmentGrade` for both investment bands.
- Validation: a three-entry card and a five-entry card are refused; the error names the item.
- Repo: `replaceScorecard` round-trips four values (opt-in DB test against `fcr-dev`).
- Snapshot checks: a snapshot missing `outlook` is refused with the path.
- DOM: the score matrix renders four columns and saves a four-entry card; the review shows four averages per rater; the legend shows five bands with "Low investment grade" and "Deprecated".
- Boundary test and the full unit suite stay green; the 13-test integration suite runs once against `fcr-dev` locally before the push.

## Out of scope

Editable weights, historical re-grading (no published rounds exist), per-factor weighting in the public site's copy.
