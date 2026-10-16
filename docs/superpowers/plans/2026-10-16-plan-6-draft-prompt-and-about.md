# Plan 6: Shorter AI Drafts With Item Context; About Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Draft with AI writes 2–3 sentences (≤ 350 characters) from a system prompt plus a per-item description; a new About page explains where the ratings come from, why 1 to 7, and who built the site.

**Architecture:** One admin-only column (`artifacts.description`) with its own non-stamping route and a Catalog tab editor; `draft-why.ts` gains a system prompt, the description, original-site voice examples and a deterministic length guard. The About page is a fourth static Vite entry linked from the footer and How it works.

**Tech Stack:** TypeScript, React 19, Vite, Vitest (+ happy-dom per file), Azure Functions, mssql, Anthropic SDK.

**Spec:** `docs/superpowers/specs/2026-10-16-draft-prompt-descriptions-about-page-design.md`

## Global Constraints

- Description: at most 600 characters, trimmed; 400 text "Descriptions use at most 600 characters."; never in the public catalog (`GET /api/catalog`) or the snapshot; editing it does not call `markChanged`.
- Draft: 2–3 sentences, ≤ 350 characters; `max_tokens: 200`; protected strings byte for byte: "The model kept mentioning scores or grades. Write this one by hand." and "Anthropic did not answer in time. Try again."
- No numeric total or weight anywhere in UI or prompt output.
- About links exactly: https://pugliabi.com, https://pugliabi.com/contact, https://www.linkedin.com/in/tommypuglia, https://www.linkedin.com/company/puglia-bi-consulting, https://promptingbi.com; citations exactly: https://web.stanford.edu/dept/communication/faculty/krosnick/docs/2010/2010%20Handbook%20of%20Survey%20Research.pdf and https://measuringu.com/ratingscales-myth-evidence/ (external links `target="_blank" rel="noopener noreferrer"`).
- Formatting: 2 spaces, single quotes, semicolons, trailing commas, ≤ 120 chars; keep each file's line endings; no prettier. Typecheck and tests green before each commit.

---

### Task 1: Item descriptions (schema, admin route, Catalog tab editor)

**Files:** `db/schema.sql`; `src/domain/api-types.ts` (`AdminArtifact.description: string`); `api/src/repo/catalog.ts` (`adminCatalog` selects `a.description`; `setArtifactDescription(db, id, description)`; `findArtifactDescription(db, id): Promise<string>`); `api/src/functions/admin-catalog.ts` (route); `src/admin/CatalogTab.tsx` (+ `catalog-write.ts` action); tests: `api/src/functions/admin-catalog.test.ts`, `src/admin/CatalogTab.dom.test.ts`; every `AdminArtifact` fixture gains `description: ''`.

- [ ] **Schema** (19 batches after): in `CREATE TABLE dbo.artifacts` add `description nvarchar(600) NOT NULL CONSTRAINT df_artifacts_description DEFAULT '',` and after the table:

```sql
IF COL_LENGTH('dbo.artifacts', 'description') IS NULL
ALTER TABLE dbo.artifacts ADD description nvarchar(600) NOT NULL CONSTRAINT df_artifacts_description DEFAULT '';
GO
```

Run `npm run db:apply` twice → "Applied 19 schema batches." both times.

- [ ] **Route** (tests first): `PUT admin/artifacts/{id}/description` (admin), body `{ description }`: 404 "That item does not exist." for an unknown id; non-string → 400 "Send the description as text."; trimmed length > 600 → 400 "Descriptions use at most 600 characters."; writes with `setArtifactDescription` (plain `db`, no transaction, no `markChanged`); returns `adminCatalog(db)`.
- [ ] **Catalog tab** (DOM test first): each item row gets a small "Description" button (aria-label "{item} description", `aria-expanded`) that toggles a following `<tr>` with a `<td colSpan={…}>` holding a `<textarea aria-label="{item} description text">` (prefilled, `maxLength` not set), a muted counter "{n}/600", and a Save button (`aria-disabled` while busy or unchanged) that sends the PUT through the tab's existing `run` pattern; the button shows "Description ✓" when the item has one. Test: toggle opens the editor with the current text; typing and Save sends `PUT /admin/artifacts/notebook/description` with the trimmed text.
- [ ] Commit: "Catalog: admin-only item descriptions for the AI draft".

### Task 2: Draft with AI: system prompt, description, voice examples, length guard

**Files:** `api/src/lib/draft-why.ts` (+ test), `api/src/functions/admin-rounds.ts` (draft route passes `description: await findArtifactDescription(db, artifactId)`).

- [ ] Tests first (`draft-why.test.ts`): `SYSTEM_PROMPT` contains "2 or 3 short sentences" and "350 characters"; `promptFor({...input, description: 'A Spark notebook…'})` contains "What it is: A Spark notebook…" and each example; with an empty description it says "What it is: (no description yet; rely on the name and workload)"; `shortenDraft`: four sentences → first three; three sentences totalling > 350 → two; one sentence of 400 characters → unchanged; trims whitespace. The create call receives `system: SYSTEM_PROMPT` and `max_tokens: 200` (mock the client as the existing tests do).
- [ ] Implement:

```ts
export const SYSTEM_PROMPT = `You write the "Why this rating" note on Microsoft Fabric Credit Ratings, a site that grades each Microsoft Fabric item the way a credit agency grades a bond. Readers are data engineers, analysts, and architects deciding what to build on.

Write 2 or 3 short sentences, at most 350 characters in total, as plain prose with no heading, list, or quotation marks. Say what the item is good at and what holds it back. Use the item description for facts and the scores only to judge what to emphasise. If there is a previous review, say in words whether things improved or slipped. If the item is retired, say so and name the replacement when there is an obvious one. Do not mention factors that do not apply to the item.

Never mention scores, numbers out of seven, totals, letter grades, rater counts, weights, or arithmetic: the reader must not be able to reconstruct the rating. Do not invent features, dates, or prices that are not in the description and are not widely known about the item. Match the length and tone of the examples without copying them.`;
```

`EXAMPLES` becomes these five (from the original site):

```ts
const EXAMPLES = [
  'The most complete authoring surface in Fabric: Spark, pure Python, T-SQL cells, Copilot, and Git integration. Session start-up and idle compute still cost more capacity than they should.',
  'Incremental copy and CDC turned a convenience item into a real ingestion tool. A guided setup with no pipeline to maintain makes it the default answer for bulk and incremental loads.',
  'The orchestration workhorse, with the widest set of activities and connectors. The authoring canvas is dated, and debugging nested pipelines still takes too many clicks.',
  'Excellent for logs and time series with very fast KQL. The experience is improving but still assumes you already know Kusto.',
  'Superseded by Dataflow Gen2. No CI/CD, no Fabric destinations, and a higher cost per row than any alternative.',
];
```

`DraftInput` gains `description?: string`. `promptFor` keeps its structure but: adds `What it is: ${description || '(no description yet; rely on the name and workload)'}` after the workload line; the Rules block is removed (now in the system prompt); the examples header reads "Voice examples from earlier notes:". In `createDrafter` the create call passes `system: SYSTEM_PROMPT`, `max_tokens: 200`; the retry message stays. Return `shortenDraft(text)` (applied after the math check passes):

```ts
const MAX_DRAFT_CHARS = 350;
/** At most three sentences, dropping trailing ones while over 350 characters; never fewer than one. */
export function shortenDraft(text: string): string {
  const sentences = text.trim().split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 3);
  while (sentences.length > 1 && sentences.join(' ').length > MAX_DRAFT_CHARS) sentences.pop();
  return sentences.join(' ');
}
```

- [ ] Commit: "Draft with AI: system prompt, item description, original-site voice, two-to-three sentences".

### Task 3: About page (independent of Tasks 1–2)

**Files:** create `about.html`, `src/about/main.tsx`, `src/about/AboutPage.tsx`, `src/about/AboutPage.module.css`, `src/about/AboutPage.dom.test.ts`; modify `vite.config.ts` (input `about`), `src/components/SiteFooter.tsx` (link), `src/components/HowItWorks.tsx` (link) and their tests if they assert text.

- [ ] `about.html` mirrors `rate.html` (title "About these ratings · Microsoft Fabric Credit Ratings", meta description "Where the Microsoft Fabric Credit Ratings come from, why they use a 1 to 7 scale, and who built the site.", script `/src/about/main.tsx`). `main.tsx` mirrors `src/rate/main.tsx`.
- [ ] `AboutPage` (content exactly; headings h1/h2; a top link "← Back to the ratings" to `/`):
  - h1 "About these ratings"
  - h2 "What this is" — "Microsoft Fabric Credit Ratings grades each Fabric item the way a credit agency grades a bond, from AAA down to C, so you can see at a glance what is ready to build on and what to plan around. Retired items are rated D."
  - h2 "Where the ratings come from" — "The ratings are opinions. Microsoft MVPs and other practitioners who build on Fabric every day score each item in review rounds. Each rater scores the items they know, the scores are averaged, and a short note explains each rating. They are subjective judgments, not measurements, benchmarks, or advice to buy."
  - h2 id="scale" "Why a 1 to 7 scale" — "Each item is scored from 1 to 7 on four factors: Feature Capability, User Experience, CU / Token Cost, and Outlook. Survey research finds that scales of five to seven points give the most reliable answers, and that seven points suit judgments that need finer distinctions, like these (" + link "Krosnick and Presser, Question and Questionnaire Design" + "). Going beyond seven points adds little reliability (" + link "MeasuringU, Rating Scales: Myth vs. Evidence" + "). The site does not publish how the four scores combine into a grade."
  - h2 "Who built this" — "Microsoft Fabric Credit Ratings was built by Tommy Puglia of " + link "Puglia BI Consulting" (pugliabi.com) + ", a Microsoft Fabric and Power BI consultancy. Tommy writes about AI and business intelligence at " + link "Prompting BI" + "." then a list: "Contact Puglia BI Consulting" (pugliabi.com/contact), "Tommy Puglia on LinkedIn", "Puglia BI Consulting on LinkedIn".
  - a fine-print line: "Independent and unofficial. Not affiliated with or endorsed by Microsoft. Microsoft Fabric is a trademark of Microsoft Corporation."
  - Styling: reuse `tokens.css`/`global.css`; a centred column (max-width ~ 72ch), headings in the display font, links in `--fabric-green`; phone-width safe.
- [ ] Links: `SiteFooter` adds `<p><a href="/about.html">About these ratings</a>: where the ratings come from and who built this site.</p>` before the "Raters: log in" line; `HowItWorks` adds after the lede `<p className={styles.lede}><a href="/about.html#scale">Why 1 to 7?</a></p>` (or append to the lede).
- [ ] DOM test: renders the five headings, `#scale`, both citation hrefs, all five site links with `target="_blank"`, and no text matching `/weight|out of 21|\b21\b/`. `vite.config.ts` input `about: fileURLToPath(new URL('about.html', import.meta.url))`; `npx vite build` emits `dist/about.html`.
- [ ] Commit: "About page: where the ratings come from, why 1 to 7, who built this".

### Task 4: Item descriptions research (data, no code)

- [ ] For every item in `.superpowers/sdd/2026-10-16-plan-6-draft-prompt-and-about/catalog.json`, write 2–3 factual sentences (≤ 600 characters, aim 250–450): what the item is, what it is for, and how it consumes capacity (CU) or tokens where documented; no opinions, no grades. Sources: Microsoft Learn first. Output `descriptions.json` in the same folder: `[{ "id", "name", "description", "sources": [url…] }]`.
- [ ] Controller review pass (accuracy spot-checks), then a one-off loader fills empty descriptions on `fcr-dev` and `fcr`.

### Task 5: Review, merge, load, deploy (controller)

- [ ] Per-task reviews; merge Task 3's worktree branch; full gate (typecheck, tests, build, bundle grep); `db:apply` on `fcr-dev` and `fcr` (19 batches); load descriptions; push; watch both deploys; live checks: About page and its two entry links; a Draft with AI call returns ≤ 3 sentences and ≤ 350 characters; the Catalog tab shows descriptions.
