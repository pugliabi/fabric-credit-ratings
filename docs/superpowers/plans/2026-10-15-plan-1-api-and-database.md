# Plan 1: API and Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Azure Functions API that runs locally against the `fcr-dev` SQL database in Fabric. It handles rater logins, each rater's own scorecard, admin editing of rounds, scores, notes, catalog, and users, and builds the public snapshot.

**Architecture:** TypeScript Azure Functions (v4 programming model, Node 24) in `api/`, bundled with esbuild. The domain code stays in `src/domain/` and the API bundles it, so grade math lives in one place. SQL goes through `mssql` with an Entra access token from `DefaultAzureCredential` (your `az login` locally, the Function App's managed identity in Azure). Sessions are random tokens in an HttpOnly cookie; only their SHA-256 is stored.

**Tech Stack:** Azure Functions Core Tools 4, `@azure/functions` 4, `mssql`, `@azure/identity`, `@anthropic-ai/sdk`, esbuild, Vitest, Node 24 type stripping for `db/*.ts` scripts.

**Spec:** `docs/superpowers/specs/2026-10-15-login-fabric-backend-design.md`

**Series:** Plan 1 of 3. Plan 2 moves the rater page, admin page, and public site onto this API and retires the local desk and the GitHub intake. Plan 3 sets up Azure, cuts over, and removes the repo round files.

**Branch:** All three plans run on the `login-backend` branch. Every push to `main` deploys the live site, so nothing merges to `main` until Plan 3's cutover.

## Global Constraints

- Never print or commit secrets: `.env`, `api/local.settings.json`, passwords, tokens, keys.
- Code under `api/` and `db/` uses only erasable TypeScript (no enums, no parameter properties, no namespaces) and `.ts` import extensions, so `node db/*.ts` can import API modules directly.
- Front-end code must not gain new imports of `src/domain/formula.ts` or `src/domain/aggregate.ts`. (The public site still imports `aggregate.ts` through `src/data/index.ts` until Plan 2.)
- Every SQL value goes through a named parameter (`@name`). Only fixed column lists from code are concatenated.
- Messages returned to users are full sentences that say what to do next.
- Formatting matches the repo: 2 spaces, single quotes, semicolons, trailing commas, lines up to 120 characters.
- Before every commit: `npm run typecheck` and `npm test` pass.

## Refinements to the Spec (already synced into the spec)

- Node 24 instead of 22. Flex Consumption supports it, local dev already runs 24.16, and support lasts a year longer.
- `workloads.short_name` column added; the public nav uses `shortName`.
- `login_attempts` key column is `attempt_key` (no bracket quoting).
- `site_state.changed_at` replaces the computed `behind` query. Handlers that change public data stamp it, which also catches a reopened round (the computed query missed that).
- Domain code stays in `src/domain/` and the API imports it; Plan 3 moves `formula.ts` and `aggregate.ts` into `api/src/domain/` once the site no longer needs them. Shared API types live in `src/domain/api-types.ts`.
- Snapshot `history` stays oldest to newest, matching the existing `Rating.history` that the components rely on.
- The deploy dispatch needs `GITHUB_REPO` (and optional `GITHUB_BRANCH`, `GITHUB_WORKFLOW`) app settings.

## File Structure

```
api/
  package.json                 fcr-api: build (esbuild), start (func start)
  tsconfig.json                NodeNext, noEmit; includes ../db
  host.json                    routePrefix "" (route() adds api/; the host rejects route templates that start with "admin")
  local.settings.example.json  local app settings template (real file is gitignored)
  src/
    index.ts                   imports every functions/* module
    lib/
      errors.ts                HttpError
      config.ts                app settings -> Config
      db.ts                    pool, token refresh, retries, query/transaction
      http.ts                  route(): CORS, CSRF checks, JSON, auth, errors
      current-user.ts          cookie -> session -> user, sliding renewal
      password.ts              scrypt hash/verify, password rules
      session.ts               token, hash, expiry, cookie helpers
      lockout.ts               login lockout rules
      permissions.ts           scorecard and user-change rules
      validate.ts              body field readers, score validation, patterns
      github.ts                workflow_dispatch for the site deploy
      draft-why.ts             Anthropic drafting (moved from scripts/)
    repo/                      one file per table group, SQL only
      users.ts sessions.ts attempts.ts catalog.ts rounds.ts scores.ts notes.ts site.ts dataset.ts
    domain/
      dataset.ts               DB rows -> RoundData[] (pure)
      snapshot.ts              public snapshot (pure)
      review.ts                admin round review (pure)
      fixtures.ts              shared test data
    functions/
      health.ts auth.ts rater.ts build.ts admin-rounds.ts admin-catalog.ts admin-users.ts admin-site.ts
db/
  schema.sql                   idempotent DDL, GO-separated batches
  target.ts                    picks the database from flags or local.settings.json
  apply.ts                     runs schema.sql
  seed.ts                      catalog + rounds from repo files, first admin
src/domain/
  grades.ts                    public grade helpers (split from scale.ts)
  formula.ts                   score -> grade (split from scale.ts)
  api-types.ts                 request/response types shared with the front end
vitest.config.ts
```

---

### Task 0: Create the dev database (manual)

**Files:** none

- [ ] **Step 1: Create `fcr-dev`.** In Fabric, open (or create) a workspace on your F SKU capacity, for example "Fabric Credit Ratings". Select New item, then SQL database, and name it `fcr-dev`.
- [ ] **Step 2: Copy the connection values.** Open `fcr-dev`, then Settings, then Connection strings. Note the server (`<id>.database.fabric.microsoft.com`) and the database name (`fcr-dev-<guid>`, the `Initial Catalog` value).
- [ ] **Step 3: Sign in for local tokens.** Run `az login` with the account that owns the workspace (add `--tenant <tenant-id>` if you have several tenants). `DefaultAzureCredential` picks this up locally.

---

### Task 1: Commit the current desk work as a baseline

The git-backed desk (rounds files, intake workflow, desk, rate page) is uncommitted. Committing it first keeps the later removals reviewable.

**Files:** everything currently modified or untracked

- [ ] **Step 1: Branch, then check nothing secret is staged.**

Run: `git switch -c login-backend; git add -A; git status --short`
Expected: no `.env` line (it is gitignored), and `src/data/rounds/` contains only `2026-Q4/round.json` and `2026-Q4/notes.json`.

- [ ] **Step 2: Verify and commit.**

Run: `npm run build`
Expected: typecheck and Vite build succeed.

```powershell
git commit -m "Git-backed rating desk: round files, intake workflow, local desk, rate page"
```

---

### Task 2: Vitest and characterization tests for the grade math

**Files:**
- Create: `vitest.config.ts`
- Create: `src/domain/aggregate.test.ts`
- Modify: `package.json` (scripts, devDependencies)
- Modify: `scripts/tsconfig.json` (include)

- [ ] **Step 1: Install Vitest.**

Run: `npm install --save-dev vitest`

- [ ] **Step 2: Add the config.**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'api/src/**/*.test.ts'],
    environment: 'node',
  },
});
```

In `scripts/tsconfig.json`, change `"include"` to:

```json
  "include": ["*.ts", "../vite.config.ts", "../vitest.config.ts"]
```

In `package.json` `scripts`, add after `"typecheck"`:

```json
    "test": "vitest run",
```

- [ ] **Step 3: Write the tests.** These pin today's behavior before the split in Task 3.

`src/domain/aggregate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { asOfDate, buildRatings, findUnrated, previousPoint } from './aggregate.ts';
import type { Artifact, RoundData } from './types.ts';

const lakehouse: Artifact = { id: 'lakehouse', name: 'Lakehouse', workload: 'storage', status: 'ga' };
const legacy: Artifact = { id: 'legacy', name: 'Legacy item', workload: 'storage', status: 'retired' };
const fresh: Artifact = { id: 'fresh', name: 'Fresh item', workload: 'mcp', status: 'preview' };
const catalog = [lakehouse, legacy, fresh];

const rounds: RoundData[] = [
  {
    round: { id: '2026-Q3', label: 'Q3 2026', status: 'published', publishedOn: '2026-07-01' },
    notes: { lakehouse: 'First look.' },
    scorecards: [
      { rater: 'ann', submittedAt: '2026-06-30T00:00:00Z', scores: { lakehouse: [6, 5, 4], legacy: [7, 7, 7] } },
      { rater: 'bo', submittedAt: '2026-06-30T00:00:00Z', scores: { lakehouse: [5, 5, 4] } },
    ],
  },
  {
    round: { id: '2026-Q4', label: 'Q4 2026', status: 'published', publishedOn: '2026-10-01' },
    notes: {},
    scorecards: [{ rater: 'ann', submittedAt: '2026-09-30T00:00:00Z', scores: { lakehouse: [7, 7, 7] } }],
  },
  {
    round: { id: '2027-Q1', label: 'Q1 2027', status: 'open', publishedOn: null },
    notes: {},
    scorecards: [{ rater: 'ann', submittedAt: '2026-12-30T00:00:00Z', scores: { fresh: [4, 4, 4] } }],
  },
];

describe('buildRatings', () => {
  const ratings = buildRatings(catalog, rounds);
  const byId = new Map(ratings.map((rating) => [rating.artifact.id, rating]));

  it('rates only items scored in a published round, in catalog order', () => {
    expect(ratings.map((rating) => rating.artifact.id)).toEqual(['lakehouse', 'legacy']);
  });

  it('averages each factor to one decimal and grades from the unrounded total', () => {
    const q3 = byId.get('lakehouse')?.history[0];
    expect(q3?.scores).toEqual({ capability: 5.5, ux: 5, cost: 4 });
    expect(q3?.raters).toBe(2);
    expect(q3?.grade).toBe('A-');
    expect(q3?.note).toBe('First look.');
  });

  it('keeps history oldest to newest with the newest as current', () => {
    const rating = byId.get('lakehouse');
    expect(rating?.history.map((point) => point.round)).toEqual(['2026-Q3', '2026-Q4']);
    expect(rating?.current.grade).toBe('AAA');
  });

  it('keeps the last rating for an item skipped in a later round', () => {
    expect(byId.get('legacy')?.current.round).toBe('2026-Q3');
  });

  it('grades retired items E whatever the scores', () => {
    expect(byId.get('legacy')?.current.grade).toBe('E');
  });

  it('lists never-rated items as unrated', () => {
    expect(findUnrated(catalog, ratings).map((artifact) => artifact.id)).toEqual(['fresh']);
  });
});

describe('previousPoint', () => {
  it('returns the newest published point before the round', () => {
    expect(previousPoint(lakehouse, rounds, '2026-Q4')?.round).toBe('2026-Q3');
  });

  it('returns the current published point for an open round', () => {
    expect(previousPoint(lakehouse, rounds, '2027-Q1')?.round).toBe('2026-Q4');
  });
});

describe('asOfDate', () => {
  it('is the newest publication date', () => {
    expect(asOfDate(rounds)).toBe('2026-10-01');
  });
});
```

- [ ] **Step 4: Run the tests.**

Run: `npm test`
Expected: 9 tests pass. (They describe current behavior, so they pass immediately; their job is to catch regressions in Task 3.)

- [ ] **Step 5: Typecheck and commit.**

Run: `npm run typecheck`
Expected: no errors.

```powershell
git add vitest.config.ts src/domain/aggregate.test.ts package.json package-lock.json scripts/tsconfig.json
git commit -m "Add Vitest with characterization tests for rating aggregation"
```

---

### Task 3: Split `scale.ts` into public grades and the private formula; open up workload ids

`formula.ts` (score total to grade) will end up API-only. `grades.ts` (bands, colors, median, notches) stays public. Workload ids become plain strings because the catalog moves into the database.

**Files:**
- Create: `src/domain/grades.ts`, `src/domain/formula.ts`, `src/domain/grades.test.ts`, `src/domain/formula.test.ts`
- Delete: `src/domain/scale.ts`
- Modify: `src/domain/aggregate.ts` (import), `src/domain/types.ts` (`WorkloadId`), and every file importing `domain/scale`

- [ ] **Step 1: Write the failing tests.**

`src/domain/formula.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { gradeForTotal, totalOf } from './formula.ts';

describe('gradeForTotal', () => {
  it('maps whole totals to notches', () => {
    expect(gradeForTotal(21)).toBe('AAA');
    expect(gradeForTotal(12)).toBe('BBB-');
    expect(gradeForTotal(3)).toBe('C');
  });

  it('rounds fractional totals to the nearest notch', () => {
    expect(gradeForTotal(14.5)).toBe('A-');
    expect(gradeForTotal(14.4)).toBe('BBB+');
  });

  it('clamps totals outside 3 to 21', () => {
    expect(gradeForTotal(1)).toBe('C');
    expect(gradeForTotal(30)).toBe('AAA');
  });
});

describe('totalOf', () => {
  it('adds the three factors', () => {
    expect(totalOf({ capability: 5.5, ux: 5, cost: 4 })).toBe(14.5);
  });
});
```

`src/domain/grades.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bandOf, isInvestmentGrade, medianGrade, notchDelta, spokenGrade } from './grades.ts';

describe('grades', () => {
  it('splits bands at BBB- and B-', () => {
    expect(bandOf('BBB-')).toBe('investment');
    expect(bandOf('BB+')).toBe('speculative');
    expect(bandOf('CCC')).toBe('distressed');
    expect(bandOf('E')).toBe('withdrawn');
    expect(isInvestmentGrade('E')).toBe(false);
  });

  it('counts notches as positive when the grade improves', () => {
    expect(notchDelta('BBB', 'A')).toBe(3);
    expect(notchDelta('A', 'BBB')).toBe(-3);
  });

  it('takes the middle grade, or the better middle one for an even count', () => {
    expect(medianGrade(['AAA', 'C', 'BBB'])).toBe('BBB');
    expect(medianGrade(['AAA', 'A'])).toBe('AAA');
    expect(medianGrade([])).toBeUndefined();
  });

  it('spells signs for screen readers', () => {
    expect(spokenGrade('AA+')).toBe('AA plus');
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npm test`
Expected: FAIL, cannot resolve `./formula.ts` and `./grades.ts`.

- [ ] **Step 3: Create `src/domain/formula.ts`** (moved verbatim from `scale.ts`):

```ts
import type { FactorValues, Grade } from './types.ts';

export const MIN_TOTAL = 3;
export const MAX_TOTAL = 21;

export const TOTAL_TO_GRADE: Readonly<Record<number, Grade>> = {
  21: 'AAA',
  20: 'AA+',
  19: 'AA',
  18: 'AA-',
  17: 'A+',
  16: 'A',
  15: 'A-',
  14: 'BBB+',
  13: 'BBB',
  12: 'BBB-',
  11: 'BB+',
  10: 'BB',
  9: 'BB-',
  8: 'B+',
  7: 'B',
  6: 'B-',
  5: 'CCC',
  4: 'CC',
  3: 'C',
};

export const WITHDRAWN_GRADE: Grade = 'E';

export function totalOf(scores: FactorValues): number {
  return scores.capability + scores.ux + scores.cost;
}

/** Averaged totals can be fractional; they round to the nearest notch. */
export function gradeForTotal(total: number): Grade {
  const notch = Math.min(MAX_TOTAL, Math.max(MIN_TOTAL, Math.round(total)));
  return TOTAL_TO_GRADE[notch] ?? 'C';
}
```

- [ ] **Step 4: Create `src/domain/grades.ts`.** Copy everything else from `scale.ts`: `GRADES`, `MIN_SCORE`, `MAX_SCORE`, `gradeIndex`, `bandOf`, `isInvestmentGrade`, `notchDelta`, `medianGrade`, `BandMeta`, `BAND_META`, `BAND_ORDER`, `spokenGrade`, unchanged. The first line becomes:

```ts
import type { Band, Grade } from './types.ts';
```

Leave out `MIN_TOTAL`, `MAX_TOTAL`, `TOTAL_TO_GRADE`, `WITHDRAWN_GRADE`, `totalOf`, `gradeForTotal`.

- [ ] **Step 5: Repoint imports and delete `scale.ts`.**

```powershell
Get-ChildItem src -Recurse -Include *.ts,*.tsx | ForEach-Object {
  $text = Get-Content $_.FullName -Raw
  $next = $text -replace "domain/scale'", "domain/grades'"
  if ($next -ne $text) { Set-Content $_.FullName $next -NoNewline }
}
Remove-Item src/domain/scale.ts
```

In `src/domain/aggregate.ts`, change the first line to:

```ts
import { WITHDRAWN_GRADE, gradeForTotal } from './formula.ts';
```

Run: `rg -n "domain/scale|\./scale" src scripts`
Expected: no output. If any file imported `totalOf`, `MIN_TOTAL`, or `MAX_TOTAL` from scale, point it at `formula.ts`, but only from `src/domain` or `scripts`, never from components.

- [ ] **Step 6: Make workload ids plain strings.** In `src/domain/types.ts`, replace the `WorkloadId` union with:

```ts
/** Workload ids come from the catalog table, so any slug is valid. */
export type WorkloadId = string;
```

- [ ] **Step 7: Verify.**

Run: `npm test; npm run typecheck; npx vite build`
Expected: 17 tests pass, no type errors, build succeeds.

- [ ] **Step 8: Commit.**

```powershell
git add -A src/domain src/components src/rating-ui src/desk src/data
git commit -m "Split grade scale into public grades and private formula; workload ids are strings"
```

---

### Task 4: API package scaffold and shared API types

**Files:**
- Create: `api/package.json`, `api/tsconfig.json`, `api/host.json`, `api/local.settings.example.json`, `api/src/index.ts`, `src/domain/api-types.ts`
- Modify: `.gitignore`, `package.json` (scripts)

- [ ] **Step 1: Create `api/package.json`.**

```json
{
  "name": "fcr-api",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --format=esm --target=node24 --packages=external --sourcemap --outfile=dist/index.js",
    "start": "npm run build && func start"
  }
}
```

- [ ] **Step 2: Install dependencies.**

```powershell
npm --prefix api install @azure/functions @azure/identity mssql @anthropic-ai/sdk
npm --prefix api install --save-dev esbuild @types/mssql @types/node azure-functions-core-tools@4
```

Expected: `api/package-lock.json` created. The Core Tools install downloads the `func` binary (about 200 MB).

- [ ] **Step 3: Create `api/tsconfig.json`.**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["node"]
  },
  "include": ["src", "../db"]
}
```

- [ ] **Step 4: Create `api/host.json`.** Routes are registered under `api/` by `route()`, because the Functions host refuses any route template that starts with `admin`.

```json
{
  "version": "2.0",
  "logging": {
    "applicationInsights": {
      "samplingSettings": { "isEnabled": true, "excludedTypes": "Request" }
    }
  },
  "extensions": {
    "http": { "routePrefix": "" }
  }
}
```

- [ ] **Step 5: Create `api/local.settings.example.json`.**

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AzureWebJobsStorage": "",
    "SQL_SERVER": "<id>.database.fabric.microsoft.com",
    "SQL_DATABASE": "fcr-dev-<guid>",
    "ALLOWED_ORIGINS": "http://localhost:5173,http://localhost:5174,http://localhost:5175",
    "COOKIE_SECURE": "false",
    "SNAPSHOT_TOKEN": "dev-snapshot-token",
    "ANTHROPIC_API_KEY": "",
    "ANTHROPIC_WORKSPACE_ID": "",
    "ANTHROPIC_MODEL": "",
    "GITHUB_DISPATCH_TOKEN": "",
    "GITHUB_REPO": "pugliabi/fabric-credit-ratings",
    "GITHUB_BRANCH": "main",
    "GITHUB_WORKFLOW": "deploy.yml"
  }
}
```

Add to `.gitignore`:

```
local.settings.json
```

(`node_modules` and `dist` already match at any depth.)

- [ ] **Step 6: Create the entry point.** `api/src/index.ts` (later tasks replace it with function imports):

```ts
export {};
```

- [ ] **Step 7: Create `src/domain/api-types.ts`.**

```ts
import type { Artifact, Rating, RatingPoint, Round, RoundNotes, ScoreTriple, Workload } from './types.ts';

export type Role = 'admin' | 'rater';

export interface SessionUser {
  id: number;
  login: string;
  displayName: string;
  role: Role;
}

export interface Catalog {
  workloads: Workload[];
  artifacts: Artifact[];
}

export interface MyScores {
  round: Round;
  scores: Record<string, ScoreTriple>;
  updatedAt: string | null;
  /** The rater's card from the newest published round they scored. */
  previous: { roundLabel: string; scores: Record<string, ScoreTriple> } | null;
}

/** What the public site is built from: published rounds only, no per-rater data. */
export interface Snapshot {
  generatedAt: string;
  asOf: string;
  workloads: Workload[];
  ratings: Rating[];
}

export interface AdminRound extends Round {
  scorecards: number;
  notes: number;
}

export type ChangeKind = 'new' | 'up' | 'down' | 'same';

export interface ReviewItem {
  artifact: Artifact;
  point: RatingPoint;
  previous: RatingPoint | null;
  change: { kind: ChangeKind; text: string };
  breakdown: { userId: number; name: string; scores: ScoreTriple }[];
}

export interface RoundReview {
  round: Round;
  raters: { userId: number; name: string }[];
  items: ReviewItem[];
  notes: RoundNotes;
  aiEnabled: boolean;
}

export interface AdminWorkload extends Workload {
  sortOrder: number;
}

export interface AdminArtifact extends Artifact {
  sortOrder: number;
  /** True when any score or note points at the item, so it can only be retired. */
  referenced: boolean;
}

export interface AdminCatalog {
  workloads: AdminWorkload[];
  artifacts: AdminArtifact[];
}

export interface AdminUser extends SessionUser {
  active: boolean;
  createdAt: string;
  lastScoredRound: string | null;
}

export interface DeployResult {
  started: boolean;
  message: string;
}

export interface PublishResult {
  rounds: AdminRound[];
  deploy: DeployResult | null;
}

export interface SiteStatus {
  lastSnapshotAt: string | null;
  behind: boolean;
  deployConfigured: boolean;
}

export interface ApiErrorBody {
  error: string;
}
```

- [ ] **Step 8: Wire the root scripts.** In the root `package.json` `scripts`, change `typecheck` and add three scripts after `test` (added in Task 2):

```json
    "typecheck": "tsc && tsc -p scripts && tsc -p api",
    "api": "npm --prefix api start",
    "db:apply": "node db/apply.ts",
    "db:seed": "node db/seed.ts"
```

- [ ] **Step 9: Verify and commit.**

Run: `npm run typecheck; npm --prefix api run build`
Expected: no type errors; `api/dist/index.js` written.

```powershell
git add api/package.json api/package-lock.json api/tsconfig.json api/host.json api/local.settings.example.json api/src/index.ts src/domain/api-types.ts .gitignore package.json
git commit -m "Scaffold the Functions API package and shared API types"
```

---

### Task 5: Password hashing

**Files:**
- Create: `api/src/lib/password.ts`, `api/src/lib/password.test.ts`

- [ ] **Step 1: Write the failing test.**

`api/src/lib/password.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, passwordProblem, verifyPassword } from './password.ts';

describe('password hashing', () => {
  it('stores scrypt parameters, salt, and key', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'));
  });

  it('accepts the right password and rejects others', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batterz', stored)).toBe(false);
  });

  it('rejects malformed stored values instead of throwing', async () => {
    expect(await verifyPassword('anything', 'unset')).toBe(false);
    expect(await verifyPassword('anything', 'scrypt$1$2$3$xx$yy')).toBe(false);
  });
});

describe('passwordProblem', () => {
  it('asks for at least 10 characters', () => {
    expect(passwordProblem('short')).toBe('Use at least 10 characters.');
  });

  it('accepts long enough passwords', () => {
    expect(passwordProblem('long enough!')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `npx vitest run api/src/lib/password.test.ts`
Expected: FAIL, cannot resolve `./password.ts`.

- [ ] **Step 3: Implement.**

`api/src/lib/password.ts`:

```ts
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 200;
const COST = 32768;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keyLength, { ...options, maxmem: MAX_MEMORY }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Stored as scrypt$N$r$p$salt$key, with salt and key in base64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLELISM });
  return ['scrypt', COST, BLOCK_SIZE, PARALLELISM, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !key) return false;
  try {
    const expected = Buffer.from(key, 'base64');
    const actual = await derive(password, Buffer.from(salt, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function passwordProblem(password: string): string | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  return undefined;
}

let dummy: Promise<string> | undefined;

/** A real hash to check against when the login does not exist, so both paths take the same time. */
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(16).toString('hex'));
  return dummy;
}
```

- [ ] **Step 4: Run it to see it pass.**

Run: `npx vitest run api/src/lib/password.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit.**

```powershell
npm run typecheck
git add api/src/lib/password.ts api/src/lib/password.test.ts
git commit -m "API: scrypt password hashing"
```

---

### Task 6: Session tokens and login lockout

**Files:**
- Create: `api/src/lib/session.ts`, `api/src/lib/session.test.ts`, `api/src/lib/lockout.ts`, `api/src/lib/lockout.test.ts`

- [ ] **Step 1: Write the failing tests.**

`api/src/lib/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  clearedCookie,
  cookieName,
  expiryFrom,
  hashToken,
  needsRenewal,
  newToken,
  readCookie,
  sessionCookie,
} from './session.ts';

const DAY = 86_400_000;

describe('session tokens', () => {
  it('creates long random tokens', () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
  });

  it('stores only a sha256 hex hash', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('session expiry', () => {
  const now = new Date('2026-10-15T12:00:00Z');

  it('lasts 30 days', () => {
    expect(expiryFrom(now).getTime() - now.getTime()).toBe(30 * DAY);
  });

  it('renews once fewer than 29 days remain', () => {
    expect(needsRenewal(new Date(now.getTime() + 29.5 * DAY), now)).toBe(false);
    expect(needsRenewal(new Date(now.getTime() + 28.9 * DAY), now)).toBe(true);
  });
});

describe('session cookie', () => {
  it('uses the __Host- prefix when secure', () => {
    expect(sessionCookie(true, 't')).toMatchObject({
      name: '__Host-fcr_session',
      value: 't',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 30 * 86_400,
    });
  });

  it('drops the prefix for local http', () => {
    expect(cookieName(false)).toBe('fcr_session');
  });

  it('clears with an empty value and max age 0', () => {
    expect(clearedCookie(true)).toMatchObject({ value: '', maxAge: 0 });
  });

  it('reads one cookie out of a header', () => {
    expect(readCookie('a=1; fcr_session=tok%2Den; b=2', 'fcr_session')).toBe('tok-en');
    expect(readCookie('a=1', 'fcr_session')).toBeUndefined();
    expect(readCookie(null, 'fcr_session')).toBeUndefined();
  });
});
```

`api/src/lib/lockout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LOCK_MS, MAX_FAILURES, WINDOW_MS, afterFailure, isLocked, type AttemptRow } from './lockout.ts';

const start = new Date('2026-10-15T12:00:00Z');
const at = (ms: number) => new Date(start.getTime() + ms);

/** One failure per second from `start`. */
function fail(times: number): AttemptRow | undefined {
  let row: AttemptRow | undefined;
  for (let i = 0; i < times; i += 1) row = afterFailure(row, at(i * 1000));
  return row;
}

describe('login lockout', () => {
  it('allows nine failures', () => {
    expect(isLocked(fail(MAX_FAILURES - 1), at(10_000))).toBe(false);
  });

  it('locks on the tenth failure for 15 minutes', () => {
    const row = fail(MAX_FAILURES);
    expect(isLocked(row, at(10_000))).toBe(true);
    expect(isLocked(row, at(9_000 + LOCK_MS + 1))).toBe(false);
  });

  it('starts a new window after 15 quiet minutes', () => {
    expect(afterFailure(fail(5), at(WINDOW_MS + 5_000)).failures).toBe(1);
  });

  it('treats a missing row as unlocked', () => {
    expect(isLocked(undefined, start)).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run api/src/lib/session.test.ts api/src/lib/lockout.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `api/src/lib/session.ts`.**

```ts
import { createHash, randomBytes } from 'node:crypto';
import type { Cookie } from '@azure/functions';

export const SESSION_DAYS = 30;
const RENEW_BELOW_DAYS = 29;
const DAY_MS = 86_400_000;

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + SESSION_DAYS * DAY_MS);
}

/** Sliding expiry, written at most about once a day per session. */
export function needsRenewal(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() - now.getTime() < RENEW_BELOW_DAYS * DAY_MS;
}

/** __Host- needs Secure, so local http uses a plain name. */
export function cookieName(secure: boolean): string {
  return secure ? '__Host-fcr_session' : 'fcr_session';
}

export function sessionCookie(secure: boolean, token: string): Cookie {
  return {
    name: cookieName(secure),
    value: token,
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  };
}

export function clearedCookie(secure: boolean): Cookie {
  return { ...sessionCookie(secure, ''), maxAge: 0 };
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const split = part.indexOf('=');
    if (split === -1 || part.slice(0, split).trim() !== name) continue;
    const value = part.slice(split + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Implement `api/src/lib/lockout.ts`.**

```ts
export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60_000;
export const LOCK_MS = 15 * 60_000;

/** One row per key: "login:<login>" or "ip:<address>". */
export interface AttemptRow {
  failures: number;
  windowStart: Date;
  lockedUntil: Date | null;
}

export function isLocked(row: AttemptRow | undefined, now: Date): boolean {
  return row?.lockedUntil != null && row.lockedUntil.getTime() > now.getTime();
}

export function afterFailure(row: AttemptRow | undefined, now: Date): AttemptRow {
  const inWindow = row !== undefined && now.getTime() - row.windowStart.getTime() < WINDOW_MS;
  const failures = inWindow ? row.failures + 1 : 1;
  return {
    failures,
    windowStart: inWindow ? row.windowStart : now,
    lockedUntil: failures >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MS) : null,
  };
}
```

- [ ] **Step 5: Run them to see them pass.**

Run: `npx vitest run api/src/lib/session.test.ts api/src/lib/lockout.test.ts`
Expected: 12 tests pass.

- [ ] **Step 6: Commit.**

```powershell
npm run typecheck
git add api/src/lib/session.ts api/src/lib/session.test.ts api/src/lib/lockout.ts api/src/lib/lockout.test.ts
git commit -m "API: session tokens, cookies, and login lockout rules"
```

---

### Task 7: Errors, input validation, and permissions

**Files:**
- Create: `api/src/lib/errors.ts`, `api/src/lib/validate.ts`, `api/src/lib/validate.test.ts`, `api/src/lib/permissions.ts`, `api/src/lib/permissions.test.ts`

- [ ] **Step 1: Write the failing tests.**

`api/src/lib/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HttpError } from './errors.ts';
import { ROUND_ID, oneOf, optionalBool, text, validateScores } from './validate.ts';

const known = new Set(['notebook', 'pipeline']);

describe('validateScores', () => {
  it('keeps whole 1 to 7 triples for known items', () => {
    expect(validateScores({ notebook: [7, 1, 4] }, known)).toEqual({ scores: { notebook: [7, 1, 4] }, errors: [] });
  });

  it('reports unknown items and bad triples', () => {
    const { scores, errors } = validateScores({ ghost: [5, 5, 5], notebook: [0, 5, 5], pipeline: [5, 5] }, known);
    expect(scores).toEqual({});
    expect(errors).toEqual([
      'Unknown item "ghost".',
      '"notebook" needs three whole scores from 1 to 7.',
      '"pipeline" needs three whole scores from 1 to 7.',
    ]);
  });

  it('rejects anything but an object', () => {
    expect(validateScores([], known).errors).toEqual(['Scores must be an object keyed by item id.']);
  });
});

describe('body fields', () => {
  it('trims required text and enforces limits', () => {
    expect(text({ name: '  Ann  ' }, 'name', 'Name', 10)).toBe('Ann');
    expect(() => text({ name: ' ' }, 'name', 'Name', 10)).toThrow(new HttpError(400, 'Name is required.'));
    expect(() => text({ name: 'x'.repeat(11) }, 'name', 'Name', 10)).toThrow('Name must be 10 characters or fewer.');
  });

  it('accepts only listed values', () => {
    expect(oneOf({ role: 'admin' }, 'role', 'Role', ['admin', 'rater'])).toBe('admin');
    expect(() => oneOf({ role: 'owner' }, 'role', 'Role', ['admin', 'rater'])).toThrow(
      'Role must be one of: admin, rater.',
    );
  });

  it('reads optional booleans', () => {
    expect(optionalBool({}, 'active', 'Active')).toBeUndefined();
    expect(optionalBool({ active: false }, 'active', 'Active')).toBe(false);
    expect(() => optionalBool({ active: 'no' }, 'active', 'Active')).toThrow('Active must be true or false.');
  });

  it('recognizes round ids', () => {
    expect(ROUND_ID.test('2027-Q1')).toBe(true);
    expect(ROUND_ID.test('Q1')).toBe(false);
  });
});
```

`api/src/lib/permissions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SessionUser } from '../../../src/domain/api-types.ts';
import type { Round } from '../../../src/domain/types.ts';
import { cardWriteProblem, userChangeProblem } from './permissions.ts';

const admin: SessionUser = { id: 1, login: 'boss', displayName: 'Boss', role: 'admin' };
const rater: SessionUser = { id: 2, login: 'ann', displayName: 'Ann', role: 'rater' };
const open: Round = { id: '2026-Q4', label: 'Q4 2026', status: 'open', publishedOn: null };
const published: Round = { ...open, status: 'published', publishedOn: '2026-10-15' };

describe('cardWriteProblem', () => {
  it('lets raters write their own card in the open round', () => {
    expect(cardWriteProblem(rater, open, 2)).toBeUndefined();
  });

  it('keeps raters off other cards', () => {
    expect(cardWriteProblem(rater, open, 3)).toBe('You can only change your own scorecard.');
  });

  it('keeps raters out of published rounds', () => {
    expect(cardWriteProblem(rater, published, 2)).toBe('Q4 2026 is published. Scores can no longer be changed.');
  });

  it('lets admins write any card in any round', () => {
    expect(cardWriteProblem(admin, published, 2)).toBeUndefined();
  });
});

describe('userChangeProblem', () => {
  const self = { id: 1, role: 'admin' as const, active: true };
  const otherAdmin = { id: 5, role: 'admin' as const, active: true };

  it('stops admins from demoting or disabling themselves', () => {
    expect(userChangeProblem(admin, self, { role: 'rater' }, 2)).toBe('You cannot remove your own admin access.');
    expect(userChangeProblem(admin, self, { active: false }, 2)).toBe('You cannot remove your own admin access.');
  });

  it('keeps at least one active admin', () => {
    expect(userChangeProblem(admin, otherAdmin, { active: false }, 1)).toBe('Keep at least one active admin.');
  });

  it('allows ordinary changes', () => {
    expect(userChangeProblem(admin, otherAdmin, { role: 'rater' }, 2)).toBeUndefined();
    expect(userChangeProblem(admin, { id: 2, role: 'rater', active: true }, { active: false }, 1)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run api/src/lib/validate.test.ts api/src/lib/permissions.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `api/src/lib/errors.ts`.**

```ts
/** An error whose message is safe to show the user. */
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}
```

- [ ] **Step 4: Implement `api/src/lib/validate.ts`.**

```ts
import type { Score, ScoreTriple } from '../../../src/domain/types.ts';
import { HttpError } from './errors.ts';

export const ROUND_ID = /^\d{4}-[A-Z0-9]{1,3}$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Lowercase letters, digits, dot, dash, underscore; 2 to 40 characters. */
export const LOGIN = /^[a-z0-9][a-z0-9._-]{1,39}$/;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Digits only, so 1e1 or 0x7 can't name a user; at most 9, so the bound value always fits SQL int. */
export const USER_ID = /^\d{1,9}$/;

/** Ids are keys of plain objects in the API and the editors, where these names already resolve to built-ins. */
const RESERVED_IDS: ReadonlySet<string> = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);

/** True for a workload or item id that can't be used as a plain-object key. */
export function isReservedId(id: string): boolean {
  return RESERVED_IDS.has(id);
}

type Body = Record<string, unknown>;

function isScore(value: unknown): value is Score {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7;
}

/** Checks a raw { itemId: [c, u, k] } object; unknown ids and bad triples become errors. */
export function validateScores(
  raw: unknown,
  knownIds: ReadonlySet<string>,
): { scores: Record<string, ScoreTriple>; errors: string[] } {
  const scores: Record<string, ScoreTriple> = {};
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { scores, errors: ['Scores must be an object keyed by item id.'] };
  }
  for (const [id, triple] of Object.entries(raw)) {
    if (!knownIds.has(id)) {
      errors.push(`Unknown item "${id}".`);
      continue;
    }
    if (!Array.isArray(triple) || triple.length !== 3 || !triple.every(isScore)) {
      errors.push(`"${id}" needs three whole scores from 1 to 7.`);
      continue;
    }
    const [capability, ux, cost] = triple as [Score, Score, Score];
    scores[id] = [capability, ux, cost];
  }
  return { scores, errors };
}

export function text(body: Body, key: string, label: string, max: number): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim() === '') throw new HttpError(400, `${label} is required.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `${label} must be ${max} characters or fewer.`);
  return trimmed;
}

export function optionalText(body: Body, key: string, label: string, max: number): string | undefined {
  return body[key] === undefined ? undefined : text(body, key, label, max);
}

/** Untrimmed, for passwords. Anything that is not a string becomes ''. */
export function rawString(body: Body, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

export function optionalBool(body: Body, key: string, label: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new HttpError(400, `${label} must be true or false.`);
  return value;
}

export function optionalInt(body: Body, key: string, label: string): number | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000) {
    throw new HttpError(400, `${label} must be a whole number.`);
  }
  return value;
}

export function oneOf<T extends string>(body: Body, key: string, label: string, allowed: readonly T[]): T {
  const value = body[key];
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new HttpError(400, `${label} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function optionalOneOf<T extends string>(
  body: Body,
  key: string,
  label: string,
  allowed: readonly T[],
): T | undefined {
  return body[key] === undefined ? undefined : oneOf(body, key, label, allowed);
}

/** Today in the site's time zone, as YYYY-MM-DD. */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
```

- [ ] **Step 5: Implement `api/src/lib/permissions.ts`.**

```ts
import type { Role, SessionUser } from '../../../src/domain/api-types.ts';
import type { Round } from '../../../src/domain/types.ts';

/** Raters write only their own card, only while the round is open. Admins write any card. */
export function cardWriteProblem(actor: SessionUser, round: Round, ownerId: number): string | undefined {
  if (actor.role === 'admin') return undefined;
  if (actor.id !== ownerId) return 'You can only change your own scorecard.';
  if (round.status !== 'open') return `${round.label} is published. Scores can no longer be changed.`;
  return undefined;
}

interface UserState {
  id: number;
  role: Role;
  active: boolean;
}

export function userChangeProblem(
  actor: SessionUser,
  target: UserState,
  change: { role?: Role; active?: boolean },
  activeAdmins: number,
): string | undefined {
  const losesAdmin =
    target.role === 'admin' &&
    target.active &&
    ((change.role !== undefined && change.role !== 'admin') || change.active === false);
  if (!losesAdmin) return undefined;
  if (target.id === actor.id) return 'You cannot remove your own admin access.';
  if (activeAdmins <= 1) return 'Keep at least one active admin.';
  return undefined;
}
```

- [ ] **Step 6: Run them to see them pass.**

Run: `npx vitest run api/src/lib/validate.test.ts api/src/lib/permissions.test.ts`
Expected: 14 tests pass.

- [ ] **Step 7: Commit.**

```powershell
npm run typecheck
git add api/src/lib/errors.ts api/src/lib/validate.ts api/src/lib/validate.test.ts api/src/lib/permissions.ts api/src/lib/permissions.test.ts
git commit -m "API: input validation and permission rules"
```

---

### Task 8: Schema, database connection, and the apply script

**Files:**
- Create: `db/schema.sql`, `api/src/lib/db.ts`, `db/target.ts`, `db/apply.ts`, `api/local.settings.json` (gitignored, from the example)

- [ ] **Step 1: Create `db/schema.sql`.** Each batch is safe to re-run.

```sql
-- Fabric Credit Ratings schema. Batches are separated by GO lines; every batch is idempotent.

IF OBJECT_ID('dbo.workloads') IS NULL
CREATE TABLE dbo.workloads (
  id varchar(64) NOT NULL CONSTRAINT pk_workloads PRIMARY KEY,
  name nvarchar(100) NOT NULL,
  short_name nvarchar(30) NOT NULL,
  blurb nvarchar(300) NOT NULL,
  sort_order int NOT NULL,
  updated_at datetime2 NOT NULL CONSTRAINT df_workloads_updated DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID('dbo.artifacts') IS NULL
CREATE TABLE dbo.artifacts (
  id varchar(64) NOT NULL CONSTRAINT pk_artifacts PRIMARY KEY,
  name nvarchar(100) NOT NULL,
  workload_id varchar(64) NOT NULL CONSTRAINT fk_artifacts_workload REFERENCES dbo.workloads (id),
  status varchar(10) NOT NULL CONSTRAINT ck_artifacts_status CHECK (status IN ('ga', 'preview', 'retired')),
  sort_order int NOT NULL,
  updated_at datetime2 NOT NULL CONSTRAINT df_artifacts_updated DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID('dbo.users') IS NULL
CREATE TABLE dbo.users (
  id int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_users PRIMARY KEY,
  login varchar(40) NOT NULL CONSTRAINT ux_users_login UNIQUE,
  display_name nvarchar(80) NOT NULL,
  password_hash varchar(255) NOT NULL,
  role varchar(10) NOT NULL CONSTRAINT ck_users_role CHECK (role IN ('admin', 'rater')),
  active bit NOT NULL CONSTRAINT df_users_active DEFAULT 1,
  created_at datetime2 NOT NULL CONSTRAINT df_users_created DEFAULT SYSUTCDATETIME(),
  password_changed_at datetime2 NOT NULL CONSTRAINT df_users_password_changed DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID('dbo.sessions') IS NULL
CREATE TABLE dbo.sessions (
  token_hash char(64) NOT NULL CONSTRAINT pk_sessions PRIMARY KEY,
  user_id int NOT NULL CONSTRAINT fk_sessions_user REFERENCES dbo.users (id),
  created_at datetime2 NOT NULL CONSTRAINT df_sessions_created DEFAULT SYSUTCDATETIME(),
  expires_at datetime2 NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_sessions_user')
CREATE INDEX ix_sessions_user ON dbo.sessions (user_id);
GO

IF OBJECT_ID('dbo.login_attempts') IS NULL
CREATE TABLE dbo.login_attempts (
  attempt_key varchar(100) NOT NULL CONSTRAINT pk_login_attempts PRIMARY KEY,
  failures int NOT NULL,
  window_start datetime2 NOT NULL,
  locked_until datetime2 NULL
);
GO

IF OBJECT_ID('dbo.rounds') IS NULL
CREATE TABLE dbo.rounds (
  id varchar(8) NOT NULL CONSTRAINT pk_rounds PRIMARY KEY,
  label nvarchar(40) NOT NULL,
  status varchar(10) NOT NULL CONSTRAINT ck_rounds_status CHECK (status IN ('open', 'published')),
  published_on date NULL,
  updated_at datetime2 NOT NULL CONSTRAINT df_rounds_updated DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_rounds_one_open')
CREATE UNIQUE INDEX ux_rounds_one_open ON dbo.rounds (status) WHERE status = 'open';
GO

IF OBJECT_ID('dbo.scores') IS NULL
CREATE TABLE dbo.scores (
  round_id varchar(8) NOT NULL CONSTRAINT fk_scores_round REFERENCES dbo.rounds (id),
  user_id int NOT NULL CONSTRAINT fk_scores_user REFERENCES dbo.users (id),
  artifact_id varchar(64) NOT NULL CONSTRAINT fk_scores_artifact REFERENCES dbo.artifacts (id),
  capability tinyint NOT NULL CONSTRAINT ck_scores_capability CHECK (capability BETWEEN 1 AND 7),
  ux tinyint NOT NULL CONSTRAINT ck_scores_ux CHECK (ux BETWEEN 1 AND 7),
  cost tinyint NOT NULL CONSTRAINT ck_scores_cost CHECK (cost BETWEEN 1 AND 7),
  updated_at datetime2 NOT NULL CONSTRAINT df_scores_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_scores PRIMARY KEY (round_id, user_id, artifact_id)
);
GO

-- An artifact delete's foreign-key check seeks this instead of scanning, and waiting on, every card being saved.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_scores_artifact' AND object_id = OBJECT_ID('dbo.scores'))
CREATE INDEX ix_scores_artifact ON dbo.scores (artifact_id);
GO

IF OBJECT_ID('dbo.notes') IS NULL
CREATE TABLE dbo.notes (
  round_id varchar(8) NOT NULL CONSTRAINT fk_notes_round REFERENCES dbo.rounds (id),
  artifact_id varchar(64) NOT NULL CONSTRAINT fk_notes_artifact REFERENCES dbo.artifacts (id),
  body nvarchar(2000) NOT NULL,
  updated_at datetime2 NOT NULL CONSTRAINT df_notes_updated DEFAULT SYSUTCDATETIME(),
  updated_by int NULL CONSTRAINT fk_notes_user REFERENCES dbo.users (id),
  CONSTRAINT pk_notes PRIMARY KEY (round_id, artifact_id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_notes_artifact' AND object_id = OBJECT_ID('dbo.notes'))
CREATE INDEX ix_notes_artifact ON dbo.notes (artifact_id);
GO

IF OBJECT_ID('dbo.site_state') IS NULL
CREATE TABLE dbo.site_state (
  id int NOT NULL CONSTRAINT pk_site_state PRIMARY KEY CONSTRAINT ck_site_state_single CHECK (id = 1),
  last_snapshot_at datetime2 NULL,
  changed_at datetime2 NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.site_state)
INSERT INTO dbo.site_state (id) VALUES (1);
```

- [ ] **Step 2: Create `api/src/lib/db.ts`.**

```ts
import { DefaultAzureCredential } from '@azure/identity';
import sql from 'mssql';

export type Param = string | number | boolean | Date | null;
export type Params = Readonly<Record<string, Param>>;

export interface Db {
  query<T>(text: string, params?: Params): Promise<T[]>;
}

/** The database did not answer, even after retries. Fabric SQL databases pause when idle. */
export class DatabaseUnavailableError extends Error {}

const SCOPE = 'https://database.windows.net/.default';
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
const OLD_POOL_GRACE_MS = 60_000;
const CONNECTION_CODES = new Set(['ESOCKET', 'ECONNCLOSED', 'ETIMEOUT', 'ELOGIN', 'ENOTOPEN', 'EINSTLOOKUP']);

interface Connection {
  pool: sql.ConnectionPool;
  expiresAt: number;
}

let credential: DefaultAzureCredential | undefined;
let pending: Promise<Connection> | undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function target(): { server: string; database: string } {
  const server = process.env.SQL_SERVER?.trim();
  const database = process.env.SQL_DATABASE?.trim();
  if (!server || !database) {
    throw new Error('Set SQL_SERVER and SQL_DATABASE (api/local.settings.json locally, app settings in Azure).');
  }
  return { server, database };
}

async function open(): Promise<Connection> {
  const { server, database } = target();
  credential ??= new DefaultAzureCredential();
  // Token problems (not signed in, no identity) are not retryable, so they fail fast as plain errors.
  const token = await credential.getToken(SCOPE);
  let lastError: unknown;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const pool = new sql.ConnectionPool({
        server,
        database,
        port: 1433,
        options: { encrypt: true, trustServerCertificate: false },
        authentication: { type: 'azure-active-directory-access-token', options: { token: token.token } },
        pool: { max: 5, min: 0, idleTimeoutMillis: 30_000 },
        connectionTimeout: 30_000,
        requestTimeout: 30_000,
      });
      await pool.connect();
      return { pool, expiresAt: token.expiresOnTimestamp };
    } catch (error) {
      lastError = error;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await sleep(delay);
    }
  }
  throw new DatabaseUnavailableError(lastError instanceof Error ? lastError.message : String(lastError));
}

function retire(pool: sql.ConnectionPool): void {
  setTimeout(() => void pool.close().catch(() => undefined), OLD_POOL_GRACE_MS).unref();
}

/** One pool per process, rebuilt shortly before its Entra token expires or after it breaks. */
async function getPool(): Promise<sql.ConnectionPool> {
  const current = pending;
  if (current) {
    const connection = await current.catch(() => undefined);
    if (connection?.pool.connected && Date.now() < connection.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return connection.pool;
    }
    if (pending === current) {
      pending = undefined;
      if (connection) retire(connection.pool);
    }
  }
  pending ??= open();
  return (await pending).pool;
}

function bind(request: sql.Request, params: Params): sql.Request {
  for (const [name, value] of Object.entries(params)) request.input(name, value);
  return request;
}

export const db: Db = {
  async query<T>(text: string, params: Params = {}): Promise<T[]> {
    const pool = await getPool();
    const result = await bind(pool.request(), params).query<T>(text);
    return result.recordset ?? [];
  },
};

/** Runs `work` in one transaction. Queries inside must run one at a time. */
export async function transaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  const scoped: Db = {
    async query<R>(text: string, params: Params = {}): Promise<R[]> {
      const result = await bind(new sql.Request(tx), params).query<R>(text);
      return result.recordset ?? [];
    },
  };
  try {
    const value = await work(scoped);
    await tx.commit();
    return value;
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  }
}

export function isConnectionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'ConnectionError' || (typeof code === 'string' && CONNECTION_CODES.has(code));
}

/** For scripts: lets the process exit. */
export async function closeDb(): Promise<void> {
  const current = pending;
  pending = undefined;
  const connection = await current?.catch(() => undefined);
  await connection?.pool.close();
}
```

- [ ] **Step 3: Create `db/target.ts`.**

```ts
import { existsSync, readFileSync } from 'node:fs';

/**
 * Points api/src/lib/db.ts at a database. --server and --database win, then
 * api/local.settings.json. Returns the arguments that were not consumed.
 */
export function useTarget(argv: readonly string[]): string[] {
  const rest: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const value = argv[i + 1];
    if ((arg === '--server' || arg === '--database') && value) {
      flags[arg.slice(2)] = value;
      i += 1;
    } else {
      rest.push(arg);
    }
  }
  const settingsPath = new URL('../api/local.settings.json', import.meta.url);
  const values = existsSync(settingsPath)
    ? ((JSON.parse(readFileSync(settingsPath, 'utf8')) as { Values?: Record<string, string> }).Values ?? {})
    : {};
  const server = flags.server ?? values.SQL_SERVER ?? '';
  const database = flags.database ?? values.SQL_DATABASE ?? '';
  if (!server || !database) {
    throw new Error('Pass --server and --database, or fill SQL_SERVER and SQL_DATABASE in api/local.settings.json.');
  }
  process.env.SQL_SERVER = server;
  process.env.SQL_DATABASE = database;
  console.log(`Database: ${database} on ${server}`);
  return rest;
}
```

- [ ] **Step 4: Create `db/apply.ts`.**

```ts
import { readFileSync } from 'node:fs';
import { closeDb, db } from '../api/src/lib/db.ts';
import { useTarget } from './target.ts';

useTarget(process.argv.slice(2));
const batches = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
  .split(/^\s*GO\s*$/im)
  .map((batch) => batch.trim())
  .filter(Boolean);
try {
  for (const batch of batches) await db.query(batch);
  console.log(`Applied ${batches.length} schema batches.`);
} finally {
  await closeDb();
}
```

- [ ] **Step 5: Fill local settings.**

```powershell
Copy-Item api/local.settings.example.json api/local.settings.json
```

Edit `api/local.settings.json`: set `SQL_SERVER` and `SQL_DATABASE` to the values from Task 0. Leave the Anthropic and GitHub values empty for now.

- [ ] **Step 6: Apply the schema twice.**

Run: `npm run db:apply`
Expected: `Database: fcr-dev-<guid> on <id>.database.fabric.microsoft.com`, then `Applied 14 schema batches.` (The first connection can take 10 to 60 seconds while the database wakes.)

Run: `npm run db:apply`
Expected: the same output with no errors, which shows the batches are idempotent.

- [ ] **Step 7: Commit.**

```powershell
npm run typecheck
git add db/schema.sql db/target.ts db/apply.ts api/src/lib/db.ts
git commit -m "Database schema, Entra-token connection pool, and schema apply script"
```

---

### Task 9: Repositories

SQL only, one file per table group. These have no unit tests; Task 17's integration test covers them through the HTTP API.

**Files:**
- Create: `api/src/repo/users.ts`, `sessions.ts`, `attempts.ts`, `catalog.ts`, `rounds.ts`, `scores.ts`, `notes.ts`, `site.ts`, `api/src/domain/dataset.ts`, `api/src/repo/dataset.ts`

- [ ] **Step 1: `api/src/repo/users.ts`.**

```ts
import type { AdminUser, Role, SessionUser } from '../../../src/domain/api-types.ts';
import type { Db, Param } from '../lib/db.ts';

export interface UserRecord extends SessionUser {
  active: boolean;
  passwordHash: string;
}

const COLUMNS = 'id, login, display_name AS displayName, role, active, password_hash AS passwordHash';

export async function findUserByLogin(db: Db, login: string): Promise<UserRecord | undefined> {
  const [row] = await db.query<UserRecord>(`SELECT ${COLUMNS} FROM users WHERE login = @login`, { login });
  return row;
}

export async function findUserById(db: Db, id: number): Promise<UserRecord | undefined> {
  const [row] = await db.query<UserRecord>(`SELECT ${COLUMNS} FROM users WHERE id = @id`, { id });
  return row;
}

export function toSessionUser({ id, login, displayName, role }: SessionUser): SessionUser {
  return { id, login, displayName, role };
}

export async function listUsers(db: Db): Promise<AdminUser[]> {
  const rows = await db.query<Omit<AdminUser, 'createdAt'> & { createdAt: Date }>(
    `SELECT u.id, u.login, u.display_name AS displayName, u.role, u.active, u.created_at AS createdAt,
            (SELECT MAX(s.round_id) FROM scores s WHERE s.user_id = u.id) AS lastScoredRound
     FROM users u
     ORDER BY u.active DESC, u.display_name`,
  );
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function createUser(
  db: Db,
  user: { login: string; displayName: string; role: Role; passwordHash: string },
): Promise<number> {
  const [row] = await db.query<{ id: number }>(
    `INSERT INTO users (login, display_name, role, password_hash)
     OUTPUT inserted.id
     VALUES (@login, @displayName, @role, @passwordHash)`,
    { ...user },
  );
  if (!row) throw new Error('Creating the user returned no id.');
  return row.id;
}

export interface UserChanges {
  displayName?: string;
  role?: Role;
  active?: boolean;
  passwordHash?: string;
}

export async function updateUser(db: Db, id: number, changes: UserChanges): Promise<void> {
  const sets: string[] = [];
  const params: Record<string, Param> = { id };
  if (changes.displayName !== undefined) {
    sets.push('display_name = @displayName');
    params.displayName = changes.displayName;
  }
  if (changes.role !== undefined) {
    sets.push('role = @role');
    params.role = changes.role;
  }
  if (changes.active !== undefined) {
    sets.push('active = @active');
    params.active = changes.active;
  }
  if (changes.passwordHash !== undefined) {
    sets.push('password_hash = @passwordHash', 'password_changed_at = SYSUTCDATETIME()');
    params.passwordHash = changes.passwordHash;
  }
  if (sets.length === 0) return;
  await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`, params);
}

/**
 * Sets a new password hash only if the user is still active with the hash the caller just verified, and reports
 * whether it did. A reset or disable that commits first wins, and this changes nothing.
 */
export async function replacePasswordHash(db: Db, id: number, verified: string, next: string): Promise<boolean> {
  const rows = await db.query<{ id: number }>(
    `UPDATE users SET password_hash = @next, password_changed_at = SYSUTCDATETIME()
     OUTPUT inserted.id
     WHERE id = @id AND active = 1 AND password_hash = @verified`,
    { id, verified, next },
  );
  return rows.length === 1;
}

/**
 * Holds the users it reads until commit, so two admins demoting or deactivating each other take turns instead of both
 * seeing the other still active. Use inside a transaction, before reading the user being changed.
 */
export async function countActiveAdminsLocked(tx: Db): Promise<number> {
  const [row] = await tx.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM users WITH (UPDLOCK, HOLDLOCK) WHERE role = 'admin' AND active = 1`,
  );
  return row?.n ?? 0;
}
```

- [ ] **Step 2: `api/src/repo/sessions.ts`.**

```ts
import type { SessionUser } from '../../../src/domain/api-types.ts';
import type { Db } from '../lib/db.ts';

/**
 * Inserts only if the user is still active with the password hash that was just verified, and reports whether it did.
 * HOLDLOCK reads the committed row, waiting for a reset or disable in flight, and takes the user row before sessions,
 * the same order as admin-users.ts's transaction, so the two can't deadlock.
 */
export async function createSession(
  db: Db,
  tokenHash: string,
  userId: number,
  expiresAt: Date,
  passwordHash: string,
): Promise<boolean> {
  const rows = await db.query<{ userId: number }>(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     OUTPUT inserted.user_id AS userId
     SELECT @tokenHash, u.id, @expiresAt FROM users u WITH (HOLDLOCK)
     WHERE u.id = @userId AND u.active = 1 AND u.password_hash = @passwordHash`,
    { tokenHash, userId, expiresAt, passwordHash },
  );
  return rows.length === 1;
}

/** Only live sessions of active users. */
export async function findSession(
  db: Db,
  tokenHash: string,
): Promise<{ user: SessionUser; expiresAt: Date } | undefined> {
  const [row] = await db.query<SessionUser & { expiresAt: Date }>(
    `SELECT u.id, u.login, u.display_name AS displayName, u.role, s.expires_at AS expiresAt
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = @tokenHash AND s.expires_at > SYSUTCDATETIME() AND u.active = 1`,
    { tokenHash },
  );
  if (!row) return undefined;
  const { expiresAt, ...user } = row;
  return { user, expiresAt };
}

export async function renewSession(db: Db, tokenHash: string, expiresAt: Date): Promise<void> {
  await db.query('UPDATE sessions SET expires_at = @expiresAt WHERE token_hash = @tokenHash', { tokenHash, expiresAt });
}

export async function deleteSession(db: Db, tokenHash: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = @tokenHash', { tokenHash });
}

/** Ends every session of a user except, optionally, the caller's own. */
export async function deleteUserSessions(db: Db, userId: number, keepTokenHash = ''): Promise<void> {
  await db.query('DELETE FROM sessions WHERE user_id = @userId AND token_hash <> @keepTokenHash', {
    userId,
    keepTokenHash,
  });
}

export async function pruneExpiredSessions(db: Db): Promise<void> {
  await db.query('DELETE FROM sessions WHERE expires_at < SYSUTCDATETIME()');
}
```

- [ ] **Step 3: `api/src/repo/attempts.ts`.**

```ts
import type { Db, Param } from '../lib/db.ts';
import type { AttemptRow } from '../lib/lockout.ts';

export async function getAttempts(db: Db, keys: readonly string[]): Promise<Map<string, AttemptRow>> {
  const params: Record<string, Param> = {};
  const names = keys.map((key, i) => {
    params[`k${i}`] = key;
    return `@k${i}`;
  });
  const rows = await db.query<AttemptRow & { attemptKey: string }>(
    `SELECT attempt_key AS attemptKey, failures, window_start AS windowStart, locked_until AS lockedUntil
     FROM login_attempts WHERE attempt_key IN (${names.join(', ')})`,
    params,
  );
  return new Map(rows.map(({ attemptKey, ...row }) => [attemptKey, row]));
}

export async function saveAttempt(db: Db, key: string, row: AttemptRow): Promise<void> {
  await db.query(
    `MERGE login_attempts AS t
     USING (SELECT @key AS attempt_key) AS s ON t.attempt_key = s.attempt_key
     WHEN MATCHED THEN UPDATE SET failures = @failures, window_start = @windowStart, locked_until = @lockedUntil
     WHEN NOT MATCHED THEN INSERT (attempt_key, failures, window_start, locked_until)
       VALUES (@key, @failures, @windowStart, @lockedUntil);`,
    { key, failures: row.failures, windowStart: row.windowStart, lockedUntil: row.lockedUntil },
  );
}

export async function clearAttempt(db: Db, key: string): Promise<void> {
  await db.query('DELETE FROM login_attempts WHERE attempt_key = @key', { key });
}
```

- [ ] **Step 4: `api/src/repo/catalog.ts`.**

```ts
import type { AdminArtifact, AdminCatalog, AdminWorkload } from '../../../src/domain/api-types.ts';
import type { Artifact, ReleaseStatus, Workload } from '../../../src/domain/types.ts';
import type { Db } from '../lib/db.ts';

export async function listWorkloads(db: Db): Promise<Workload[]> {
  return db.query<Workload>('SELECT id, name, short_name AS shortName, blurb FROM workloads ORDER BY sort_order, name');
}

/** Catalog order: workload order, then item order within the workload. */
export async function listArtifacts(db: Db): Promise<Artifact[]> {
  return db.query<Artifact>(
    `SELECT a.id, a.name, a.workload_id AS workload, a.status
     FROM artifacts a JOIN workloads w ON w.id = a.workload_id
     ORDER BY w.sort_order, a.sort_order, a.name`,
  );
}

export async function adminCatalog(db: Db): Promise<AdminCatalog> {
  const [workloads, artifacts] = await Promise.all([
    db.query<AdminWorkload>(
      'SELECT id, name, short_name AS shortName, blurb, sort_order AS sortOrder FROM workloads ORDER BY sort_order, name',
    ),
    db.query<AdminArtifact>(
      `SELECT a.id, a.name, a.workload_id AS workload, a.status, a.sort_order AS sortOrder,
              CAST(CASE WHEN EXISTS (SELECT 1 FROM scores s WHERE s.artifact_id = a.id)
                          OR EXISTS (SELECT 1 FROM notes n WHERE n.artifact_id = a.id)
                        THEN 1 ELSE 0 END AS bit) AS referenced
       FROM artifacts a JOIN workloads w ON w.id = a.workload_id
       ORDER BY w.sort_order, a.sort_order, a.name`,
    ),
  ]);
  return { workloads, artifacts };
}

interface WorkloadFields {
  name: string;
  shortName: string;
  blurb: string;
}

export async function createWorkload(db: Db, workload: WorkloadFields & { id: string }): Promise<void> {
  await db.query(
    `INSERT INTO workloads (id, name, short_name, blurb, sort_order)
     SELECT @id, @name, @shortName, @blurb, ISNULL(MAX(sort_order), 0) + 10 FROM workloads`,
    { ...workload },
  );
}

export async function updateWorkload(
  db: Db,
  id: string,
  fields: WorkloadFields & { sortOrder: number },
): Promise<void> {
  await db.query(
    `UPDATE workloads
     SET name = @name, short_name = @shortName, blurb = @blurb, sort_order = @sortOrder, updated_at = SYSUTCDATETIME()
     WHERE id = @id`,
    { id, ...fields },
  );
}

interface ArtifactFields {
  name: string;
  workload: string;
  status: ReleaseStatus;
}

export async function createArtifact(db: Db, artifact: ArtifactFields & { id: string }): Promise<void> {
  await db.query(
    `INSERT INTO artifacts (id, name, workload_id, status, sort_order)
     SELECT @id, @name, @workload, @status, ISNULL(MAX(sort_order), 0) + 10 FROM artifacts WHERE workload_id = @workload`,
    { ...artifact },
  );
}

export async function updateArtifact(
  db: Db,
  id: string,
  fields: ArtifactFields & { sortOrder: number },
): Promise<void> {
  await db.query(
    `UPDATE artifacts
     SET name = @name, workload_id = @workload, status = @status, sort_order = @sortOrder, updated_at = SYSUTCDATETIME()
     WHERE id = @id`,
    { id, ...fields },
  );
}

export async function deleteArtifact(db: Db, id: string): Promise<void> {
  await db.query('DELETE FROM artifacts WHERE id = @id', { id });
}

export async function upsertWorkload(db: Db, workload: Workload, sortOrder: number): Promise<void> {
  await db.query(
    `MERGE workloads AS t USING (SELECT @id AS id) AS s ON t.id = s.id
     WHEN MATCHED THEN UPDATE SET name = @name, short_name = @shortName, blurb = @blurb, sort_order = @sortOrder,
       updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (id, name, short_name, blurb, sort_order)
       VALUES (@id, @name, @shortName, @blurb, @sortOrder);`,
    { id: workload.id, name: workload.name, shortName: workload.shortName, blurb: workload.blurb, sortOrder },
  );
}

export async function upsertArtifact(db: Db, artifact: Artifact, sortOrder: number): Promise<void> {
  await db.query(
    `MERGE artifacts AS t USING (SELECT @id AS id) AS s ON t.id = s.id
     WHEN MATCHED THEN UPDATE SET name = @name, workload_id = @workload, status = @status, sort_order = @sortOrder,
       updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (id, name, workload_id, status, sort_order)
       VALUES (@id, @name, @workload, @status, @sortOrder);`,
    { id: artifact.id, name: artifact.name, workload: artifact.workload, status: artifact.status, sortOrder },
  );
}
```

- [ ] **Step 5: `api/src/repo/rounds.ts`.**

```ts
import type { AdminRound } from '../../../src/domain/api-types.ts';
import type { Round } from '../../../src/domain/types.ts';
import type { Db } from '../lib/db.ts';

/** published_on comes back as 'YYYY-MM-DD' text so no time zone can shift it. */
const ROUND = `r.id, r.label, r.status, CONVERT(char(10), r.published_on, 23) AS publishedOn`;

export async function listRounds(db: Db): Promise<Round[]> {
  return db.query<Round>(`SELECT ${ROUND} FROM rounds r ORDER BY r.id`);
}

export async function findRound(db: Db, id: string): Promise<Round | undefined> {
  const [round] = await db.query<Round>(`SELECT ${ROUND} FROM rounds r WHERE r.id = @id`, { id });
  return round;
}

export async function findOpenRound(db: Db): Promise<Round | undefined> {
  const [round] = await db.query<Round>(`SELECT ${ROUND} FROM rounds r WHERE r.status = 'open'`);
  return round;
}

export async function listRoundsWithCounts(db: Db): Promise<AdminRound[]> {
  return db.query<AdminRound>(
    `SELECT ${ROUND},
            (SELECT COUNT(DISTINCT s.user_id) FROM scores s WHERE s.round_id = r.id) AS scorecards,
            (SELECT COUNT(*) FROM notes n WHERE n.round_id = r.id) AS notes
     FROM rounds r
     ORDER BY r.id DESC`,
  );
}

export async function countScorecards(db: Db, id: string): Promise<number> {
  const [row] = await db.query<{ n: number }>(
    'SELECT COUNT(DISTINCT user_id) AS n FROM scores WHERE round_id = @id',
    { id },
  );
  return row?.n ?? 0;
}

export async function createRound(db: Db, id: string, label: string): Promise<void> {
  await db.query(`INSERT INTO rounds (id, label, status) VALUES (@id, @label, 'open')`, { id, label });
}

export async function publishRound(db: Db, id: string, publishedOn: string): Promise<void> {
  await db.query(
    `UPDATE rounds SET status = 'published', published_on = @publishedOn, updated_at = SYSUTCDATETIME() WHERE id = @id`,
    { id, publishedOn },
  );
}

export async function reopenRound(db: Db, id: string): Promise<void> {
  await db.query(
    `UPDATE rounds SET status = 'open', published_on = NULL, updated_at = SYSUTCDATETIME() WHERE id = @id`,
    { id },
  );
}

export async function upsertRound(db: Db, round: Round): Promise<void> {
  await db.query(
    `MERGE rounds AS t USING (SELECT @id AS id) AS s ON t.id = s.id
     WHEN MATCHED THEN UPDATE SET label = @label, status = @status, published_on = @publishedOn,
       updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (id, label, status, published_on) VALUES (@id, @label, @status, @publishedOn);`,
    { id: round.id, label: round.label, status: round.status, publishedOn: round.publishedOn },
  );
}
```

- [ ] **Step 6: `api/src/domain/dataset.ts`** (pure; turns DB rows into the existing `RoundData` shape so `aggregate.ts` works unchanged).

```ts
import type { Artifact, Round, RoundData, Score, Scorecard, ScoreTriple, Workload } from '../../../src/domain/types.ts';

export interface ScoreRow {
  roundId: string;
  userId: number;
  name: string;
  artifactId: string;
  capability: number;
  ux: number;
  cost: number;
  updatedAt: Date;
}

export interface NoteRow {
  roundId: string;
  artifactId: string;
  body: string;
}

export interface Dataset {
  workloads: Workload[];
  artifacts: Artifact[];
  /** Scorecard.rater holds the user id as text; raterNames maps it to a display name. */
  rounds: RoundData[];
  raterNames: Map<number, string>;
}

export function triple(row: Pick<ScoreRow, 'capability' | 'ux' | 'cost'>): ScoreTriple {
  return [row.capability as Score, row.ux as Score, row.cost as Score];
}

export function assembleDataset(
  workloads: Workload[],
  artifacts: Artifact[],
  rounds: Round[],
  scoreRows: readonly ScoreRow[],
  noteRows: readonly NoteRow[],
): Dataset {
  const byRound = new Map<string, RoundData>(rounds.map((round) => [round.id, { round, notes: {}, scorecards: [] }]));
  for (const note of noteRows) {
    const data = byRound.get(note.roundId);
    if (data) data.notes[note.artifactId] = note.body;
  }
  const raterNames = new Map<number, string>();
  const cards = new Map<string, Scorecard>();
  for (const row of scoreRows) {
    const data = byRound.get(row.roundId);
    if (!data) continue;
    raterNames.set(row.userId, row.name);
    const key = `${row.roundId}:${row.userId}`;
    const at = row.updatedAt.toISOString();
    let card = cards.get(key);
    if (!card) {
      card = { rater: String(row.userId), submittedAt: at, scores: {} };
      cards.set(key, card);
      data.scorecards.push(card);
    }
    card.scores[row.artifactId] = triple(row);
    if (at > card.submittedAt) card.submittedAt = at;
  }
  return { workloads, artifacts, rounds: [...byRound.values()], raterNames };
}
```

- [ ] **Step 7: `api/src/repo/scores.ts`.**

```ts
import type { ScoreTriple } from '../../../src/domain/types.ts';
import { triple, type ScoreRow } from '../domain/dataset.ts';
import type { Db, Param } from '../lib/db.ts';

const COLUMNS = `s.round_id AS roundId, s.user_id AS userId, u.display_name AS name, s.artifact_id AS artifactId,
  s.capability, s.ux, s.cost, s.updated_at AS updatedAt`;

export async function allScores(db: Db): Promise<ScoreRow[]> {
  return db.query<ScoreRow>(`SELECT ${COLUMNS} FROM scores s JOIN users u ON u.id = s.user_id`);
}

export async function scoresFor(db: Db, roundId: string, userId: number): Promise<ScoreRow[]> {
  return db.query<ScoreRow>(
    `SELECT ${COLUMNS} FROM scores s JOIN users u ON u.id = s.user_id
     WHERE s.round_id = @roundId AND s.user_id = @userId`,
    { roundId, userId },
  );
}

export function toTriples(rows: readonly ScoreRow[]): Record<string, ScoreTriple> {
  return Object.fromEntries(rows.map((row) => [row.artifactId, triple(row)]));
}

/** Replaces one rater's whole card for a round. An empty card deletes it. Run inside a transaction. */
export async function replaceScorecard(
  db: Db,
  roundId: string,
  userId: number,
  scores: Record<string, ScoreTriple>,
): Promise<void> {
  await db.query('DELETE FROM scores WHERE round_id = @roundId AND user_id = @userId', { roundId, userId });
  const entries = Object.entries(scores);
  if (entries.length === 0) return;
  const params: Record<string, Param> = { roundId, userId };
  const rows = entries.map(([artifactId, [capability, ux, cost]], i) => {
    params[`a${i}`] = artifactId;
    params[`c${i}`] = capability;
    params[`u${i}`] = ux;
    params[`k${i}`] = cost;
    return `(@roundId, @userId, @a${i}, @c${i}, @u${i}, @k${i})`;
  });
  await db.query(
    `INSERT INTO scores (round_id, user_id, artifact_id, capability, ux, cost) VALUES ${rows.join(', ')}`,
    params,
  );
}

/** The user's card from the newest published round they scored. */
export async function lastPublishedCard(
  db: Db,
  userId: number,
): Promise<{ roundLabel: string; scores: Record<string, ScoreTriple> } | undefined> {
  const [round] = await db.query<{ id: string; label: string }>(
    `SELECT TOP 1 r.id, r.label FROM rounds r
     WHERE r.status = 'published' AND EXISTS (SELECT 1 FROM scores s WHERE s.round_id = r.id AND s.user_id = @userId)
     ORDER BY r.published_on DESC, r.id DESC`,
    { userId },
  );
  if (!round) return undefined;
  return { roundLabel: round.label, scores: toTriples(await scoresFor(db, round.id, userId)) };
}
```

- [ ] **Step 8: `api/src/repo/notes.ts`.**

```ts
import type { NoteRow } from '../domain/dataset.ts';
import type { Db } from '../lib/db.ts';

export async function allNotes(db: Db): Promise<NoteRow[]> {
  return db.query<NoteRow>('SELECT round_id AS roundId, artifact_id AS artifactId, body FROM notes');
}

/** An empty body deletes the note. */
export async function saveNote(
  db: Db,
  roundId: string,
  artifactId: string,
  body: string,
  userId: number | null,
): Promise<void> {
  if (!body) {
    await db.query('DELETE FROM notes WHERE round_id = @roundId AND artifact_id = @artifactId', {
      roundId,
      artifactId,
    });
    return;
  }
  await db.query(
    `MERGE notes AS t
     USING (SELECT @roundId AS round_id, @artifactId AS artifact_id) AS s
       ON t.round_id = s.round_id AND t.artifact_id = s.artifact_id
     WHEN MATCHED THEN UPDATE SET body = @body, updated_at = SYSUTCDATETIME(), updated_by = @userId
     WHEN NOT MATCHED THEN INSERT (round_id, artifact_id, body, updated_by)
       VALUES (@roundId, @artifactId, @body, @userId);`,
    { roundId, artifactId, body, userId },
  );
}
```

- [ ] **Step 9: `api/src/repo/site.ts`.**

```ts
import type { Db } from '../lib/db.ts';

export interface SiteState {
  lastSnapshotAt: Date | null;
  changedAt: Date | null;
}

export async function siteState(db: Db): Promise<SiteState> {
  const [row] = await db.query<SiteState>(
    'SELECT last_snapshot_at AS lastSnapshotAt, changed_at AS changedAt FROM site_state WHERE id = 1',
  );
  return row ?? { lastSnapshotAt: null, changedAt: null };
}

export function isBehind(state: SiteState): boolean {
  if (!state.lastSnapshotAt) return true;
  // A tie may hide a change made just after the snapshot's clock read: both come back truncated to milliseconds, and
  // two clock reads can be equal anyway.
  return state.changedAt !== null && state.changedAt >= state.lastSnapshotAt;
}

/**
 * Call after any change the public site would show (publish, reopen, published edits, catalog edits): inside its
 * transaction as the last statement, or after it commits. SYSUTCDATETIME() is fixed when a statement starts, before it
 * waits for the row lock, so the first UPDATE takes the lock and the second stamps a time later than any snapshot clock
 * read that got past it. The first must be a real write: a lock on an unchanged row doesn't hold back locking readers.
 */
export async function markChanged(db: Db): Promise<void> {
  await db.query(
    `UPDATE site_state SET changed_at = SYSUTCDATETIME() WHERE id = 1;
     UPDATE site_state SET changed_at = SYSUTCDATETIME() WHERE id = 1;`,
  );
}

/**
 * Call once the site built from a snapshot is live, with that snapshot's generatedAt: the database time read before
 * its dataset was loaded, so a change made during the build still shows as behind. Never moves the stamp back, so a
 * late confirmation of an older deploy doesn't undo a newer one's.
 */
export async function markSnapshotTaken(db: Db, takenAt: Date): Promise<void> {
  await db.query(
    `UPDATE site_state SET last_snapshot_at = @takenAt
     WHERE id = 1 AND (last_snapshot_at IS NULL OR last_snapshot_at < @takenAt)`,
    { takenAt },
  );
}
```

- [ ] **Step 10: `api/src/repo/dataset.ts`.**

```ts
import { assembleDataset, type Dataset } from '../domain/dataset.ts';
import type { Db } from '../lib/db.ts';
import { listArtifacts, listWorkloads } from './catalog.ts';
import { allNotes } from './notes.ts';
import { listRounds } from './rounds.ts';
import { allScores } from './scores.ts';

export async function loadDataset(db: Db): Promise<Dataset> {
  const [workloads, artifacts, rounds, scores, notes] = await Promise.all([
    listWorkloads(db),
    listArtifacts(db),
    listRounds(db),
    allScores(db),
    allNotes(db),
  ]);
  return assembleDataset(workloads, artifacts, rounds, scores, notes);
}
```

- [ ] **Step 11: Typecheck and commit.**

Run: `npm run typecheck`
Expected: no errors.

```powershell
git add api/src/repo api/src/domain/dataset.ts
git commit -m "API: repositories for users, sessions, catalog, rounds, scores, notes, site state"
```

---

### Task 10: Seed script

Loads the catalog and round files from the repo into the database and creates the first admin. Raters found in round files get accounts with no usable password; the admin sets one later on the Users tab.

**Files:**
- Create: `db/seed.ts`

- [ ] **Step 1: Create `db/seed.ts`.** This listing is the file as built:
  - **Reserved ids.** Unless `--admin-only` is given, it loads `src/data/workloads.ts` and `src/data/artifacts.ts` first (`catalogFiles()`). It refuses a workload or item id that the admin catalog would refuse as reserved (`isReservedId`, `fa28250`), naming the file and the id. This happens before its first database call (`a5cf878`), so a bad id writes nothing at all, the admin user included.
  - **Existing data** (`b621f07`). On a database that already has a catalog or rounds, it refuses to run unless `--admin-only` (only the admin) or `--force` (overwrite them with the repo files).
  - **After seeding.** It stamps `site_state.changed_at`.

```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { closeDb, db, transaction } from '../api/src/lib/db.ts';
import { hashPassword, passwordProblem } from '../api/src/lib/password.ts';
import { LOGIN, isReservedId, validateScores } from '../api/src/lib/validate.ts';
import { listArtifacts, listWorkloads, upsertArtifact, upsertWorkload } from '../api/src/repo/catalog.ts';
import { saveNote } from '../api/src/repo/notes.ts';
import { listRounds, upsertRound } from '../api/src/repo/rounds.ts';
import { replaceScorecard } from '../api/src/repo/scores.ts';
import { markChanged } from '../api/src/repo/site.ts';
import { createUser, findUserByLogin } from '../api/src/repo/users.ts';
import type { Round, RoundNotes, Scorecard } from '../src/domain/types.ts';
import { useTarget } from './target.ts';

const USAGE =
  'Usage: npm run db:seed -- --admin <login> --name "<display name>" [--admin-only] [--force] ' +
  '[--server <host>] [--database <name>]';
const VALUE_FLAGS = ['--admin', '--name'];
const SWITCHES = ['--admin-only', '--force'];

const args = useTarget(process.argv.slice(2));
const values: Record<string, string> = {};
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i] ?? '';
  if (VALUE_FLAGS.includes(arg)) {
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value. ${USAGE}`);
    values[arg.slice(2)] = value;
    i += 1;
  } else if (!SWITCHES.includes(arg)) {
    throw new Error(`Unknown argument "${arg}". Quote names that contain spaces. ${USAGE}`);
  }
}
const adminOnly = args.includes('--admin-only');
const force = args.includes('--force');
const adminLogin = values.admin?.toLowerCase() ?? '';
const adminName = values.name?.trim() ?? '';
if (!adminLogin || values.name === undefined) throw new Error(USAGE);
if (!LOGIN.test(adminLogin)) {
  throw new Error('Logins use 2 to 40 lowercase letters, digits, dots, dashes, or underscores.');
}
if (adminName.length < 1 || adminName.length > 80) throw new Error('Display names use 1 to 80 characters.');

function readJson<T>(path: URL): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

async function ensureAdmin(): Promise<string> {
  const existing = await findUserByLogin(db, adminLogin);
  if (existing) {
    const state = `${existing.role}, ${existing.active ? 'active' : 'inactive'}`;
    return `already exists (${state}), not changed. --name was not applied.`;
  }
  const password = process.env.FCR_ADMIN_PASSWORD ?? '';
  const problem = passwordProblem(password);
  if (problem) throw new Error(`Set FCR_ADMIN_PASSWORD first. ${problem}`);
  await createUser(db, {
    login: adminLogin,
    displayName: adminName,
    role: 'admin',
    passwordHash: await hashPassword(password),
  });
  return 'created';
}

function refuseReservedIds(file: string, rows: readonly { id: string }[]): void {
  const reserved = rows.find(({ id }) => isReservedId(id));
  if (reserved) throw new Error(`src/data/${file}: the id ${reserved.id} is reserved. Rename it, then seed again.`);
}

/** Loads and checks the catalog files; called before any database call, so a bad id writes nothing at all. */
async function catalogFiles() {
  const { WORKLOADS } = await import('../src/data/workloads.ts');
  const { ARTIFACTS } = await import('../src/data/artifacts.ts');
  refuseReservedIds('workloads.ts', WORKLOADS);
  refuseReservedIds('artifacts.ts', ARTIFACTS);
  return { WORKLOADS, ARTIFACTS };
}

async function seedCatalog({ WORKLOADS, ARTIFACTS }: Awaited<ReturnType<typeof catalogFiles>>): Promise<string> {
  for (const [index, workload] of WORKLOADS.entries()) await upsertWorkload(db, workload, (index + 1) * 10);
  for (const workload of WORKLOADS) {
    const items = ARTIFACTS.filter((artifact) => artifact.workload === workload.id);
    for (const [index, artifact] of items.entries()) await upsertArtifact(db, artifact, (index + 1) * 10);
  }
  return `${WORKLOADS.length} workloads, ${ARTIFACTS.length} items`;
}

/** Round files name raters by GitHub login; they become rater accounts with no usable password. */
async function raterId(login: string): Promise<number> {
  const existing = await findUserByLogin(db, login.toLowerCase());
  if (existing) return existing.id;
  return createUser(db, { login: login.toLowerCase(), displayName: login, role: 'rater', passwordHash: 'unset' });
}

async function seedRounds(): Promise<string> {
  const root = new URL('../src/data/rounds/', import.meta.url);
  if (!existsSync(root)) return 'no round files';
  const known = new Set((await listArtifacts(db)).map((artifact) => artifact.id));
  const ids = readdirSync(root)
    .filter((id) => existsSync(new URL(`${id}/round.json`, root)))
    .sort();
  let cards = 0;
  let notes = 0;
  for (const id of ids) {
    const dir = new URL(`${id}/`, root);
    const round = readJson<Round>(new URL('round.json', dir));
    await upsertRound(db, round);
    const scoresDir = new URL('scores/', dir);
    const files = existsSync(scoresDir) ? readdirSync(scoresDir).filter((name) => name.endsWith('.json')) : [];
    for (const file of files) {
      const card = readJson<Scorecard>(new URL(file, scoresDir));
      const { scores, errors } = validateScores(card.scores, known);
      if (errors.length > 0) throw new Error(`${id}/scores/${file}: ${errors.join(' ')}`);
      const userId = await raterId(card.rater);
      await transaction((tx) => replaceScorecard(tx, round.id, userId, scores));
      cards += 1;
    }
    const notesPath = new URL('notes.json', dir);
    const roundNotes = existsSync(notesPath) ? readJson<RoundNotes>(notesPath) : {};
    for (const [artifactId, body] of Object.entries(roundNotes)) {
      await saveNote(db, round.id, artifactId, body.trim(), null);
      notes += 1;
    }
  }
  return `${ids.length} rounds, ${cards} scorecards, ${notes} notes`;
}

try {
  const catalog = adminOnly ? undefined : await catalogFiles();
  if (catalog && !force && ((await listWorkloads(db)).length > 0 || (await listRounds(db)).length > 0)) {
    throw new Error(
      'This database already has a catalog or rounds, and /admin owns them now. Use --admin-only to add an admin, ' +
        'or --force to overwrite them with the repo files.',
    );
  }
  console.log(`Admin ${adminLogin}: ${await ensureAdmin()}`);
  if (catalog) {
    console.log(`Catalog: ${await seedCatalog(catalog)}`);
    console.log(`Rounds: ${await seedRounds()}`);
    await markChanged(db);
  }
} finally {
  await closeDb();
}
```

- [ ] **Step 2: Seed `fcr-dev`.** `Read-Host -MaskInput` needs PowerShell 7.1 or newer. In Windows PowerShell 5.1, read the password with `$env:FCR_ADMIN_PASSWORD = [Net.NetworkCredential]::new('', (Read-Host 'Admin password (10+ characters)' -AsSecureString)).Password` instead. The seed only reads `FCR_ADMIN_PASSWORD`, so either way works; run `Remove-Item Env:FCR_ADMIN_PASSWORD` afterward.

```powershell
$env:FCR_ADMIN_PASSWORD = Read-Host 'Admin password (10+ characters)' -MaskInput
npm run db:seed -- --admin pugliabi --name "<your display name>"
```

Expected:

```
Database: fcr-dev-<guid> on <id>.database.fabric.microsoft.com
Admin pugliabi: created
Catalog: 12 workloads, <n> items
Rounds: 1 rounds, 0 scorecards, 0 notes
```

- [ ] **Step 3: Run it again.**

Run: `npm run db:seed -- --admin pugliabi --name "<your display name>"`
Expected: it stops with "This database already has a catalog or rounds, and /admin owns them now. Use --admin-only to add an admin, or --force to overwrite them with the repo files." and writes nothing.

Run: `npm run db:seed -- --admin pugliabi --name "<your display name>" --admin-only`
Expected: `Admin pugliabi: already exists (admin, active), not changed. --name was not applied.`, and nothing else. The re-run doesn't read `FCR_ADMIN_PASSWORD`.

Don't use `--force` on a database the admin edits: it overwrites the catalog and rounds with the repo files.

- [ ] **Step 4: Commit.**

```powershell
npm run typecheck
git add db/seed.ts
git commit -m "Seed script: catalog, rounds, and first admin from the repo files"
```

---

### Task 11: HTTP layer, sessions, and the auth endpoints

**Files:**
- Create: `api/src/lib/config.ts`, `api/src/lib/http.ts`, `api/src/lib/http.test.ts`, `api/src/lib/current-user.ts`, `api/src/functions/health.ts`, `api/src/functions/auth.ts`
- Modify: `api/src/index.ts`

- [ ] **Step 1: Write the failing test.**

`api/src/lib/http.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clientIp, corsHeaders } from './http.ts';

describe('corsHeaders', () => {
  it('echoes allowed origins with credentials', () => {
    expect(corsHeaders('https://fabriccreditratings.com', ['https://fabriccreditratings.com'])).toMatchObject({
      'Access-Control-Allow-Origin': 'https://fabriccreditratings.com',
      'Access-Control-Allow-Credentials': 'true',
    });
  });

  it('sends no allow-origin for other sites', () => {
    expect(corsHeaders('https://evil.example', ['https://fabriccreditratings.com'])).not.toHaveProperty(
      'Access-Control-Allow-Origin',
    );
  });
});

describe('clientIp', () => {
  it('takes the first forwarded address without its port', () => {
    expect(clientIp('203.0.113.7:51234, 10.0.0.1')).toBe('203.0.113.7');
    expect(clientIp('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(clientIp('2001:db8::1')).toBe('2001:db8::1');
    expect(clientIp(null)).toBe('unknown');
  });
});
```

Run: `npx vitest run api/src/lib/http.test.ts`
Expected: FAIL, cannot resolve `./http.ts`.

- [ ] **Step 2: Create `api/src/lib/config.ts`.**

```ts
export interface Config {
  allowedOrigins: string[];
  cookieSecure: boolean;
  snapshotToken: string;
  github: { token: string; repo: string; branch: string; workflow: string };
  anthropic: { apiKey: string; workspaceId: string; model: string };
}

function setting(name: string): string {
  return process.env[name]?.trim() ?? '';
}

export function loadConfig(): Config {
  return {
    allowedOrigins: setting('ALLOWED_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    cookieSecure: setting('COOKIE_SECURE') !== 'false',
    snapshotToken: setting('SNAPSHOT_TOKEN'),
    github: {
      token: setting('GITHUB_DISPATCH_TOKEN'),
      repo: setting('GITHUB_REPO'),
      branch: setting('GITHUB_BRANCH') || 'main',
      workflow: setting('GITHUB_WORKFLOW') || 'deploy.yml',
    },
    anthropic: {
      apiKey: setting('ANTHROPIC_API_KEY'),
      workspaceId: setting('ANTHROPIC_WORKSPACE_ID'),
      model: setting('ANTHROPIC_MODEL'),
    },
  };
}
```

- [ ] **Step 3: Create `api/src/lib/current-user.ts`.**

```ts
import type { Cookie } from '@azure/functions';
import type { SessionUser } from '../../../src/domain/api-types.ts';
import { findSession, renewSession } from '../repo/sessions.ts';
import type { Config } from './config.ts';
import { db } from './db.ts';
import { cookieName, expiryFrom, hashToken, needsRenewal, readCookie, sessionCookie } from './session.ts';

export function sessionToken(cookieHeader: string | null, config: Config): string | undefined {
  return readCookie(cookieHeader, cookieName(config.cookieSecure));
}

/** Looks up the caller and slides the session forward; a renewed cookie is pushed onto `cookies`. */
export async function resolveSession(
  cookieHeader: string | null,
  config: Config,
  cookies: Cookie[],
): Promise<SessionUser | undefined> {
  const token = sessionToken(cookieHeader, config);
  if (!token) return undefined;
  const tokenHash = hashToken(token);
  const found = await findSession(db, tokenHash);
  if (!found) return undefined;
  const now = new Date();
  if (needsRenewal(found.expiresAt, now)) {
    await renewSession(db, tokenHash, expiryFrom(now));
    cookies.push(sessionCookie(config.cookieSecure, token));
  }
  return found.user;
}
```

- [ ] **Step 4: Create `api/src/lib/http.ts`.**

```ts
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  app,
  type Cookie,
  type HttpMethod,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import type { SessionUser } from '../../../src/domain/api-types.ts';
import { loadConfig, type Config } from './config.ts';
import { resolveSession } from './current-user.ts';
import { DatabaseUnavailableError, isConnectionError } from './db.ts';
import { HttpError } from './errors.ts';

export type Access = 'public' | 'build' | 'user' | 'admin';
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface Ctx {
  request: HttpRequest;
  params: Record<string, string>;
  body: Record<string, unknown>;
  config: Config;
  ip: string;
  /** Cookies to set on the response. */
  cookies: Cookie[];
  log: InvocationContext;
}

export interface UserCtx extends Ctx {
  user: SessionUser;
}

type Handler<C> = (ctx: C) => Promise<unknown>;

const preflightPaths = new Set<string>();

export function corsHeaders(origin: string | null, allowed: readonly string[]): Record<string, string> {
  const base = { 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (!origin || !allowed.includes(origin)) return base;
  return { ...base, 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' };
}

export function clientIp(forwardedFor: string | null): string {
  const first = forwardedFor?.split(',')[0]?.trim() ?? '';
  if (!first) return 'unknown';
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(first);
  if (bracketed?.[1]) return bracketed[1];
  const parts = first.split(':');
  return parts.length === 2 ? (parts[0] ?? first) : first;
}

function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return expected !== '' && timingSafeEqual(digest(given), digest(expected));
}

/**
 * Cross-site form posts can't send JSON, and other sites' Origin headers are refused. Build calls skip the Origin
 * check: GitHub Actions sends none, and their bearer token is never attached by a browser, so CSRF can't use it.
 */
function checkMutation(request: HttpRequest, config: Config, access: Access): void {
  const origin = request.headers.get('origin');
  if (access !== 'build' && (!origin || !config.allowedOrigins.includes(origin))) {
    throw new HttpError(403, 'This request came from a page that is not allowed to change ratings.');
  }
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Send the request as JSON.');
}

async function readBody(request: HttpRequest): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // Falls through to the 400 below.
  }
  throw new HttpError(400, 'The request body must be a JSON object.');
}

function describe(error: unknown, log: InvocationContext): [number, string] {
  if (error instanceof HttpError) return [error.status, error.message];
  if (error instanceof DatabaseUnavailableError || isConnectionError(error)) {
    log.warn('Database unavailable', error);
    return [503, 'The ratings database is not responding. Try again in a minute.'];
  }
  log.error('Unhandled error', error);
  return [500, 'Something went wrong on the server. Try again.'];
}

async function handle(
  request: HttpRequest,
  log: InvocationContext,
  method: Method,
  access: Access,
  handler: Handler<UserCtx>,
): Promise<HttpResponseInit> {
  const config = loadConfig();
  const headers = corsHeaders(request.headers.get('origin'), config.allowedOrigins);
  if (request.method === 'OPTIONS') {
    return {
      status: 204,
      headers: {
        ...headers,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      },
    };
  }
  const cookies: Cookie[] = [];
  try {
    if (method !== 'GET') checkMutation(request, config, access);
    if (access === 'build') {
      const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      if (!sameSecret(given, config.snapshotToken)) throw new HttpError(401, 'A valid build token is required.');
    }
    const ctx: Ctx = {
      request,
      params: request.params,
      body: method === 'GET' ? {} : await readBody(request),
      config,
      ip: clientIp(request.headers.get('x-forwarded-for')),
      cookies,
      log,
    };
    let user: SessionUser | undefined;
    if (access === 'user' || access === 'admin') {
      user = await resolveSession(request.headers.get('cookie'), config, cookies);
      if (!user) throw new HttpError(401, 'Log in to continue.');
      if (access === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Only admins can do that.');
    }
    const result = await handler({ ...ctx, user } as UserCtx);
    if (result === undefined) return { status: 204, headers, cookies };
    return { status: 200, headers, cookies, jsonBody: result };
  } catch (error) {
    const [status, message] = describe(error, log);
    return { status, headers, cookies, jsonBody: { error: message } };
  }
}

/** Registers one endpoint. The first route on a path also answers its CORS preflight. */
export function route(name: string, method: Method, path: string, access: 'public' | 'build', handler: Handler<Ctx>): void;
export function route(name: string, method: Method, path: string, access: 'user' | 'admin', handler: Handler<UserCtx>): void;
export function route(name: string, method: Method, path: string, access: Access, handler: Handler<UserCtx>): void {
  const methods: HttpMethod[] = [method];
  if (!preflightPaths.has(path)) {
    preflightPaths.add(path);
    methods.push('OPTIONS');
  }
  app.http(name, {
    methods,
    authLevel: 'anonymous',
    // host.json's routePrefix is empty because the host refuses any route template that starts with "admin".
    route: `api/${path}`,
    handler: (request, log) => handle(request, log, method, access, handler),
  });
}
```

Run: `npx vitest run api/src/lib/http.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Create `api/src/functions/health.ts`.**

```ts
import { db } from '../lib/db.ts';
import { route } from '../lib/http.ts';

route('health', 'GET', 'health', 'public', async () => {
  await db.query('SELECT 1 AS ok');
  return { ok: true };
});
```

- [ ] **Step 6: Create `api/src/functions/auth.ts`.** As built, login's lockout differs from the block below, and `api/src/functions/auth.ts` wins: it validates the login against `LOGIN`, takes a lock-free look at both keys, then reserves the attempt on both (`reserveAttempt`) before the password check, and on success clears the login key and hands back the IP attempt (`releaseAttempt`). The session insert is guarded (`7e573e9`), logout clears the cookie first (`dbcbb18`), and a password change commits the new hash and the end of the other sessions together (`29bfb0c`), as shown here. The change applies only to the hash it verified (`7075b0f`). `replacePasswordHash` updates the row only while the user is still active with that hash. If an admin reset the password or disabled the user in the meantime, it matches nothing, and the route answers 400 "Your current password is wrong." inside the transaction. That rolls the transaction back, so nothing changes and no session ends.

```ts
import { sessionToken } from '../lib/current-user.ts';
import { db, transaction } from '../lib/db.ts';
import { HttpError } from '../lib/errors.ts';
import { route } from '../lib/http.ts';
import { afterFailure, isLocked } from '../lib/lockout.ts';
import { dummyHash, hashPassword, passwordProblem, verifyPassword } from '../lib/password.ts';
import { clearedCookie, expiryFrom, hashToken, newToken, sessionCookie } from '../lib/session.ts';
import { rawString, text } from '../lib/validate.ts';
import { clearAttempt, getAttempts, saveAttempt } from '../repo/attempts.ts';
import { createSession, deleteSession, deleteUserSessions, pruneExpiredSessions } from '../repo/sessions.ts';
import { findUserById, findUserByLogin, replacePasswordHash, toSessionUser } from '../repo/users.ts';

route('login', 'POST', 'auth/login', 'public', async (ctx) => {
  const login = text(ctx.body, 'login', 'Login', 40).toLowerCase();
  const password = rawString(ctx.body, 'password');
  const now = new Date();
  const loginKey = `login:${login}`;
  const keys = [loginKey, `ip:${ctx.ip}`];
  const attempts = await getAttempts(db, keys);
  if (keys.some((key) => isLocked(attempts.get(key), now))) {
    throw new HttpError(429, 'Too many failed tries. Wait 15 minutes, then try again.');
  }
  const user = await findUserByLogin(db, login);
  const matches = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));
  if (!user || !user.active || !matches) {
    for (const key of keys) await saveAttempt(db, key, afterFailure(attempts.get(key), now));
    throw new HttpError(401, 'Wrong login or password.');
  }
  await clearAttempt(db, loginKey);
  await pruneExpiredSessions(db);
  const token = newToken();
  // False when an admin reset the password or disabled the user after the check above.
  if (!(await createSession(db, hashToken(token), user.id, expiryFrom(now), user.passwordHash))) {
    throw new HttpError(401, 'Wrong login or password.');
  }
  ctx.cookies.push(sessionCookie(ctx.config.cookieSecure, token));
  return toSessionUser(user);
});

route('logout', 'POST', 'auth/logout', 'public', async (ctx) => {
  // Cleared first: an error response still sends ctx.cookies, so a failed delete still logs this browser out.
  ctx.cookies.push(clearedCookie(ctx.config.cookieSecure));
  const token = sessionToken(ctx.request.headers.get('cookie'), ctx.config);
  if (token) await deleteSession(db, hashToken(token));
  return undefined;
});

route('me', 'GET', 'me', 'user', async (ctx) => ctx.user);

route('changePassword', 'PUT', 'me/password', 'user', async (ctx) => {
  const current = rawString(ctx.body, 'current');
  const next = rawString(ctx.body, 'next');
  const record = await findUserById(db, ctx.user.id);
  if (!record || !(await verifyPassword(current, record.passwordHash))) {
    throw new HttpError(400, 'Your current password is wrong.');
  }
  const problem = passwordProblem(next);
  if (problem) throw new HttpError(400, problem);
  const passwordHash = await hashPassword(next);
  const token = sessionToken(ctx.request.headers.get('cookie'), ctx.config);
  await transaction(async (tx) => {
    // False when an admin reset the password or disabled the user after the check above.
    if (!(await replacePasswordHash(tx, record.id, record.passwordHash, passwordHash))) {
      throw new HttpError(400, 'Your current password is wrong.');
    }
    await deleteUserSessions(tx, record.id, token ? hashToken(token) : '');
  });
  return undefined;
});
```

- [ ] **Step 7: Register them.** Replace `api/src/index.ts` with:

```ts
import './functions/health.ts';
import './functions/auth.ts';
```

- [ ] **Step 8: Smoke test against `fcr-dev`.**

Terminal 1: `npm run api`
Expected: the Functions host lists `health`, `login`, `logout`, `me`, `changePassword` routes on `http://localhost:7071`.

Terminal 2:

```powershell
Invoke-RestMethod http://localhost:7071/api/health
$web = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$headers = @{ Origin = 'http://localhost:5173' }
$body = @{ login = 'pugliabi'; password = $env:FCR_ADMIN_PASSWORD } | ConvertTo-Json
Invoke-RestMethod -Method Post http://localhost:7071/api/auth/login -WebSession $web -Headers $headers -ContentType 'application/json' -Body $body
Invoke-RestMethod http://localhost:7071/api/me -WebSession $web
Invoke-RestMethod -Method Post http://localhost:7071/api/auth/logout -WebSession $web -Headers $headers -ContentType 'application/json' -Body '{}'
Invoke-RestMethod http://localhost:7071/api/me -WebSession $web
```

Expected:
- `ok: True`.
- Login and `me` both return `id`, `login: pugliabi`, `displayName`, `role: admin`.
- After logout, the last call fails with HTTP 401 and `{"error":"Log in to continue."}`.

- [ ] **Step 9: Commit.**

```powershell
npm run typecheck; npm test
git add api/src/lib/config.ts api/src/lib/http.ts api/src/lib/http.test.ts api/src/lib/current-user.ts api/src/functions api/src/index.ts
git commit -m "API: HTTP layer with CORS and CSRF checks, sessions, login, logout, password change"
```

---

### Task 12: Snapshot and review building

**Files:**
- Create: `api/src/domain/fixtures.ts`, `api/src/domain/snapshot.ts`, `api/src/domain/snapshot.test.ts`, `api/src/domain/review.ts`, `api/src/domain/review.test.ts`, `api/src/functions/build.ts`
- Modify: `api/src/index.ts`

- [ ] **Step 1: Shared fixture.** `api/src/domain/fixtures.ts`:

```ts
import type { Artifact, Round, Workload } from '../../../src/domain/types.ts';
import { assembleDataset, type NoteRow, type ScoreRow } from './dataset.ts';

const at = new Date('2026-09-30T12:00:00Z');
const names: Record<number, string> = { 1: 'Ann', 2: 'Bo' };

function row(roundId: string, userId: number, artifactId: string, scores: [number, number, number]): ScoreRow {
  const [capability, ux, cost] = scores;
  return { roundId, userId, name: names[userId] ?? '', artifactId, capability, ux, cost, updatedAt: at };
}

export const workloads: Workload[] = [
  { id: 'storage', name: 'Storage & Databases', shortName: 'Storage', blurb: 'Lakehouses and warehouses' },
  { id: 'mcp', name: 'MCP Servers', shortName: 'MCP', blurb: 'Servers for agents' },
];

export const artifacts: Artifact[] = [
  { id: 'lakehouse', name: 'Lakehouse', workload: 'storage', status: 'ga' },
  { id: 'legacy', name: 'Legacy item', workload: 'storage', status: 'retired' },
  { id: 'unscored', name: 'Unscored item', workload: 'storage', status: 'preview' },
  { id: 'mcp-server', name: 'MCP server', workload: 'mcp', status: 'preview' },
];

export const rounds: Round[] = [
  { id: '2026-Q3', label: 'Q3 2026', status: 'published', publishedOn: '2026-07-01' },
  { id: '2026-Q4', label: 'Q4 2026', status: 'published', publishedOn: '2026-10-01' },
  { id: '2027-Q1', label: 'Q1 2027', status: 'open', publishedOn: null },
];

export const scoreRows: ScoreRow[] = [
  row('2026-Q3', 1, 'lakehouse', [6, 5, 4]),
  row('2026-Q3', 2, 'lakehouse', [5, 5, 4]),
  row('2026-Q3', 1, 'legacy', [7, 7, 7]),
  row('2026-Q4', 1, 'lakehouse', [7, 7, 7]),
  row('2027-Q1', 1, 'mcp-server', [4, 4, 4]),
];

export const noteRows: NoteRow[] = [{ roundId: '2026-Q4', artifactId: 'lakehouse', body: 'Now the default store.' }];

export const dataset = assembleDataset(workloads, artifacts, rounds, scoreRows, noteRows);
```

- [ ] **Step 2: Write the failing tests.**

`api/src/domain/snapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dataset } from './fixtures.ts';
import { buildSnapshot } from './snapshot.ts';

const snapshot = buildSnapshot(dataset.workloads, dataset.artifacts, dataset.rounds, new Date('2026-10-15T00:00:00Z'));

describe('buildSnapshot', () => {
  it('includes only items scored in a published round', () => {
    expect(snapshot.ratings.map((rating) => rating.artifact.id)).toEqual(['lakehouse', 'legacy']);
  });

  it('drops workloads with no rated items', () => {
    expect(snapshot.workloads.map((workload) => workload.id)).toEqual(['storage']);
  });

  it('keeps averages, history order, notes, and the retired rule', () => {
    const [lakehouse, legacy] = snapshot.ratings;
    expect(lakehouse?.history.map((point) => [point.round, point.grade, point.raters])).toEqual([
      ['2026-Q3', 'A-', 2],
      ['2026-Q4', 'AAA', 1],
    ]);
    expect(lakehouse?.history[0]?.scores).toEqual({ capability: 5.5, ux: 5, cost: 4 });
    expect(lakehouse?.current.note).toBe('Now the default store.');
    expect(legacy?.current.grade).toBe('E');
  });

  it('dates the snapshot and the ratings', () => {
    expect(snapshot.generatedAt).toBe('2026-10-15T00:00:00.000Z');
    expect(snapshot.asOf).toBe('2026-10-01');
  });

  it('carries no rater identities', () => {
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain('Ann');
    expect(json).not.toContain('"rater"');
    expect(json).not.toContain('userId');
  });
});
```

`api/src/domain/review.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dataset } from './fixtures.ts';
import { buildReview } from './review.ts';

describe('buildReview', () => {
  it('compares a published round with the one before it', () => {
    const review = buildReview(dataset, '2026-Q4', '2026-10-15', false);
    expect(review?.items.map((item) => item.artifact.id)).toEqual(['lakehouse']);
    const item = review?.items[0];
    expect(item?.change).toEqual({ kind: 'up', text: 'Up 6 notches from A- (Q3 2026)' });
    expect(item?.breakdown).toEqual([{ userId: 1, name: 'Ann', scores: [7, 7, 7] }]);
    expect(review?.notes).toEqual({ lakehouse: 'Now the default store.' });
  });

  it('dates an open round with today and flags first ratings', () => {
    const review = buildReview(dataset, '2027-Q1', '2026-10-15', true);
    expect(review?.items[0]?.point.date).toBe('2026-10-15');
    expect(review?.items[0]?.change.kind).toBe('new');
    expect(review?.raters).toEqual([{ userId: 1, name: 'Ann' }]);
    expect(review?.aiEnabled).toBe(true);
  });

  it('lists every rater in the round', () => {
    expect(buildReview(dataset, '2026-Q3', '2026-10-15', false)?.raters).toEqual([
      { userId: 1, name: 'Ann' },
      { userId: 2, name: 'Bo' },
    ]);
  });

  it('returns undefined for an unknown round', () => {
    expect(buildReview(dataset, '1999-Q1', '2026-10-15', false)).toBeUndefined();
  });
});
```

Run: `npx vitest run api/src/domain`
Expected: FAIL, cannot resolve `./snapshot.ts` and `./review.ts`.

- [ ] **Step 3: Implement `api/src/domain/snapshot.ts`.**

```ts
import type { Snapshot } from '../../../src/domain/api-types.ts';
import { asOfDate, buildRatings } from '../../../src/domain/aggregate.ts';
import type { Artifact, RoundData, Workload } from '../../../src/domain/types.ts';

/** Published rounds only. Unscored items and workloads without a rated item are left out. */
export function buildSnapshot(
  workloads: readonly Workload[],
  artifacts: readonly Artifact[],
  rounds: readonly RoundData[],
  now: Date,
): Snapshot {
  const ratings = buildRatings(artifacts, rounds);
  const rated = new Set(ratings.map((rating) => rating.artifact.workload));
  return {
    generatedAt: now.toISOString(),
    asOf: asOfDate(rounds),
    workloads: workloads.filter((workload) => rated.has(workload.id)),
    ratings,
  };
}
```

- [ ] **Step 4: Implement `api/src/domain/review.ts`.** `changeLabel` moves here from `src/desk/selectors.ts`.

```ts
import type { ChangeKind, ReviewItem, RoundReview } from '../../../src/domain/api-types.ts';
import { pointFor, previousPoint } from '../../../src/domain/aggregate.ts';
import { notchDelta } from '../../../src/domain/grades.ts';
import type { RatingPoint } from '../../../src/domain/types.ts';
import { pluralize } from '../../../src/lib/format.ts';
import type { Dataset } from './dataset.ts';

export function changeLabel(point: RatingPoint, previous: RatingPoint | undefined): { kind: ChangeKind; text: string } {
  if (!previous) return { kind: 'new', text: 'First rating' };
  const delta = notchDelta(previous.grade, point.grade);
  const from = `from ${previous.grade} (${previous.roundLabel})`;
  if (delta > 0) return { kind: 'up', text: `Up ${pluralize(delta, 'notch', 'notches')} ${from}` };
  if (delta < 0) return { kind: 'down', text: `Down ${pluralize(-delta, 'notch', 'notches')} ${from}` };
  return { kind: 'same', text: `Unchanged ${from}` };
}

/** Everything the admin Review tab shows for one round. Open rounds are dated `today`. */
export function buildReview(data: Dataset, roundId: string, today: string, aiEnabled: boolean): RoundReview | undefined {
  const target = data.rounds.find((item) => item.round.id === roundId);
  if (!target) return undefined;
  const date = target.round.publishedOn ?? today;
  const rater = (id: string) => ({ userId: Number(id), name: data.raterNames.get(Number(id)) ?? id });
  const items = data.artifacts.flatMap((artifact): ReviewItem[] => {
    const point = pointFor(artifact, target, date);
    if (!point) return [];
    const previous = previousPoint(artifact, data.rounds, roundId);
    const breakdown = target.scorecards.flatMap((card) => {
      const scores = card.scores[artifact.id];
      return scores ? [{ ...rater(card.rater), scores }] : [];
    });
    return [{ artifact, point, previous: previous ?? null, change: changeLabel(point, previous), breakdown }];
  });
  return {
    round: target.round,
    raters: target.scorecards.map((card) => rater(card.rater)),
    items,
    notes: target.notes,
    aiEnabled,
  };
}
```

Run: `npx vitest run api/src/domain`
Expected: 9 tests pass.

- [ ] **Step 5: Create `api/src/functions/build.ts`.** The snapshot GET writes nothing (`9611edd`). Its `generatedAt` is the database's clock, read under `site_state`'s row lock before the load (`cde0634`). The deploy workflow confirms the live snapshot with `POST build/snapshot/deployed`, which moves `last_snapshot_at` forward.

```ts
import type { InvocationContext } from '@azure/functions';
import { buildSnapshot } from '../domain/snapshot.ts';
import { db } from '../lib/db.ts';
import { HttpError } from '../lib/errors.ts';
import { route } from '../lib/http.ts';
import { loadDataset } from '../repo/dataset.ts';
import { markSnapshotTaken } from '../repo/site.ts';

/** Slack for this host's clock running behind the database's, which dated the snapshot. */
const MAX_AHEAD_MS = 5 * 60_000;

function deployedAt(value: unknown): Date {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'generatedAt is required: send the generatedAt of the snapshot that was deployed.');
  }
  const at = new Date(value);
  if (Number.isNaN(at.getTime()) || at.toISOString() !== value) {
    throw new HttpError(
      400,
      'generatedAt must be an ISO timestamp exactly as the snapshot gave it, such as 2026-10-15T21:00:00.000Z.',
    );
  }
  if (at.getTime() > Date.now() + MAX_AHEAD_MS) {
    throw new HttpError(
      400,
      'generatedAt is more than 5 minutes in the future. Send the generatedAt of the snapshot that was deployed.',
    );
  }
  return at;
}

/**
 * The database's clock, the one changed_at uses. SYSUTCDATETIME() is fixed when this statement starts; the read then
 * takes site_state's row lock (READCOMMITTEDLOCK), so it waits for any transaction that has already stamped. A stamp
 * this read didn't wait for is no earlier than this time, and isBehind counts a tie as behind.
 */
async function databaseNow(log: InvocationContext): Promise<Date> {
  const [locked] = await db.query<{ now: Date }>(
    'SELECT SYSUTCDATETIME() AS now FROM site_state WITH (READCOMMITTEDLOCK) WHERE id = 1',
  );
  if (locked) return locked.now;
  // Without the row, markChanged has nothing to stamp, so there is nothing to wait for.
  log.warn(
    'site_state has no row, so the admin page shows the site as behind until npm run db:apply adds it ' +
      'and the next deploy is confirmed.',
  );
  const [clock] = await db.query<{ now: Date }>('SELECT SYSUTCDATETIME() AS now');
  if (!clock) throw new Error('SYSUTCDATETIME() returned no row.');
  return clock.now;
}

/**
 * Read-only: the deploy workflow confirms with build/snapshot/deployed once the site is live. generatedAt is read
 * before the load starts, so a change is either in the snapshot or stamped no earlier than generatedAt.
 */
route('buildSnapshot', 'GET', 'build/snapshot', 'build', async (ctx) => {
  const now = await databaseNow(ctx.log);
  const data = await loadDataset(db);
  return buildSnapshot(data.workloads, data.artifacts, data.rounds, now);
});

route('buildSnapshotDeployed', 'POST', 'build/snapshot/deployed', 'build', async (ctx) => {
  await markSnapshotTaken(db, deployedAt(ctx.body.generatedAt));
});
```

Add to `api/src/index.ts`:

```ts
import './functions/build.ts';
```

- [ ] **Step 6: Check the endpoint.** With `npm run api` running:

```powershell
Invoke-RestMethod http://localhost:7071/api/build/snapshot -Headers @{ Authorization = 'Bearer dev-snapshot-token' }
```

Expected: `generatedAt` set, `asOf` empty, `workloads` and `ratings` empty (nothing published in `fcr-dev` yet). Without the header, the call fails with HTTP 401.

- [ ] **Step 7: Commit.**

```powershell
npm run typecheck; npm test
git add api/src/domain api/src/functions/build.ts api/src/index.ts
git commit -m "API: public snapshot and admin round review builders, snapshot endpoint"
```

---

### Task 13: Site deploy trigger

**Files:**
- Create: `api/src/lib/github.ts`, `api/src/lib/github.test.ts`

- [ ] **Step 1: Write the failing test.**

`api/src/lib/github.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Config } from './config.ts';
import { deployConfigured, startDeploy } from './github.ts';

function config(token: string): Config {
  return {
    allowedOrigins: [],
    cookieSecure: true,
    snapshotToken: '',
    github: { token, repo: 'owner/repo', branch: 'main', workflow: 'deploy.yml' },
    anthropic: { apiKey: '', workspaceId: '', model: '' },
  };
}

describe('startDeploy', () => {
  it('says so when dispatch is not set up', async () => {
    expect(deployConfigured(config(''))).toBe(false);
    expect((await startDeploy(config(''))).started).toBe(false);
  });

  it('dispatches the deploy workflow on the configured branch', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
    expect((await startDeploy(config('tok'), fetchImpl)).started).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://api.github.com/repos/owner/repo/actions/workflows/deploy.yml/dispatches');
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ ref: 'main' }) });
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('explains a refusal', async () => {
    const result = await startDeploy(config('tok'), async () => new Response('nope', { status: 403 }));
    expect(result).toEqual({
      started: false,
      message: 'GitHub refused the site update (HTTP 403). Run the deploy workflow from the Actions tab.',
    });
  });

  it('survives a network failure', async () => {
    const result = await startDeploy(config('tok'), async () => {
      throw new Error('offline');
    });
    expect(result.started).toBe(false);
  });
});
```

Run: `npx vitest run api/src/lib/github.test.ts`
Expected: FAIL, cannot resolve `./github.ts`.

- [ ] **Step 2: Implement `api/src/lib/github.ts`.**

```ts
import type { DeployResult } from '../../../src/domain/api-types.ts';
import type { Config } from './config.ts';

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function deployConfigured(config: Config): boolean {
  return Boolean(config.github.token && config.github.repo);
}

/** Starts the site's deploy workflow. Never throws: a publish must not fail because GitHub did. */
export async function startDeploy(config: Config, fetchImpl: Fetch = fetch): Promise<DeployResult> {
  if (!deployConfigured(config)) {
    return {
      started: false,
      message: 'Automatic site updates are not set up. Set GITHUB_DISPATCH_TOKEN and GITHUB_REPO in the Function App.',
    };
  }
  const { token, repo, branch, workflow } = config.github;
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'fabric-credit-ratings-api',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: branch }),
    });
    if (response.status === 204) {
      return { started: true, message: 'The public site is rebuilding. It updates in about two minutes.' };
    }
    return {
      started: false,
      message: `GitHub refused the site update (HTTP ${response.status}). Run the deploy workflow from the Actions tab.`,
    };
  } catch {
    return { started: false, message: 'GitHub did not respond. Try Update public site again in a minute.' };
  }
}
```

Run: `npx vitest run api/src/lib/github.test.ts`
Expected: 4 tests pass.

- [ ] **Step 3: Commit.**

```powershell
npm run typecheck
git add api/src/lib/github.ts api/src/lib/github.test.ts
git commit -m "API: trigger the site deploy workflow"
```

---

### Task 14: Rater endpoints

**Files:**
- Create: `api/src/functions/rater.ts`
- Modify: `api/src/index.ts`

- [ ] **Step 1: Create `api/src/functions/rater.ts`.** As built, the save differs from the block below, and `api/src/functions/rater.ts` wins. It runs through `saveForItems(ctx.log, CARD_ITEM_DELETED, …)` (`api/src/lib/item-saves.ts`, Task 15). Inside, `lockRound(tx, round.id)` re-checks that the round is still open (409 "<label> was just published. Reload the page." if not) before `replaceScorecard`. A deleted item answers 409 `CARD_ITEM_DELETED`, and a lost deadlock answers 503 "Someone was changing the catalog at the same moment. Try again." (`5223830`).

```ts
import type { MyScores } from '../../../src/domain/api-types.ts';
import type { Round } from '../../../src/domain/types.ts';
import { db, transaction } from '../lib/db.ts';
import { HttpError } from '../lib/errors.ts';
import { route } from '../lib/http.ts';
import { cardWriteProblem } from '../lib/permissions.ts';
import { validateScores } from '../lib/validate.ts';
import { listArtifacts, listWorkloads } from '../repo/catalog.ts';
import { findOpenRound } from '../repo/rounds.ts';
import { lastPublishedCard, replaceScorecard, scoresFor, toTriples } from '../repo/scores.ts';

async function requireOpenRound(): Promise<Round> {
  const round = await findOpenRound(db);
  if (!round) throw new HttpError(409, 'No round is open for scoring right now.');
  return round;
}

async function myScores(round: Round, userId: number): Promise<MyScores> {
  const rows = await scoresFor(db, round.id, userId);
  const newest = rows.reduce<Date | undefined>(
    (latest, row) => (!latest || row.updatedAt > latest ? row.updatedAt : latest),
    undefined,
  );
  return {
    round,
    scores: toTriples(rows),
    updatedAt: newest?.toISOString() ?? null,
    previous: (await lastPublishedCard(db, userId)) ?? null,
  };
}

route('catalog', 'GET', 'catalog', 'user', async () => {
  const [workloads, artifacts] = await Promise.all([listWorkloads(db), listArtifacts(db)]);
  return { workloads, artifacts };
});

route('openRound', 'GET', 'rounds/open', 'user', async () => ({ round: (await findOpenRound(db)) ?? null }));

route('myScoresGet', 'GET', 'rounds/open/my-scores', 'user', async (ctx) =>
  myScores(await requireOpenRound(), ctx.user.id),
);

route('myScoresPut', 'PUT', 'rounds/open/my-scores', 'user', async (ctx) => {
  const round = await requireOpenRound();
  if (ctx.body.round !== round.id) {
    throw new HttpError(409, `The open round is now ${round.label}. Reload the page to score it.`);
  }
  const problem = cardWriteProblem(ctx.user, round, ctx.user.id);
  if (problem) throw new HttpError(403, problem);
  const known = new Set((await listArtifacts(db)).map((artifact) => artifact.id));
  const { scores, errors } = validateScores(ctx.body.scores, known);
  if (errors.length > 0) throw new HttpError(400, errors.join(' '));
  await transaction((tx) => replaceScorecard(tx, round.id, ctx.user.id, scores));
  return myScores(round, ctx.user.id);
});
```

Add to `api/src/index.ts`:

```ts
import './functions/rater.ts';
```

- [ ] **Step 2: Check it.** With `npm run api` running and `$web` and `$headers` logged in as in Task 11 Step 8:

```powershell
Invoke-RestMethod http://localhost:7071/api/rounds/open -WebSession $web
$card = @{ round = '2026-Q4'; scores = @{ notebook = @(6, 5, 4) } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Method Put http://localhost:7071/api/rounds/open/my-scores -WebSession $web -Headers $headers -ContentType 'application/json' -Body $card
$empty = @{ round = '2026-Q4'; scores = @{} } | ConvertTo-Json
Invoke-RestMethod -Method Put http://localhost:7071/api/rounds/open/my-scores -WebSession $web -Headers $headers -ContentType 'application/json' -Body $empty
```

Expected:
- The first call returns round `2026-Q4`, status `open`.
- The second returns `scores.notebook = 6 5 4` and a non-null `updatedAt`.
- The third clears the card: `scores` is empty and `updatedAt` is null.

- [ ] **Step 3: Commit.**

```powershell
npm run typecheck
git add api/src/functions/rater.ts api/src/index.ts
git commit -m "API: catalog, open round, and the rater's own scorecard"
```

---

### Task 15: AI drafting and admin round endpoints

**Files:**
- Create: `api/src/lib/draft-why.ts`, `api/src/lib/draft-why.test.ts`, `api/src/functions/admin-rounds.ts`
- Modify: `api/src/index.ts`

`scripts/draft-why.ts` stays until Plan 2 deletes the desk that uses it.

- [ ] **Step 1: Write the failing test.**

`api/src/lib/draft-why.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDrafter, mentionsMath, promptFor } from './draft-why.ts';

describe('mentionsMath', () => {
  it('flags grades, totals, and sums', () => {
    expect(mentionsMath('Rated AA+ this time')).toBe(true);
    expect(mentionsMath('scored 18 out of 21')).toBe(true);
    expect(mentionsMath('5 + 6 + 7')).toBe(true);
    expect(mentionsMath('A dependable workhorse with rough edges.')).toBe(false);
  });
});

describe('promptFor', () => {
  it('names the workload and forbids the math', () => {
    const prompt = promptFor({
      artifact: { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga' },
      workload: { id: 'data-engineering', name: 'Data Engineering', shortName: 'Data Eng', blurb: 'Notebooks and Spark' },
      roundLabel: 'Q4 2026',
      scores: { capability: 6, ux: 5, cost: 4 },
      raters: 2,
    });
    expect(prompt).toContain('Workload: Data Engineering (Notebooks and Spark)');
    expect(prompt).toContain('average of 2 raters');
    expect(prompt).toContain('Never mention scores');
  });
});

describe('createDrafter', () => {
  it('is off without an API key', () => {
    expect(createDrafter({ apiKey: '', workspaceId: '', model: '' })).toBeUndefined();
  });
});
```

Run: `npx vitest run api/src/lib/draft-why.test.ts`
Expected: FAIL, cannot resolve `./draft-why.ts`.

- [ ] **Step 2: Create `api/src/lib/draft-why.ts`.** This is `scripts/draft-why.ts` with three changes: the caller passes the workload, settings come from the Function App, and the error messages point at app settings instead of `.env`. As built (`fc3a229`, then `3b86266`, `cfaae75`, `e4c63c5`), the file differs from the block below, and `api/src/lib/draft-why.ts` wins:
  - **Timeouts.** The client is built with `timeout: 40_000` and `maxRetries: 1`, so each Anthropic call gives up after 40 s with one retry. The SDK's waits between retries follow `Retry-After` with no cap, so the caller's signal bounds the whole draft. `draft(input, signal?)` checks `signal.aborted` before each attempt and passes `{ signal }` to every `messages.create`.
  - **Leak guard.** `mentionsMath` uses two regexes, `GRADE` and `OUT_OF`. They catch signed grades such as `A-` or `B+` without flagging "B-tree", plus "6 of 7", "out of seven", and a slash score from 1 to 21 over 7 or 21, decimals included ("6/7", "15/21", "5.67/7", "17.0/21"; `e03dc3b`). "24/7" isn't flagged.
  - **`explain()`.** It wraps every error, mapped or not, in an `Error` that keeps the provider's error as its `cause`. An unmapped error keeps its own message for the 502 (`a2a211c`). Besides the workspace and key cases:
    - a model the key can't use (404): "ANTHROPIC_MODEL names a model this key can't use. Check the setting in the Function App.";
    - a rate limit (429): "Anthropic's rate limit was reached. Wait a minute, then try again." (`5223830`);
    - an overload (529 or `overloaded_error`): "Anthropic is overloaded right now. Try again in a minute.";
    - a timeout, meaning an attempt's own 40 s, the SDK's `APIUserAbortError`, or a `TimeoutError` or `AbortError` from the caller's signal: "Anthropic did not answer in time. Try again."
  - **`failureDetails(error, settings)`** is exported for the log. It returns the model, and for an SDK error with a status, its status, request id, and error type. It adds the cause's chain of up to 3 links as `"<class>: <message> (<code>)"` joined by `" <- "`, such as `APIConnectionError: Connection error. <- TypeError: fetch failed <- Error: getaddrinfo ENOTFOUND api.anthropic.com (ENOTFOUND)`. It never includes the key, which travels only in request headers, or the prompt.
  - **Prompt.** A missing workload row renders as its id.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { FACTORS } from '../../../src/data/factors.ts';
import type { Artifact, FactorValues, Workload } from '../../../src/domain/types.ts';

const DEFAULT_MODEL = 'claude-sonnet-5-5';
const STATUS_LABEL = { ga: 'general availability', preview: 'preview', retired: 'retired' } as const;

const EXAMPLES = [
  'The most complete authoring surface in Fabric: Spark, pure Python, T-SQL cells, Copilot, and Git integration. Session start-up and idle compute still cost more capacity than they should.',
  'Incremental copy and CDC turned a convenience item into a real ingestion tool. A guided setup with no pipeline to maintain makes it the default answer for bulk and incremental loads.',
  'Superseded by Dataflow Gen2. No CI/CD, no Fabric destinations, and a higher cost per row than any alternative.',
];

export interface AnthropicSettings {
  apiKey: string;
  workspaceId: string;
  model: string;
}

export interface DraftInput {
  artifact: Artifact;
  workload?: Workload;
  roundLabel: string;
  scores: FactorValues;
  raters: number;
  previous?: { roundLabel: string; scores: FactorValues; note: string };
}

/** True when a draft leaks a grade, a total, or arithmetic. */
export function mentionsMath(text: string): boolean {
  return (
    /\b(AAA|AA\+|AA-|AA|A\+|A-|BBB\+|BBB-|BBB|BB\+|BB-|BB|B\+|B-|CCC|CC)\b/.test(text) ||
    /\/\s*21|out of 21|\/\s*7\b|out of 7/.test(text) ||
    /\d\s*\+\s*\d/.test(text)
  );
}

function scoreLine(scores: FactorValues): string {
  return FACTORS.map((factor) => `${factor.label.toLowerCase()} ${scores[factor.id]}`).join(', ');
}

export function promptFor(input: DraftInput): string {
  const { artifact, workload, roundLabel, scores, raters, previous } = input;
  const factors = FACTORS.map(
    (factor) =>
      `- ${factor.label} (${scores[factor.id]} of 7). 1 means "${factor.low}". 7 means "${factor.high}".`,
  ).join('\n');
  const prior = previous
    ? `Previous review (${previous.roundLabel}): ${scoreLine(previous.scores)}.${previous.note ? ` Its write-up: "${previous.note}"` : ''}`
    : 'This is the first review of this item.';

  return `Write the "why this rating" paragraph for a Microsoft Fabric item on a bond-style ratings site.

Item: ${artifact.name}
Workload: ${workload?.name ?? artifact.workload} (${workload?.blurb ?? ''})
Release status: ${STATUS_LABEL[artifact.status]}
Review: ${roundLabel}, ${raters === 1 ? 'one rater' : `average of ${raters} raters`}
${prior}

Scores, for your judgment only:
${factors}

Voice, from earlier writeups. Match the length and tone. Do not copy them:
${EXAMPLES.map((example) => `- ${example}`).join('\n')}

Rules:
- 2 to 4 sentences, plain prose, no heading and no list.
- Say what the item is good at and what holds it back.
- If there is a previous review, describe the direction of change in words.
- If the item is retired, say so plainly and point readers to the replacement if there is an obvious one.
- Never mention scores, totals, letter grades, rater counts, or arithmetic. The reader must not be able to reconstruct the rating from the paragraph.`;
}

/** Turns the two setup errors people actually hit into instructions. */
function explain(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('anthropic-workspace-id')) {
    return new Error(
      'This Anthropic key is not scoped to a workspace. Set ANTHROPIC_WORKSPACE_ID in the Function App settings (Claude Console, Settings, Workspaces), or create the key inside a workspace.',
    );
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new Error('Anthropic rejected ANTHROPIC_API_KEY. Check the key in the Function App settings.');
  }
  return error instanceof Error ? error : new Error(message);
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

/** Returns undefined when no API key is configured. */
export function createDrafter(settings: AnthropicSettings) {
  if (!settings.apiKey) return undefined;
  const client = new Anthropic({
    apiKey: settings.apiKey,
    ...(settings.workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': settings.workspaceId } } : {}),
  });
  const model = settings.model || DEFAULT_MODEL;

  /** One retry if the first draft leaks the math. Throws on API errors. */
  return async function draft(input: DraftInput): Promise<string> {
    const prompt = promptFor(input);
    let rejected = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const message = await client.messages
        .create({
          model,
          max_tokens: 400,
          messages: [
            {
              role: 'user',
              content:
                attempt === 0
                  ? prompt
                  : `${prompt}\n\nThe draft below mentions a score, a total, or a letter grade. Rewrite it without any of those.\n\n${rejected}`,
            },
          ],
        })
        .catch((error: unknown) => {
          throw explain(error);
        });
      const text = textOf(message);
      if (text && !mentionsMath(text)) return text;
      rejected = text;
    }
    throw new Error('The model kept mentioning scores or grades. Write this one by hand.');
  };
}

export type Drafter = NonNullable<ReturnType<typeof createDrafter>>;
```

Run: `npx vitest run api/src/lib/draft-why.test.ts`
Expected: 3 tests pass.

- [ ] **Step 3: Create `api/src/functions/admin-rounds.ts`.** As built (`f8bdb00`, `817d1d6`, `8090e47`), the writes differ from the block below, and `api/src/functions/admin-rounds.ts` wins. Publish, reopen, `adminScoresPut`, and `adminNotePut` each run in one `transaction`: `lockRound(tx, round.id)` first (from the Task 9 fix), then the status checks on the locked row, then the write, then `markChanged(tx)` as the last statement. Scores and notes stamp only when the locked round is published. Publish starts the deploy after the commit, and refuses a `publishedOn` earlier than the latest published round's with 400 (`e9fe8cf`). The latest published round is the one with the latest publish date; on a tie, the one whose id sorts last (`findLatestPublishedRound`: `ORDER BY published_on DESC, id DESC`). So a lower-id round published on the same day doesn't become the latest. That's accepted, because round ids are created in order (`d98671a`). Reopen accepts only the latest published round. `adminDraft` starts `AbortSignal.timeout(200_000)` as its first statement, so the dataset load counts against it, and passes it to the drafter (`3b86266`). The load can't be interrupted. If the deadline passed during it, the route throws `DatabaseUnavailableError`, which answers the database 503 "The ratings database is not responding. Try again in a minute." instead of blaming Anthropic (`ad47915`). A failed draft logs `failureDetails(error, ctx.config.anthropic)` plus `loadMs` and `elapsedMs`, and answers 502 with the friendly message (`cfaae75`, `ad47915`). A note body that isn't a string gets 400. `adminScoresPut` takes `userId` only as 1 to 9 digits (`USER_ID`). Both saves, and the rater's own save in Task 14, run through `saveForItems(ctx.log, deleted, work)` in `api/src/lib/item-saves.ts` (`beb3ca5`, `5223830`):
  - a foreign-key refusal (547: the item was deleted after the check) becomes a 409 with `deleted`, either `CARD_ITEM_DELETED` ("An item on this card was just deleted. Reload the page to get the current list.") or the note's "That item was just deleted. Reload the page to get the current list.";
  - a lost deadlock (1205) logs "Deadlock victim" and becomes 503 "Someone was changing the catalog at the same moment. Try again.". Card saves take the round lock in turn, so the only deadlock one can lose is to that same item's delete.

  The SQL error number lists (`DUPLICATE_KEY`, `DEADLOCK_VICTIM`, `CONSTRAINT_CONFLICT`) and `hasSqlNumber` live in `db.ts`, next to `sqlErrorNumber` (`28ebd57`).

```ts
import type { DeployResult, PublishResult, RoundReview } from '../../../src/domain/api-types.ts';
import { pointFor, previousPoint } from '../../../src/domain/aggregate.ts';
import type { Round } from '../../../src/domain/types.ts';
import { buildReview } from '../domain/review.ts';
import type { Config } from '../lib/config.ts';
import { db, transaction } from '../lib/db.ts';
import { createDrafter } from '../lib/draft-why.ts';
import { HttpError } from '../lib/errors.ts';
import { startDeploy } from '../lib/github.ts';
import { route } from '../lib/http.ts';
import { cardWriteProblem } from '../lib/permissions.ts';
import { ISO_DATE, ROUND_ID, oneOf, text, today, validateScores } from '../lib/validate.ts';
import { listArtifacts } from '../repo/catalog.ts';
import { loadDataset } from '../repo/dataset.ts';
import { saveNote } from '../repo/notes.ts';
import {
  countScorecards,
  createRound,
  findOpenRound,
  findRound,
  listRoundsWithCounts,
  publishRound,
  reopenRound,
} from '../repo/rounds.ts';
import { replaceScorecard } from '../repo/scores.ts';
import { markChanged } from '../repo/site.ts';
import { findUserById } from '../repo/users.ts';

const NOTE_MAX = 2000;

async function requireRound(id: string | undefined): Promise<Round> {
  const round = id ? await findRound(db, id) : undefined;
  if (!round) throw new HttpError(404, `Round ${id ?? ''} does not exist.`);
  return round;
}

async function reviewFor(roundId: string, config: Config): Promise<RoundReview> {
  const review = buildReview(await loadDataset(db), roundId, today(), Boolean(config.anthropic.apiKey));
  if (!review) throw new HttpError(404, `Round ${roundId} does not exist.`);
  return review;
}

async function knownArtifactIds(): Promise<Set<string>> {
  return new Set((await listArtifacts(db)).map((artifact) => artifact.id));
}

route('adminRounds', 'GET', 'admin/rounds', 'admin', async () => listRoundsWithCounts(db));

route('adminRoundCreate', 'POST', 'admin/rounds', 'admin', async (ctx) => {
  const id = text(ctx.body, 'id', 'Round id', 8);
  if (!ROUND_ID.test(id)) throw new HttpError(400, 'Round ids look like 2027-Q1.');
  const label = text(ctx.body, 'label', 'Label', 40);
  const open = await findOpenRound(db);
  if (open) throw new HttpError(409, `Publish ${open.label} before starting a new round.`);
  if (await findRound(db, id)) throw new HttpError(409, `Round ${id} already exists.`);
  await createRound(db, id, label);
  return listRoundsWithCounts(db);
});

route('adminRoundUpdate', 'PUT', 'admin/rounds/{id}', 'admin', async (ctx): Promise<PublishResult> => {
  const round = await requireRound(ctx.params.id);
  const status = oneOf(ctx.body, 'status', 'Status', ['open', 'published'] as const);
  let deploy: DeployResult | null = null;
  if (status === 'published') {
    if (round.status === 'published') throw new HttpError(409, `${round.label} is already published.`);
    const publishedOn = text(ctx.body, 'publishedOn', 'Publish date', 10);
    if (!ISO_DATE.test(publishedOn) || Number.isNaN(Date.parse(publishedOn))) {
      throw new HttpError(400, 'Publish dates look like 2026-10-15.');
    }
    if ((await countScorecards(db, round.id)) === 0) throw new HttpError(400, `Nobody has scored ${round.label} yet.`);
    await publishRound(db, round.id, publishedOn);
    await markChanged(db);
    deploy = await startDeploy(ctx.config);
  } else {
    if (round.status === 'open') throw new HttpError(409, `${round.label} is already open.`);
    const open = await findOpenRound(db);
    if (open) throw new HttpError(409, `Publish ${open.label} before reopening another round.`);
    await reopenRound(db, round.id);
    await markChanged(db);
  }
  return { rounds: await listRoundsWithCounts(db), deploy };
});

route('adminReview', 'GET', 'admin/rounds/{id}/review', 'admin', async (ctx) =>
  reviewFor((await requireRound(ctx.params.id)).id, ctx.config),
);

route('adminScoresPut', 'PUT', 'admin/rounds/{id}/scores/{userId}', 'admin', async (ctx) => {
  const round = await requireRound(ctx.params.id);
  const userId = Number(ctx.params.userId);
  const owner = Number.isInteger(userId) ? await findUserById(db, userId) : undefined;
  if (!owner) throw new HttpError(404, 'That user does not exist.');
  const problem = cardWriteProblem(ctx.user, round, owner.id);
  if (problem) throw new HttpError(403, problem);
  const { scores, errors } = validateScores(ctx.body.scores, await knownArtifactIds());
  if (errors.length > 0) throw new HttpError(400, errors.join(' '));
  await transaction((tx) => replaceScorecard(tx, round.id, owner.id, scores));
  if (round.status === 'published') await markChanged(db);
  return reviewFor(round.id, ctx.config);
});

route('adminNotePut', 'PUT', 'admin/rounds/{id}/notes/{artifactId}', 'admin', async (ctx) => {
  const round = await requireRound(ctx.params.id);
  const artifactId = ctx.params.artifactId ?? '';
  if (!(await knownArtifactIds()).has(artifactId)) throw new HttpError(404, 'That item does not exist.');
  const body = typeof ctx.body.body === 'string' ? ctx.body.body.trim() : '';
  if (body.length > NOTE_MAX) throw new HttpError(400, 'Keep the write-up under 2,000 characters.');
  await saveNote(db, round.id, artifactId, body, ctx.user.id);
  if (round.status === 'published') await markChanged(db);
  return undefined;
});

route('adminDraft', 'POST', 'admin/rounds/{id}/draft/{artifactId}', 'admin', async (ctx) => {
  const drafter = createDrafter(ctx.config.anthropic);
  if (!drafter) throw new HttpError(400, 'Set ANTHROPIC_API_KEY in the Function App settings to draft with AI.');
  const data = await loadDataset(db);
  const target = data.rounds.find((item) => item.round.id === ctx.params.id);
  if (!target) throw new HttpError(404, `Round ${ctx.params.id ?? ''} does not exist.`);
  const artifact = data.artifacts.find((item) => item.id === ctx.params.artifactId);
  if (!artifact) throw new HttpError(404, 'That item does not exist.');
  const point = pointFor(artifact, target, target.round.publishedOn ?? today());
  if (!point) throw new HttpError(400, `${artifact.name} has no scores in ${target.round.label} yet.`);
  const previous = previousPoint(artifact, data.rounds, target.round.id);
  try {
    const draft = await drafter({
      artifact,
      workload: data.workloads.find((workload) => workload.id === artifact.workload),
      roundLabel: target.round.label,
      scores: point.scores,
      raters: point.raters,
      ...(previous ? { previous: { roundLabel: previous.roundLabel, scores: previous.scores, note: previous.note } } : {}),
    });
    return { text: draft };
  } catch (error) {
    throw new HttpError(502, error instanceof Error ? error.message : String(error));
  }
});
```

Add to `api/src/index.ts`:

```ts
import './functions/admin-rounds.ts';
```

- [ ] **Step 4: Check it.** With the admin session from Task 11 Step 8 (log in again if you logged out):

```powershell
Invoke-RestMethod http://localhost:7071/api/admin/rounds -WebSession $web
Invoke-RestMethod http://localhost:7071/api/admin/rounds/2026-Q4/review -WebSession $web
$publish = @{ status = 'published'; publishedOn = '2026-10-15' } | ConvertTo-Json
Invoke-RestMethod -Method Put http://localhost:7071/api/admin/rounds/2026-Q4 -WebSession $web -Headers $headers -ContentType 'application/json' -Body $publish
```

Expected:
- The rounds call returns `2026-Q4` with `scorecards: 0`.
- The review returns `items` empty and `aiEnabled: False`.
- The publish fails with HTTP 400 `Nobody has scored Q4 2026 yet.` (Do not publish `fcr-dev`'s round for real yet; Plan 2 exercises publishing through the UI.)

- [ ] **Step 5: Commit.**

```powershell
npm run typecheck; npm test
git add api/src/lib/draft-why.ts api/src/lib/draft-why.test.ts api/src/functions/admin-rounds.ts api/src/index.ts
git commit -m "API: admin rounds, review, score and note editing, AI drafting"
```

---

### Task 16: Admin catalog, users, and site status

**Files:**
- Create: `api/src/functions/admin-catalog.ts`, `api/src/functions/admin-users.ts`, `api/src/functions/admin-site.ts`
- Modify: `api/src/index.ts`

- [ ] **Step 1: Create `api/src/functions/admin-catalog.ts`.** Every write and its `markChanged(tx)` share one transaction, with the stamp last. As built (`1ed2260`, `571fd3a`), `saveCatalog` also takes any number of `{ numbers, error }` refusals after the write, so a SQL error number the route's earlier check lost a race on becomes that route's error instead of a 500. The number lists and `hasSqlNumber` come from `db.ts` (`28ebd57`):
  - a create that loses a race on its id (2601/2627) answers the "already exists" 409;
  - a delete that loses a race with a new score or note (547) answers the "has scores or notes" 409;
  - a delete chosen as a deadlock victim (1205) answers 503 "Someone was saving a score or note for <name> at the same moment. Try again.". A refusal's optional `onRefuse` writes the same "Deadlock victim" log line `describe()` writes elsewhere (`a2a211c`). With the `artifact_id` indexes, a delete can only deadlock with a card or note save that adds this item, and a retry gets the accurate 409.

Creates refuse ids that name a built-in object property (`constructor`, `__proto__`, `toString`, …) or `prototype` with 400, before the format check (`3777692`): ids are keys of plain objects in the API and the editors. The check is `isReservedId` in `validate.ts` (Task 7), which the seed shares (`fa28250`). A delete's foreign-key checks seek `ix_scores_artifact` and `ix_notes_artifact` (Task 8) instead of scanning, and waiting on, every card being saved.

```ts
import type { AdminCatalog } from '../../../src/domain/api-types.ts';
import { db, transaction, type Db } from '../lib/db.ts';
import { HttpError } from '../lib/errors.ts';
import { route } from '../lib/http.ts';
import { SLUG, isReservedId, oneOf, optionalInt, text } from '../lib/validate.ts';
import {
  adminCatalog,
  createArtifact,
  createWorkload,
  deleteArtifact,
  updateArtifact,
  updateWorkload,
} from '../repo/catalog.ts';
import { markChanged } from '../repo/site.ts';

const RELEASE_STATUSES = ['ga', 'preview', 'retired'] as const;

function slug(body: Record<string, unknown>, label: string): string {
  const id = text(body, 'id', label, 64);
  if (isReservedId(id)) throw new HttpError(400, `${label} ${id} is reserved. Pick another id.`);
  if (!SLUG.test(id)) throw new HttpError(400, `${label} must be lowercase words joined by dashes, like copy-job.`);
  return id;
}

function workloadFields(body: Record<string, unknown>) {
  return {
    name: text(body, 'name', 'Name', 100),
    shortName: text(body, 'shortName', 'Short name', 30),
    blurb: text(body, 'blurb', 'Description', 300),
  };
}

function artifactFields(body: Record<string, unknown>, catalog: AdminCatalog) {
  const workload = text(body, 'workload', 'Workload', 64);
  if (!catalog.workloads.some((item) => item.id === workload)) {
    throw new HttpError(400, `Workload ${workload} does not exist.`);
  }
  return {
    name: text(body, 'name', 'Name', 100),
    workload,
    status: oneOf(body, 'status', 'Status', RELEASE_STATUSES),
  };
}

/**
 * Runs a catalog write and its site-changed mark in one transaction, so a committed change always shows the site as
 * behind. These transactions lock no round, so taking site_state last keeps admin-rounds.ts's lock order.
 */
async function saveCatalog(write: (tx: Db) => Promise<void>): Promise<AdminCatalog> {
  await transaction(async (tx) => {
    await write(tx);
    await markChanged(tx);
  });
  return adminCatalog(db);
}

route('adminCatalog', 'GET', 'admin/catalog', 'admin', async () => adminCatalog(db));

route('adminWorkloadCreate', 'POST', 'admin/workloads', 'admin', async (ctx) => {
  const id = slug(ctx.body, 'Workload id');
  const fields = workloadFields(ctx.body);
  if ((await adminCatalog(db)).workloads.some((item) => item.id === id)) {
    throw new HttpError(409, `A workload with id ${id} already exists.`);
  }
  return saveCatalog((tx) => createWorkload(tx, { id, ...fields }));
});

route('adminWorkloadUpdate', 'PUT', 'admin/workloads/{id}', 'admin', async (ctx) => {
  const current = (await adminCatalog(db)).workloads.find((item) => item.id === ctx.params.id);
  if (!current) throw new HttpError(404, 'That workload does not exist.');
  const sortOrder = optionalInt(ctx.body, 'sortOrder', 'Order') ?? current.sortOrder;
  const fields = workloadFields(ctx.body);
  return saveCatalog((tx) => updateWorkload(tx, current.id, { ...fields, sortOrder }));
});

route('adminArtifactCreate', 'POST', 'admin/artifacts', 'admin', async (ctx) => {
  const catalog = await adminCatalog(db);
  const id = slug(ctx.body, 'Item id');
  if (catalog.artifacts.some((item) => item.id === id)) throw new HttpError(409, `An item with id ${id} already exists.`);
  const fields = artifactFields(ctx.body, catalog);
  return saveCatalog((tx) => createArtifact(tx, { id, ...fields }));
});

route('adminArtifactUpdate', 'PUT', 'admin/artifacts/{id}', 'admin', async (ctx) => {
  const catalog = await adminCatalog(db);
  const current = catalog.artifacts.find((item) => item.id === ctx.params.id);
  if (!current) throw new HttpError(404, 'That item does not exist.');
  const sortOrder = optionalInt(ctx.body, 'sortOrder', 'Order') ?? current.sortOrder;
  const fields = artifactFields(ctx.body, catalog);
  return saveCatalog((tx) => updateArtifact(tx, current.id, { ...fields, sortOrder }));
});

route('adminArtifactDelete', 'DELETE', 'admin/artifacts/{id}', 'admin', async (ctx) => {
  const current = (await adminCatalog(db)).artifacts.find((item) => item.id === ctx.params.id);
  if (!current) throw new HttpError(404, 'That item does not exist.');
  if (current.referenced) {
    throw new HttpError(409, `${current.name} has scores or notes. Mark it retired instead of deleting it.`);
  }
  return saveCatalog((tx) => deleteArtifact(tx, current.id));
});
```

- [ ] **Step 2: Create `api/src/functions/admin-users.ts`.** `adminUserUpdate` takes ids only as 1 to 9 digits (`USER_ID`, so `1e1` or `0x7` is a 404) and hashes a new password first. Then it runs one transaction: the locked admin count, the caller re-read on `tx` (403 if they stopped being an active admin while the request waited), the target re-read, the last-admin check, the update, and the session delete. As built (`1ed2260`), `adminUserCreate` also turns a duplicate-login race (2601/2627) into the same 409.

```ts
import { sessionToken } from '../lib/current-user.ts';
import { db, transaction } from '../lib/db.ts';
import { HttpError } from '../lib/errors.ts';
import { route } from '../lib/http.ts';
import { hashPassword, passwordProblem } from '../lib/password.ts';
import { userChangeProblem } from '../lib/permissions.ts';
import { hashToken } from '../lib/session.ts';
import {
  LOGIN,
  USER_ID,
  oneOf,
  optionalBool,
  optionalOneOf,
  optionalText,
  rawString,
  text,
} from '../lib/validate.ts';
import { deleteUserSessions } from '../repo/sessions.ts';
import {
  countActiveAdminsLocked,
  createUser,
  findUserById,
  findUserByLogin,
  listUsers,
  updateUser,
} from '../repo/users.ts';

const ROLES = ['admin', 'rater'] as const;

const noSuchUser = () => new HttpError(404, 'That user does not exist.');

route('adminUsers', 'GET', 'admin/users', 'admin', async () => listUsers(db));

route('adminUserCreate', 'POST', 'admin/users', 'admin', async (ctx) => {
  const login = text(ctx.body, 'login', 'Login', 40).toLowerCase();
  if (!LOGIN.test(login)) {
    throw new HttpError(400, 'Logins use 2 to 40 lowercase letters, digits, dots, dashes, or underscores.');
  }
  const displayName = text(ctx.body, 'displayName', 'Name', 80);
  const role = oneOf(ctx.body, 'role', 'Role', ROLES);
  const password = rawString(ctx.body, 'password');
  const problem = passwordProblem(password);
  if (problem) throw new HttpError(400, problem);
  if (await findUserByLogin(db, login)) throw new HttpError(409, `The login ${login} is taken.`);
  await createUser(db, { login, displayName, role, passwordHash: await hashPassword(password) });
  return listUsers(db);
});

route('adminUserUpdate', 'PUT', 'admin/users/{id}', 'admin', async (ctx) => {
  const id = USER_ID.test(ctx.params.id ?? '') ? Number(ctx.params.id) : NaN;
  if (Number.isNaN(id) || !(await findUserById(db, id))) throw noSuchUser();
  const displayName = optionalText(ctx.body, 'displayName', 'Name', 80);
  const role = optionalOneOf(ctx.body, 'role', 'Role', ROLES);
  const active = optionalBool(ctx.body, 'active', 'Active');
  const password = ctx.body.password === undefined ? undefined : rawString(ctx.body, 'password');
  const weak = password === undefined ? undefined : passwordProblem(password);
  if (weak) throw new HttpError(400, weak);
  // Before the transaction, so slow scrypt work never holds the admin-count lock.
  const passwordHash = password === undefined ? undefined : await hashPassword(password);
  const own = id === ctx.user.id ? sessionToken(ctx.request.headers.get('cookie'), ctx.config) : undefined;
  await transaction(async (tx) => {
    const admins = await countActiveAdminsLocked(tx);
    // The session was checked before the lock, and a change that committed while this request waited can demote it.
    const actor = await findUserById(tx, ctx.user.id);
    if (!actor?.active || actor.role !== 'admin') throw new HttpError(403, 'Only admins can do that.');
    const target = await findUserById(tx, id);
    if (!target) throw noSuchUser();
    const problem = userChangeProblem(ctx.user, target, { role, active }, admins);
    if (problem) throw new HttpError(409, problem);
    await updateUser(tx, target.id, { displayName, role, active, passwordHash });
    if (active === false || passwordHash !== undefined) {
      await deleteUserSessions(tx, target.id, own ? hashToken(own) : '');
    }
  });
  return listUsers(db);
});
```

- [ ] **Step 3: Create `api/src/functions/admin-site.ts`.**

```ts
import type { SiteStatus } from '../../../src/domain/api-types.ts';
import { db } from '../lib/db.ts';
import { HttpError } from '../lib/errors.ts';
import { deployConfigured, startDeploy } from '../lib/github.ts';
import { route } from '../lib/http.ts';
import { isBehind, siteState } from '../repo/site.ts';

route('adminSite', 'GET', 'admin/site', 'admin', async (ctx): Promise<SiteStatus> => {
  const state = await siteState(db);
  return {
    lastSnapshotAt: state.lastSnapshotAt?.toISOString() ?? null,
    behind: isBehind(state),
    deployConfigured: deployConfigured(ctx.config),
  };
});

route('adminSiteUpdate', 'POST', 'admin/site/update', 'admin', async (ctx) => {
  const result = await startDeploy(ctx.config);
  if (!result.started) throw new HttpError(502, result.message);
  return result;
});
```

- [ ] **Step 4: Register them.** `api/src/index.ts` is now:

```ts
import './functions/health.ts';
import './functions/auth.ts';
import './functions/build.ts';
import './functions/rater.ts';
import './functions/admin-rounds.ts';
import './functions/admin-catalog.ts';
import './functions/admin-users.ts';
import './functions/admin-site.ts';
```

- [ ] **Step 5: Check it.** With the admin session:

```powershell
(Invoke-RestMethod http://localhost:7071/api/admin/catalog -WebSession $web).artifacts.Count
Invoke-RestMethod http://localhost:7071/api/admin/users -WebSession $web
Invoke-RestMethod http://localhost:7071/api/admin/site -WebSession $web
```

Expected:
- The catalog call prints the item count from Task 10.
- The users call lists your admin account with `active: True`.
- The site call shows `lastSnapshotAt` set (Task 12 took a snapshot), `behind: False`, and `deployConfigured: False`.

- [ ] **Step 6: Commit.**

```powershell
npm run typecheck; npm test
git add api/src/functions api/src/index.ts
git commit -m "API: admin catalog, user management, and public-site status"
```

---

### Task 17: Dev proxy and the integration test

**Files:**
- Create: `api/src/integration.test.ts`, `api/src/functions/auth.test.ts` (the login-order unit tests from the Task 17 brief)
- Modify: `vite.config.ts`

- [ ] **Step 1: Proxy `/api` from Vite to the Functions host.** In `vite.config.ts`, add a `server` block above `build`:

```ts
  server: {
    // /api/desk stays with the local desk plugin until Plan 2 removes it. FCR_API_TARGET points the rest at a
    // Functions host on another port.
    proxy: { '^/api/(?!desk)': process.env.FCR_API_TARGET ?? 'http://localhost:7071' },
  },
```

- [ ] **Step 2: Write the integration test.** It runs only when `FCR_API_URL` is set and cleans up after itself. As built (`5f8be72`, then `78dc8cb`, `e68ee68`, `90f3cb0`, `8f5e592`, `230bccd`, `b018b77`, `7723a47`), the file differs from the block below, and `api/src/integration.test.ts` wins:
  - **13 tests.** On top of the 8 below:
    - deploy confirmations need the build token and no particular `Origin` (sent with a `generatedAt` the API refuses, so `fcr-dev` isn't stamped);
    - a second user with a taken login gets 409;
    - the admin removing their own admin access gets 409. This test counts the active admins first and skips itself unless there is exactly one, so the last-admin rule backs up the self rule and a broken self rule can't demote anyone;
    - an admin password reset ends the rater's sessions and swaps the password;
    - the rater's own password change (`PUT /api/me/password`) answers 204, keeps the session that made it, ends the rater's second session, and the new password logs in.

    The disable test also checks that the disabled rater's login, with the password from the own-change test, gets 401.
  - **Fails fast.** It throws, naming the variables, when `FCR_ADMIN_LOGIN`, `FCR_ADMIN_PASSWORD`, or `FCR_SNAPSHOT_TOKEN` is missing.
    - It refuses to run unless `SQL_DATABASE` is `fcr-dev` or `fcr-dev-<suffix>` (`/^fcr-dev(-|$)/`, so `fcr-devprod` is refused), through `useDevTarget()` in `api/src/test-target.ts`, the same guard every row-writing test uses.
    - Right after the admin login in `beforeAll`, before any test writes, it looks up the session the host just wrote by its hash. That proves the host and the suite share a database.
    - The check after creating the rater stays.
  - **Its own addresses.** Every request sends `X-Forwarded-For` with a per-run TEST-NET-3 address (`203.0.113.x`), so its lockout traffic never shares the `ip:unknown` row with other local hosts. The lock test uses a new address per try, so only the login's own key reaches the limit.
  - **Cleanup.** `clearTestRows` also deletes the suite's notes and its `ip:203.0.113.%` attempts.
    - It first counts `itest-` scores in published rounds. If there are any, it throws "An itest- card is in a published round. Remove it by hand, then stamp site_state." Deleting them would change a published round without stamping `site_state`.
    - `afterAll` skips all cleanup when the `fcr-dev` guard never passed, so a wrong database is never cleaned.
  - **`afterAll` checks, in one assertion** so a failed logout can't hide a failed cleanup:
    - the admin's logout answers 204;
    - no `itest-` users, no `login:itest-%` or `ip:203.0.113.%` attempts, and no session for the admin's token remain;
    - the whole `site_state` row (`changed_at` and `last_snapshot_at`) is unchanged.
  - **`api/src/functions/auth.test.ts`** pins the login order (look, reserve, verify, clear) with mocked repos. Since `dbcbb18` it covers logout's cookie handling too.

`api/src/integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { useTarget } from '../../db/target.ts';
import { closeDb, db } from './lib/db.ts';

const BASE = process.env.FCR_API_URL ?? '';
const ORIGIN = process.env.FCR_ORIGIN ?? 'http://localhost:5173';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

interface Reply {
  status: number;
  // Response shapes vary per endpoint; assertions check the fields they need.
  body: any;
}

class Client {
  cookie = '';

  async send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers,
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';')[0] ?? '';
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const raw = await response.text();
    return { status: response.status, body: raw ? JSON.parse(raw) : undefined };
  }
}

async function clearTestRows(): Promise<void> {
  const pattern = 'itest-%';
  const testUsers = 'SELECT id FROM users WHERE login LIKE @pattern';
  await db.query(`DELETE FROM scores WHERE user_id IN (${testUsers})`, { pattern });
  await db.query(`DELETE FROM sessions WHERE user_id IN (${testUsers})`, { pattern });
  await db.query('DELETE FROM users WHERE login LIKE @pattern', { pattern });
  await db.query(`DELETE FROM login_attempts WHERE attempt_key LIKE 'login:itest-%' OR attempt_key = 'ip:unknown'`);
}

describe.skipIf(!BASE)('API against the dev database', () => {
  const stamp = Date.now().toString(36);
  const admin = new Client();
  const rater = new Client();
  const raterLogin = `itest-${stamp}`;
  const raterPassword = `pass-${stamp}-long`;
  let raterId = 0;
  let roundId = '';
  let artifactId = '';

  beforeAll(async () => {
    useTarget([]);
    await clearTestRows();
    const reply = await admin.send('POST', '/api/auth/login', {
      login: process.env.FCR_ADMIN_LOGIN,
      password: process.env.FCR_ADMIN_PASSWORD,
    });
    expect(reply.status).toBe(200);
    expect(reply.body.role).toBe('admin');
  });

  afterAll(async () => {
    await clearTestRows();
    await closeDb();
  });

  it('refuses writes from pages that are not allowed', async () => {
    const reply = await new Client().send(
      'POST',
      '/api/auth/login',
      { login: 'x', password: 'y' },
      { Origin: 'https://evil.example' },
    );
    expect(reply.status).toBe(403);
  });

  it('lets an admin create a rater who can log in', async () => {
    const created = await admin.send('POST', '/api/admin/users', {
      login: raterLogin,
      displayName: 'Integration Rater',
      role: 'rater',
      password: raterPassword,
    });
    expect(created.status).toBe(200);
    raterId = created.body.find((user: { login: string }) => user.login === raterLogin).id;
    expect((await rater.send('POST', '/api/auth/login', { login: raterLogin, password: raterPassword })).status).toBe(200);
    expect((await rater.send('GET', '/api/me')).body).toMatchObject({ login: raterLogin, role: 'rater' });
  });

  it('keeps raters out of admin routes', async () => {
    expect((await rater.send('GET', '/api/admin/users')).status).toBe(403);
  });

  it('saves a rater card in the open round only', async () => {
    const open = await rater.send('GET', '/api/rounds/open');
    expect(open.body.round, 'fcr-dev needs an open round (the seed creates 2026-Q4)').toBeTruthy();
    roundId = open.body.round.id;
    artifactId = (await rater.send('GET', '/api/catalog')).body.artifacts[0].id;
    const saved = await rater.send('PUT', '/api/rounds/open/my-scores', {
      round: roundId,
      scores: { [artifactId]: [5, 6, 7] },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.scores).toEqual({ [artifactId]: [5, 6, 7] });
    const stale = await rater.send('PUT', '/api/rounds/open/my-scores', { round: '1999-Q1', scores: {} });
    expect(stale.status).toBe(409);
  });

  it('shows the card in the admin review', async () => {
    const review = await admin.send('GET', `/api/admin/rounds/${roundId}/review`);
    const item = review.body.items.find((entry: { artifact: { id: string } }) => entry.artifact.id === artifactId);
    expect(item.breakdown).toContainEqual({ userId: raterId, name: 'Integration Rater', scores: [5, 6, 7] });
  });

  it('serves the snapshot only with the build token', async () => {
    expect((await new Client().send('GET', '/api/build/snapshot')).status).toBe(401);
    const reply = await new Client().send('GET', '/api/build/snapshot', undefined, {
      Authorization: `Bearer ${process.env.FCR_SNAPSHOT_TOKEN ?? ''}`,
    });
    expect(reply.status).toBe(200);
    expect(JSON.stringify(reply.body)).not.toContain('Integration Rater');
  });

  it('ends sessions when an admin disables the user', async () => {
    expect((await admin.send('PUT', `/api/admin/users/${raterId}`, { active: false })).status).toBe(200);
    expect((await rater.send('GET', '/api/me')).status).toBe(401);
  });

  it('locks a login after 10 failures', async () => {
    const stranger = new Client();
    const login = `itest-lock-${stamp}`;
    for (let i = 0; i < 10; i += 1) {
      expect((await stranger.send('POST', '/api/auth/login', { login, password: 'wrong-password' })).status).toBe(401);
    }
    expect((await stranger.send('POST', '/api/auth/login', { login, password: 'wrong-password' })).status).toBe(429);
  });
});
```

- [ ] **Step 3: Confirm the default run skips it.**

Run: `npm test`
Expected: all unit tests pass; the 13 integration tests show as skipped. The run shows 18 skipped in all, because the 5 opt-in database tests (`FCR_DB_TESTS`) skip too: 2 in `attempts.test.ts`, and 1 each in `rounds.test.ts`, `users.test.ts`, and `site.test.ts`. When they run, each refuses a database not named `fcr-dev` or `fcr-dev-<suffix>` (`useDevTarget()`), and cleans up only after that check passed. Inside its transaction, the `site.test.ts` row-lock test first reads the row with a plain query, which doesn't wait. That shows the `READCOMMITTEDLOCK` hint is what blocks, and leaves a pooled connection for the locking read (`bb751b1`). The `rounds.test.ts` one publishes a throwaway round dated `2000-01-01`, so it's never the latest published round that publish and reopen check against. Its `afterAll` deletes the round's scores, the test user, and the round, each step even if the one before failed.

- [ ] **Step 4: Run it against `fcr-dev`.** Close every local site and host using `fcr-dev`, in this checkout and in worktrees, and run one copy of the suite at a time. Leave `FCR_DB_TESTS` unset, and never run the suite in the same run as the opt-in database tests: their `itest-` rows collide with the suite's cleanup. For the few minutes of the run, nobody may publish, reopen, edit the catalog or a published card or note, change users, seed, or confirm a deploy on `fcr-dev`. Anything that stamps `site_state` fails `afterAll`.

Paste the block whole, from the repo root, in Windows PowerShell 5.1 or 7. The `& { … }` wrapper makes any `throw` stop the rest; pasted line by line, PowerShell would carry on after a failed check.
- The block builds the API and starts its own host on `$port`, before any `FCR_` variable exists, so the host never inherits the admin password. Pick a port no other checkout uses.
- It waits for `/api/health`, which also wakes `fcr-dev`.
- It runs the suite, and in `finally` removes the variables and stops the host with `taskkill /T`, which also ends the Node worker `func.exe` started.
- It prints nothing secret.

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $port = 7071
  $base = "http://localhost:$port"
  $set = Get-ChildItem env: | Where-Object Name -match '^(FCR_|SQL_)|^(ALLOWED_ORIGINS|SNAPSHOT_TOKEN|COOKIE_SECURE)$' |
    ForEach-Object Name
  if ($set) { throw "Remove these from this shell first: $($set -join ', ')" }
  $values = (Get-Content api\local.settings.json -Raw | ConvertFrom-Json).Values
  if ("$($values.SQL_DATABASE)" -cnotmatch '^fcr-dev(-|$)') { throw 'api/local.settings.json does not name fcr-dev.' }
  if (@("$($values.ALLOWED_ORIGINS)".Split(',') | ForEach-Object Trim) -notcontains 'http://localhost:5173') {
    throw 'ALLOWED_ORIGINS in api/local.settings.json lacks http://localhost:5173.'
  }
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
    throw "Port $port is taken. Pick another free port."
  }
  npm --prefix api run build
  if ($LASTEXITCODE -ne 0) { throw 'The API build failed.' }
  $log = Join-Path $env:TEMP "fcr-itest-host-$port.log"
  # Started before any FCR_ variable exists, so the host never inherits the admin password.
  $hostProc = Start-Process -FilePath (Resolve-Path api\node_modules\azure-functions-core-tools\bin\func.exe).Path `
    -ArgumentList 'start', '--port', "$port" -WorkingDirectory (Resolve-Path api).Path `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err" -NoNewWindow -PassThru
  $suiteExit = $null
  try {
    # /api/health runs SELECT 1, so this also wakes fcr-dev before the suite's first request.
    $deadline = (Get-Date).AddMinutes(6)
    $ready = $false
    while (-not $ready -and (Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 5
      if ($hostProc.HasExited) { throw "func exited early. See $log and $log.err." }
      try { $ready = (Invoke-WebRequest "$base/api/health" -UseBasicParsing -TimeoutSec 240).StatusCode -eq 200 }
      catch { $ready = $false }
    }
    if (-not $ready) { throw "The host never answered /api/health with 200. See $log." }
    $env:FCR_API_URL = $base
    $env:FCR_ADMIN_LOGIN = 'pugliabi'
    $env:FCR_SNAPSHOT_TOKEN = $values.SNAPSHOT_TOKEN
    $env:FCR_ADMIN_PASSWORD = [Net.NetworkCredential]::new('', (Read-Host 'Admin password' -AsSecureString)).Password
    npx vitest run --reporter=verbose api/src/integration.test.ts
    $suiteExit = $LASTEXITCODE
  } finally {
    # Continue: in Windows PowerShell 5.1, Stop turns any stderr line from a native command into a throw.
    $ErrorActionPreference = 'Continue'
    Remove-Item Env:FCR_API_URL, Env:FCR_ADMIN_LOGIN, Env:FCR_ADMIN_PASSWORD, Env:FCR_SNAPSHOT_TOKEN `
      -ErrorAction SilentlyContinue
    if (-not $hostProc.HasExited) { taskkill /PID $hostProc.Id /T /F | Out-Null }
    "Host stopped. Suite exit code: $suiteExit. Host log: $log"
  }
}
```

If the window closes mid-run, stop the host with `Get-NetTCPConnection -State Listen -LocalPort 7071 | ForEach-Object { taskkill /PID $_.OwningProcess /T /F }`, using your port. A wrong admin password gives a 401 on the admin login. Stop there and don't retry: each failure counts toward the shared `login:pugliabi` lockout, and the suite can't clean it.

Expected: `Tests  13 passed (13)` when `fcr-dev` has exactly one active admin, then `Host stopped. Suite exit code: 0.` With two or more, the self-demotion check skips itself, giving `12 passed | 1 skipped (13)`. "13 skipped" means `FCR_API_URL` wasn't set. `afterAll` logs the admin out and deletes the suite's rows. In one assertion, it then checks that the logout answered 204, that no `itest-` users, suite attempts, or admin session remain, and that `site_state` is unchanged, so a green run is the cleanup check. An `afterAll` failure can sit under an all-green test count ("Test Files 1 failed", exit code 1), so read both. If `afterAll` fails on `site_state` and nobody else wrote public data during the run, an open-round write stamped the site: treat it as an API bug.

- [ ] **Step 5: Commit.**

```powershell
npm run typecheck
git add vite.config.ts api/src/integration.test.ts api/src/functions/auth.test.ts
git commit -m "Dev proxy to the Functions host; API integration test against fcr-dev"
```

---

## Done When

- `npm run typecheck` and `npm test` pass. The integration suite passes against `fcr-dev` when `FCR_API_URL` is set.
- `fcr-dev` holds the seeded catalog, round `2026-Q4` (open), and your admin account.
- `npm run api` serves every endpoint in the spec's API table on `http://localhost:7071/api`, and `npm run dev` proxies `/api` to it.
- The public site, rate page, and desk still build and behave exactly as before. Plan 2 switches them over.
