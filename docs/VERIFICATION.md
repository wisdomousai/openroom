# Repository and browser verification

`bun run verify` builds shared packages in dependency order, typechecks every
workspace that declares a typecheck, runs its tests with at most two workers, then
builds the browser apps, Desktop application and Worker assets. Desktop reuses the
Host renderer produced in that run. It stops on the first
failure. `node scripts/verify.mjs --build-only` performs the same builds without
claiming test or typecheck coverage.

The package-manager version is pinned in `package.json`. Install with
`bun install --frozen-lockfile` and use Node 24. The CI workflow reads that Bun
version instead of installing whichever version is newest.

## Browser journeys

After a successful build:

```bash
cd e2e
bunx playwright install chromium
cd ..
bun run verify:browser
```

For a focused run, pass normal Playwright file or filtering arguments:

```bash
bun run verify:browser journeys/UC-38-saved-results.spec.ts
```

The runner derives its Worker configuration from the checked-in JSONC config and
creates a new temporary D1/R2/DO persistence directory. It applies the current
schema baseline locally, builds the Worker with Wrangler's local `--dry-run`,
selects an unused loopback port and serves that bundle directly with Miniflare.
This omits Wrangler's development proxy and file watcher. D1, R2, SQLite Durable
Objects and assets still use the checked-in configuration and real local runtime.
Its only credentials are fixed test values and disposable test accounts.
The server configuration contains no Paddle, Google or model credentials, no
production routes, no cron triggers and no remote resource bindings. Developer
`.dev.vars` is not copied or changed. Fixtures receive the temporary persistence
path and matching test signing secret explicitly.

The test Worker is stopped and its storage removed when the run finishes.
If the Worker exits during a journey, the runner stops the tests and fails the run.
`e2e/verification-output/worker.log` and `run.json` describe the local run;
Playwright screenshots, traces and downloaded fixtures live in `e2e/test-results`.
These directories are ignored by Git. Do not replace the runner's generated local
configuration with a hosted target.

Native Desktop journeys explicitly skip unless `RUN_DESKTOP_JOURNEY=1` is set.
They need a built Electron application and a native display. Passing browser
journeys does not prove a native Desktop package, an installed Office add-in,
a real Paddle lifecycle, accessibility on physical devices or production load.
Office and checkout adapter fixtures remain identified as fixtures in their
journey documentation.

`bun run verify:browser UC-39-first-tutoring-lesson` adds a fresh tutoring account
walkthrough with UI-only setup, a complete teaching/homework/feedback cycle, and
live rehearsal of all eight language samples. It retains full-page axe JSON and
screenshots alongside assertions. Tutor and learners run in separate browser
processes; two isolated learner contexts verify distinct answers and recovery after
reload and a simulated network loss. Separate browsers are the accepted functional
substitute for phones. Google sign-in, screen readers and hardware-specific touch,
microphone and OS behavior remain separate evidence.
See [UC-39](journeys/UC-39-first-tutoring-lesson.md) and the
[first-use audit](qa/2026-09-19-first-use.md).

`UC-40-slide-display-parity` compares authored content in the editor, control view,
actual fullscreen stage and narrow learner view at 16:9, 16:10 and 4:3. It measures
content margins, aspect ratio, text and proportional positions/font sizes, and
waits for uploaded images to load. Mobile defaults to the authored Slide view;
Reading is an explicit reflow option. See [UC-40](journeys/UC-40-slide-display-parity.md).

For a Chromium tutor and a separate WebKit learner browser:

```sh
cd e2e
bunx playwright install webkit
cd ..
OPENROOM_E2E_LEARNER_ENGINE=webkit bun run verify:browser UC-39-first-tutoring-lesson UC-40-slide-display-parity
```

The engine flag affects only journeys using `fixtures/learner-browser.ts`. It does
not silently change the browser engine of the other journeys.

The native media/design journeys block every HTTP(S) request before offline
reload, so they cannot accidentally use the runner's random local port. They
still use the real Desktop resource protocol, saved package, renderer and
audience window; only the operating system file picker is replaced.

## Local capacity check

After building the shared SDK and application assets, run:

```bash
bun run verify:capacity
```

This uses the same disposable Worker setup, with 500 real SDK participants,
500 simultaneous participant WebSockets, and host/stage monitors. It checks two
500-answer rounds, hidden and live results, 100 duplicate retries, privacy before
reveal, 50 WebSocket reconnects, 50 polling clients, and session end. It refuses
hosted targets and uses no billing, model or production credentials.
Connection counts come from the real client sockets, independently of document
revisions. The host's joined count continues to represent distinct participants.

The check fails for lost or duplicated answers, incomplete state convergence,
unexpected HTTP failures, socket close handshakes that do not finish within five
seconds, or local ballot p95 at or above 500 ms / host aggregate
receipt p95 at or above one second. Timing includes the local client and HTTP
transport; it does **not** establish production server latency or
browser rendering performance. Run it without other builds or test workloads.

Capacity runs additionally wrap the Worker entry point to report local handler
duration through `Server-Timing`. It includes authentication, body parsing and
awaited Durable Object work. These diagnostic measurements do not replace the
round-trip assertions. The wrapper is not used by browser verification or
deployment. Local timer behavior follows the [Workers performance documentation](https://developers.cloudflare.com/workers/runtime-apis/performance/).

The runner uses Wrangler's configuration adapter with the matching locked
Miniflare version. Update both together when changing the development runtime;
verify binding persistence and the complete browser journeys after an update.

Evidence is written to `e2e/verification-output/capacity/`: `metrics.json` contains
the correctness checks and latency distributions, `run.json` the overall result,
and `worker.log` local runtime diagnostics. A runtime interruption fails the run;
it is not treated as a capacity pass.

## Recovery drill

`bun run verify:recovery` captures synthetic D1/R2 data, restores it into a separate
empty local installation, and checks exact table contents, retained media, expired
audio handling, credential invalidation and authenticated application reads. It
uses the actual bundled Worker and no provider/production credentials. The result
is `e2e/verification-output/recovery/run.json`; private temporary data is removed
on completion. See [the recovery runbook](RECOVERY.md) for the schema-first import
requirement and remaining hosted backup/privacy/billing work.

## CI

`.github/workflows/verify.yml` runs automatically on pull requests and pushes to
`main`, and also supports manual runs. It uses read-only repository permissions,
locked dependencies and no deployment/provider secrets in the verification job.
Superseded pull-request runs cancel; main runs finish without interrupting a deployment.
It runs the same repository, recovery and isolated browser commands above, plus the
manual browser checks, and keeps browser evidence and local Worker diagnostics for
seven days, including on failure.

After verification succeeds on `main`, a separate production job restores the
verified build artifact, applies D1 migrations, deploys the Worker and its assets,
and compares public production responses with the build. Pull requests run checks
only. See [DEPLOYMENT.md](DEPLOYMENT.md) for credentials, activation, release
behaviour, and recovery. A hosted workflow execution is separate evidence from a local run.
Mac/Windows signing, notarization, installers, upgrades, native Office acceptance
and hosted backup/restore are not yet covered by these checks.

Workflow syntax follows the official [GitHub Actions documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
Bun setup follows [setup-bun](https://github.com/oven-sh/setup-bun), with Node setup
and retained evidence using [setup-node](https://github.com/actions/setup-node) and
[upload-artifact](https://github.com/actions/upload-artifact).
