# Raters submit; the admin releases the round

Date: 2026-10-19
Status: approved in conversation (Submit step + Release; withdraw to edit; drafts left out with a warning). Plan: `docs/superpowers/plans/2026-10-19-plan-7-submit-and-release.md`.

## Goal

Raters save drafts while they work, then **submit** their card when it is final. Only submitted cards count. Nothing reaches the public site until the admin **releases** the round, and then every submitted card goes live at once. Several raters can take a week over a round without the public averages moving day by day.

What already exists and stays: the public site and the snapshot only show published rounds; the admin's publish step (status `open` → `published`, a date, the site deploy) is the release. This change adds the rater's Submit step, counts submitted cards only, and renames the admin's action to Release.

## Decisions

| Topic | Decision |
|---|---|
| Where submission lives | New table `dbo.submissions (round_id varchar(8) FK rounds, user_id int FK users, submitted_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), PK (round_id, user_id))`: one row per submitted card |
| Existing data | Created with a one-time backfill in the same batch (`IF OBJECT_ID('dbo.submissions') IS NULL BEGIN CREATE …; INSERT … END`): every card in a round whose status is `published` gets a submission dated its newest score's `updated_at`. Cards in the open round stay drafts. Re-running `db:apply` never backfills again, so drafts a release left out stay out |
| What counts | Only submitted cards: the public snapshot, the admin review's averages, grades and change labels, the AI draft's prompt, round counts, and the rater page's "previous card" reference (`lastPublishedCard`) |
| Rater: before submitting | Save works as today; a saved card is a private draft. **Submit scores** appears once a non-empty card is saved and the page has no unsaved changes. A `confirm()` asks: "Submit your {label} card? You can withdraw it to make changes until the round is released." |
| Rater: after submitting | Sliders, Clear all and Save are locked (read-only matrix). A banner: "Submitted {date and time}. Your scores count when {label} is released." A **Withdraw submission** button turns the card back into a draft |
| Submit route | `POST /api/rounds/open/my-scores/submit` `{ round, updatedAt }` → `MyScores`. Refusals: 409 "No round is open for scoring right now."; 409 "The open round is now {label}. Reload the page to score it."; 400 "Save your scores before submitting."; 409 "Your card changed since this page loaded. Reload the page to see it." (when `updatedAt` is not the card's newest save); 409 "Your card is already submitted." Runs in a transaction after `lockRound`; refuses unless the round is still open |
| Withdraw route | `POST /api/rounds/open/my-scores/withdraw` `{ round }` → `MyScores`. Removes the submission if there is one (no error if there isn't). Same open-round and round-mismatch refusals; 409 "{label} was just released. Reload the page." once released. A submit without `updatedAt` gets 400 "Send updatedAt: the save time of the card you are submitting." |
| Saving a submitted card | `PUT /api/rounds/open/my-scores` refuses with 409 "You submitted this card. Withdraw your submission to make changes." This applies to every role on the rater page, including an admin scoring their own card |
| `MyScores` | Gains `submittedAt: string \| null` |
| Clearing a card | An empty card still deletes the card; `replaceScorecard` with no scores also deletes the card's submission |
| Deleting an open round | `deleteRound` also deletes the round's submissions |
| Reopening a released round | Submissions are kept; raters withdraw to edit, and the next release counts whatever is submitted then |
| Admin edits (Review tab) | Open round: the edit leaves the submission as it is (a submitted card stays submitted, a draft stays a draft). Released round: the edit is a correction to live data, so a non-empty card is upserted as submitted. An empty card deletes card and submission in both cases |
| Release | `PUT /api/admin/rounds/{id}` `{ status: 'published', publishedOn }` is unchanged except it counts submitted cards: 400 "Nobody has submitted {label} yet." when there are none. Drafts stay in the database and never count |
| Release panel (Publish tab) | Status line above the button: "{n} submitted · {m} saved but not submitted ({names})", or "{n} submitted" when there are no drafts. Button "Release {label}". Confirm: "Release {label}, dated {date}? Raters can no longer change their cards." plus, with drafts, " {name}'s card isn't submitted and won't count." (one draft) or " These cards aren't submitted and won't count: {names}." (several). The status line and names come from the review the form already loads. Release is blocked in the UI when nobody has submitted |
| Round counts | `AdminRound` gains `submitted: number`. `scorecards` keeps counting every card. The rounds list shows "{scorecards} cards · {submitted} submitted" |
| Review tab | Averages, grades and change labels from submitted cards only. `RoundReview.raters` lists every rater with a card, each with `submittedAt: string \| null`; the header reads "{items} items · {n} submitted · {m} drafts". Each item's breakdown lists every card with `submitted: boolean`; draft entries are marked "(draft)" and are not in the averages. An item only drafts scored is still listed, with `point: null` and the change label "Only in drafts" (`ChangeKind` `'draft'`), shown as "No submitted scores" with no grade and no AI draft button; this keeps the card editor, which rebuilds a card from the breakdowns, from dropping that item's score. The header counts only items with submitted scores ("{n} items · {m} submitted · {k} drafts", the drafts part only when there are drafts). Opening a draft card in the card editor works as today |
| Domain shape | `ScoreRow` gains `submittedAt: Date \| null` (LEFT JOIN submissions). `RoundData.scorecards` holds submitted cards only, so aggregation code is unchanged; new `RoundData.drafts: Scorecard[]` holds the rest. `Scorecard.submittedAt` (today the card's last save time) is renamed `savedAt`, and `Scorecard` gains `submittedAt: string \| null` |
| Wording | User-facing "publish" becomes "release" in the admin page and the API's messages: "Release {label}", "Releasing…", "Released rounds", "No released rounds yet.", "released {date}", "Release date", "Release dates look like 2026-10-15.", "Release dates can't be earlier than {label}'s ({date}).", "{label} is already released.", "{label} is released", "Release {label} before starting a new round.", "Release {label} before reopening another round.", "Only the most recent released round ({label}) can be reopened.", "Only one round can be open. Release or delete {label} to start the next one.", " · raters score this round; release or delete it below", "Reopen {label}? Raters can change their cards again until you release it again.", "{label} is released, so scores can no longer be changed. Ask an admin if a score needs correcting.", "{label} is released. Saving changes its public averages at the next site update.", "{label} was just released. Reload the page." Internal names (`status: 'published'`, `published_on`, `publishedOn`, `PublishTab`, the tab's label "Publish") stay |
| Rater page note | "Only the admin sees individual cards. Submitted cards count toward the averages, which appear on the site when the admin releases {label}." replaces the sentence that ends "…the site shows averages once {label} is published." |
| Rollout | `db:apply` on `fcr-dev`, then `fcr` (adds the table and backfills); API deploy; site deploy. No release happens between the schema and the API deploy, so the old API counting every card in that window is harmless. Afterwards the admin submits their own Q4 2026 card once |

## Out of scope

Submitting on a rater's behalf; notifying anyone; locking or hiding drafts from the admin; public-site wording; deadlines or reminders.

## Testing

- Schema: `db:apply` twice on `fcr-dev` (batch count +1 both times); the backfill marks every card in published rounds and none in the open round; a second run adds nothing.
- Repo and domain: `assembleDataset` splits submitted cards from drafts; aggregation and the snapshot ignore drafts; `buildReview` lists drafts with `submitted: false` and leaves them out of the averages; `lastPublishedCard` ignores unsubmitted cards; submitted counts.
- Routes: submit (every refusal, success returns `submittedAt`), withdraw (idempotent), save refused while submitted, release refused with no submissions, admin edit in an open round keeps the submission state and in a released round marks the card submitted, empty card removes the submission, round delete removes submissions.
- Rater page (DOM): Submit appears only when saved and clean, confirm, locked state with banner, Withdraw returns to editing; the new note text.
- Publish tab (DOM): the status line with and without drafts, the button text, the confirm text with one and with several drafts; rounds list counts; the renamed strings.
- Integration suite against `fcr-dev`: save → review shows a draft → submit → saving is refused → review shows it submitted → withdraw. Releasing stays in unit tests, because releasing would use up fcr-dev's open round.
