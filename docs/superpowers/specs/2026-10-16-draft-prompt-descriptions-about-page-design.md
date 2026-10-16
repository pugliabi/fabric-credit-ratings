# Shorter AI drafts with item context; an About page

Date: 2026-10-16
Status: approved in conversation ("Go", with Survey Practice dropped and LinkedIn + Prompting BI added). Plan: `docs/superpowers/plans/2026-10-16-plan-6-draft-prompt-and-about.md`.

## Goal

1. **Draft with AI** writes 2 to 3 sentences (at most 350 characters), guided by a real system prompt and by a short factual description of each Fabric item, in the voice of the original site's notes.
2. **An About page** answers "where do these ratings come from, why 1 to 7, and who built this", reachable from the footer and How it works, not from the home page's main content.

## Decisions

| Topic | Decision |
|---|---|
| Item descriptions | `artifacts.description nvarchar(600) NOT NULL DEFAULT ''`: two or three factual sentences on what the item is, what it is for, and how it uses capacity. Admin-only (prompt context): returned on `AdminArtifact.description`, never on the public catalog or the snapshot |
| Editing descriptions | Catalog tab: per item, a "Description" toggle opens a row with a textarea and Save. Saved through `PUT /api/admin/artifacts/{id}/description` `{ description }` (trimmed, at most 600 characters; 400 "Descriptions use at most 600 characters."), which does NOT stamp `site_state` (not public data) |
| Initial descriptions | Researched from Microsoft Learn for every catalog item (with source URLs), reviewed, then loaded once into `fcr-dev` and `fcr` by a one-off script that only fills empty descriptions |
| System prompt | Sent as the `system` parameter (text in the plan). Role, audience, 2–3 sentences ≤ 350 characters, what to say, what never to say (scores, numbers out of seven, totals, grades, rater counts, weights, arithmetic), do not invent facts beyond the description |
| User message | Item, workload (+ blurb), release status, **description**, round, rater count, previous review and its note, the applicable factor scores "for your judgment only", the not-applicable lines, and 4–5 voice examples taken from the original site's notes |
| Length guard | `max_tokens` 200; the server keeps at most the first three sentences and drops trailing sentences while the text exceeds 350 characters (never below one sentence) |
| Unchanged | The math-leak check and its one retry; the two protected strings ("The model kept mentioning scores or grades. Write this one by hand." / "Anthropic did not answer in time. Try again."); the note limit (2,000) |
| About page | `about.html` (a fourth Vite input) rendered by `src/about/`: sections "What this is", "Where the ratings come from", "Why a 1 to 7 scale" (`id="scale"`), "Who built this", and the independence disclaimer; a link back to the ratings. Copy in the plan |
| About links | Footer: "About these ratings" → `/about.html`. How it works: "Why 1 to 7?" → `/about.html#scale`. Nothing added to the hero or the header |
| Citations | Krosnick and Presser, *Question and Questionnaire Design* (Stanford-hosted PDF) and MeasuringU, *Rating Scales: Myth vs. Evidence*. No Google citation (none found that says 7 is best) and not Survey Practice |
| Who built this | Tommy Puglia, Puglia BI Consulting: https://pugliabi.com, https://pugliabi.com/contact, https://www.linkedin.com/in/tommypuglia, https://www.linkedin.com/company/puglia-bi-consulting, https://promptingbi.com |

## Out of scope

Showing descriptions on the public site; per-round notes guidance beyond the prompt; a CMS for the About copy.

## Testing

- Draft: `promptFor`/`systemPrompt` contain the description, the examples, the 350-character rule; `shortenDraft` cases (four sentences → three; three over 350 → two; one long sentence kept); the retry path unchanged; protected strings byte for byte.
- Description route: trims, 600 limit, 404 unknown item, no `markChanged`; Catalog tab DOM test: toggle, type, Save sends the PUT.
- About page: DOM test for the five sections, the two citations' URLs, the five links, `id="scale"`; footer and How it works links; build includes `about.html`.
