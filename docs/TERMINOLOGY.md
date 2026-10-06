# OpenRoom terminology

Canonical product language for UI copy, docs, agents, and review.
**UI labels and host hash routes** may differ from **API/DB identifiers**; both are listed.
When they conflict in user-facing text, prefer the **UI** column.

Related: `AGENTS.md` (invariants), `docs/TUTORING.md` (prepared delivery),
`docs/CONTRACTS.md` (HTTP paths), `docs/AGENT.md` (agent happy path).

---

## Two product nouns

There are exactly two product nouns. Everything else in the workspace is a
place, a link, or a piece of live state.

| Noun | What it is | Mental model |
| --- | --- | --- |
| **Deck** | The authored, reusable file: prepared content and structure, versioned. | A file, the way a `.pptx` is a file. You keep it, open it, edit it, duplicate it, move it to trash. |
| **Session** | One **started** instance of a deck: the live synchronized thing while it runs, and the durable row it leaves behind. | The hour you teach. It is started, never booked. |

> A deck is filed in a folder. A session is started from a deck.
> **Library** opens the current workspace and retains Live now, invitations, and Notes.

**Session covers both planes.** The durable row (`/api/sessions*`, filed, has an
id) and the ephemeral live plane (`/api/sessions/:code/*`, has a session code,
purged on a short TTL) are the same product noun. Say **live session** only when
you need to point at the ephemeral plane specifically; never invent a second
noun for it.

### Saved results

**Saved results** is a retained file produced when a session ends under the
owner's paid access. Open it from its deck, read captured answers, or download a
report. It is not a new workspace collection or session-management surface.
The storage/API term is **archive**; the host document route is `#/results/:id`.

### Context — one word, everywhere

One word spans UI, API, MCP, CLI and DB: **context**.

- **User-facing:** **context** — the four-question + paragraph thing pinned to a
  person's folder. Headings name the *person*, not the type. The rail group is
  **Students**.
- **Domain/API/MCP/CLI/DB:** `context` / `contexts` / `contextId`.
- **Browser hashes:** `#/tutor/contexts*`.
- `Card` / `CardContent` from `components/ui/card` are the shadcn layout
  primitive and keep their names. Do not use them to mean a context.

A space holds **one** context. A context may be reused across spaces — the same
student taught two languages is two contexts, which is why the language pair
sits on the space and not on the context.

---

## The word “session”: product noun vs auth session

Only two meanings survive, and only the first is the product noun:

| Meaning | Where it lives | Write it as |
| --- | --- | --- |
| **The started instance** — what you start from a deck, control while it is live, end, and write Notes for | `/api/sessions*`, `/api/my/sessions`, `session.*` wire commands, `#/sessions/:code`, `#/sessions/:id/record` | **Session** (product noun). This is the canonical meaning. |
| **The auth session** — a signed-in host’s cookie | D1 `auth_sessions` table, `or_session` cookie | **Sign-in session** / **auth session**, and only in auth contexts. |

The published content-contract for what a deck *contains* is **Outline v1**
(`deck_versions.content_json`). That is not a product noun: the file is a
**deck**. `packages/schema/schema/session.schema.json` publishes the shared
interaction, defaults and Q&A `$defs` that Outline v1 `$ref`s; it is not a
standalone startable document.

---

## Workspace hierarchy

| Term | UI | API / storage | Role |
| --- | --- | --- | --- |
| **Space** | Space (sidebar links, location pickers) | `spaces` | Root of the workspace **and** the sharing boundary: owns folders, members and invites. A person has many spaces — some they own, some they were invited to. First library call bootstraps Personal. |
| **Folder** | Folder (space root holds unfiled items; no “Unfiled” destination) | `folders` | Nesting and naming in a space tree (Explorer browser). Same tree for all item types. A persistent tree rail is allowed and the URL still owns location (`?folderId=`); inline create/rename on the browser is allowed. See `AGENTS.md`. |
| **Item** | Typed row in a folder | deck / session / session record | Something stored under a folder (or unfiled). |

Path for humans: **Space → Folder → deck → (optional) session**.

Membership roles on a space are **`owner` | `editor` | `presenter`**. There is no level
between space and folder: a space *is* the shared or personal work area.

**Meaning links (required for new work):** Context (who) → Deck (what) →
**Session** (when). A deck also requires a Context.
Free-floating creates (no context / no deck where required) are not allowed.
Place (space/folder) and links are different: place files work; links give it
meaning.

Agents may start sessions from outline payloads but must still supply
required link ids when writing library objects.

---

## Library objects (durable, reusable)

These are **filed work**, not peer nav apps. Only decks appear as folder rows.

| UI term | API / code | What it is | Not |
| --- | --- | --- | --- |
| **Deck** | deck (`/api/decks*`, D1 `decks` / `deck_versions`) | The file: reusable prepared content + structure (versioned). Browser: `#/decks/:id`. Verbs: New deck · Edit deck · Duplicate · Move to trash · Start session. | Not an “outline” as the entity name. Not a session. |
| **Context** | presentation context (`/api/tutoring/contexts*`) | Who it is for. Four light questions and a paragraph, nothing required. Shown with that student's decks. One per space. Original school docs stay in the external agent. | Not a folder; not a participant account; not a CRM form; not a nav shelf. |
| **Outline** | outline (`deck_versions.content_json`, Outline v1) | The file contents of a deck: steps + interactions. What a live session runs. | Not a third product noun; it is what is *in* the deck. |

### Access link ↔ learner view

| UI term | API / code | What it is | Not |
| --- | --- | --- | --- |
| **Access link** (full: **context access link**) | `orlnk_…` bearer; D1 `context_access_links`; `/api/tutoring/contexts/:id/links*` | A revocable capability the tutor mints for **one** context and hands to that student or family. Shown once at mint; default 180 days; max 10 live per context; revoked, never hard-deleted. | **Not an account** — no user row, no sign-in, no space membership, no email. Not a personal API token (`orpat_…`, tutor-side). Not a session join code. |
| **Learner view** | `/api/learner/*` (`me`, `sessions`) | The student-facing read surface an access link unlocks: their own sessions and curated session records. | Not the host console, not a second workspace, and not a place anything is written. |

| **Roster invite** | `orinv_…` bearer; D1 `roster_seats`; mint on the session | A one-session named seat the host typed. Shown once; redeemed into that session as that display name. The job is a roll (club vote, board, training attendance). | **Not** a context access link. **Not** a space invite. No context, no learner page, no account. |

Write **access link** in UI copy; say **context access link** in docs and code review where
the scope matters. Do not call it a "student account", "student login", "invite", or
"share link" — an invite grants space membership to a colleague, which this deliberately
never does. Say the tutor **issues** or **revokes** a link, not "adds a student".
A **roster invite** is the only invite that names a person in a session; say **roster**
in UI, never "access link" and never "context."

**Credential boundary.** A live session with no durable session row has no
context. Live join codes and `session_codes` are never exposed through learner
responses.

Say **learner** (not "student account", not "participant") for the person reading through
a link: a participant is someone in a live session, a learner is someone reading their own
records.

---

## Sessions and live state

| UI term | API / code | What it is | Primary surfaces |
| --- | --- | --- | --- |
| **Session** | session (`/api/sessions*`) | One **deck that was started**: who (context), which deck version, the live plane, the Notes written afterwards. | Nested under deck / context / space folder; `#/sessions/:code`, `#/sessions/:id/record`. |
| **Live session** | the ephemeral plane (Durable Object + `/api/sessions/:code/*`) | Ephemeral synchronized live state: host, stage, participants, ballots. Lifecycle is driven by the `session.*` commands. Purged on a short TTL. | Host console, remote, stage, participant join. Home **Continue**. |
| **Notes** | session record | Compact post-session outcomes (not a transcript). UI word is **Notes**; API/DB word stays `record`. | `#/sessions/:id/record`; a typed row in the session’s folder. |

### A session is browsable, but not a library peer

- A session is an **occurrence**, not a reusable library object. It is still **findable in a place**.
- A session is **not** a folder row. Notes appear as a quiet group on the person's folder (titles only, no dates), on Home's timeless write-Notes prompt, and on learner links. Type-filter chips are deleted.
- Sessions and Notes get **no collection route** and no nav item: there is no “all sessions” shelf.
- **Create path: a session is started, not scheduled.** It comes into existence from the deck editor's **Start session** or a library row’s **Start session** — there is no create form and no free-floating “New session” anywhere. Notes are written from the session (`#/sessions/:id/record`).
- **There is no scheduling and no approvals.** Sessions carry no `startsAt`/`endsAt` and no `scheduled` status — not in the workspace, not in the API. Nothing is booked and nothing waits on an approver.
- Cross-cutting history (recent, recover live) belongs on **Home**; a session’s own history belongs on **its deck’s page**. The folder row is a way to find a session in the place it was filed, not a second history.
- Keep dedicated **instance** routes (detail / record) for deep links and agents.
- `updateSession({folderId})` stays in the API for agents — and a session it files is reachable by place navigation as well as from its deck, Home, its context, or Trash.

**No ledger.** Teacher UI never shows timestamps, taught-counts, status or
version stamps outside the History tab, admin tables, and live counts.

---

## Content contracts (files / schemas)

| Term | What | Notes |
| --- | --- | --- |
| **Deck** | The library file (`decks` / `deck_versions`) | Product noun. Open · edit · start · duplicate · trash. |
| **Outline** / **Outline v1** | JSON stored as a deck version (`outline.schema.json`) | The *contents* of a deck. Layout is automatic; no authored CSS or coordinates. A live session runs this document. |
| **SimpleSession** | title + questions dialect | Agent shorthand; compiles to an Outline of interaction steps, then lives on a deck. Not a second file type. |
| **Session** | Started instance of a deck | Not a file format. `/api/sessions*`, live DO, Notes afterwards. |
| **Edit deck** (code: `DeckEditor`) | Structured authoring surface | Where a deck is written. Route: `#/decks/:id/edit`. |

### Edit deck (the surface and the noun)

| | Word |
| --- | --- |
| **Teacher-facing surface** | **Deck editor** |
| **Teacher-facing verb** | **“Edit deck”** |
| **Code names** (code and comments) | `DeckEditor` (component), `DeckEditorPage` (routed page), `apps/host/src/pages/deck-edit/**` |
| **Route** | `#/decks/:id/edit` |
| **Domain / API / DB / MCP / CLI noun** | `deck` |

- Do **not** introduce **Prep**, *Outline Designer*, **Session Builder**, bare **Builder**, or **“Edit outline file”** for this surface — in copy or in code. `Prep` and `OutlineDesigner` are retired names; the verb *prepare* is unaffected.
- The deck editor is **three panes** — thumbnail rail · desk · task pane — and **full-bleed**: it owns the viewport instead of sitting inside the workspace shell. It is opened from a deck, never from nav, and it must **not** share the screen with the library.
- Its live-orange primary is **Start session**: stamp the version, file the session, launch it, land in the live console.

---

## Host surfaces (four clients)

| Surface | Audience |
| --- | --- |
| **Host** (`/host/`) | Host workspace: library, deck editor, live controls. |
| **Stage** | Projector / shared screen. Reached with `?session=CODE`. |
| **Participant** | Join by code; no account. An identified session additionally requires a context access link — still no account. |
| **Site** | Marketing, docs, agent discovery (`llms.txt`, OpenAPI). |

Phone **presenter remote** and **Q&A desk** are host-side tools for a live session, not separate products.

The **learner view** (`#/learn?token=orlnk_…`, backed by `/api/learner/*`) is a fifth
audience. It ships inside the host bundle but is **not** part of the workspace: no nav, no
library, nothing to sign in to. Call its reader a **learner** — not a participant (that is
someone in a live session) and not a user (there is no account).

---

## Routes

Host hash routes, in full. Unknown hashes land on Home.

| Route | Screen |
| --- | --- |
| `#/` | Home |
| `#/space[...]` | Space and folder browser |
| `#/decks/new` | New deck |
| `#/decks/:id` | Deck detail |
| `#/decks/:id/edit` | Deck editor |
| `#/sessions/:code` | Live host console (`/remote`, `/qna` beneath it) |
| `#/sessions/:id/record` | Notes |
| `#/tutor/contexts*` | Contexts (Students) |
| `#/tutor/trash` | Trash |
| `#/settings*` | Settings |
| `#/learn` | Learner view |

Deep link: `openroom://deck/open?deckId=`. Desktop handoff: `/desktop/open?deckId=`.
Stage and participant take `?session=CODE`; the join code param is `?code=`.

---

## Primary nav vs secondary

The rail — nothing that becomes browsable in a folder earns a nav item:

- **Library** `#/space` (also the landing page at `#/`)
- **Students** in Tutoring, **Classes** in Classroom — folder rows, one per context, with an Explorer-style item count. Training omits this section.
- *Shared* — a **section heading** over links to spaces you were invited to, **not a route**
- **Trash** `#/tutor/trash`
- **Settings**

People are folders. There is no **Contexts** / **People** peer nav item.

The space switcher groups all accessible spaces under **Tutoring**, **Classroom**,
and **Training**. An owner chooses the experience on **New space** (`#/space/new`)
or in **Space settings**. The saved choice changes navigation and starter decks;
it grants no access and does not change document content or available editing tools.

**No collection route exists for:**

- **Decks** — open the folder they are filed in
- **Sessions** and **Notes** — Library (Live now / write Notes) and the person's quiet Notes group. Not folder rows, not a shelf, not a route.
- The **deck editor** (opened from a deck, not a top-level list)

### Create and present

1. Open a workspace/folder in **Library** and choose **New deck**. The blank file opens in the deck editor with an editable title.
2. Optionally open a student shortcut before creating; that explicitly links the deck to the student. Standalone decks have no context.
3. **Present** shows the current content. **Start session** enables participation without changing the current slide/reveal position.
4. **Edit deck** returns to that slide. **Live now** in the Library reopens a running session; **Notes** stays linked to its session.

Students and classes are free. Paid plans add shared workspaces (`team`), saved results (`keep`), and the teaching loop (`continuity`, shown as **Homework and Notes**): Notes, homework, learner links, learner work and identified sessions, in Tutoring and Classroom alike. Member invitations create workspace membership; student access links only unlock one context's learner-visible records.


---

## Interaction and live vocabulary

| Term | Meaning |
| --- | --- |
| **Interaction** | One question/activity type: choice, scale, numeric, text, Q&A, ranking. |
| **Open / close / reveal** | Lifecycle of an interaction in a live session. |
| **Advance** | Move to the next pending interaction (classroom) or outline step (tutoring). |
| **Ballot** | One participant’s response; purged after the session ends. |
| **Session code** | The 8-character code a participant types to join. Also the live-plane path segment `/api/sessions/:code/*`. |
| **Handle** | The participant identity shown in a session (never a global account). In the default pseudonymous mode it is generated session-locally ("Amber Fox 4827"); in an identified session it is the context's `display_name`, authored by the tutor. Never typed by the participant in any mode. |
| **Identity mode** | Outline-level `anonymous` \| `pseudonymous` \| `identified`. Default `pseudonymous`. `identified` sessions are enterable only with a context access link for that session's context. |
| **Dictionary** | The full entry for a word in the language being taught: part of speech, headword properties (gender, verb class, auxiliary), and a forms table. Part-of-speech generic — verbs, nouns, adjectives, pronouns and prepositions all render through one tag-driven path. The tutor can project it onto the wall. |
| **Meaning** | The short translation of one word into the student's own language, attached under the word on the slide. Not "gloss": that is a lexicographer's word and told a tutor nothing. Not "translation" either, which is already taken by whole-sentence translation. |
| **Language pair** | A space's `{ taught, native }`, set at `#/space/:id/edit`. Closed to pairs the dictionary has a verified source for. Nothing else in the product carries a language. |

### Wire commands and errors

Commands on `POST /api/sessions/:code/commands`: `session.start`, `session.end`,
`session.freeze`, `session.unfreeze`, `session.advance`, `session.theme`,
`session.display`. The WebSocket notify literal is `session.changed`.

Errors: `deck-content-not-found`, `invalid-deck-content`, `session-not-found`.

### Copy

| Surface | String |
| --- | --- |
| End dialog title | End this session? |
| End dialog body | Participants are disconnected and results are final. |
| End dialog confirm | End session |
| Ended banner | Session ended |
| Ended banner (participant) | Session ended · You can close this page. |
| Ended console actions | Notes · Export CSV · Back to library |
| Join waiting | Waiting for the host to start. |

Facts only. Noun labels and bare verbs. No first-person, no narrative, no metaphor.

---

## Deletion

| Term | Meaning |
| --- | --- |
| **Trash** / **Move to trash** | Recoverable delete (normal path). |
| **Permanent delete** / **Purge** | Irreversible; requires short-lived **browser** confirmation. CLI/MCP/API token cannot complete the final purge alone. |

---

## Retired or avoid (user-facing)

| Avoid | Prefer |
| --- | --- |
| Gloss | **Meaning** (the short translation) or **Dictionary** (the full entry), whichever is meant |
| Project (as a level between space and folder) | **Space** (root + sharing boundary) or **Folder** (filing), whichever is meant |
| My projects | **My spaces** |
| Designs / Templates / Rooms (as product nav, label or noun for the file) | **Decks** |
| Contexts / People (as a nav shelf) | **Students** (the entity is a **context** in UI and API alike) |
| Prep / Outline Designer / Session Builder / Builder / “Edit outline file” | **Open** / **Edit deck**; in code, `DeckEditor` |
| Schedule / book / “Not scheduled yet” | **Start session** — a session is started, never booked |
| Run (as a noun for a started teaching) | **Session** |
| Run record | **Notes** (UI); `record` stays the API/DB word |
| Room (as an object you start, edit or end) | **Deck** (the file) or **Session** (the started instance) — “room” is only the brand **OpenRoom** and the `.openroom` extension |
| Collection + create form on one screen | Dedicated `#/decks/new` and `#/decks/:id` routes; the deck's sole editor is at `#/decks/:id/edit` |

---

## Agent and peer-client note

Browser, CLI, MCP, and direct API are **peer clients** of the same application
services, and they share one vocabulary: `deck` and `session` mean the same
thing on every surface.

- **CLI:** `openroom deck get|save|draft|versions|start`, `openroom session …`
- **MCP:** `deck_get`, `deck_preview`, `deck_save_version`, `deck_draft_put`,
  `deck_start`, `session_create`, `session_status`, `session_results`,
  `session_command`

Product copy says **agents**, never a vendor name. Do not invent a second domain
model for “template”, “design” or “room” in storage.
