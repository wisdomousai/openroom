# GitHub Actions deployment

The workflow is [`.github/workflows/verify.yml`](../.github/workflows/verify.yml).
GitHub Actions runs checks on pull requests targeting `main`, pushes to `main`, and
manual runs. Production is two Workers:

| Worker | Source | Serves |
| --- | --- | --- |
| `openroom` (control plane) | `apps/workspace-worker` | `openroom.app`, `www.openroom.app`, `join.openroom.app`; D1, R2, accounts, session creation, the live API front door |
| `openroom-relay` (live plane) | `apps/relay` | No public route (`workers_dev: false`). Owns `SessionDO`; serves `/join/`, `/stage/` and the `join.` host through the control plane's `RELAY` service binding |

The control plane binds `SessionDO` from the relay with `script_name: "openroom-relay"`
([Durable Object bindings](https://developers.cloudflare.com/workers/wrangler/configuration/#durable-objects))
and forwards the live pages over a service binding
([service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)).
Both resolve only if the relay is deployed, so **the relay always deploys first**.

## Release sequence

1. Install the locked dependencies with the Bun version in `package.json` and Node 24.
2. Run repository builds, type checks, unit tests, isolated recovery verification,
   browser journeys, and the manual's browser checks.
3. Store the built workspace packages and Worker static assets in an artifact named
   for the commit. Retain this artifact and browser evidence for seven days.
4. For `main`, enter the `production` job after verification succeeds. Skip a build
   if a newer commit is already on `main`.
5. Restore the artifact, deploy the relay with its verified stage and participant
   assets, then apply pending D1 migrations and deploy the control plane with its
   verified static assets. The deployment job performs no frontend rebuild.
6. Verify production health and compare app entry points, manual chapters, search
   data, screenshots, and linked assets with the build using SHA-256 hashes. `/join/`
   and `/stage/` are compared with `apps/relay/public`, the rest with
   `apps/workspace-worker/public`. HTML
   comparison excludes Cloudflare's injected challenge and analytics scripts, the
   Umami Cloud snippet the Worker adds when `UMAMI_WEBSITE_ID` is set,
   and normalizes whitespace between tags; other assets require an exact byte match.

Pull requests have no production credentials. All jobs use read-only repository
permissions; the Cloudflare token is exposed only to the two deployment steps, which
run only in the canonical repository.
Official Actions are pinned to commit revisions. Production deployments run one
at a time and are not interrupted by newer pushes. A manual workflow run deploys
only when its selected branch is `main`.

## One-time GitHub configuration

Create a GitHub environment named **production** and restrict its deployment
branches to the branch **main**. No required reviewer is needed for automatic
deployment after checks pass. Confirm that the repository's GitHub plan supports
deployment environments for private repositories.

Set these values after creating the environment:

| Kind | Name | Value |
| --- | --- | --- |
| Repository variable | `CLOUDFLARE_ACCOUNT_ID` | The account ID owning the existing `openroom` Worker and D1 database; set this last to activate deployment |
| Production environment secret | `CLOUDFLARE_API_TOKEN` | A dedicated Cloudflare API token for this deployment |

Use a token scoped to the OpenRoom account and `openroom.app` zone. It must permit
Worker uploads, the existing custom-domain routes, and D1 migration operations.
Start from Cloudflare's **Edit Cloudflare Workers** token template, restrict its
account and zone resources, and add D1 edit access. Keep the token in GitHub's
environment secret storage. The local Wrangler OAuth login is for interactive
development and is not the CI credential.

The GitHub CLI can store the token through a hidden prompt:

```sh
gh secret set CLOUDFLARE_API_TOKEN --env production
gh variable set CLOUDFLARE_ACCOUNT_ID --body YOUR_ACCOUNT_ID
```

Worker secrets are set once per Worker with `wrangler secret put` (hidden prompt),
not through GitHub:

| Worker | Secret | Note |
| --- | --- | --- |
| `openroom-relay` (`cd apps/relay`) | `TOKEN_SECRET` | The **same value** as the control plane's; both sign and verify session capability tokens |
| `openroom` (`cd apps/workspace-worker`) | `TOKEN_SECRET`, `ADMIN_KEY`, Google and Paddle values | As before |

Hosted, the relay has no `RELAY_KEY`: only the control plane creates sessions, and
`POST /api/sessions` on the relay answers `403 creation-disabled`. Set the relay's
`TOKEN_SECRET` before the first relay deploy; without it no session token verifies.

Do not place credentials in YAML, commit them, or include them in issue comments.
Once configuration is complete, push `main` and open **Actions → OpenRoom CI/CD**.
The run must show successful verification and deployment jobs. Without the account
ID repository variable, checks still run and deployment is skipped. Set the variable
after the production environment and token are configured. A missing token then
fails the deployment step with the name of the value to configure.

## Billing configuration

Production (openroom.app) is a billed deployment and must set
`PADDLE_ENVIRONMENT` (`sandbox` or `live`) together with the other Paddle values
in [BILLING.md](BILLING.md). Setting `PADDLE_ENVIRONMENT=off` makes a
deployment self-hosted: every account receives every implemented capability,
including `continuity` and `team`, and nothing is sold. Self-hosted deployments
need no Paddle account, catalog, webhook or cron configuration.

An unset or empty `PADDLE_ENVIRONMENT` fails closed: accounts are free (or keep
their manual development grants), so a deploy that drops the variable does not
unlock paid features. Check the variable before the first production deploy and
after any change to Worker variables or secrets. Local development and the
isolated browser journeys run with `DEMO_AUTH` set and no `PADDLE_ENVIRONMENT`,
which is treated as self-hosted.

## Terminology migration

The product dropped internal jargon from names, routes, error codes, stored values and
database objects. It is a hard break: no alias accepts an old name. Each rename pass adds
a D1 migration under `apps/workspace-worker/migrations/` that renames objects and rewrites
stored values, and `node scripts/check-terms.mjs` (part of `scripts/verify.mjs`) fails on any
retired term outside the migrations and the one-shot scripts. The retired and current
terms are in [TERMINOLOGY.md](TERMINOLOGY.md).

Before deploying a release that contains these migrations:

- Durable Object state is not migrated. Live sessions running at deploy time end, so
  deploy outside teaching hours, relay first as usual.
- Deployment configuration is not rewritten by a migration. Edit the `capabilities`
  arrays in the `PADDLE_PRICE_CATALOG` secret of every environment (see
  [BILLING.md](BILLING.md)) to the new entitlement keys listed below, or the catalog is
  rejected and the plan grants nothing.
- Local `.openroom` files and drafts saved outside D1 keep the old values and fail
  validation until someone edits them; D1 decks, versions, drafts and frozen session
  outlines are rewritten by the migration.
- R2 session archives (`archives/<session code>.json`) hold aggregates and the kept ballots
  CSV. The aggregates carry no renamed value, but the CSV header names its participant
  column. It was `handle` and is now `name`. Archives written before this release keep the
  old header until rewritten. Run `apps/workspace-worker/scripts/terminology-archives.mjs`
  on downloaded copies (it never contacts Cloudflare, supports `--dry-run`, and can run
  twice): list the keys with `SELECT r2_key FROM session_archives`, fetch each with
  `wrangler r2 object get <bucket>/<key> --remote --file <folder>/<code>.json`, run
  `node apps/workspace-worker/scripts/terminology-archives.mjs <folder>`, and put the
  changed files back with `wrangler r2 object put <bucket>/<key> --remote --file ...
  --content-type application/json`. Skipping this only leaves the old column header in
  old archived downloads.
- The tutoring entity is now a student in every API route, field, error code and table. Old
  bookmarks and external callers that use `/api/tutoring/contexts`, `contextId`,
  `contextLink`, `?contextId=` on a host space URL, `#/tutor/contexts` or the
  `context-link-*` error codes stop working; update them. Issued `orlnk_…` access links
  (and the learner page URL `#/learn?token=…`) stay valid, because only table and column
  names change, not tokens or ids.
- `0003_student` renames tables and columns with `ALTER TABLE ... RENAME`, which rewrites the
  foreign keys in the other tables only while foreign keys are enforced. Cloudflare D1
  always enforces them, so `wrangler d1 migrations apply` is correct. Do not apply the file
  through a SQLite shell that has `PRAGMA foreign_keys=OFF`. After a local dry run,
  `PRAGMA foreign_key_check;` returns no rows.
- No R2 object or Durable Object carries a context-named key. Archives, media and deck
  files need no rewrite for `0003_student`, and no script was added for it. A live session
  asks the Worker for its student on `/api/sessions/:code/student` (it was `/context`); open
  host tabs from before the deploy fail that one request until reloaded.
- The join page reads the guest link from `?guest=orinv_…` (the older query parameter is no longer read). Guest
  links already copied or sent with the old query parameter no longer sign the guest in;
  the host copies the link again.
- Participants inside Durable Objects store the name under `name` (it was `handle`). This
  is part of the live state that ends at deploy.
- Facilitators are now hosts. No D1 table or column, R2 object or archive names a
  facilitator, so this change has no D1 migration and no script. The session state inside
  Durable Objects holds `hosting.hosts` (it was `facilitation.facilitators`), and host tokens
  carry `hostId` (it was `facilitatorId`). A session that is live at deploy time ends: its
  state does not load under the new keys, and every host, stage-remote and capability token
  issued before the deploy fails verification. Hosts reopen the session from the Library
  with their account; a relay-only presenter starts a new session. External callers that use
  `POST /api/my/sessions/:code/facilitate`, the MCP tool `session_facilitate`, the CLI
  command `session facilitate`, the `presentation.handoff` field `facilitatorId` or the
  `facilitation` object in session snapshots must switch to `/co-host`, `session_co_host`,
  `session co-host`, `hostId` and `hosting`. Host tokens kept in an old `.openroom.json`
  file of the CLI stop working; run `openroom session co-host <code>` again.

| Migration | Rename |
| --- | --- |
| `0001_guest_list` | The two session guest tables are renamed to `guest_lists` and `guest_links` (indexes recreated, issued `orinv_…` tokens stay valid). The retired `identityMode` value is rewritten to `guest-list` in `deck_versions.content_json`, `sessions.source_outline_json` and `deck_drafts.content_yaml`. The retired entitlement key in `users.entitlements` is rewritten to `guestList`. The plan catalog capability must be changed to `guestList` by hand (see above). |
| `0002_nickname` | The retired `identityMode` value is rewritten to `nickname` in `deck_versions.content_json`, `sessions.source_outline_json` and `deck_drafts.content_yaml`. No table or column changes. |
| `0003_student` | Tables `contexts`, `context_learners`, `context_access_links` and `space_contexts` become `students`, `student_learners`, `student_access_links` and `space_students`. Column `context_id` becomes `student_id` in all nine tables that carry it, and `contexts.context_json` becomes `students.student_json` (the JSON inside keeps its keys). The twelve indexes are dropped and recreated with the new names. `item_tags` is rebuilt so its `item_type` check accepts `student` instead of `context`, and stored rows are converted. `deletion_intents.resource_type` `context` becomes `student`. The pinned-item kind `context` in `users.prefs` becomes `student`. |
| `0004_profile` | Column `students.student_json` becomes `students.profile_json`. The JSON inside is unchanged. The details object of a student is named `profile` in the API: request and response field `profile` (it was `student` inside the student), errors `profile-must-be-object` and `profile-too-large` (they were `student-must-be-object` and `student-too-large`). |

## Website pageviews

`UMAMI_WEBSITE_ID` is optional. The hosted site sets it in
`apps/workspace-worker/wrangler.jsonc` to the Umami Cloud website id. Public-site
HTML (the landing page, the manual, privacy, and terms) then loads
`https://cloud.umami.is/script.js` with that id. The workspace at `/host`, the
join app, and the stage never load the script. Clear the variable for a
deployment that should not track, including local `.dev.vars`.

## Manual deployment and verification

From the repository root, with an authenticated local Wrangler session:

```sh
bun run deploy
node scripts/ci/verify-deployment.mjs https://openroom.app
```

CI passes the deployment's `workers.dev` URL as a second argument. Bot Fight Mode
on the public zone challenges the GitHub Actions Node client, so when
`openroom.app` answers that challenge the check continues against the same
deployment on `workers.dev`.

`bun run deploy` rebuilds the app, deploys the relay, then the control plane. The CI
job intentionally invokes Wrangler directly in `apps/relay` and then `apps/workspace-worker`
after restoring its verified build. Calling either package's deploy script alone
collects existing app output without rebuilding it.

### Moving `SessionDO` to the relay

The control plane's migration `v3` (`deleted_classes: ["SessionDO"]`) deletes its
own `SessionDO` namespace on the first deploy after the move; the relay's `v1`
creates the new one. Sessions running at that moment end: their state is not moved.
Ended-session archives in R2 and durable session rows in D1 are unaffected. Deploy
outside teaching hours.

## Failures and recovery

Failed verification prevents deployment. A failed migration prevents the Worker
upload. Migration files are reviewed code: assess data compatibility before merging
schema changes, and use additive changes when old and new Worker versions need to
coexist. D1 migration application and Worker upload are separate operations.

If the production check fails after an upload, inspect the failed path and the
Cloudflare deployment before rerunning. The workflow reports the failure and leaves
the deployed version visible; it does not reverse database changes automatically.

For a Worker-only regression, inspect versions and roll back from `apps/workspace-worker` or
`apps/relay`:

```sh
bun x --no-install wrangler deployments list
bun x --no-install wrangler rollback VERSION_ID
```

Confirm that the previous Worker is compatible with the current database before
rollback. Do not roll the control plane back past the `SessionDO` move: a version
that defines the class locally conflicts with migration `v3`. Roll the relay back
independently; the control plane keeps binding whatever relay version is live. Native Desktop distribution, signing, notarization, and native PowerPoint
acceptance remain separate release tasks.

References: [GitHub deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments),
[GitHub environment secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets),
[Cloudflare GitHub Actions deployments](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
