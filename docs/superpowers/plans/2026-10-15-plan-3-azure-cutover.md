# Plan 3: Azure Setup and Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Steps marked **(manual)** happen in a portal and need the user.

**Goal:** Run the API in Azure against the production `fcr` database at `https://api.fabriccreditratings.com`, then merge `login-backend` to `main` so fabriccreditratings.com uses it. Before that, move the grade math into the API and delete the repo's catalog and round files.

**Architecture:** One Flex Consumption Function App (Node 24) whose system-assigned managed identity reads and writes the Fabric SQL database. No database secret exists. GitHub Actions deploys the API through OIDC with a separate user-assigned identity. The site deploy keeps using GitHub Pages, and refreshes `src/data/snapshot.json` from the API before each build.

**Tech Stack:** Azure CLI, GitHub CLI, Fabric portal, Bluehost DNS, `azure/login@v3`, `Azure/functions-action@v1`.

**Spec:** `docs/superpowers/specs/2026-10-15-login-fabric-backend-design.md`

**Series:** Plan 3 of 3. Plans 1 and 2 are done: the API and front end work locally against `fcr-dev` on the `login-backend` branch.

**Branch:** `login-backend` until Task 10 merges it to `main`. Every push to `main` deploys the live site.

## Global Constraints

- Never print, log, or commit secrets: the admin password, `SNAPSHOT_TOKEN`, the GitHub token, the Anthropic key. Read them with `Read-Host -MaskInput`. Pass them straight to `az` or `gh`. Run every `az ... appsettings set` with `-o none`, because its default output lists all setting values. Remove the variables afterward.
- `infra/names.ps1` holds names and ids only, and is gitignored. Every task that uses Azure starts with `. ./infra/names.ps1` in the repo root.
- Messages returned to users are full sentences that say what to do next.
- Formatting matches the repo: 2 spaces, single quotes, semicolons, trailing commas, lines up to 120 characters.
- Before every commit: `npm run typecheck` and `npm test` pass.

## File Structure

```
infra/names.ps1                     (gitignored) resource names and ids for the az and gh steps
.github/workflows/api-deploy.yml    builds, tests, and deploys api/ with OIDC
api/src/domain/formula.ts           moved from src/domain (score total -> grade)
api/src/domain/formula.test.ts      moved
api/src/domain/aggregate.ts         moved from src/domain; findUnrated removed
api/src/domain/aggregate.test.ts    moved
api/src/boundary.test.ts            fails if the site imports API code or regains the formula
db/seed.ts                          reduced to creating the first admin
README.md                           rewritten for the new setup
```

Deleted: `src/data/rounds/`, `src/data/artifacts.ts`, `src/data/workloads.ts`.

---

### Task 0: Tools and names

**Files:**
- Create: `infra/names.ps1` (gitignored)
- Modify: `.gitignore`

- [ ] **Step 1: Check the tools.**

Run: `az version; gh auth status; node --version`
Expected: Azure CLI 2.60 or newer, `gh` logged in to github.com with `repo` and `workflow` scopes, and Node v24.

- [ ] **Step 2: Find the capacity's subscription and region.**

```powershell
az login
az resource list --resource-type Microsoft.Fabric/capacities --query "[].{name:name, group:resourceGroup, location:location, id:id}" -o table
az account show --query "{tenant:tenantId, subscription:id}" -o table
az functionapp list-flexconsumption-locations --query "[].name" -o tsv
```

Expected: your F SKU capacity, listed with its region. If the region appears in the Flex Consumption list, use it. If it doesn't, pick the nearest listed region. If the capacity is in a different subscription, run `az account set --subscription <id>` and repeat the first command.

- [ ] **Step 3: Create `infra/names.ps1`.** Fill in the placeholders. `fcr-api-` plus four random lowercase letters or digits must be globally unique, and so must the storage name (3–24 lowercase letters or digits). Leave `$sqlServer` and `$sqlDatabase` for Task 1.

```powershell
# Production names and ids for Plan 3. No secrets. Dot-source it: . ./infra/names.ps1
$tenant = '<tenant id>'
$subscription = '<subscription id of the Fabric capacity>'
$location = '<region from Step 2>'
$rg = 'rg-fabric-credit-ratings'
$app = 'fcr-api-<suffix>'
$storage = 'fcrapi<suffix>'
$deployer = 'fcr-api-deployer'
$group = 'fcr-fabric-api-identities'
$repo = 'pugliabi/fabric-credit-ratings'
$apiHost = 'api.fabriccreditratings.com'
$sqlServer = '<set in Task 1>'
$sqlDatabase = '<set in Task 1>'
```

Add to `.gitignore`:

```
infra/names.ps1
```

- [ ] **Step 4: Commit.**

Run: `git status --short`
Expected: `.gitignore` modified; `infra/` not listed.

```powershell
git add .gitignore
git commit -m "Ignore the local Azure names file"
```

---

### Task 1: Production database `fcr`

**Files:** none

- [ ] **Step 1 (manual): Create `fcr`.** In Fabric, open the workspace that holds `fcr-dev`. Select New item, then SQL database, and name it `fcr`. Open it, then Settings, then Connection strings. Copy the server (`<id>.database.fabric.microsoft.com`) and the database name (`Initial Catalog`, `fcr-<guid>`) into `$sqlServer` and `$sqlDatabase` in `infra/names.ps1`.

- [ ] **Step 2: Apply the schema.**

```powershell
. ./infra/names.ps1
npm run db:apply -- --server $sqlServer --database $sqlDatabase
```

Expected: `Database: fcr-<guid> on <id>.database.fabric.microsoft.com`, then `Applied 12 schema batches.`

- [ ] **Step 3: Full seed.** This loads the catalog and the Q4 2026 round from the repo files that Task 3 deletes, so it must run first. Use the admin password you want in production.

```powershell
$env:FCR_ADMIN_PASSWORD = Read-Host 'Production admin password (10+ characters)' -MaskInput
npm run db:seed -- --admin pugliabi --name "<your display name>" --server $sqlServer --database $sqlDatabase
Remove-Item Env:FCR_ADMIN_PASSWORD
```

Expected:

```
Database: fcr-<guid> on <id>.database.fabric.microsoft.com
Admin pugliabi: created
Catalog: 12 workloads, <n> items
Rounds: 1 rounds, 0 scorecards, 0 notes
```

`<n>` matches the item count in `fcr-dev`.

---

### Task 2: Move the grade math into the API

The public site stopped importing `formula.ts` and `aggregate.ts` in Plan 2. Moving them under `api/` means they can't ship in the site bundle, and a test guards that.

**Files:**
- Move: `src/domain/formula.ts`, `src/domain/formula.test.ts`, `src/domain/aggregate.ts`, `src/domain/aggregate.test.ts` → `api/src/domain/`
- Modify: every `api/` file importing them
- Create: `api/src/boundary.test.ts`

- [ ] **Step 1: Write the failing guard.** `api/src/boundary.test.ts`:

```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SITE = new URL('../../src/', import.meta.url);

function sourceFiles(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return sourceFiles(new URL(`${entry.name}/`, dir));
    return /\.tsx?$/.test(entry.name) ? [new URL(entry.name, dir)] : [];
  });
}

describe('site boundary', () => {
  it('keeps the grade math out of the site sources', () => {
    expect(existsSync(new URL('domain/formula.ts', SITE))).toBe(false);
    expect(existsSync(new URL('domain/aggregate.ts', SITE))).toBe(false);
  });

  it('never imports API code from the site', () => {
    const leaks = sourceFiles(SITE).filter((file) => /from '[^']*api\/src\//.test(readFileSync(file, 'utf8')));
    expect(leaks.map((file) => file.pathname)).toEqual([]);
  });
});
```

Run: `npx vitest run api/src/boundary.test.ts`
Expected: FAIL in "keeps the grade math out of the site sources".

- [ ] **Step 2: Move the files.**

```powershell
git mv src/domain/formula.ts api/src/domain/formula.ts
git mv src/domain/formula.test.ts api/src/domain/formula.test.ts
git mv src/domain/aggregate.ts api/src/domain/aggregate.ts
git mv src/domain/aggregate.test.ts api/src/domain/aggregate.test.ts
```

- [ ] **Step 3: Repoint imports.** The moved files import `./types.ts`, which stays in `src/domain`. API files imported the old location.

```powershell
foreach ($file in 'formula.ts', 'aggregate.ts', 'aggregate.test.ts') {
  $path = "api/src/domain/$file"
  $text = Get-Content $path -Raw
  Set-Content $path ($text -replace "'\./types\.ts'", "'../../../src/domain/types.ts'") -NoNewline
}
Get-ChildItem api/src -Recurse -Include *.ts | ForEach-Object {
  $prefix = switch ($_.Directory.Name) { 'domain' { './' } 'src' { './domain/' } default { '../domain/' } }
  $text = Get-Content $_.FullName -Raw
  $next = $text -replace "'\.\./\.\./\.\./src/domain/(aggregate|formula)\.ts'", "'$prefix`$1.ts'"
  if ($next -ne $text) { Set-Content $_.FullName $next -NoNewline }
}
```

Run: `rg -n "src/domain/(aggregate|formula)" api db src`
Expected: no output.

- [ ] **Step 4: Drop `findUnrated`.** Nothing lists unrated items any more. In `api/src/domain/aggregate.ts`, delete the `export function findUnrated(...)` function. In `api/src/domain/aggregate.test.ts`:
  - change the import to `import { asOfDate, buildRatings, previousPoint } from './aggregate.ts';`;
  - delete the test block:

```ts
  it('lists never-rated items as unrated', () => {
    expect(findUnrated(catalog, ratings).map((artifact) => artifact.id)).toEqual(['fresh']);
  });
```

- [ ] **Step 5: Verify.**

Run: `npm run typecheck; npm test`
Expected: no type errors. All tests pass, including both boundary tests. The integration tests are skipped.

Run: `npx vite build; rg -l '21:"AAA"' dist`
Expected: the build succeeds and `rg` prints nothing. The notch table no longer ships in any public file.

- [ ] **Step 6: Commit.**

```powershell
git add -A src/domain api/src
git commit -m "Move the grade formula and aggregation into the API; guard the site boundary"
```

---

### Task 3: Retire the repo catalog and round files

Production now holds the catalog and rounds (Task 1), and the admin edits them online. The seed only creates the first admin of an empty database.

**Files:**
- Delete: `src/data/rounds/`, `src/data/artifacts.ts`, `src/data/workloads.ts`
- Modify: `db/seed.ts` (rewrite)

- [ ] **Step 1: Delete the files.**

```powershell
git rm -r src/data/rounds src/data/artifacts.ts src/data/workloads.ts
```

Run: `rg -n "data/(artifacts|workloads|rounds)" src api db scripts`
Expected: only `db/seed.ts` lines, which Step 2 replaces.

- [ ] **Step 2: Rewrite `db/seed.ts`.**

```ts
import { closeDb, db } from '../api/src/lib/db.ts';
import { hashPassword, passwordProblem } from '../api/src/lib/password.ts';
import { LOGIN } from '../api/src/lib/validate.ts';
import { createUser, findUserByLogin } from '../api/src/repo/users.ts';
import { useTarget } from './target.ts';

const USAGE = 'Usage: npm run db:seed -- --admin <login> --name "<display name>" [--server <host>] [--database <name>]';

const args = useTarget(process.argv.slice(2));
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const adminLogin = flag('admin')?.toLowerCase() ?? '';
const adminName = flag('name') ?? '';
if (!adminLogin || !adminName) throw new Error(USAGE);
if (!LOGIN.test(adminLogin)) throw new Error('Logins use 2 to 40 lowercase letters, digits, dots, dashes, or underscores.');

/** The first admin of an empty database. The catalog and rounds are then managed in /admin. */
async function ensureAdmin(): Promise<string> {
  if (await findUserByLogin(db, adminLogin)) return 'already exists, password unchanged';
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

try {
  console.log(`Admin ${adminLogin}: ${await ensureAdmin()}`);
} finally {
  await closeDb();
}
```

- [ ] **Step 3: Verify.**

Run: `npm run typecheck; npm test; npm run build`
Expected: all pass.

Run: `npm run db:seed -- --admin pugliabi --name "<your display name>"`
Expected: `Admin pugliabi: already exists, password unchanged` against `fcr-dev`.

- [ ] **Step 4: Commit.**

```powershell
git add -A src/data db/seed.ts
git commit -m "Remove the repo catalog and round files; the seed only creates the first admin"
```

---

### Task 4: Function App and its identity

**Files:** none

- [ ] **Step 1: Create the resources.** Flex Consumption creates Application Insights with the app. 512 MB instances and a cap of 10 instances keep the cost close to zero at this traffic.

```powershell
. ./infra/names.ps1
az account set --subscription $subscription
az group create --name $rg --location $location -o none
az storage account create --name $storage --resource-group $rg --location $location --sku Standard_LRS `
  --min-tls-version TLS1_2 --allow-blob-public-access false -o none
az functionapp create --resource-group $rg --name $app --storage-account $storage `
  --flexconsumption-location $location --runtime node --runtime-version 24 --instance-memory 512 -o none
az functionapp scale config set --resource-group $rg --name $app --maximum-instance-count 10 -o none
az functionapp update --resource-group $rg --name $app --set httpsOnly=true -o none
az functionapp identity assign --resource-group $rg --name $app -o none
```

- [ ] **Step 2: Leave CORS to the API.** The API sends its own CORS headers. Platform CORS would answer preflights first and break the cookie flow.

Run: `az functionapp cors show --resource-group $rg --name $app`
Expected: `allowedOrigins` is empty or missing. For each origin listed, run `az functionapp cors remove --resource-group $rg --name $app --allowed-origins <origin>`.

- [ ] **Step 3: Check it.**

Run: `az functionapp show --resource-group $rg --name $app --query "{host:defaultHostName, https:httpsOnly, identity:identity.type}" -o table`
Expected: the default host name, `True`, and `SystemAssigned`.

---

### Task 5: Fabric access for the Function App

**Files:** none

- [ ] **Step 1: Put the identity in a security group.**

```powershell
. ./infra/names.ps1
az ad group create --display-name $group --mail-nickname $group -o none
$principalId = az functionapp identity show --resource-group $rg --name $app --query principalId -o tsv
az ad group member add --group $group --member-id $principalId
```

Run: `az ad group member check --group $group --member-id $principalId --query value`
Expected: `true`.

- [ ] **Step 2 (manual): Tenant setting.** In Fabric, open Settings, then Admin portal, then Tenant settings, then Developer settings. Enable **Service principals can use Fabric APIs**, applied to **Specific security groups**, with `fcr-fabric-api-identities` as the only group. Apply. Changes can take about 15 minutes to propagate. (Newer tenants split this setting. If you see that, enable the one about service principals calling Fabric public APIs, scoped the same way.)

- [ ] **Step 3 (manual): Share `fcr` with the app.** Open `fcr` and select Share. Type the Function App name (the `$app` value) and pick the app. Leave every additional permission unchecked, then select Grant. This gives the Read item permission, which the identity needs to connect at all.

- [ ] **Step 4 (manual): Grant table access.** In `fcr`, open a New SQL query and run, with your app name:

```sql
CREATE USER [fcr-api-<suffix>] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [fcr-api-<suffix>];
ALTER ROLE db_datawriter ADD MEMBER [fcr-api-<suffix>];
SELECT name, type_desc FROM sys.database_principals WHERE name = 'fcr-api-<suffix>';
```

Expected: one row, `EXTERNAL_USER`. If `CREATE USER` fails with a directory lookup error, your account lacks the Entra Directory Readers role. Use Security, then Manage SQL security, instead: add the app to `db_datareader` and to `db_datawriter`.

---

### Task 6: App settings and secrets

**Files:** none

- [ ] **Step 1: Database, origins, cookie, and deploy target.**

```powershell
. ./infra/names.ps1
az functionapp config appsettings set --resource-group $rg --name $app -o none --settings `
  "SQL_SERVER=$sqlServer" "SQL_DATABASE=$sqlDatabase" `
  "ALLOWED_ORIGINS=https://fabriccreditratings.com,https://www.fabriccreditratings.com" `
  "COOKIE_SECURE=true" "GITHUB_REPO=$repo" "GITHUB_BRANCH=main" "GITHUB_WORKFLOW=deploy.yml"
```

- [ ] **Step 2: Snapshot token, shared with the site deploy.** Nothing prints it.

```powershell
$snapshotToken = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
az functionapp config appsettings set --resource-group $rg --name $app -o none --settings "SNAPSHOT_TOKEN=$snapshotToken"
$snapshotToken | gh secret set SNAPSHOT_TOKEN -R $repo
Remove-Variable snapshotToken
```

- [ ] **Step 3 (manual): GitHub token for site rebuilds.** On github.com, open Settings, then Developer settings, then Personal access tokens, then Fine-grained tokens, then Generate new token:
  - Name: "fcr site deploy".
  - Expiration: 1 year. Add a calendar reminder to rotate it.
  - Repository access: Only select repositories, then `pugliabi/fabric-credit-ratings`.
  - Repository permissions: Actions, Read and write.

  Generate it, then:

```powershell
$token = Read-Host 'GitHub token' -MaskInput
az functionapp config appsettings set --resource-group $rg --name $app -o none --settings "GITHUB_DISPATCH_TOKEN=$token"
Remove-Variable token
```

- [ ] **Step 4: Anthropic, for Draft with AI.** Leave the workspace id blank if the key was created inside a workspace. Leave the model blank for the default.

```powershell
$key = Read-Host 'Anthropic API key' -MaskInput
$workspace = Read-Host 'Anthropic workspace id (Enter to skip)'
$model = Read-Host 'Anthropic model (Enter for the default)'
az functionapp config appsettings set --resource-group $rg --name $app -o none --settings `
  "ANTHROPIC_API_KEY=$key" "ANTHROPIC_WORKSPACE_ID=$workspace" "ANTHROPIC_MODEL=$model"
Remove-Variable key, workspace, model
```

- [ ] **Step 5: Check the names, not the values.**

Run: `az functionapp config appsettings list --resource-group $rg --name $app --query "[].name" -o tsv`
Expected: the list includes `SQL_SERVER`, `SQL_DATABASE`, `ALLOWED_ORIGINS`, `COOKIE_SECURE`, `SNAPSHOT_TOKEN`, `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH`, `GITHUB_WORKFLOW`, `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID`, `ANTHROPIC_MODEL`, and the platform's own `APPLICATIONINSIGHTS_CONNECTION_STRING` and `AzureWebJobsStorage`.

Run: `gh secret list -R $repo`
Expected: `SNAPSHOT_TOKEN`.

---

### Task 7: API deploy workflow and the first deploy

**Files:**
- Create: `.github/workflows/api-deploy.yml`

- [ ] **Step 1: Deploy identity with a federated credential.** GitHub signs in as this identity through the `api` environment, so no secret is stored. "Website Contributor" on the app is all it can do.

```powershell
. ./infra/names.ps1
az identity create --resource-group $rg --name $deployer -o none
$deployerClientId = az identity show --resource-group $rg --name $deployer --query clientId -o tsv
$deployerPrincipalId = az identity show --resource-group $rg --name $deployer --query principalId -o tsv
$appId = az functionapp show --resource-group $rg --name $app --query id -o tsv
az role assignment create --assignee-object-id $deployerPrincipalId --assignee-principal-type ServicePrincipal `
  --role 'Website Contributor' --scope $appId -o none
az identity federated-credential create --resource-group $rg --identity-name $deployer --name github-api-environment `
  --issuer https://token.actions.githubusercontent.com --subject "repo:${repo}:environment:api" `
  --audiences api://AzureADTokenExchange -o none
gh api -X PUT "repos/$repo/environments/api" --silent
gh variable set AZURE_CLIENT_ID -R $repo --body $deployerClientId
gh variable set AZURE_TENANT_ID -R $repo --body $tenant
gh variable set AZURE_SUBSCRIPTION_ID -R $repo --body $subscription
gh variable set AZURE_FUNCTIONAPP_NAME -R $repo --body $app
```

Run: `gh variable list -R $repo`
Expected: the four `AZURE_*` variables.

- [ ] **Step 2: Create `.github/workflows/api-deploy.yml`.** `login-backend` is in the trigger only until Task 11, so the API can be deployed before the merge. The API package installs with `--ignore-scripts`, which skips the 200 MB Core Tools download (esbuild still works). The package ships `dist/` plus production dependencies only.

```yaml
name: Deploy the API

on:
  push:
    branches: [main, login-backend]
    paths:
      - 'api/**'
      - 'src/domain/**'
      - '.github/workflows/api-deploy.yml'
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

concurrency:
  group: api-deploy
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: api
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: |
            package-lock.json
            api/package-lock.json

      - run: npm ci

      - run: npm ci --ignore-scripts
        working-directory: api

      - run: npm run typecheck

      - run: npm test

      - name: Build and package
        working-directory: api
        run: |
          npm run build
          mkdir -p ../.deploy
          cp host.json package.json package-lock.json ../.deploy/
          cp -r dist ../.deploy/dist
          npm ci --omit=dev --ignore-scripts --prefix ../.deploy

      - uses: azure/login@v3
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}

      - uses: Azure/functions-action@v1
        with:
          app-name: ${{ vars.AZURE_FUNCTIONAPP_NAME }}
          package: .deploy

      - name: Check the API answers
        if: ${{ vars.API_URL != '' }}
        run: |
          for attempt in 1 2 3 4 5 6; do
            if curl -fsS --max-time 60 "${{ vars.API_URL }}/api/health"; then exit 0; fi
            sleep 10
          done
          echo "::error::${{ vars.API_URL }}/api/health did not answer after the deploy."
          exit 1
```

- [ ] **Step 3: Commit and push the branch.** This is the branch's first push. `deploy.yml` only runs for `main`, so the live site doesn't change.

```powershell
npm run typecheck; npm test
git add .github/workflows/api-deploy.yml
git commit -m "Deploy the API to Azure Functions with OIDC"
git push -u origin login-backend
Start-Sleep -Seconds 10
gh run watch (gh run list -R $repo --workflow api-deploy.yml -L 1 --json databaseId --jq '.[0].databaseId') -R $repo --exit-status
```

Expected: the run succeeds. The health check step is skipped because `API_URL` isn't set yet.

- [ ] **Step 4: Smoke test on the default host name.**

```powershell
. ./infra/names.ps1
$api = 'https://' + (az functionapp show --resource-group $rg --name $app --query defaultHostName -o tsv)
Invoke-RestMethod "$api/api/health"
$headers = @{ Origin = 'https://fabriccreditratings.com' }
$preflight = Invoke-WebRequest -Method Options "$api/api/auth/login" -Headers ($headers + @{
  'Access-Control-Request-Method' = 'POST'; 'Access-Control-Request-Headers' = 'content-type' })
$preflight.Headers['Access-Control-Allow-Origin'], $preflight.Headers['Access-Control-Allow-Credentials']
$web = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$password = Read-Host 'Production admin password' -MaskInput
$body = @{ login = 'pugliabi'; password = $password } | ConvertTo-Json
Invoke-RestMethod -Method Post "$api/api/auth/login" -WebSession $web -Headers $headers -ContentType 'application/json' -Body $body
Remove-Variable password, body
Invoke-RestMethod "$api/api/admin/rounds" -WebSession $web
```

Expected:
- health returns `ok: True` (the first call can take up to a minute while `fcr` wakes);
- the preflight echoes `https://fabriccreditratings.com` and `true`;
- login returns your user with `role: admin`;
- rounds lists `2026-Q4`, open, with 0 scorecards.

If health returns 503 or the logs show a login failure for the identity, recheck Task 5. Live logs: `az webapp log tail --resource-group $rg --name $app`, or Application Insights, then Failures.

---

### Task 8: Custom domain, certificate, and the site's API variable

**Files:** none (a code fix only if Step 5 shows spoofable addresses)

- [ ] **Step 1: Get the DNS values.** The verification id is public by design.

```powershell
. ./infra/names.ps1
az functionapp show --resource-group $rg --name $app --query "{cname:defaultHostName, txt:customDomainVerificationId}" -o table
```

- [ ] **Step 2 (manual): Bluehost DNS.** In Bluehost, open Domains, then `fabriccreditratings.com`, then DNS, and add:
  - CNAME, host `api`, pointing to the `cname` value above, TTL 1 hour.
  - TXT, host `asuid.api`, value: the `txt` value above.

Run, until both answer (minutes, sometimes an hour):

```powershell
Resolve-DnsName api.fabriccreditratings.com -Type CNAME
Resolve-DnsName asuid.api.fabriccreditratings.com -Type TXT
```

- [ ] **Step 3 (manual): Bind the domain with a managed certificate.** The Azure CLI can't create site-scoped certificates for Flex Consumption yet. In the Azure portal, open the Function App, then Settings, then Custom domains, then Add custom domain:
  - Domain provider: All other domain services.
  - TLS/SSL certificate: App Service Managed Certificate.
  - TLS/SSL type: SNI SSL.
  - Domain: `api.fabriccreditratings.com`.

  Select Validate, then Add. The certificate can take up to 10 minutes.

Run: `Invoke-RestMethod https://api.fabriccreditratings.com/api/health`
Expected: `ok: True` over a valid certificate.

- [ ] **Step 4: Point the site deploy at the API.**

Run: `gh variable set API_URL -R $repo --body "https://$apiHost"`

From now on, `deploy.yml` fetches the snapshot from the API, and the health check in `api-deploy.yml` runs after every API deploy. Both workflows first run with it in Task 10.

- [ ] **Step 5: Check that lockout sees the real client address.** The per-address lockout keys on the last `X-Forwarded-For` entry, the one Azure's front end should append (`clientIp` in `api/src/lib/http.ts`). Anything that isn't a bare IP address of at most 45 characters becomes `ip:unknown`. These checks confirm that on the deployed app the last entry is the caller's real address and a client can't set it. The login `ip-check` doesn't exist, so the tries can't lock the admin's login; all the checks together add 6 failures to `login:ip-check`, under the lock at 10. They do count against your own address: each pass of checks 1 and 2 adds 4 failures to your `ip:` row, so run check 5's cleanup before you repeat a check, or a third pass locks your address, admin login included, for 15 minutes.

Clean up first, so the counts start from zero (earlier logins, such as Task 7 Step 4's, leave rows behind). In the `fcr` SQL query editor:

```sql
DELETE FROM login_attempts;
```

Run checks 1 to 4 within 15 minutes of check 1. After that, a key's count restarts at 1 on its next failure, so judge by which keys appear, not by the counts.

Setup, in PowerShell 7 (run it again in any new terminal):

```powershell
. ./infra/names.ps1
$wrong = @{ login = 'ip-check'; password = 'not-the-password' } | ConvertTo-Json -Compress
function Send-WrongLogin([string]$forwardedFor) {
  $headers = @{ Origin = 'https://fabriccreditratings.com' }
  if ($forwardedFor) { $headers['X-Forwarded-For'] = $forwardedFor }
  Invoke-RestMethod -Method Post "https://$apiHost/api/auth/login" -ContentType 'application/json' -Body $wrong `
    -Headers $headers -SkipHttpErrorCheck
}
```

Each `Send-WrongLogin` prints an `error` of `Wrong login or password.` After each check, run this in the `fcr` SQL query editor:

```sql
SELECT attempt_key, failures FROM login_attempts ORDER BY attempt_key;
```

**Check 1: the real address, with no header sent.**

```powershell
Send-WrongLogin
Invoke-RestMethod https://api.ipify.org; Invoke-RestMethod https://api64.ipify.org
```

Expected: `login:ip-check` and one `ip:` row, each with 1 failure, and no others. The `ip:` address is exactly one of the two printed addresses, with no port. Anything else fails, including `ip:unknown` and private or Azure addresses (`10.*`, `172.16.*` to `172.31.*`, `100.64.*` to `100.127.*`, `169.254.*`, `fc*`, `fd*`, `fe80:*`).

**Check 2: spoofed headers.**

```powershell
Send-WrongLogin '198.51.100.7'
Send-WrongLogin '198.51.100.7, 198.51.100.8'
Send-WrongLogin 'not-an-ip'
```

Expected: the same two rows, each now with 4 failures, and no others: no `ip:198.51.100.*` and no `ip:unknown`.

**Check 3: a second network.** Move this computer to another network, such as a phone hotspot. If you opened a new terminal, run the setup block first. Run check 1's ipify line first: it must print a different address than in check 1. If it doesn't (a VPN, or a shared NAT), this check proves nothing, because both networks reach the API from the same address; use another network. Then run `Send-WrongLogin`.

Expected: a new `ip:` row with 1 failure for the address ipify now prints, and `login:ip-check` at 5. If the key is the same as in check 1 while ipify's addresses differ, every caller shares one front-end address, which the `isIP` check can't catch.

**Check 4: IPv6**, when both this network and the API have it.

```powershell
$wrong | curl.exe -6 -sS -o NUL -w '%{http_code}\n' "https://$apiHost/api/auth/login" `
  -H 'Origin: https://fabriccreditratings.com' -H 'Content-Type: application/json' --data-binary '@-'
curl.exe -6 -sS https://api64.ipify.org
```

Expected: `401`, then an IPv6 address, and a row `ip:<that address>` in lowercase with no port: new with 1 failure, or check 3's row now at 2 if check 3 already went over IPv6; `login:ip-check` at 6. If curl can't resolve or connect, one side has no IPv6: skip this check. A row of `ip:unknown`, or an address with a port glued on (such as `…:1:443`), means the platform sends IPv6 without brackets, and `clientIp` needs to handle that form. An uppercase address means `clientIp` should lowercase it.

**Check 5: clean up**, whatever the results:

```sql
DELETE FROM login_attempts;
```

If check 2 shows `ip:198.51.100.*` or `ip:unknown`, the platform passes the client's `X-Forwarded-For` through without appending the real address, so the client picks the per-address key. If check 3 shows one key for both networks, every caller shares it. If check 1 shows `ip:unknown`, there is no usable header. `clientIp` already reads the last entry, so reading a different entry won't help. Either:
- switch to a header the platform sets and the client can't override, once this same check shows a client-sent copy is replaced; or
- (a spec change, ask first) drop the per-address key and rely on the per-login limit. Skipping it only when it's `unknown` isn't enough: a passed-through or shared address is a valid IP.

Whatever the fix, keep `clientIp`'s `isIP` check and 45-character cap: they stop a client-chosen value from becoming an over-long key, which fails the `login_attempts` write, or a non-ASCII one, which aliases other keys. After either change, commit it with its tests and push, which redeploys the API, then repeat this step. After dropping the key, checks 1 to 4 should show only `login:ip-check`.

---

### Task 9: README

**Files:**
- Modify: `README.md` (rewrite)

- [ ] **Step 1: Rewrite `README.md`.**

````markdown
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

- The public site never calls the API. Each site deploy fetches the published ratings once (`npm run snapshot`) and commits `src/data/snapshot.json` when it changed.
- Publishing a round, or **Update public site** in the admin, starts the site deploy. The site updates about two minutes later.
- The snapshot holds published rounds only, with no per-rater scores. Items nobody has rated don't appear.

## Run locally

Needs Node 24, the Azure CLI, and access to the `fcr-dev` database in Fabric.

```powershell
az login
npm install
npm --prefix api install
Copy-Item api/local.settings.example.json api/local.settings.json   # set SQL_SERVER and SQL_DATABASE for fcr-dev
npm run api   # terminal 1: the API on http://localhost:7071
npm run dev   # terminal 2: http://localhost:5173, /rate.html, /admin.html
```

Vite proxies `/api` to the local API, so the session cookie works on localhost.

| Command | What it does |
|---------|--------------|
| `npm run dev` | Site dev server with hot reload |
| `npm run api` | Build and start the Functions API locally |
| `npm run build` | Typecheck everything, then build the site to `dist/` |
| `npm run typecheck` | TypeScript for the site, scripts, and API |
| `npm test` | Unit tests. The API integration test also runs when `FCR_API_URL` is set |
| `npm run snapshot` | Refresh `src/data/snapshot.json` from the API |
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

- **Site:** `.github/workflows/deploy.yml` runs on every push to `main` and when the API starts it. It refreshes the snapshot (repo variable `API_URL`, secret `SNAPSHOT_TOKEN`), builds, and publishes to GitHub Pages.
- **API:** `.github/workflows/api-deploy.yml` deploys `api/` when `api/` or `src/domain/` changes on `main`. It signs in to Azure with OIDC through the `api` environment (variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_FUNCTIONAPP_NAME`).

Function App settings:

| Setting | What it is |
|---------|------------|
| `SQL_SERVER`, `SQL_DATABASE` | The `fcr` database in Fabric |
| `ALLOWED_ORIGINS` | Pages allowed to call the API with cookies |
| `COOKIE_SECURE` | `true` in Azure; `false` only for local http |
| `SNAPSHOT_TOKEN` | Same value as the repo's `SNAPSHOT_TOKEN` secret |
| `GITHUB_DISPATCH_TOKEN` | Fine-grained token (this repo, Actions read/write) that starts the site deploy. Rotate it yearly |
| `GITHUB_REPO`, `GITHUB_BRANCH`, `GITHUB_WORKFLOW` | Which workflow to start |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID`, `ANTHROPIC_MODEL` | Draft with AI. The workspace id and model are optional |

DNS is at Bluehost. The site records point at GitHub Pages (`public/CNAME` holds the domain). `api` is a CNAME to the Function App, with an App Service managed certificate.
````

- [ ] **Step 2: Commit.**

```powershell
git add README.md
git commit -m "README: logins, admin, Fabric SQL backend, and both deploys"
```

---

### Task 10: Cutover

**Files:** none

- [ ] **Step 1: Final check on the branch.**

Run: `npm run typecheck; npm test; npm run build; git status --short`
Expected: everything passes and the tree is clean. `src/data/snapshot.json` is still the empty file from Plan 2.

- [ ] **Step 2: Merge and push.**

```powershell
git switch main
git pull --ff-only
git merge --ff-only login-backend
git push origin main
```

If `--ff-only` refuses because `main` moved, run `git merge login-backend`, resolve any conflicts, and push.

- [ ] **Step 3: Watch both deploys.**

```powershell
. ./infra/names.ps1
Start-Sleep -Seconds 10
gh run list -R $repo -L 4
gh run watch (gh run list -R $repo --workflow deploy.yml -L 1 --json databaseId --jq '.[0].databaseId') -R $repo --exit-status
```

Expected:
- `deploy.yml` passes. Its "Fetch the published ratings" step logs `Snapshot unchanged.`, because nothing is published in `fcr` yet, so no snapshot commit is made.
- `api-deploy.yml` also runs (the API files are new on `main`) and passes.

- [ ] **Step 4: Live check** in a normal browser window, with a private window for a rater.
  1. https://fabriccreditratings.com shows "Items rated 0" and the "No ratings are published yet" empty state, with "Raters: log in" in the footer. The mock ratings that used to be live are gone; this is expected until Q4 2026 is published.
  2. https://fabriccreditratings.com/admin: log in. The Score tab shows Q4 2026 with every item, and the Publish tab reads "The public site is up to date".
  3. On Users, create the real raters. Each one's notice shows the password to hand over.
  4. In the private window, log in at https://fabriccreditratings.com/rate as one rater, save a score, and change the password.
  5. On Publish, select Update public site. The notice reads "The public site is rebuilding…", and `gh run list -R $repo --workflow deploy.yml -L 1` shows a `workflow_dispatch` run.
  6. Undo the test score: on Review & why, choose the rater's card, clear the item, and save.

---

### Task 11: Clean up

**Files:**
- Modify: `.github/workflows/api-deploy.yml`

- [ ] **Step 1: Deploy the API from `main` only.** In `.github/workflows/api-deploy.yml`, change `branches: [main, login-backend]` to `branches: [main]`.

- [ ] **Step 2: Commit, push, and delete the branch.**

```powershell
git add .github/workflows/api-deploy.yml
git commit -m "Deploy the API from main only"
git push origin main
git push origin --delete login-backend
git branch -d login-backend
```

Expected: `api-deploy.yml` runs once more and passes (the workflow file changed). `deploy.yml` also runs, and leaves the snapshot alone.

- [ ] **Step 3: Note the expiries.** The GitHub token from Task 6 expires a year from creation, and site updates from the admin stop when it does. When that happens, the admin shows "GitHub refused the site update (HTTP 401)…". Set the calendar reminder now if you skipped it.

---

## Done When

- https://api.fabriccreditratings.com/api/health answers over a managed certificate. The Function App reaches `fcr` with its managed identity, and no database secret exists anywhere.
- `fcr` holds the catalog, round 2026-Q4 (open), your admin account, and the real raters.
- Raters log in at `/rate` and the admin works at `/admin` on the live site; publishing or Update public site rebuilds it.
- The public site is built from `src/data/snapshot.json`, which the deploy refreshes from the API.
- `api-deploy.yml` deploys the API from `main` through OIDC; `deploy.yml` deploys the site.
- `src/data/rounds/`, `artifacts.ts`, and `workloads.ts` are gone. `formula.ts` and `aggregate.ts` live only under `api/`, and the boundary test passes.
- The README describes the new setup.
