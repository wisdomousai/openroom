# GitHub Actions deployment

The workflow is [`.github/workflows/verify.yml`](../.github/workflows/verify.yml).
GitHub Actions runs checks on pull requests targeting `main`, pushes to `main`, and
manual runs. Production is the `openroom` Worker serving `openroom.app`,
`www.openroom.app`, and `join.openroom.app`.

## Release sequence

1. Install the locked dependencies with the Bun version in `package.json` and Node 24.
2. Run repository builds, type checks, unit tests, isolated recovery verification,
   browser journeys, and the manual's browser checks.
3. Store the built workspace packages and Worker static assets in an artifact named
   for the commit. Retain this artifact and browser evidence for seven days.
4. For `main`, enter the `production` job after verification succeeds. Skip a build
   if a newer commit is already on `main`.
5. Restore the artifact, apply pending D1 migrations, and deploy the Worker with
   the verified static assets. The deployment job performs no frontend rebuild.
6. Verify production health and compare app entry points, manual chapters, search
   data, screenshots, and linked assets with the build using SHA-256 hashes. HTML
   comparison excludes Cloudflare's injected challenge and analytics scripts and
   normalizes whitespace between tags; other assets require an exact byte match.

Pull requests have no production credentials. All jobs use read-only repository
permissions; the Cloudflare token is exposed only to the migration/deployment step.
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

Do not place credentials in YAML, commit them, or include them in issue comments.
Once configuration is complete, push `main` and open **Actions → OpenRoom CI/CD**.
The run must show successful verification and deployment jobs. Without the account
ID repository variable, checks still run and deployment is skipped. Set the variable
after the production environment and token are configured. A missing token then
fails the deployment step with the name of the value to configure.

## Billing configuration

Production (openroom.app) is a billed deployment and must set
`PADDLE_ENVIRONMENT` (`sandbox` or `live`) together with the other Paddle values
in [BILLING.md](BILLING.md). Leaving `PADDLE_ENVIRONMENT` unset or empty makes a
deployment self-hosted: every account receives every implemented capability,
including `continuity` and `team`, and nothing is sold. Self-hosted deployments
need no Paddle account, catalog, webhook or cron configuration.

Check the variable before the first production deploy and after any change to
Worker variables or secrets. Local development (`.dev.vars` with an empty
`PADDLE_ENVIRONMENT`) and the isolated browser journeys run self-hosted.

## Manual deployment and verification

From the repository root, with an authenticated local Wrangler session:

```sh
bun run deploy
node scripts/ci/verify-deployment.mjs https://openroom.app
```

`bun run deploy` rebuilds the app before uploading. The CI job intentionally invokes
Wrangler directly after restoring its verified build. Calling the Worker package's
deploy script alone collects existing app output without rebuilding it.

## Failures and recovery

Failed verification prevents deployment. A failed migration prevents the Worker
upload. Migration files are reviewed code: assess data compatibility before merging
schema changes, and use additive changes when old and new Worker versions need to
coexist. D1 migration application and Worker upload are separate operations.

If the production check fails after an upload, inspect the failed path and the
Cloudflare deployment before rerunning. The workflow reports the failure and leaves
the deployed version visible; it does not reverse database changes automatically.

For a Worker-only regression, inspect versions and roll back from `apps/worker`:

```sh
bun x --no-install wrangler deployments list
bun x --no-install wrangler rollback VERSION_ID
```

Confirm that the previous Worker is compatible with the current database before
rollback. Native Desktop distribution, signing, notarization, and native PowerPoint
acceptance remain separate release tasks.

References: [GitHub deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments),
[GitHub environment secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets),
[Cloudflare GitHub Actions deployments](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
