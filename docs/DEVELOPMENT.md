# Development

Requires [Bun](https://bun.sh) and Node 24. Everything runs locally on
[Wrangler](https://developers.cloudflare.com/workers/wrangler/), Cloudflare's Workers
CLI; no Cloudflare account is needed to develop.

```sh
bun install
bun run build       # all packages + apps (build:core, then build:workspace)
bun run build:core  # core only: packages, relay, stage, participant, office, Desktop
bun run test        # unit and integration tests (vitest)
bun run typecheck
```

## Run it

```sh
cp apps/workspace-worker/.dev.vars.example apps/workspace-worker/.dev.vars
cp apps/relay/.dev.vars.example apps/relay/.dev.vars   # same TOKEN_SECRET in both
bun dev             # https://openroom.localhost (port 8787 underneath)
bun desktop         # worker on your LAN IP:8787 + Desktop, so phones can join
```

Open `/host/`, then Settings, and sign in with a demo account (`alice`, `bob` or
`cara`, password `demo`). `DEMO_AUTH=1` in `.dev.vars` enables these; never set it in
production. Create a deck and press **Start session** for the stage and participant
URLs.

`bun dev` and `bun run dev:worker` start two `wrangler dev` processes
(`scripts/dev-workers.mjs`): the control plane on 8787 and the relay on 8790,
connected through Wrangler's local dev registry. Two processes are needed because a
single `wrangler dev -c … -c …` backs both Workers' static assets with one disk.

## Named URLs with portless

`bun dev` runs through [portless](https://portless.sh), which gives the dev worker a
stable HTTPS hostname. Install it once and trust its CA (both proxy steps need sudo):

```sh
npm install -g portless
portless trust
portless proxy start
```

- `https://openroom.localhost`: marketing, `/host/`, `/stage/`, `/api/`
- `https://join.openroom.localhost`: the participant app at `/`, through a static
  alias (`portless alias join.openroom 8787`). This is the only local way to exercise
  the `join.` hostname branch in `apps/relay/src/join-url.ts`.

In a linked git worktree the branch name is prepended, for example
`https://fix-ui.openroom.localhost`. `portless.json` pins the port to 8787, so
`http://localhost:8787`, `bun desktop` and the Playwright journeys work either way.
If a stale wrangler holds 8787 the new one falls back to 8788 and the named URL
returns 404; `portless prune` clears orphans.

Without portless:

```sh
bun run dev:worker   # both Workers through wrangler dev directly
PORTLESS=0 bun dev   # through the portless CLI, bypassing the proxy
bun run dev:relay    # the relay alone on :8790 (RELAY_KEY=dev-relay)
```

## Browser journeys

`docs/journeys/` holds the use-case contracts for the stage, host and participant
surfaces. With the worker running on 8787:

```sh
bun run test:e2e    # the journeys as Playwright specs
bun run verify      # build, typecheck and unit tests, as CI runs them
```

See `docs/journeys/README.md` for the document, test and iterate loop.
