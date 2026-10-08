# OpenRoom repository instructions

## Product model (decks · share · space)

OpenRoom is **not** a SaaS ops dashboard or teaching ERP. The product is three things:

| Pillar | What it is | What it is not |
| --- | --- | --- |
| **Deck** | What the teacher opens, edits, and starts. Stored as `.openroom` or as a deck in a cloud folder. Open · edit · start · duplicate · trash. | A booking, a scheduled thing, an ERP delivery row |
| **Share / invite** | A **space** is the sharing boundary — members and invites share one folder tree of decks | Per-item ACLs, project hierarchy, approval workflows |
| **Common tutoring space** | Folders of decks; start a session when you teach; optional short Notes after | Week stats, “next up” calendars, delivery-management shelves |

Infrastructure stores a durable session row (live instance + record linkage). **UI must not** turn sessions into a shelf teachers curate. Prefer **deck**, **folder**, **space**, **context**, **Notes**.

When adding a surface, ask: does this help open a deck, share a space, or teach from a common place? If it only helps “manage deliveries,” delete it.

## Product architecture

- Core and workspace. The **core** makes and presents: `packages/*`, `apps/relay`, `apps/stage`, `apps/participant`, `apps/office` and `apps/desktop` (MIT). The **workspace** organises and hosts: `apps/workspace` (library, spaces and folders, students and classes, Notes, learner page, billing, settings, sign-in, home) and `apps/workspace-worker` (the control plane), plus `apps/site` (AGPL-3.0-only; see `LICENSING.md`). Core code never imports from a workspace app — not by relative path, alias, or package name; `apps/desktop/src/core-boundary.test.ts` enforces this for Desktop. `bun run build:core` must succeed in a checkout with `apps/workspace` and `apps/workspace-worker` deleted, and must produce Desktop's core renderer (`apps/desktop/renderer/core/index.html`); CI checks both.
- Keep durable business records in D1. Use a Durable Object only for the live state and coordination of one session.
- Do not put D1, R2, queues, workflows, or model calls on the ballot hot path.
- Two Workers. `apps/relay` (`openroom-relay`) is the live plane: it owns `SessionDO`, the live session routes (state, commands, WebSocket, export, stage token, per-session assets), anonymous/pseudonymous join, and the stage and participant apps. It has no D1 or R2 and runs alone as a complete live system, where `RELAY_KEY` gates `POST /api/sessions`. `apps/workspace-worker` (`openroom`) is the control plane: accounts, spaces, decks, billing, MCP, and every hosted session creation. It binds `SessionDO` cross-script (`script_name: "openroom-relay"`), answers the live API itself through the shared `openroom-relay/live` module with its own authority (D1 rechecks, archives, identified and roster joins), and forwards `/join/`, `/stage/` and the `join.` host to the relay over the `RELAY` service binding. Live logic lives once, in `apps/relay/src`; the control plane never copies it. Deploy the relay first.
- Heavy outline preparation happens in the teacher's **own** agent, through one of two doors:
  an **external agent** (any MCP client, the CLI, or the public API), or the **OpenRoom
  Desktop "Prepare this deck" pane**, which executes the agent locally: the Claude harness
  (Agent SDK) on the teacher's own Anthropic API key, the Codex harness on the teacher's
  Codex (ChatGPT) sign-in, or the API-key host, which calls a provider the teacher holds a
  key for. Either way in a conversation-scoped workdir with a stdio MCP sidecar to the open
  file (see `docs/AGENT.md`). OpenRoom stores and delivers the resulting outline.
  Invariants a change must not break:
  - OpenRoom **never proxies or bills model tokens**. Claude runs on the teacher's own
    Anthropic API key (Max and Team plans include monthly API credits), ChatGPT on the
    teacher's Codex sign-in, the API-key host on the teacher's own provider keys; OpenRoom
    is not in the token-selling business. The Claude host never uses a claude.ai login.
    There is **no hosted or server-side agent execution** — every agent turn executes on
    the teacher's computer. A teacher's API key is stored in the OS keychain on that
    computer, is sent only to the provider it belongs to, and never reaches OpenRoom.
  - The **browser app has no agent surface**. Desktop is the only in-app agent chat.
  - OpenRoom never ingests the original school documents. The desktop pane reads them
    locally (workdir copies are deleted with the conversation) and does not upload them.
- Browser, CLI, MCP, and direct API are peer clients of the same application services. The only browser-only actions are interactive authentication and final confirmation of permanent deletion.
- Normal deletion is recoverable trash. Permanent deletion requires a short-lived browser confirmation and cannot be completed solely through CLI, MCP, or an API token.
- The deck editor, presenter and live console live in `packages/editor` (`@openroom/editor`). Two hosts mount it: `apps/workspace`, the workspace shell (router, query cache, API client, Library, settings), and Desktop's core renderer `apps/desktop/renderer-src` (the file and presentation windows). The editor reaches a host only through its port, `EditorServices` in `packages/editor/src/services.tsx`:
  - The editor never imports from `apps/`, and never uses `@tanstack/react-query` or `@tanstack/react-router`. Data reads arrive as host-supplied hooks; links and navigation arrive as `EditorDestination`s the host resolves to routes. `packages/editor/src/boundary.test.ts` enforces this.
  - Optional features (draft saves, learner work, brand kits, version history, language pair, live scratchpad, saved results) are `slots`; all but the scratchpad are workspace features. The scratchpad (`packages/editor/src/live/scratchpad.ts`) is core: this device's `localStorage` only, never sent over the WebSocket, never reaching the Worker or D1. An absent slot means its affordance is not rendered — never a disabled control or an error.
  - The host adapters are `CloudEditorServices` in `apps/workspace/src/editor-services.tsx` and `DesktopFileEditorServices` in `apps/desktop/renderer-src/editor-services.tsx`, each the one place its host meets the editor. Desktop's adapter carries only the scratchpad slot, and hands its notes to the Notes form only when the build ships the workspace bundle; it links to workspace pages (`/host/index.html#…`) only when the build ships the workspace bundle, and renders no link otherwise. `RelayLiveServices` (`apps/desktop/renderer-src/relay-live.tsx`) narrows it for a Desktop session on the teacher's relay (signed out, live server set): relay join/stage links, no saved record or results, `shareUrl` null. Shadcn primitives, `cn`, toasts, the theme provider and the host theme stylesheet (`@openroom/ui/theme.css`) live in `packages/ui`.
  - Server differences belong in an adapter, not in the editor. Desktop chooses the server at start (`apps/desktop/renderer-src/desktop-live.ts`: signed in → control plane, signed out with a live server → relay, otherwise Present only), and the main process routes a relay session's `/api/sessions/<code>/…` calls to its relay (`apps/desktop/src/relay.ts`).

## Credential boundary invariant

Five credential families coexist. **None is ever accepted where another belongs**, and no
credential is ever converted into another. Keep this true in code review:

| Credential | Proves | Unlocks |
| --- | --- | --- |
| `or_session` cookie (+ CSRF header on writes) | who the tutor is | the control plane only |
| Personal API token `orpat_…` | the same tutor, headless | the same control plane, minus final purge |
| Session capability token (`apps/relay/src/tokens.ts`) | a seat in one live session | exactly that session |
| **Context access link `orlnk_…`** | possession of one context's learner credential | exactly that context's learner-visible records |
| **Roster invite `orinv_…`** | this named seat on one session's roster | join **that one session** as that host-authored name |

A **context access link is not an account**. It resolves to a `VerifiedContextLink`
(link id, learner id, context id, display name) and *never* to a `SessionUser`, so it physically
cannot be handed to `requireControlUser`. Join forwards the display name and the
stable context-local learner id as a seat key — never the `orlnk_…` token — so two named people in one
group do not collapse into one participant. It creates no `users` row, grants no space
membership, carries no role, and is rejected on every `/api/tutoring/*` and `/api/my/*`
path. The blast radius of a leaked link is exactly one context.

A **roster invite is not a context access link**. It proves a named seat in **one
session**, not a context. The host types the names; the participant never types one.
Join forwards `{ displayName, seatKey }` — never the `orinv_…` token. It creates
no `users` row, grants no space membership, unlocks no learner records, and is
rejected on every `/api/tutoring/*`, `/api/learner/*`, and `/api/my/*` path. A
context link cannot enter a roster session; a roster token cannot enter an
identified session. Roster sessions may join from the lobby (a committee files in
before the host starts). Do not extend the tutoring start-gate to them. The
blast radius of a leaked invite is exactly one session.

`RELAY_KEY` is an operator key for one relay deployment, not a sixth family: it
creates sessions on that relay and nothing else. Host tokens a relay issues carry no
`userId`, and the relay refuses account-bound host tokens (`403 account-session`), so
a control-plane session never runs under relay rules. Desktop keeps the key in the OS
keychain and only the main process sends it.

Paid memory (archives, named ballot export, connectors) is a control-plane
entitlement, not a credential. Paddle-managed accounts read verified subscription
records and the current approved price catalog through `readEntitlements`; only
billing ingestion/reconciliation writes those records. `users.entitlements` is reserved for manual development grants to
accounts without a Paddle customer mapping. Neither proves who someone is.
Session collaboration already enabled at creation survives a billing downgrade;
current space membership and connection revocation are still checked on every
host request. New paid operations require current owner entitlements.

Rules that follow, and that a change must not quietly break:

- `/api/learner/*` is dispatched **before** the control plane, so no learner path can
  fall through to cookie or PAT auth; an unknown `/api/learner/*` path 404s there rather
  than continuing down the router.
- The learner context id comes from the verified credential — never from a path
  parameter, query string, or body field.
- Learner responses are built from an explicit **column allowlist**, not `SELECT *`
  minus deletions. Adding a column to `sessions` or `session_records` must not leak it.
  Never add `session_records.notes` (tutor-private) or `session_codes` (would turn a
  records credential into a live-session credential).
- Minting or revoking a link needs `editor` or above on the space. `presenter` starts
  sessions; it does not mint credentials.
- The learner page (`#/learn?token=…`) renders outside the workspace shell: no nav, no
  library, no sign-in affordance. Do not fold it into the signed-in host chrome, and do
  not add a "create an account" path to it.
- A live session proves its context only through its durable session row
  (`sessions.context_id`). A live session with no durable session row has no context, so
  no link may identify into it. Do not add a second, weaker association path.
- An **identified** session admits joins only while `status === 'live'`. The tutor pressing
  start is the gate, so a leaked link is useless against an unattended lobby. Do not
  extend that restriction to anonymous or pseudonymous sessions — they join from the lobby
  on purpose.
- A link whose context owner lacks `continuity` answers **exactly like a revoked link**
  (same `401`, same throttle charge), from inside `requireContextLink`. Never give
  learner routes a distinct paywall status.
- The learner throttle lives **in `requireContextLink`**, ahead of the credential lookup,
  so new learner routes are budgeted by construction and the `429` is not an oracle. Keep
  it there rather than in individual routes, keep it in front of the lookup, and keep the
  client key a salted hash — no raw IP column.

## A deck is a file (the PowerPoint principle)

A deck is a **file**, and the whole product follows from that. The verbs a file
has are: **open · edit · start · duplicate · trash**. Nothing else.

OpenRoom is **not in the business of scheduling, planning, setting constraints,
locking people out, or approving**. Do not add — or redraw, or relocate — a
booking form, a calendar surface, a capacity/constraint editor, a lock, or an
approval step. Such affordances are **removed, not reshaped**.

- **A session is started, never scheduled.** Sessions come into existence by being
  started: the deck editor's **Start session**, or a library row's **Start
  session**. There is no “Schedule a session” screen, route, menu item, or empty-state
  prompt — and no scheduling fields anywhere, API included. Sessions carry no
  `startsAt`/`endsAt` and no `scheduled` status.
- Factual status words (`draft`, `live`, `completed`) may exist in storage. They
  are not row, tile, or inspector data. The banned thing is the **verb** and
  the **ledger**.

## The No-Ledger Rule

Teacher-facing UI never renders: a timestamp or relative time ("changed 3h ago",
"taught yesterday"), a usage tally ("Times taught", session counts), a delivery
status word as row/tile data (`draft` / `scheduled` / `completed`), or a version
stamp — anywhere outside three sanctioned homes:

1. The **History tab** of the deck editor's task pane (version list with dates).
2. The two **admin tables** (Settings API tokens, Space members) and the
   context-link lifecycle card (credential expiry is security, not delivery).
3. A **live session's own live counts** (joined / answered / votes / countdown).

A row states what is *in* the file (`6 slides · 2 ask the class · homework`).
Sorting by recency silently is fine; exposing the sort as visible metadata is
not. `Live now` in the Library (an ongoing session you can rejoin) is a state of *now*,
not history — allowed with its word.

Writing Notes after a session is still a teaching act. The prompt is timeless
(`Write the notes for {person}'s session`). Do not render when the deck was
taught, how often, or a delivery status next to that prompt.

## CRUD interaction invariant

Never put a collection and its create or edit form on the same screen.

- Collection routes show collections only.
- Creation uses a dedicated `/new` route.
- Detail uses a dedicated `/:id` route.
- Typed record editing uses a dedicated `/:id/edit` route.
- A deck has no second metadata editor: the full-bleed **deck editor** is its edit surface, at the
  dedicated `#/decks/:id/edit` route.
- Do not use an always-visible create form, a CRUD drawer, a CRUD modal over a visible collection, or an embedded empty-state form.
- Two shipped surfaces are **three-pane on purpose**, and the older blanket bans on “inline row editing” and “a split collection/inspector” do **not** apply to them:
  - **Deck editor** (`#/decks/:id/edit`): thumbnail rail · desk · task pane. All three edit one outline, so they belong on one screen.
  - **The Library** (`#/space/:id`): folder tree rail · item list · **permanent** inspector. The inspector is always present (not a drawer that opens on demand), and it carries the two identity edits — rename, move — inline, committing immediately. See “Entity panel, not record inspector”. Tags are gone.

  Outside those two, the bans stand: no field-dump drawer beside a collection, no inline editing of typed fields on a list row.

### Exception: folder chrome on the Explorer browser

**Folders are file-system navigation chrome**, not a typed library product surface.

- On the space browser (`#/space/:id` / `?folderId=`) and the deck browser when a space is selected, **inline folder create and rename are allowed** (New folder row, F2 / slow-click rename).
- Typed library items still use their dedicated create and authoring routes. A
  **deck** is authored only in the deck editor (`#/decks/:id/edit`), while record
  types that genuinely have metadata forms use their own `/:id/edit`. Do not
  inline-create or inline-edit them on the browser list. The bounded identity
  edits below (rename / move) are the only exception, and they live in
  the entity panel.
- A **persistent folder tree rail is allowed** on the space browser (`#/space/:id`). It is navigation chrome, the same as the Explorer tree it is named after. Two things the old “prefer navigation” wording was protecting still hold:
  - **The URL owns location.** Clicking a tree row navigates: `?folderId=` updates, the list shows that folder’s children, and reload / Back / a pasted link land in the same place. The rail reflects the URL; it never holds a location the URL does not.
  - **No “Unfiled” monoscreen.** The space root holds unfiled items. Do not add a separate “Unfiled” destination, rail entry, or pseudo-folder.

## Place + link interaction (not entity tables)

**Space stays** as the filing container — it is the root of the workspace and the sharing boundary (members and invites live on the space). What must not return is **DB-admin UX**: “All X” tables, space/folder foreign-key pickers on forms, or free-floating **New X** with no parent.

### Place-first

- Default library work happens **inside a space** (and folder): open place → see contents → create here.
- Location on create/edit is **inherited** from the route or parent object. Show a read-only “Saving in: Space › Folder” breadcrumb — **never** a flat parent/folder `<select>`.
- Move items by drag (or browser actions), not by editing location fields on detail forms.

### Standalone decks and optional students

- **New deck** creates a blank file and opens its editor immediately. No metadata form or student gate.
- Cloud location is inherited from the current space/folder. An explicitly selected student supplies `contextId`; otherwise it stays null. Never choose the first student or generate a compatibility context.
- A session inherits its deck and optional context. Student-specific identity and learner records require a real context; presenting and participating do not.
- **Present** opens the presenter without participants. **Start session** enables participation in that view, preserving slide and reveal position. Live state remains authoritative in the session Durable Object.
- There is no global `isTutoring` product mode. Document tools depend on document content, participation on live session state, identity on the verified credential, and collaboration on space membership plus the owner entitlement. Do not infer layout or annotation tools from a linked student.
- Contexts (students and classes, every kind) are free. The teaching loop — Notes (including the next-time sticky and homework published on the record), context people and access links, learner work, practice and feedback, identified sessions and the learner plane — is the space owner's paid `continuity` capability (`403 continuity-required`) in every workspace experience; shared workspaces and invitations use the owner `team` entitlement, retained results the `keep` entitlement. Live sessions, decks and the results recap stay free; a live session admits 50 participants unless the owner holds `largeSessions` at start (`409 session-full` for the next new participant, re-entry always admitted). Invitees do not need their own licence. Deletion, restore and link revocation are never gated, and a deployment without billing (`PADDLE_ENVIRONMENT` unset) holds every capability. Student context links remain separate credentials, with no account or workspace membership.
- **Notes** belong to a session and stay reachable from the Library. A session is started from a deck, never scheduled or filed as a library item.

### Entity panel, not record inspector

The ban on a “CRUD drawer” beside a collection targets the **record inspector**: a row expanding into a field dump you edit and save. It does **not** ban an **entity panel**, which presents one thing and routes you onward.

| | Record inspector — forbidden | Entity panel — required shape |
| --- | --- | --- |
| Content | every column as an editable field | what it is, its state, what to do next |
| Verbs | Save / Cancel | Open · Start session |
| Answers | “what are this record’s values?” | “I found it — now what?” |

The review test is **not** “is there a panel?” and no longer “does it contain a form field?” — it is
**“does the panel enumerate the record’s columns as inputs?”** Two identity affordances are not a
field dump; the moment a third typed field appears, it is. Rules:

- **No field dump and no Save.** The panel may carry exactly two **identity** edits, each already
  folder chrome elsewhere in the app, each committing immediately — there is no Save button:
  - **Rename** — click the title to edit it in place. Commit on `Enter` **and on blur**;
    cancel on `Escape`. (There is no pencil button, and blur does not abandon the edit —
    a file manager commits what you typed when you click away.)
  - **Move** — a filterable tree picker (the same hierarchy as the rail) plus drag-and-drop.

  Tags are deleted. Everything else routes to the entity's authoring surface. For a deck that is
  always the deck editor — never a parallel metadata form. Context link, description,
  versioning, and **any typed field of the record** stay out of the panel. This list is closed. Adding a third is a
  rule change, not a judgement call.
- **Move is not a location field.** It is the drag gesture given a keyboard-reachable form. Location
  on create/edit stays **inherited** and read-only (“Saving in: Space › Folder”); a flat
  parent/folder `<select>` is still forbidden.
- **One primary action**, phrased as the file’s verb. For a written deck the primary is **Open** and **Start session** sits beside it; for an unwritten one (v0) **Open** (into the deck editor) is still primary. Other secondaries (Duplicate · Move to trash) are visually demoted.
- **Trash lives in the inspector.** There is no multi-select band and no bulk trash.
- **One component, two frames.** `ItemDetailPanel` renders beside `LibraryList` (`variant="panel"`) *and* full-page at the item’s own route (`variant="page"`). Do not write a second detail implementation.
- **Selection is the panel.** One fact, mirrored into the URL (`?itemId=`) so it survives reload and Back. Do not track a separate `selectedId`.
- Row actions are a **right-click context menu** (the Explorer convention), with `Shift+F10` for keyboard parity. There is no visible `⋯` column in the folder browser; every action stays reachable from the panel, so the context menu is never the only path. `RowActions` remains for the genuine admin tables (`SpaceMemberPages`, `SettingsPage`).

## Naming

Canonical vocabulary (UI vs API, library vs instance vs live session, nav intent):
**[`docs/TERMINOLOGY.md`](docs/TERMINOLOGY.md)**. Prefer that file over ad-hoc synonyms.

Short rules that still apply in review:

- The structured authoring surface is the **deck editor**, and the teacher-facing verb is **“Open”** (into the editor) or **“Edit deck”** where a verb is still needed. Code says the same thing: the component is `DeckEditor`, the routed page is `DeckEditorPage`, and the implementation folder is `packages/editor/src/deck-edit/**`. `Prep` and *Outline Designer* (`OutlineDesigner`) are **retired** — do not reintroduce them in code, comments, or copy, and do not introduce user-facing Session Builder, Builder, or “Edit outline file”. (The verb *prepare* is unaffected.) The route is `#/decks/:id/edit`, and the domain / API / DB / MCP / CLI noun is `deck`.
- **The deck editor owns the viewport.** `#/decks/:id/edit` hangs off the router root, not the workspace shell: no sidebar, no max-width, no page padding — the same arrangement the live console uses. This is a deliberate exception, not drift. Editing is **not** a nav item: it is reached from a deck.
- Workspace chrome follows the space's explicit `experience`: **Tutoring** uses Library · Students · Shared · Trash · Settings; **Classroom** uses Classes in place of Students; **Training** has no student/class section. The space switcher reaches every owned or invited space, grouped by experience. This choice affects navigation and starters only, never document tools, credentials, membership, or entitlements. Students and classes are explicit context shortcuts; Shared lists invited spaces. The Library retains URL-owned folder location and selection, immediate folder children, and search results with their location. Use direct product labels, never first-person narrator copy.
- **“Card” is retired: the word is `context` in UI and in the domain alike.** A context is four light questions and a paragraph, pinned to that person's folder — not a CRM form and not a nav shelf. A space holds one context; a context may be reused across spaces. `Card`/`CardContent` from `@openroom/ui` stay the shadcn layout primitive and never mean a context.
- **Decks and sessions have no collection route**: decks live in folders; a live session is only ever **Live now** in the Library. `routing.ts` must not be able to *emit* a link to a deleted collection, and an unknown hash lands on the Library rather than 404ing.
- The noun is `deck` in UI, domain, API, DB, MCP and CLI alike; browser hashes are `#/decks/new`, `#/decks/:id`, and `#/decks/:id/edit`.
- A **session** is an **occurrence**, not a nav peer and not a folder row. There is still **no collection route** for decks, sessions, or Notes (`#/sessions` is not a screen), and **a session exists only because a deck was started** — there is no “New session” and no “Schedule session” form, route, or hash. Notes remain reachable from the Library's timeless write-notes prompt, from a quiet Notes group on the person's folder, and from learner links. Instance routes stay for CRUD, deep links, and agents; `PATCH /api/sessions/{id}` (title, context, folder) remains for agents. Type-filter chips (Decks / Sessions / Notes / …) are deleted.

## Agent-facing surface (one source per fact)

The MCP tool descriptions and `SERVER_INSTRUCTIONS` in `packages/mcp/src/` are
the source of truth for the agent-facing surface: tool names, argument shapes,
error semantics, and the outline contract. They sit next to the code they
describe and ship with the server, so a client reaching `/api/mcp` with no
plugin installed gets them and nothing else.

- **Skills carry only what the server cannot know**: pedagogy, the privacy
  boundary, tutor-in-control. A `SKILL.md` must not restate the API surface.
  No `/api/...` route literal belongs in one, with the single exception of
  token creation, which precedes any tool call.
- **Never document a tool in two places.** If a fact about the surface is
  missing, add it to the tool description — not to a skill, and not to a doc.
- A tool changed in `packages/mcp/src/tools.ts` propagates to
  `server-card.ts` on its own. These name tools by hand and must be updated
  with it: `docs/AGENT.md`, `docs/CONTRACTS.md`, `docs/PRD.md` (API-08),
  `plugin/README.md`, and `packages/editor/src/deck-edit/agent-commands.ts`
  (`MCP_TOOLS`, the save-path subset rendered in the deck editor).

This rule exists because the same list rotted twice: the `deck_*` tools
landed the day after the skills were written and updated five docs but no
skill, leaving every skill teaching raw REST for a year. A `SKILL.md` that
restates the contract will drift from it — the only reliable fix is not to
write the second copy.

## Testing

This is not a coverage or TDD shop. Only keep tests that would catch a real
product regression. Prefer fewer sharp tests over many weak ones.

**Do not write or leave behind:**

- Prop/children echo checks (`render(<X>Foo</X>)` → `toContain('Foo')`).
- Source-scan / `?raw` tests that only prove a string, import, or UI widget was
  removed after a cleanup (`not.toContain('admin key')`, `not.toContain('<form')`
  on `.tsx` source, and similar). That is change residue, not a contract.
- Tests whose only job is to lock the absence of old copy, old routes, or old
  helpers after a refactor.

**Do write:**

- Domain math, reveal/privacy security, routing parse/href contracts, schema
  validation, and HTTP/WS behaviour in vitest.
- Derived UI behaviour when it matters (computed percentages, timers, ranking
  scores, selected/disabled state, chart mode markers).
- Playwright journeys for browser visibility and visual grammar
  (`docs/journeys/`).
- Deck-editor structured writes: a new button that changes the outline must go
  through `outline-edit.ts` and be classified in `outline-fuzz.ts` (walked
  write or explicit read). `outline-fuzz.test.ts` is the integration layer —
  object + YAML round-trip, same as `DeckEditor.apply`. UC-08 does not grow
  a combination matrix.

When you remove a feature, delete its tests. Do not replace them with
“assert the old thing is gone.” Architectural rules belong in `AGENTS.md` /
review, not in string greps over source.
