# OpenRoom Agent Plugin

An Agent Plugins package and Codex / ChatGPT plugin for OpenRoom. Compatible clients get:

- **`mcp.json`** — the remote MCP server (Streamable HTTP, JSON responses)
  at `https://openroom.app/api/mcp`, with tools
  `outline_validate`, `session_create`, `session_status`,
  `session_results`, `openroom_api`, `deck_get`, `deck_preview`,
  `deck_save_version`, `deck_draft_put`, `deck_start`, `session_facilitate`, `session_recap`, `session_command`,
  and `picture_search`.
  `deck_preview` returns a read-only ChatGPT widget (`text/html+skybridge`);
  clients without UI support receive the validated preview data as ordinary JSON text. Auth is
  MCP-standard OAuth (discovery + dynamic client registration are served by
  the worker) or a personal API token as the bearer. Agents can also discover
  the endpoint via `https://openroom.app/.well-known/mcp/server-card.json`.
  Account billing and retained archives use the same owner-paid access and current
  membership checks as the browser; the server's tool descriptions carry their contract.
- **`skills/prepare-a-tutoring-outline/`** — keeps original school documents in
  this agent, produces a typed outline, saves it through the shared
  business API, and helps the tutor deliver it live.
- **`skills/run-a-session/`** — teaches the live classroom loop: author and
  validate an outline, create a session, control it, and read aggregate results.
- **`.codex-plugin/plugin.json` + `.mcp.json`** — a Codex- and ChatGPT-compatible
  manifest over the same remote MCP endpoint. OpenRoom does not bundle or proxy an LLM.

Point your client's plugin installer at this directory (or a published copy
of it). The directory layout follows the spec:

```
plugin/
├── .codex-plugin/plugin.json
├── .mcp.json
├── plugin.json
├── mcp.json
├── assets/
└── skills/
    ├── prepare-a-tutoring-outline/
    │   └── SKILL.md
    └── run-a-session/
        └── SKILL.md
```

ChatGPT: enable developer mode, then add `https://openroom.app/api/mcp` under
Settings → Connectors.

Self-hosters: replace the `url` in `mcp.json` with your deployment's origin;
everything else is deployment-independent.
