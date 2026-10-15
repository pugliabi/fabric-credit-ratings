# Rater logins, online admin, and a Fabric SQL backend

Date: 2026-10-15
Status: approved in brainstorming, pending spec review

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
api.fabriccreditratings.com  (Azure Functions, Node 22, TypeScript)
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

```sql
workloads (
  id          varchar(64)  PRIMARY KEY,         -- 'data-engineering'
  name        nvarchar(120) NOT NULL,
  blurb       nvarchar(300) NOT NULL,
  sort_order  int NOT NULL,
  updated_at  datetime2 NOT NULL
)
artifacts (
  id          varchar(64)  PRIMARY KEY,         -- 'notebook'
  name        nvarchar(160) NOT NULL,
  workload_id varchar(64)  NOT NULL REFERENCES workloads(id),
  status      varchar(10)  NOT NULL CHECK (status IN ('ga','preview','retired')),
  sort_order  int NOT NULL,
  updated_at  datetime2 NOT NULL
)
users (
  id                  int IDENTITY PRIMARY KEY,
  login               nvarchar(120) NOT NULL UNIQUE, -- stored lowercase
  display_name        nvarchar(120) NOT NULL,
  password_hash       varchar(200) NOT NULL,
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
  [key]        nvarchar(200) PRIMARY KEY,        -- 'login:<login>' or 'ip:<address>'
  failures     int NOT NULL,
  window_start datetime2 NOT NULL,
  locked_until datetime2 NULL
)
rounds (
  id           varchar(8)   PRIMARY KEY,         -- '2026-Q4', matches ^\d{4}-[A-Za-z0-9]{1,3}$
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
notes (
  round_id    varchar(8)  NOT NULL REFERENCES rounds(id),
  artifact_id varchar(64) NOT NULL REFERENCES artifacts(id),
  body        nvarchar(max) NOT NULL,
  updated_at  datetime2 NOT NULL,
  updated_by  int NOT NULL REFERENCES users(id),
  PRIMARY KEY (round_id, artifact_id)
)
site_state (
  id               int PRIMARY KEY CHECK (id = 1),
  last_snapshot_at datetime2 NULL
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

`aggregate.ts` moves to `api/src/domain/`. The public site and the admin receive computed grades, so the formula ships in no public file.

Shared types (`Rating`, `RatingPoint`, `FactorValues`, `Grade`, `Band`, snapshot types, API payloads) live in `shared/types.ts`. The site and the API import them type-only.

## API

All responses are JSON. Errors look like `{ "error": "<message>" }`, with status 400 (invalid input), 401 (not logged in), 403 (wrong role), 404, 409 (state conflict, such as a round not open), or 503 (database unavailable).

### Auth (anyone)

| Method + path | Body | Result |
|---|---|---|
| `POST /api/auth/login` | `{ login, password }` | 200 `{ user }` and sets the session cookie |
| `POST /api/auth/logout` | none | 204. Deletes the session and clears the cookie |
| `GET /api/me` | none | 200 `{ user: { id, login, displayName, role } }` or 401 |
| `PUT /api/me/password` | `{ currentPassword, newPassword }` | 204. Ends the user's other sessions |

### Rater (any logged-in user)

| Method + path | Body | Result |
|---|---|---|
| `GET /api/catalog` | none | `{ workloads, artifacts }` in sort order |
| `GET /api/rounds/open` | none | `{ round }` or `{ round: null }` |
| `GET /api/rounds/open/my-scores` | none | `{ round, scores: Record<artifactId, [c,u,k]> }` |
| `PUT /api/rounds/open/my-scores` | `{ round, scores }` | 204. Replaces the caller's card. 409 if `round` is not the open round |

The rater page's "Start from current ratings" uses the bundled `snapshot.json` (rounded averages), not an API call.

### Admin (role `admin`)

| Method + path | Body | Result |
|---|---|---|
| `GET /api/admin/rounds` | none | every round, with scorecard count and items scored |
| `POST /api/admin/rounds` | `{ id, label }` | opens a round. 409 if one is already open or the id exists |
| `PUT /api/admin/rounds/:id` | `{ status: 'published', publishedOn }` or `{ status: 'open' }` | publish, or reopen the latest published round when no round is open |
| `GET /api/admin/rounds/:id/review` | none | per item: averaged scores, grade, previous published grade and change, per-rater scores, note |
| `PUT /api/admin/rounds/:id/scores/:userId` | `{ scores }` | replaces any user's card in any round, published included |
| `PUT /api/admin/rounds/:id/notes/:artifactId` | `{ body }` | saves the why text. An empty body deletes it |
| `POST /api/admin/rounds/:id/draft/:artifactId` | none | `{ text }`, an AI-drafted why (existing `draft-why` logic) |
| `POST /api/admin/workloads`, `PUT /api/admin/workloads/:id` | workload fields | create or edit |
| `POST /api/admin/artifacts`, `PUT /api/admin/artifacts/:id`, `DELETE /api/admin/artifacts/:id` | item fields | create, edit, or delete (delete only when unreferenced) |
| `GET /api/admin/users`, `POST /api/admin/users` | `{ login, displayName, role, password }` | list or create |
| `PUT /api/admin/users/:id` | any of `{ displayName, role, active, password }` | edit. Disabling or a new password ends the user's sessions |
| `GET /api/admin/site` | none | `{ lastSnapshotAt, behind }` |
| `POST /api/admin/site/update` | none | starts the deploy workflow |

`behind` is true when the newest `updated_at` among published rounds, scores and notes in published rounds, artifacts, and workloads is later than `site_state.last_snapshot_at`.

Publishing a round also starts the deploy workflow. An admin can't demote themselves or disable the last active admin.

### Build

| Method + path | Auth | Result |
|---|---|---|
| `GET /api/build/snapshot` | `Authorization: Bearer <SNAPSHOT_TOKEN>` | the snapshot JSON. Sets `site_state.last_snapshot_at` |

## Auth and security

- **Password hashing.** scrypt from `node:crypto` (N=32768, r=8, p=1, 16-byte salt, 64-byte key), stored as `scrypt$32768$8$1$<salt b64>$<hash b64>` and compared with `timingSafeEqual`. Minimum length is 10 characters. Logins are case-insensitive (stored lowercase).
- **Session token.** 32 random bytes, base64url. Only its sha256 is stored. Lifetime is 30 days. When a request arrives and less than 29 days remain, `expires_at` is reset to 30 days from now, so the session row is written at most once a day.
- **Cookie.** In production it's `__Host-fcr_session` with HttpOnly, Secure, SameSite=Lax, Path=/. In local dev it's `fcr_session` without Secure (controlled by `COOKIE_SECURE=false`).
- **CORS.** `Access-Control-Allow-Origin` is echoed only for origins in `ALLOWED_ORIGINS` (production: `https://fabriccreditratings.com`), with `Allow-Credentials: true`.
- **CSRF.** SameSite=Lax, plus every mutating request must have `Content-Type: application/json` and an `Origin` header in `ALLOWED_ORIGINS`.
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
  "workloads": [{ "id": "data-engineering", "name": "Data Engineering", "blurb": "..." }],
  "ratings": [
    {
      "artifact": { "id": "notebook", "name": "Notebook", "workload": "data-engineering", "status": "ga" },
      "current": { "round": "2026-Q4", "roundLabel": "Q4 2026", "date": "2026-10-20",
                   "scores": { "capability": 6.5, "ux": 5.5, "cost": 4.5 }, "raters": 2,
                   "grade": "A+", "note": "..." },
      "history": [ "...RatingPoint, newest first..." ]
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
2. Fetch `${{ vars.API_URL }}/api/build/snapshot` with `secrets.SNAPSHOT_TOKEN`. On HTTP 200 with valid JSON, write `src/data/snapshot.json`. On any failure, keep the committed file and log a warning.
3. If the snapshot changed, commit it as `github-actions[bot]` ("Snapshot <asOf>") and push with a pull-rebase retry. `GITHUB_TOKEN` commits don't retrigger the workflow.
4. Build, upload `dist`, deploy to Pages.

The function starts the workflow with `POST https://api.github.com/repos/pugliabi/fabric-credit-ratings/actions/workflows/deploy.yml/dispatches` and `{ "ref": "main" }`. It uses a fine-grained token scoped to this repo with Actions read/write, and the token expires within a year. Changes reach the site about 2 minutes after publish or "Update public site".

## Front end

### Public site (`/`)

- Reads `snapshot.json` in place of `getRatings()`, `getWorkloads()`, and the round globs.
- No "Not rated" rows or NR counts.
- The header stat becomes "Items rated: N" (no "of 78").
- The footer always shows "Raters: log in", linking to `/rate`.

### Rater page (`/rate`, `rate.html`)

- Shows a login form when there is no session. After login:
  - the open round's matrix (existing `ScoreMatrix`), built from `GET /api/catalog`, prefilled with the rater's saved card;
  - a "Start from current ratings" button;
  - Save;
  - a saved/unsaved state;
  - a change-password dialog;
  - log out.
- The draft persists in localStorage, keyed by user and round (existing `usePersistentDraft`).
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

`index.html`, `rate.html`, `admin.html`. The Vite dev server proxies `/api` to the local Functions host (`http://localhost:7071`), so the cookie is same-origin in development.

## Errors in the UI

- **503 from the API.** "The ratings database is unavailable right now. Your draft is saved in this browser." Saves can be retried.
- **401 mid-session.** An inline login on the same page. The draft is kept and the save retries after login.
- **409 on a rater save.** "Q4 2026 was published, so changes are closed." The draft is kept.
- **Slow first request.** Cold starts are covered by a "Saving…" or "Loading…" state. The DB connection retries up to 3 times with backoff.

## Seed (`db/seed.ts`)

A one-time, idempotent run (MERGE on primary keys) against a target database (`--db fcr-dev` or `--db fcr`), authenticated with the developer's `az login` identity:

1. Workloads and artifacts from the current `src/data/workloads.ts` and `src/data/artifacts.ts`, keeping their order as `sort_order`.
2. Rounds, notes, and scores from `src/data/rounds/*`. Today that's `2026-Q4`: open, no scores, no notes.
3. An admin user. It prompts for login, display name, and password. The password is never echoed or logged.

Steps 1 and 2 read files that rollout step 6 deletes. In step 6, `seed.ts` drops them and keeps only step 3 (`--admin-only`), which is still useful for bootstrapping a fresh database. Copying production data into `fcr-dev` is not part of this work.

## Repo changes

### Added

```text
api/                      Azure Functions app (own package.json, tsconfig)
  src/functions/          auth.ts, me.ts, catalog.ts, rounds.ts, scores.ts, notes.ts,
                          admin-catalog.ts, admin-users.ts, admin-site.ts, draft.ts, build.ts
  src/lib/                db.ts, password.ts, session.ts, permissions.ts, http.ts (CORS, errors), github.ts
  src/domain/             aggregate.ts, formula.ts, snapshot.ts, draft-why.ts
shared/types.ts
db/schema.sql, db/seed.ts
admin.html, src/admin/
src/data/snapshot.json
.github/workflows/api-deploy.yml
```

### Removed

- `.github/workflows/intake.yml`, `scripts/intake.ts`, `src/domain/payload.ts`
- `desk.html`, `src/desk/` (replaced by `src/admin/`), `scripts/desk-api.ts`, `scripts/rounds-fs.ts`
- `src/data/raters.json`, `src/data/rounds/`, `src/data/artifacts.ts`, `src/data/workloads.ts` (after seeding)
- The desk plugin in `vite.config.ts`, and the `desk` npm script

### Kept

- Public components.
- `src/rating-ui/` (`ScoreMatrix`, `draft.ts`, `usePersistentDraft`).
- `src/data/factors.ts`, `src/lib/format.ts`.

## Setup (done once; the plan spells out every click)

1. **Fabric.**
   - Create SQL databases `fcr` and `fcr-dev` in the F SKU workspace.
   - In tenant settings, allow service principals to use Fabric APIs, scoped to a security group that contains the Function App identity.
2. **Azure.**
   - Create a Function App on Flex Consumption with Node 22, plus a storage account and Application Insights, in the capacity's subscription.
   - Turn on the system-assigned managed identity.
3. **Database access.**
   - Give the identity Read on the `fcr` item.
   - In `fcr`, run `CREATE USER [<function app name>] FROM EXTERNAL PROVIDER` and grant `db_datareader` and `db_datawriter`.
4. **App settings.** `SQL_SERVER`, `SQL_DATABASE`, `ALLOWED_ORIGINS`, `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID`, `ANTHROPIC_MODEL` (optional), `GITHUB_DISPATCH_TOKEN`, `SNAPSHOT_TOKEN`.
5. **Bluehost DNS.**
   - CNAME `api` → `<app>.azurewebsites.net`, and TXT `asuid.api` → the verification ID.
   - Bind the custom domain with a managed certificate.
6. **GitHub.**
   - Variable `API_URL`; secret `SNAPSHOT_TOKEN`.
   - A federated credential (OIDC) on a user-assigned identity or app registration for `api-deploy.yml`, so there's no publish-profile secret.

### Verify during setup (each has a fallback)

- **Flex Consumption supports App Service managed certificates for the custom domain.** Fallback: a Consumption-plan Function App, which supports them.
- **The tenant setting in step 1 is what a managed identity needs to open a TDS connection to a Fabric SQL database.** If the docs name a different setting, use that one. Either way, it stays scoped to the security group.
- **How long the first connection to an idle Fabric SQL database takes.** If it's above about 10 seconds, the UI copy says "Waking the database…" and the retry budget increases.

## Local development

- `npm run dev`: Vite site, `/rate`, `/admin`.
- `npm run api`: Azure Functions Core Tools on port 7071, connecting to `fcr-dev` with `DefaultAzureCredential` (the developer's `az login`).
- Env for local Functions: `api/local.settings.json` (gitignored), with `local.settings.example.json` committed.

## Testing

- **Unit (Vitest, new dev dependency):**
  - password hash and verify;
  - session token hashing and expiry renewal;
  - every rule in `permissions.ts`;
  - snapshot building: unscored items excluded, workloads without rated items excluded, retired is E, averages and history match the current behavior, no per-rater fields.
- **Integration, against `fcr-dev`:**
  - log in, save a card, admin edits a published card, publish, then the snapshot reflects it;
  - a rater gets 409 on a closed round and 403 on admin routes;
  - a login lockout after 10 failures.
- **Browser end-to-end after deploy:**
  - a rater logs in, saves, and changes their password;
  - the admin creates a user, publishes, sees the "behind" banner after an edit, and clicks Update public site, and the site updates.

## Rollout

Each step ships on its own. The current site keeps working until step 6.

1. Schema and seed into `fcr-dev` and `fcr`.
2. API: auth, users, sessions.
3. Rater page on the API.
4. Admin on the API.
5. Snapshot endpoint and the deploy workflow change. The public site switches to `snapshot.json`.
6. Remove the GitHub intake, the local desk, and the repo round files.
7. DNS for `api.fabriccreditratings.com`.

## Out of scope

- Password-reset emails.
- Multi-factor login.
- A Power BI report on the ratings. The data is in OneLake, so it can be added later.
- Showing rater names publicly.
- "Revised" markers on edited ratings.
