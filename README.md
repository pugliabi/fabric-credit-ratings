# Microsoft Fabric Credit Ratings

Bond-style credit ratings (AAA to E) for every Microsoft Fabric item. Each item is scored 1 to 7 on **Feature Capability**, **User Experience**, and **CU / Token Cost**. Those scores, along with other factors, inform the rating. The site does not show how a set of scores becomes a grade.

## Run locally

```bash
npm install
npm run dev        # the site, http://localhost:5173
npm run desk       # the rating desk, http://localhost:5173/desk.html
```

| Command | What it does |
|---------|--------------|
| `npm run dev` | Site dev server with hot reload. `/rate` is the public scoring page |
| `npm run desk` | Same server, opened on the local rating desk |
| `npm run build` | Typecheck the site and scripts, then build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | TypeScript for the site (`tsconfig.json`) and scripts (`scripts/tsconfig.json`) |

Copy `.env.example` to `.env` for the desk. `.env` is gitignored and nothing in it is needed in GitHub.

| Variable | What it is |
|----------|------------|
| `RATER` | Your GitHub username. Desk scores are saved under this name |
| `ANTHROPIC_API_KEY` | Drafts "Why this rating" text in the desk |
| `ANTHROPIC_WORKSPACE_ID` | Needed when the key is not scoped to a workspace |
| `ANTHROPIC_MODEL` | Optional. Defaults to `claude-sonnet-5-5` |

## How a round works

Ratings are reviewed in rounds, such as `2026-Q4`. The repo is the database: each round is a folder.

```
src/data/raters.json                       GitHub usernames allowed to submit
src/data/rounds/2026-Q4/round.json         { id, label, status: open | published, publishedOn }
src/data/rounds/2026-Q4/notes.json         "Why this rating" per item
src/data/rounds/2026-Q4/scores/<rater>.json  one rater's scores, one [capability, ux, cost] line per item
```

1. **Open a round.** In the desk, Publish tab, start a new round. Only one round is open at a time.
2. **Score.** In the desk's Score tab, set the sliders for each item and save. Other raters use https://fabriccreditratings.com/rate, which opens a prefilled GitHub issue. `.github/workflows/intake.yml` checks the author against `raters.json`, commits their scorecard, comments, and closes the issue. A rater who submits again replaces their earlier scores.
3. **Review.** `git pull` to get the submitted scorecards, then reload the desk. The Review tab shows each item's averaged scores, grade, change from the last round, and the per-rater breakdown. Write the why, or use **Draft with AI** for a first pass. Notes save as you type.
4. **Publish.** The Publish tab checks that every scored item has a why, then marks the round published. Commit and push. The push deploys the site.

While a round is open, nothing about it shows on the site, so intake commits never change the live ratings.

## How ratings are computed

- For each published round, each factor is averaged across the raters who scored the item, shown to one decimal.
- The grade comes from the unrounded average total (`src/domain/scale.ts`, used internally and never shown). Retired items are rated E.
- Each published round adds a point to the item's history. The newest point is the current rating, so an item skipped in a round keeps its last rating.

See `src/domain/aggregate.ts`.

## Where things live

- `src/data/artifacts.ts`, `workloads.ts`, `factors.ts`: the catalog and the scoring factors
- `src/data/index.ts`: loads the round files and builds the ratings
- `src/rating-ui/`: the slider matrix shared by the desk and `/rate`
- `src/desk/` + `desk.html`: the local desk. Not a build input, so it never ships
- `src/rate/` + `rate.html`: the public scoring page
- `scripts/desk-api.ts`: the desk's local API, as a Vite dev-server plugin. It writes the round files and calls Anthropic
- `scripts/intake.ts`: validates and writes a scorecard from an issue body
- `src/domain/payload.ts`: the issue body format, shared by `/rate` and the intake script

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main` and on **Run workflow**. Intake commits use `GITHUB_TOKEN`, so they do not trigger a deploy.

In the repo settings, set **Pages → Source** to **GitHub Actions**.

The site is served at https://fabriccreditratings.com (custom domain, DNS at Bluehost). `base` in `vite.config.ts` is `'/'` and `public/CNAME` holds the domain.
