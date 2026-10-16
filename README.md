# Microsoft Fabric Credit Ratings

Bond-style credit ratings (AAA to E) for Microsoft Fabric items. Raters score each item 1 to 7 on **Feature Capability**, **User Experience**, and **CU / Token Cost**. Those scores, along with other factors, inform the rating. The site does not show how a set of scores becomes a grade.

## How it fits together

```
fabriccreditratings.com        GitHub Pages: the public site, /rate, /admin (static files)
  │  public ratings come from src/data/snapshot.json, baked in at build time
  │  /rate and /admin call the API with a session cookie
  ▼
api.fabriccreditratings.com    Azure Functions, Flex Consumption, Node 24 (api/)
  │  managed identity, no stored database secret
  ▼
SQL database "fcr" in Fabric   users, sessions, catalog, rounds, scores, notes
```

- The public site never calls the API. Each site deploy fetches the published ratings once (`npm run snapshot`) and commits `src/data/snapshot.json` when it changed. Once Pages is live, the workflow tells the API which snapshot it deployed, and only that moves the Publish tab from "The public site is behind" to "The public site is up to date".
- Publishing a round, or **Update public site** in the admin, starts the site deploy. The site updates about two minutes later.
- The snapshot holds published rounds only, with no per-rater scores. Items nobody has rated don't appear.

## Run locally

Needs Node 24, the Azure CLI, and access to the `fcr-dev` database in Fabric.

```powershell
az login
npm install
npm --prefix api install --ignore-scripts
Copy-Item api/local.settings.example.json api/local.settings.json   # set SQL_SERVER and SQL_DATABASE for fcr-dev
npm run api   # terminal 1: the API on http://localhost:7071
npm run dev   # terminal 2: http://localhost:5173, /rate.html, /admin.html
```

`--ignore-scripts` skips the Azure Functions Core Tools download, whose npm postinstall fails on Node 24. `npm run api` needs `func` anyway: install Core Tools separately (`winget install Microsoft.Azure.FunctionsCoreTools`, or the MSI) so it is on PATH, or copy `func.exe` and its folder from a working install into `api/node_modules/azure-functions-core-tools/bin/`.

Vite proxies `/api` to the local API, so the session cookie works on localhost. To use a Functions host on another port, set `FCR_API_TARGET` (for example `http://localhost:7076`) before `npm run dev`. The first API call after a quiet spell can take up to a minute while `fcr-dev` wakes.

| Command | What it does |
|---------|--------------|
| `npm run dev` | Site dev server with hot reload |
| `npm run api` | Build and start the Functions API locally |
| `npm run build` | Typecheck everything, then build the site to `dist/` |
| `npm run typecheck` | TypeScript for the site, scripts, and API |
| `npm test` | Unit tests, with no network unless `FCR_API_URL` or `FCR_DB_TESTS` is set. The 13-test API integration suite also runs when `FCR_API_URL` is set |
| `npm run snapshot` | Refresh `src/data/snapshot.json` from the API |
| `npm run snapshot -- --confirm` | Refresh it, then tell the local API it's live, as a deploy does. Don't commit a snapshot built from `fcr-dev` |
| `npm run db:apply` | Apply `db/schema.sql` (safe to re-run) |
| `npm run db:seed` | Create the first admin in an empty database (`FCR_ADMIN_PASSWORD` must be set) |

`db:apply` and `db:seed` use the database in `api/local.settings.json` unless you pass `--server` and `--database`.

## How a round works

1. **Open a round** in `/admin`. One round is open at a time.
2. **Score.** Raters log in at `/rate` and keep one scorecard each for the open round; saving again replaces it. The admin scores on the Score tab.
3. **Review.** The Review & why tab shows each item's averaged scores, grade, change from the last round, and every rater's scores. Write the why, or use **Draft with AI** for a first pass. The admin can edit any rater's card.
4. **Publish** on the Publish tab. The site rebuilds with the new ratings.

Edits to a published round (scores, whys, catalog) save right away and reach the site at the next **Update public site**. The admin creates rater accounts on the Users tab and hands over the password; raters can change it.

## How ratings are computed

- For each published round, each factor is averaged across the raters who scored the item, shown to one decimal.
- The grade comes from the unrounded average total (`api/src/domain/formula.ts`, server-side only). Retired items are rated E.
- Each published round adds a point to the item's history. The newest point is the current rating, so an item skipped in a round keeps its last rating.

See `api/src/domain/aggregate.ts`.

## Where things live

- `src/App.tsx`, `src/components/`: the public site
- `src/rate/`, `src/admin/`, `src/account/`: the rater page, the admin, login and password
- `src/rating-ui/`: the score matrix and draft handling shared by `/rate` and `/admin`
- `src/data/snapshot.json`: the published ratings the site is built from; `src/data/factors.ts`: the scoring factors
- `src/domain/`: shared types, grade display helpers, API types
- `api/src/functions/`: API routes; `api/src/repo/`: SQL; `api/src/domain/`: grade math, snapshot, review
- `db/`: schema, apply and seed scripts
- `scripts/snapshot.ts`: fetches the snapshot before a build

## Deploy

- **Site:** `.github/workflows/deploy.yml` runs on every push to `main` and when the API starts it. It refreshes the snapshot (repo variable `API_URL`, secret `SNAPSHOT_TOKEN`), builds, publishes to GitHub Pages, and then confirms the live snapshot to the API (`POST /api/build/snapshot/deployed`).
- **API:** `.github/workflows/api-deploy.yml` deploys `api/` when `api/` or `src/domain/` changes on `main`. It signs in to Azure with OIDC through the `api` environment (variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_FUNCTIONAPP_NAME`), and ends by starting a site deploy so the site is rebuilt against the new API.
- **Checks:** `.github/workflows/ci.yml` typechecks, tests, builds, and scans `dist/` for token shapes and the grade formula on every pull request and every push to a branch other than `main`.

Function App settings:

| Setting | What it is |
|---------|------------|
| `SQL_SERVER`, `SQL_DATABASE` | The `fcr` database in Fabric |
| `ALLOWED_ORIGINS` | Pages allowed to call the API with cookies |
| `COOKIE_SECURE` | `true` in Azure; `false` only for local http |
| `SNAPSHOT_TOKEN` | Same value as the repo's `SNAPSHOT_TOKEN` secret |
| `GITHUB_DISPATCH_TOKEN` | Fine-grained token (this repo, Actions read/write) that starts the site deploy. Rotate it yearly. Until it is set, **Update public site** answers that dispatch isn't configured; run `npm run snapshot -- --confirm` against the API and push the snapshot instead |
| `GITHUB_REPO`, `GITHUB_BRANCH`, `GITHUB_WORKFLOW` | Which workflow to start |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID`, `ANTHROPIC_MODEL` | Draft with AI. The workspace id and model are optional |

DNS is at Bluehost. The site records point at GitHub Pages (`public/CNAME` holds the domain). `api` is a CNAME to the Function App, with an App Service managed certificate.
