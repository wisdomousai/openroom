# Self-hosting

OpenRoom runs entirely on Cloudflare: [Workers](https://developers.cloudflare.com/workers/),
[Durable Objects](https://developers.cloudflare.com/durable-objects/),
[D1](https://developers.cloudflare.com/d1/) and [R2](https://developers.cloudflare.com/r2/).
There are two ways to host it.

## Relay only: live sessions, no accounts

The relay (`apps/relay`) is a complete live system on Workers and Durable Objects
alone, with no D1, no R2 and no sign-in. Whoever holds `RELAY_KEY` creates sessions.
Participants join anonymously or with a pseudonymous handle on the relay's own join
page, and the stage runs there too. Identified and roster sessions need the full
deployment.

```sh
bun run build
cd apps/relay
# give it a public address: "workers_dev": true or a route in wrangler.jsonc
wrangler secret put TOKEN_SECRET
wrangler secret put RELAY_KEY
bun run deploy
```

Create a session with `POST /api/sessions` and `Authorization: Bearer <RELAY_KEY>`
(`docs/CONTRACTS.md`, "Relay API"), or point OpenRoom Desktop at the relay under
Settings → **Live server** (address and key). Signed out, Desktop then starts live
sessions on that relay.

## Full: workspace, library and live sessions

Point the `routes` and the D1 `database_id` in `apps/workspace-worker/wrangler.jsonc`
at your own account, then from the repository root:

```sh
wrangler login
bun run deploy
```

`bun run deploy` rebuilds everything, deploys the relay, then deploys the control
plane, which binds the relay's `SessionDO` by script name and forwards `/join/`,
`/stage/` and the `join.` host to it.

| Secret | Worker | Purpose |
| --- | --- | --- |
| `TOKEN_SECRET` | both, same value | capability signing |
| `ADMIN_KEY` | control plane | operator key |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | control plane | optional Google sign-in |

Set each with `wrangler secret put <NAME>`. The relay needs no `RELAY_KEY` here,
because the control plane creates sessions. Never set `DEMO_AUTH` in production.

A deployment without Paddle billing configured has every feature unlocked. Billing
setup is in `docs/BILLING.md`, and CI deployment in `docs/DEPLOYMENT.md`.
