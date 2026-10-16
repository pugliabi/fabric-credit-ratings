# Rater logins, online admin, and a Fabric SQL backend

Date: 2026-10-15
Status: approved. Implementation plans: `docs/superpowers/plans/2026-10-15-plan-1-api-and-database.md`, `…-plan-2-front-end.md`, `…-plan-3-azure-cutover.md`. Where a plan and this spec differ, the plan wins; the differences are synced here.

## Goal

Replace the GitHub-issue intake and the local-only desk with:

- Username + password logins for raters and admins, held in an HttpOnly session cookie.
- An online admin that can do everything the desk does today, plus edit already-published ratings, manage the item catalog, and manage users.
- All rating data in a SQL database in Fabric.
- A public site that stays static and anonymous. It never reads from Fabric at view time.

## Decisions

| Topic | Decision |
|---|---|
| Data store | SQL database in Fabric, on the existing paid F SKU capacity |
| API host | Azure Functions (TypeScript, Flex Consumption) in the same subscription and tenant as the capacity |
| Fabric auth | The Function App's system-assigned managed identity. No secrets |
| User auth | Our own login + password, with sessions stored in the database |
| Public reads | A snapshot is baked into the static site at deploy time. Visitors never hit the API or Fabric |
| Catalog | Workloads and items live in the database and are editable in the admin, seeded once from the current files |
| Published edits | Silent. No "revised" marker on the public site |
| Rater passwords | The admin sets them. Raters can change their own later |
| Unscored items | Hidden from the public site entirely, along with workloads that have no rated items |

## Architecture

```text
fabriccreditratings.com  (GitHub Pages, static)
  /         public ratings, built from src/data/snapshot.json
  /rate     rater login + own scorecard
  /admin    admin (admin role only)
      │  fetch(..., { credentials: 'include' }) with the session cookie
      ▼
api.fabriccreditratings.com  (Azure Functions, Node 24, TypeScript)
  auth, permissions, scorecards, notes, catalog, users, AI drafting, snapshot
      │  managed identity → Entra token → TDS (mssql)
      ▼
SQL database in Fabric: fcr (production), fcr-dev (local development)
```

The site and the API are same-site (both under fabriccreditratings.com), so a SameSite=Lax cookie set by the API is sent on the site's fetch calls in every browser.

### What touches Fabric

- `/rate` and `/admin` requests.
- One snapshot fetch per deploy.

Public page views cost no capacity. If the capacity is paused, the public site keeps serving the last published ratings, and `/rate` and `/admin` show a "database unavailable" message.

## Data model (`db/schema.sql`)

Summary; the exact, idempotent DDL is `db/schema.sql` (Plan 1, Task 8).

```sql
workloads (
  id          varchar(64)   PRIMARY KEY,        -- 'data-engineering'
  name        nvarchar(100) NOT NULL,
  short_name  nvarchar(30)  NOT NULL,           -- nav label
  blurb       nvarchar(300) NOT NULL,
  sort_order  int NOT NULL,
  updated_at  datetime2 NOT NULL
)
artifacts (
  id          varchar(64)   PRIMARY KEY,        -- 'notebook'
  name        nvarchar(100) NOT NULL,
  workload_id varchar(64)   NOT NULL REFERENCES workloads(id),
  status      varchar(10)   NOT NULL CHECK (status IN ('ga','preview','retired')),
  sort_order  int NOT NULL,
  updated_at  datetime2 NOT NULL
)
users (
  id                  int IDENTITY PRIMARY KEY,
  login               varchar(40)  NOT NULL UNIQUE, -- stored lowercase
  display_name        nvarchar(80) NOT NULL,
  password_hash       varchar(255) NOT NULL,
  role                varchar(10)  NOT NULL CHECK (role IN ('admin','rater')),
  active              bit NOT NULL DEFAULT 1,
  created_at          datetime2 NOT NULL,
  password_changed_at datetime2 NOT NULL
)
sessions (
  token_hash  char(64) PRIMARY KEY,              -- sha256 hex of the cookie token
  user_id     int NOT NULL REFERENCES users(id),
  created_at  datetime2 NOT NULL,
  expires_at  datetime2 NOT NULL
)
login_attempts (
  attempt_key  varchar(100) PRIMARY KEY,         -- 'login:<login>' or 'ip:<address>'
  failures     int NOT NULL,
  window_start datetime2 NOT NULL,
  locked_until datetime2 NULL
)
rounds (
  id           varchar(8)   PRIMARY KEY,         -- '2026-Q4', matches ^\d{4}-[A-Z0-9]{1,3}$
  label        nvarchar(40) NOT NULL,            -- 'Q4 2026'
  status       varchar(10)  NOT NULL CHECK (status IN ('open','published')),
  published_on date NULL,
  updated_at   datetime2 NOT NULL
)
CREATE UNIQUE INDEX ux_rounds_one_open ON rounds(status) WHERE status = 'open';
scores (
  round_id    varchar(8)  NOT NULL REFERENCES rounds(id),
  user_id     int         NOT NULL REFERENCES users(id),
  artifact_id varchar(64) NOT NULL REFERENCES artifacts(id),
  capability  tinyint NOT NULL CHECK (capability BETWEEN 1 AND 7),
  ux          tinyint NOT NULL CHECK (ux BETWEEN 1 AND 7),
  cost        tinyint NOT NULL CHECK (cost BETWEEN 1 AND 7),
  updated_at  datetime2 NOT NULL,
  PRIMARY KEY (round_id, user_id, artifact_id)
)
CREATE INDEX ix_scores_artifact ON scores(artifact_id);  -- an item delete's FK check seeks instead of scanning
notes (
  round_id    varchar(8)  NOT NULL REFERENCES rounds(id),
  artifact_id varchar(64) NOT NULL REFERENCES artifacts(id),
  body        nvarchar(2000) NOT NULL,
  updated_at  datetime2 NOT NULL,
  updated_by  int NULL REFERENCES users(id),     -- NULL for seeded notes
  PRIMARY KEY (round_id, artifact_id)
)
CREATE INDEX ix_notes_artifact ON notes(artifact_id);
site_state (
  id               int PRIMARY KEY CHECK (id = 1),
  last_snapshot_at datetime2 NULL,               -- set by POST /api/build/snapshot/deployed
  changed_at       datetime2 NULL                -- stamped by every change to public data
)
```

### Rules

- A rater's scorecard for a round is their `scores` rows. An item they skipped has no row. Saving a scorecard replaces all of that user's rows for the round in one transaction.
- Users are never hard-deleted (scores reference them). They're disabled.
- Items are retired rather than deleted. An item can be deleted only if no scores or notes reference it.
- The three factors (capability, ux, cost) stay in code. They are the shape of every score.

## Grade math stays server-side

Today's `src/domain/scale.ts` is split:

- `src/domain/grades.ts` (public): grade list, bands, band metadata, `gradeIndex`, `bandOf`, `spokenGrade`, `medianGrade`, `isInvestmentGrade`. The public components need these.
- `api/src/domain/formula.ts` (API only): the total-to-grade table, `totalOf`, `gradeForTotal`, `WITHDRAWN_GRADE`.

`aggregate.ts` moves to `api/src/domain/`. The public site and the admin receive computed grades, so the formula ships in no public file. Sequencing: both files stay in `src/domain/` (imported by the API) until Plan 2 removes the last front-end import. Plan 3 then moves them, and `api/src/boundary.test.ts` guards the split.

Shared types stay in `src/domain/types.ts` (`Rating`, `RatingPoint`, `FactorValues`, `Grade`, `Band`, ...). API payloads are in `src/domain/api-types.ts`. The site and the API import them type-only.

## API

All responses are JSON. Errors look like `{ "error": "<message>" }`, with status 400 (invalid input), 401 (not logged in), 403 (wrong role), 404, 409 (state conflict, such as a round not open), 415 (a write that isn't JSON), 502 (the AI draft or GitHub refused), or 503 (database unavailable).

### Auth (anyone)

| Method + path | Body | Result |
|---|---|---|
| `POST /api/auth/login` | `{ login, password }` | 200 `{ id, login, displayName, role }` and sets the session cookie. The session is created only if the user is still active with the password that was checked, so a reset or disable that lands during the login gives 401 "Wrong login or password." |
| `POST /api/auth/logout` | none | 204. Clears the cookie, then deletes the session. If the delete fails, the answer is 503 (database not responding) or 500, and it still clears the cookie, so the browser is logged out either way. A logout with no session cookie answers 204 without touching the database |
| `GET /api/me` | none | 200 `{ id, login, displayName, role }` or 401 |
| `PUT /api/me/password` | `{ current, next }` | 204. The new hash and the end of the user's other sessions commit in one transaction. The change applies only if the password is still the one just checked: if an admin reset it or disabled the user in the meantime, the answer is 400 "Your current password is wrong." and nothing changes, so no session ends |

### Rater (any logged-in user)

| Method + path | Body | Result |
|---|---|---|
| `GET /api/catalog` | none | `{ workloads, artifacts }` in sort order |
| `GET /api/rounds/open` | none | `{ round }` or `{ round: null }` |
| `GET /api/rounds/open/my-scores` | none | `{ round, scores: Record<artifactId, [c,u,k]>, updatedAt, previous }`, where `previous` is the caller's card from the newest published round they scored. 409 when no round is open |
| `PUT /api/rounds/open/my-scores` | `{ round, scores }` | 200, the same shape as GET. Replaces the caller's card. 409 if `round` is not the open round, or if an item on the card was deleted after the check ("An item on this card was just deleted. Reload the page to get the current list.") |

The rater page's "Start from current ratings" uses the bundled `snapshot.json` (rounded averages), not an API call. "Start from my <previous round> scores" uses `previous`.

### Admin (role `admin`)

| Method + path | Body | Result |
|---|---|---|
| `GET /api/admin/rounds` | none | every round, with scorecard and note counts |
| `POST /api/admin/rounds` | `{ id, label }` | opens a round and returns every round. 409 if one is already open or the id exists |
| `PUT /api/admin/rounds/:id` | `{ status: 'published', publishedOn }` or `{ status: 'open' }` | publish, or reopen the latest published round when no round is open. Returns `{ rounds, deploy }`. A `publishedOn` earlier than the latest published round's gets 400 ("Publish dates can't be earlier than <label>'s (<date>)."); the same day and future dates are allowed. The latest published round is the one with the latest publish date; rounds published on the same date fall back to round order, so the one whose id sorts last counts as latest. A lower-id round published that day therefore doesn't become the latest, which is accepted because round ids are created in order |
| `GET /api/admin/rounds/:id/review` | none | the raters, and per item: averaged scores, grade, change from the previous published round, per-rater scores. Plus the notes and whether AI drafting is configured |
| `PUT /api/admin/rounds/:id/scores/:userId` | `{ scores }` | replaces any user's card in any round, published included. Returns the review. A `userId` that isn't 1 to 9 digits gets 404. An item deleted after the check gets 409, as on the rater's save |
| `PUT /api/admin/rounds/:id/notes/:artifactId` | `{ body }` | 204. Saves the why text. An empty body deletes it. A body that isn't text gets 400. An item deleted after the check gets 409 ("That item was just deleted. Reload the page to get the current list.") |
| `POST /api/admin/rounds/:id/draft/:artifactId` | none | `{ text }`, an AI-drafted why (existing `draft-why` logic), or 502 with the reason. Each Anthropic call times out after 40 s, with one retry. The whole draft, including the dataset load, gives up after 200 s ("Anthropic did not answer in time. Try again."). A rate limit on the key gets "Anthropic's rate limit for this key was reached. Wait a minute, then try again.", and an overload gets "Anthropic is overloaded right now. Try again in a minute." |
| `GET /api/admin/catalog` | none | workloads and items with sort orders, and whether each item is referenced |
| `POST /api/admin/workloads`, `PUT /api/admin/workloads/:id` | `{ id?, name, shortName, blurb, sortOrder? }` | create or edit. Create ignores `sortOrder` and appends to the end; an edit without it keeps the current order. Returns the admin catalog. A new id that names a built-in object property (`constructor`, `__proto__`, `toString`, …) or `prototype` gets 400 ("Workload id <id> is reserved. Pick another id.") |
| `POST /api/admin/artifacts`, `PUT /api/admin/artifacts/:id`, `DELETE /api/admin/artifacts/:id` | `{ id?, name, workload, status, sortOrder? }` | create, edit, or delete (delete only when unreferenced, else 409). A delete that loses a deadlock to a save adding that item gets 503 ("Someone was saving a score or note for <name> at the same moment. Try again."). Create ignores `sortOrder` and appends to the end of the item's workload, and refuses the same reserved ids ("Item id <id> is reserved. Pick another id."). Returns the admin catalog |
| `GET /api/admin/users`, `POST /api/admin/users` | `{ login, displayName, role, password }` | list or create. Returns every user |
| `PUT /api/admin/users/:id` | any of `{ displayName, role, active, password }` | edit. Disabling or a new password ends the user's sessions; setting your own password keeps your current session. Returns every user. An id that isn't 1 to 9 digits gets 404 |
| `GET /api/admin/site` | none | `{ lastSnapshotAt, behind, deployConfigured }` |
| `POST /api/admin/site/update` | none | starts the deploy workflow. 502 if GitHub refuses or dispatch isn't configured |

`behind` is true when `site_state.changed_at` is at or after `last_snapshot_at`, or when no deploy has confirmed a snapshot yet. Both are compared to the millisecond, and a tie counts as behind. Every handler that changes public data stamps `changed_at`: publish, reopen, edits to published scores or notes, and catalog edits. A computed "newest `updated_at`" query would miss a reopened round.

Publishing a round also starts the deploy workflow. An admin can't demote or disable themselves, and a change that would leave no active admin is refused. The check runs under a lock, so two admins changing each other at once can't both succeed. A caller who lost admin rights while the request waited for that lock gets 403 ("Only admins can do that.").

### Build

| Method + path | Auth | Result |
|---|---|---|
| `GET /api/build/snapshot` | `Authorization: Bearer <SNAPSHOT_TOKEN>` | the snapshot JSON. Writes nothing. `generatedAt` is the database's time (`SYSUTCDATETIME()`), read before the data is loaded. The clock read waits for any write transaction that has already marked the site changed, so a change is either in the snapshot or stamped no earlier than its `generatedAt`. `markChanged` stamps twice in one batch: the first UPDATE takes the row lock, and the second records the time once it holds it. |
| `POST /api/build/snapshot/deployed` | `Authorization: Bearer <SNAPSHOT_TOKEN>` | body `{ generatedAt }`, the deployed snapshot's. 204. Sets `site_state.last_snapshot_at` to it, only ever forward. 400 unless it's an ISO timestamp exactly as the snapshot gave it and no more than 5 minutes in the future. Skips the `Origin` check, since GitHub Actions sends none and the token is the protection, but still needs `Content-Type: application/json` |

## Auth and security

- **Password hashing.** scrypt from `node:crypto` (N=32768, r=8, p=3, 16-byte salt, 64-byte key, password NFKC-normalized), stored as `scrypt$32768$8$3$<salt b64>$<hash b64>` and compared with `timingSafeEqual`. Length is 10 to 200 characters. Logins are case-insensitive (stored lowercase).
- **Session token.** 32 random bytes, base64url. Only its sha256 is stored. Lifetime is 30 days. When a request arrives and less than 29 days remain, `expires_at` is reset to 30 days from now, so the session row is written at most once a day.
- **Cookie.** In production it's `__Host-fcr_session` with HttpOnly, Secure, SameSite=Lax, Path=/. In local dev it's `fcr_session` without Secure (controlled by `COOKIE_SECURE=false`).
- **CORS.** `Access-Control-Allow-Origin` is echoed only for origins in `ALLOWED_ORIGINS` (production: `https://fabriccreditratings.com` and `https://www.fabriccreditratings.com`), with `Allow-Credentials: true`.
- **CSRF.** SameSite=Lax, plus every mutating request must have `Content-Type: application/json` and an `Origin` header in `ALLOWED_ORIGINS`, except build-token calls (`build/snapshot/deployed`), which have no browser Origin and are authenticated by `SNAPSHOT_TOKEN`; they still need a JSON content type.
- **Brute force.** Failures are tracked per login and per IP. Ten failures within 15 minutes lock that key for 15 minutes. Every failure returns the same message: "Wrong login or password".
- **Permissions** live in one pure module (`api/src/lib/permissions.ts`), so they can be unit-tested:
  - Raters write only their own card, and only in the open round.
  - Admins write any card in any round.
  - Disabled users have no sessions.
- **Secrets** live only in Function App settings: the Anthropic key, the GitHub token, and the snapshot token. Fabric access uses the managed identity, so there's no Fabric secret anywhere.

## Snapshot and deploy

### Snapshot shape (`src/data/snapshot.json`)

```json
{
  "generatedAt": "2026-10-20T15:04:05.000Z",
  "asOf": "2026-10-20",
  "workloads": [{ "id": "data-engineering", "name": "Data Engineering", "shortName": "Data Eng", "blurb": "..." }],
  "ratings": [
    {
      "artifact": { "id": "notebook", "name": "Notebook", "workload": "data-engineering", "status": "ga" },
      "current": { "round": "2026-Q4", "roundLabel": "Q4 2026", "date": "2026-10-20",
                   "scores": { "capability": 6.5, "ux": 5.5, "cost": 4.5 }, "raters": 2,
                   "grade": "A+", "note": "..." },
      "history": [ "...RatingPoint, oldest to newest; the last one is current..." ]
    }
  ]
}
```

- Only published rounds count.
- An item appears only if it has a point in at least one published round. A workload appears only if it has at least one such item.
- `asOf` is the newest `published_on`.
- Averages, the retired-is-E rule, and history semantics are unchanged from the current `aggregate.ts`.
- No per-rater data is included.

### `.github/workflows/deploy.yml`

Triggers: push to `main`, `workflow_dispatch`. Permissions: `contents: write`, `pages: write`, `id-token: write`.

1. Checkout, setup-node, `npm ci`.
2. When the `API_URL` variable is set, `npm run snapshot` (`scripts/snapshot.ts`) fetches `${API_URL}/api/build/snapshot` with `secrets.SNAPSHOT_TOKEN`, with a timeout of about 200 seconds so a paused database can wake (under the 230-second Functions limit), and one retry on a 503. On HTTP 200 with a valid snapshot it writes `src/data/snapshot.json`, and it skips the write when only `generatedAt` differs. Either way it outputs the fetched `generatedAt` for step 5. On any failure it keeps the committed file, logs a warning, and outputs nothing. Locally the same script reads the token from `api/local.settings.json`.
3. If the snapshot changed, commit it as `github-actions[bot]` ("Snapshot <asOf>") and push with a pull-rebase retry. `GITHUB_TOKEN` commits don't retrigger the workflow.
4. Build, upload `dist`, deploy to Pages.
5. After `actions/deploy-pages` succeeds, if step 2 output a `generatedAt`, POST it as `{ generatedAt }` to `${API_URL}/api/build/snapshot/deployed` with the same token. That includes the run where step 2 skipped the write because only `generatedAt` differed, since the deployed data is the same. If the fetch failed, the run doesn't POST, because the site still shows the committed file. So a failed fetch, or a deploy that fails or is cancelled after it, leaves `last_snapshot_at` where it was, and the admin page still shows the site as behind.

The function starts the workflow with `POST https://api.github.com/repos/<GITHUB_REPO>/actions/workflows/<GITHUB_WORKFLOW>/dispatches` and `{ "ref": "<GITHUB_BRANCH>" }` (defaults `deploy.yml` and `main`). It uses a fine-grained token scoped to this repo with Actions read/write, and the token expires within a year. Changes reach the site about 2 minutes after publish or "Update public site".

## Front end

### Public site (`/`)

- Reads `snapshot.json` in place of `getRatings()`, `getWorkloads()`, and the round globs.
- No "Not rated" rows or NR counts.
- The header stat becomes "Items rated: N" (no "of 78").
- The footer always shows "Raters: log in", linking to `/rate`.

### Rater page (`/rate`, `rate.html`)

- Shows a login form when there is no session. After login:
  - the open round's matrix (existing `ScoreMatrix`), built from `GET /api/catalog`, prefilled with the rater's saved card;
  - "Start from my <previous round> scores" and "Start from current ratings" buttons;
  - Save;
  - a saved/unsaved state;
  - a change-password dialog;
  - log out.
- The draft persists in localStorage, keyed by user and round, as `{ base, draft }`: `base` is the saved card the draft started from. A stored draft is restored only if it differs from its base. So a draft with no edits never hides a newer saved card (from another device, or an admin edit).
- With no open round, it shows "No review round is open right now."

### Admin (`/admin`, `admin.html`)

Requires the admin role; raters who open it are sent to `/rate`. Tabs:

- **Score.** The admin's own card, the same component as `/rate`.
- **Review & why.**
  - A round picker (open and published).
  - Per item: averaged scores, grade, change from the previous published round, per-rater breakdown, why text with 700 ms debounced autosave, and Draft with AI.
  - "Edit this rater's card" opens that rater's scores in the matrix.
  - "Draft all blank" and the "Only missing a why" filter carry over.
- **Publish.**
  - The checklist (every scored item has a why, with an override) and the publish date.
  - Publish, and reopen the latest round.
  - Site status: "Public site is up to date" or "Public site is behind", with an Update public site button.
- **Catalog.** Workloads and items: add, rename, reorder, change workload, set status, delete when unreferenced.
- **Users.** List, create (login, display name, role, password), edit name and role, set a new password, disable or enable.

### Build inputs

`index.html`, `rate.html`, `admin.html`. The Vite dev server proxies `/api` to the local Functions host (`http://localhost:7071`), so the cookie is same-origin in development. The built site calls `VITE_API_URL` (`.env.production`: `https://api.fabriccreditratings.com`). Every front-end request goes through `src/lib/api.ts`.

## Errors in the UI

- **503 from the API.** "The ratings database is not responding. Try again in a minute." A failed save adds "Your draft is kept in this browser."
- **401 mid-session.** The page returns to its login form with "Your session ended. Log in again; unsaved scores are still in this browser." After login, the draft is restored and the user saves again.
- **409 on a rater save.** The server's message (for example "The open round is now Q1 2027. Reload the page to score it."), plus "Your draft is kept in this browser."
- **Slow first request.** After 4 seconds, a notice reads "Waking the ratings database. The first request after a quiet spell can take up to a minute." The DB connection retries 3 times with backoff (2, 5, and 10 seconds).

## Seed (`db/seed.ts`)

An idempotent run (upserts on primary keys) against the database in `api/local.settings.json`, or the one named with `--server` and `--database`. It authenticates with the developer's `az login` identity. Usage: `npm run db:seed -- --admin <login> --name "<display name>"`.

1. An admin user, if the login doesn't exist yet. The password comes from `FCR_ADMIN_PASSWORD`, which the docs fill with `Read-Host -MaskInput`. It's never echoed or logged.
2. Workloads and artifacts from the current `src/data/workloads.ts` and `src/data/artifacts.ts`, keeping their order as `sort_order`. Before writing any, it refuses an id the admin catalog would refuse as reserved, naming the file and the id ("src/data/<file>: the id <id> is reserved. Rename it, then seed again.").
3. Rounds, notes, and scores from `src/data/rounds/*`. Today that's `2026-Q4`: open, no scores, no notes.

Both `fcr-dev` (Plan 1) and `fcr` (Plan 3) get the full seed. Plan 3 then deletes the data files, and `seed.ts` keeps only step 1, which is still useful for bootstrapping a fresh database. Copying production data into `fcr-dev` is not part of this work.

## Repo changes

### Added

```text
api/                      Azure Functions app (own package.json, tsconfig, esbuild bundle)
  src/functions/          health, auth, rater, build, admin-rounds, admin-catalog, admin-users, admin-site
  src/lib/                db, http (CORS, CSRF, errors), current-user, password, session, lockout,
                          permissions, validate, config, github, draft-why
  src/repo/               SQL per table group
  src/domain/             dataset, snapshot, review; aggregate and formula (moved in Plan 3)
src/domain/api-types.ts   API request/response types
src/domain/grades.ts      public grade helpers (split from scale.ts)
db/schema.sql, db/target.ts, db/apply.ts, db/seed.ts
admin.html, src/admin/, src/account/, src/lib/api.ts, .env.production
src/data/snapshot.json, scripts/snapshot.ts
vitest.config.ts
.github/workflows/api-deploy.yml
```

### Removed

- Plan 2: `.github/workflows/intake.yml`, `scripts/intake.ts`, `src/domain/payload.ts`, `src/data/site.ts`
- Plan 2: `desk.html`, `src/desk/` (replaced by `src/admin/`), `scripts/desk-api.ts`, `scripts/rounds-fs.ts`, `scripts/draft-why.ts` (moved to the API), `src/data/raters.json`, `.env.example`, the root `@anthropic-ai/sdk` dependency, the desk plugin in `vite.config.ts`, and the `desk` npm script
- Plan 3, after seeding `fcr`: `src/data/rounds/`, `src/data/artifacts.ts`, `src/data/workloads.ts`

### Kept

- Public components.
- `src/rating-ui/` (`ScoreMatrix`, `draft.ts`, `usePersistentDraft`).
- `src/data/factors.ts`, `src/lib/format.ts`.

## Setup (done once; the plan spells out every click)

1. **Fabric.**
   - Create SQL databases `fcr` and `fcr-dev` in the F SKU workspace.
   - In tenant settings (Developer settings), enable "Service principals can use Fabric APIs", scoped to a security group that contains the Function App identity.
2. **Azure.**
   - Create a Function App on Flex Consumption with Node 24 (512 MB instances, at most 10), plus a storage account and Application Insights, in the capacity's subscription. HTTPS only, and no platform CORS (the API sends its own).
   - Turn on the system-assigned managed identity.
3. **Database access.**
   - Share `fcr` with the identity, with no additional permissions (the Read item permission).
   - In `fcr`, run `CREATE USER [<function app name>] FROM EXTERNAL PROVIDER` and grant `db_datareader` and `db_datawriter`.
4. **App settings.** `SQL_SERVER`, `SQL_DATABASE`, `ALLOWED_ORIGINS` (`https://fabriccreditratings.com,https://www.fabriccreditratings.com`), `COOKIE_SECURE=true`, `SNAPSHOT_TOKEN`, `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH`, `GITHUB_WORKFLOW`, `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID` (optional), `ANTHROPIC_MODEL` (optional).
5. **Bluehost DNS.**
   - CNAME `api` → the Function App's default host name, and TXT `asuid.api` → the verification ID.
   - Bind the custom domain with an App Service managed certificate (portal only for Flex Consumption).
6. **GitHub.**
   - Variable `API_URL`; secret `SNAPSHOT_TOKEN`.
   - A user-assigned identity with Website Contributor on the app, and a federated credential for the repo's `api` environment. `api-deploy.yml` signs in through it, so there's no publish-profile secret. Variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_FUNCTIONAPP_NAME`.

### Verified while planning, and checked during setup

- Flex Consumption supports Node 24 and App Service managed certificates (site-scoped, added in the portal).
- Fabric's docs require the Read item permission and the "Service principals can use Fabric APIs" tenant setting for a service principal or managed identity to connect. Newer tenants may split that setting; Plan 3 says which one to pick.
- Whether the last `X-Forwarded-For` entry, which the per-address lockout keys on, is the caller's real address on the deployed app, rather than one a client can set or one every caller shares. Plan 3 Task 8 Step 5 checks this. If it isn't, the lockout switches to a header the platform sets and the client can't override, or (a spec change, decided then) drops the per-address key and relies on the per-login limit.
- The first connection to an idle Fabric SQL database can take up to a minute. The UI shows the "Waking the ratings database" notice after 4 seconds.

## Local development

- `npm run dev`: Vite site at `http://localhost:5173`, plus `/rate.html` and `/admin.html`.
- `npm run api`: Azure Functions Core Tools on port 7071, connecting to `fcr-dev` with `DefaultAzureCredential` (the developer's `az login`).
- Env for local Functions: `api/local.settings.json` (gitignored), with `local.settings.example.json` committed.
- `npm run snapshot` refreshes `src/data/snapshot.json` from the local API. Don't commit a snapshot built from `fcr-dev`.

## Testing

- **Unit (Vitest, new dev dependency):**
  - password hash and verify;
  - session token hashing and expiry renewal;
  - every rule in `permissions.ts`;
  - snapshot building: unscored items excluded, workloads without rated items excluded, retired is E, averages and history match the current behavior, no per-rater fields.
  - the front end's API client, draft restore rule, round suggestion, catalog reordering, and password generator;
  - a boundary test that keeps the formula out of the site sources.
- **Integration, against `fcr-dev` (runs when `FCR_API_URL` is set):**
  - origin check, user creation and login, raters kept out of admin routes;
  - a taken login gets 409. So does an admin removing their own admin access, a check that runs only when exactly one admin is active, so the last-admin rule backs it up; otherwise it's skipped;
  - a card saved in the open round shows in the admin review, and a stale round gets 409;
  - the snapshot needs the build token and has no rater names, and deploy confirmations need the token too;
  - an admin password reset ends the user's sessions and swaps the password;
  - disabling a user ends their sessions and their login gets 401, and a login locks after 10 failures.

  Before any test writes, the suite proves that the API host and its own connection use the same database.
- **Opt-in database tests (run when `FCR_DB_TESTS` is set):** login-attempt counting, card-write locking, the admin-count lock, and the site-changed stamp's row lock. Every test that writes rows, these and the integration suite, refuses a database whose name doesn't start with `fcr-dev`.
- **Browser end-to-end against `fcr-dev` (Plan 2, Task 12):** rater and admin scoring, review and whys, editing a rater's card, publish, snapshot, a silent edit flagged as "behind", the next round, catalog edits, and session end.
- **Live check after cutover (Plan 3, Task 10):** a rater logs in, saves, and changes their password. The admin creates users and starts a site update.

## Rollout

All work happens on the `login-backend` branch, because every push to `main` deploys the live site. The live site doesn't change until the merge in Plan 3.

1. **Plan 1:** the schema and seed in `fcr-dev`, and the whole API running locally.
2. **Plan 2:** the rater page, admin, and public site on the API and snapshot. The desk and GitHub intake are removed.
3. **Plan 3:** the `fcr` database and full seed, then the repo data files are removed. Then Azure resources, the API deploy, and DNS for `api.fabriccreditratings.com`. Then the merge to `main`.

## Out of scope

- Password-reset emails.
- Multi-factor login.
- A Power BI report on the ratings. The data is in OneLake, so it can be added later.
- Showing rater names publicly.
- "Revised" markers on edited ratings.
