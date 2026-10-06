# DNS for AI Discovery (DNS-AID)

OpenRoom publishes agent endpoints under the `_agents` namespace on **openroom.app**
so scanners and agents can discover A2A and MCP via DNS (DoH), per
[draft-mozleywilliams-dnsop-dnsaid](https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/)
and the [isitagentready `dnsAid` skill](https://isitagentready.com/.well-known/agent-skills/dns-aid/SKILL.md).

## Records (zone: `openroom.app`)

| Owner name | Type | Priority | Target | SvcParams / content |
| --- | --- | --- | --- | --- |
| `_a2a._agents.openroom.app` | SVCB | 1 | `openroom.app.` | `alpn="a2a,h2,h3" port=443 mandatory=alpn,port key65001="cap=https://openroom.app/.well-known/agent-card.json"` |
| `_mcp._agents.openroom.app` | SVCB | 1 | `openroom.app.` | `alpn="mcp,h2,h3" port=443 mandatory=alpn,port key65001="cap=https://openroom.app/.well-known/mcp/server-card.json"` |
| `_index._agents.openroom.app` | SVCB | 1 | `openroom.app.` | `alpn="h2,h3" port=443 mandatory=alpn,port key65001="cap=https://openroom.app/.well-known/agent-skills/index.json"` |
| `_index._agents.openroom.app` | TXT | — | — | `agents=openroom:a2a,openroom:mcp` |

Presentation form (bind-style):

```dns
_a2a._agents.openroom.app.   3600 IN SVCB 1 openroom.app. (
  alpn="a2a,h2,h3" port=443 mandatory=alpn,port
  key65001="cap=https://openroom.app/.well-known/agent-card.json" )

_mcp._agents.openroom.app.   3600 IN SVCB 1 openroom.app. (
  alpn="mcp,h2,h3" port=443 mandatory=alpn,port
  key65001="cap=https://openroom.app/.well-known/mcp/server-card.json" )

_index._agents.openroom.app. 3600 IN SVCB 1 openroom.app. (
  alpn="h2,h3" port=443 mandatory=alpn,port
  key65001="cap=https://openroom.app/.well-known/agent-skills/index.json" )

_index._agents.openroom.app. 3600 IN TXT "agents=openroom:a2a,openroom:mcp"
```

Notes:

- **ServiceMode** uses priority `1` (not `0` / AliasMode).
- **`key65001`** is an experimental SvcParamKey for a capability locator (`cap=…`) until IANA registers named keys (draft §4.4.3). Clients that require it must list it under `mandatory`.
- Endpoints themselves stay on the Worker apex (`/api/a2a`, `/api/mcp`); DNS only advertises how to connect and where the cards live.
- Records are **DNS-only** (not orange-cloud proxied). Underscore names are not proxied hosts.

## DNSSEC

Public DNS-AID zones SHOULD be signed. On Cloudflare:

1. Dashboard → **DNS** → **Settings** → **DNSSEC** → Enable, **or** run the publish script with `--dnssec`.
2. If the domain is **not** on Cloudflare Registrar, add the **DS** record Cloudflare shows at your registrar so the chain of trust completes.
3. Validate: `dig +dnssec SVCB _a2a._agents.openroom.app` (look for `ad` flag / RRSIG).

## Publish / update

Requires a Cloudflare API token with **Zone → DNS → Edit** (and **Zone → DNSSEC → Edit** if enabling DNSSEC).

```bash
export CLOUDFLARE_API_TOKEN=…   # DNS Edit on openroom.app
export CLOUDFLARE_ZONE_ID=db3c373702a33f816e1bfd5bf4caec4e   # optional; script can resolve by name
bun apps/worker/scripts/publish-dns-aid.mjs
# optional:
bun apps/worker/scripts/publish-dns-aid.mjs --dnssec
bun apps/worker/scripts/publish-dns-aid.mjs --dry-run
```

Dashboard alternative: **DNS → Records → Add record** → type SVCB / TXT with the values above.

## Validate

DoH:

```bash
curl -sS 'https://cloudflare-dns.com/dns-query?name=_a2a._agents.openroom.app&type=SVCB&do=1' \
  -H 'accept: application/dns-json' | jq .
```

Agent readiness:

```bash
curl -sS -X POST 'https://isitagentready.com/api/scan' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://openroom.app/","enabledChecks":["dnsAid"]}' \
  | jq '.checks.discoverability.dnsAid'
```

Expect `"status": "pass"`.
