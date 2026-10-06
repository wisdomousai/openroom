# Prepared delivery (contexts, decks, sessions)

Canonical names (UI vs API, library vs instance): **[`docs/TERMINOLOGY.md`](TERMINOLOGY.md)**.

OpenRoom organizes work in **folders** (the folder tree inside a space). What you put in a folder
is a **typed item** with type-specific metadata — not separate apps for
“decks” vs “events.”

| Primitive | Role |
| --- | --- |
| **Folder** | How you nest and name work (same tree for everyone). |
| **Context** | Who it is for (person, group, class, event). |
| **Deck** | The reusable file: content and structure, versioned. One noun everywhere — UI, API, DB, CLI, MCP. Not called an “outline.” |
| **Session** | One teaching of a deck **that was started**: who, the live plane, the Notes. Not a primary library nav peer — see terminology doc. |
| **Access link** | A revocable capability the tutor mints on a context so that student can read their own sessions and records. Not an account. |

Codex, Claude Desktop, or another MCP client can prepare content and create
decks/sessions through the same API as the browser. OpenRoom does not upload
original school documents or wrap a general-purpose model.

## Continuity capability

On a billed deployment (openroom.app) the teaching loop — homework → preparation
→ class → recap → next class — is the paid `continuity` capability
(`apps/workspace-worker/src/continuity-access.ts`), in Tutoring and Classroom workspaces
alike. It covers session Notes (`/api/sessions/:id/record`, including the
next-time sticky and the homework published on the record), context people,
access links, returned and learner work (practice, writing and voice
submissions, feedback, private audio), creating identified sessions, and the
learner plane (`/api/learner/*`). Contexts themselves — students and classes,
every kind — are free: create, list, read, edit and file into a space.

- **Whose capability.** The space owner's, exactly like `team`: an editor in a
  paid owner's space needs no licence, and an editor's own subscription never
  substitutes for an owner's lapsed one. Learner routes resolve the link to its
  context, the context to its space, the space to its owner.
- **What lapsing does.** Gated reads and writes answer
  `403 { ok: false, error: "continuity-required" }`; contexts stay listed and
  editable but omit `nextNote`, and the Library stops offering unwritten Notes.
  Nothing is deleted. Trash, restore, permanent deletion,
  link revocation and recording trash/restore never need the capability, so a
  lapsed tutor can always remove a learner's data. Access returns unchanged on
  renewal.
- **Checked at start, not per join.** An identified session needs the capability
  when it is created or first allocated (direct, deck, presentation and MCP
  creation), the same rule as named (`roster`) sessions. A session already
  running keeps admitting its learners.
- **What stays free.** Contexts, decks, anonymous and pseudonymous live
  sessions, the results recap, listening recordings, Desktop, the CLI and MCP,
  and the
  `/api/tutoring/lookup`, `/dictionary`, `/stock`, `/embed-check` and
  `/embed-import` tools, which only share the path prefix.
- **Self-hosted.** A deployment without `PADDLE_ENVIRONMENT` has no billing and
  every account holds `continuity` (see [BILLING.md](BILLING.md)).

The host shows a **Homework and Notes** lock with a **Plans** action
(Settings → Billing) on the loop surfaces — Notes, learner links, learner work —
instead of hiding them. Context surfaces never show it.

## Product routes (current + target)

| Route | Job |
| --- | --- |
| Space folders (`#/space/:id`, optional `?folderId=`) | Primary **place** browser (Explorer). Sessions and decks as typed rows in the current folder — **sessions are not rows**. |
| `/host/#/tutor/contexts` | The one non-folder shelf: who you teach. Grouped by kind, not a table. |
| `/host/#/tutor/contexts/new` | Create a context (link root). |
| `/host/#/tutor/contexts/:id` | Context hub: linked decks + sessions; notes secondary. New deck/session from here carries `contextId`. Existing access links are listed here. |
| `/host/#/tutor/contexts/:id/links/new` | Mint an access link. Its own route, not a form beside the list: minting carries an option (how long the link lives) and shows a secret exactly once. |
| `/host/#/learn?token=orlnk_…` | The learner's own page: their sessions and records. Deliberately outside the signed-in workspace shell — no nav, no library, nothing to sign in to. |
| `/host/#/decks/new`, `…/:id` | Deck create and detail routes. Detail leads with its teaching history. |
| `/host/#/decks/:id/edit` | **Edit deck**: full-bleed three-pane authoring — block rail · canvas · properties — with **Start session** in the top bar. In code: `DeckEditor` (component), `DeckEditorPage` (routed page). |
| `/host/#/sessions/:id`, `…/:id/record` | Session instance routes (reopen, Notes). There is no `new` and no `edit` route: a session is **started**, not scheduled or filled in. |
| `/host/#/` (Home) | Continue live sessions; upcoming/recent sessions. Empty account gets a single guided **Get started** card. |
| `/host/#/tutor/trash` | Restore or permanently delete. |

There are no collection routes for decks or sessions — a session is an occurrence and a deck is filed work, so neither gets a shelf. Unknown hashes land on Home.

Detail routes and the `#/decks/:id*` legacy aliases remain reachable. The
`#/project*` hashes are a `parseHash` alias only — `href()` never emits them.

**Type-specific chrome only:** decks get
**Start session** and **Edit deck**; sessions get who/launch/record. Organization
stays folders. Nothing here schedules, plans, constrains or approves — a deck is
a file, and scheduling does not exist at all — not even in the API.

Collections and forms stay on separate routes (CRUD invariant). **Exception:** folder create/rename may be inline on the Explorer browser because folders are navigation chrome, not typed library entities — see `AGENTS.md`.

**Place + link:** location is never a flat parent/folder form field. Deck requires a context; a session inherits its deck's place and context when it is started. Create entry points must prefill those links — see `AGENTS.md`.

## Preparation and delivery

1. The tutor receives school material, sometimes shortly before the session.
2. The tutor opens those files in Codex, Claude Desktop, or another external
   agent with the OpenRoom plugin or MCP connection.
3. The agent retrieves only the curated OpenRoom presentation context it needs,
   works through the source material locally, and drafts an `Outline v1`.
4. The agent calls `outline_validate`, then uses `openroom_api` to create or
   update the context, deck, and immutable deck version.
5. The tutor chooses **Edit deck** on the deck, reads the saved
   outline through, and edits anything the agent got wrong.
6. The tutor presses **Start** — which stamps the version, files the session and
   launches it in one gesture. There is no scheduling step in between. OpenRoom
   copies that outline into one session Durable Object and returns the host, stage,
   and participant surfaces. (A library row's **Start session** does the same
   thing without opening the editor.)
7. During the session, the tutor uses the host console, tablet, CLI, direct API,
   or `session_command` to move between semantic steps and existing interactions.
8. After the session, the tutor saves a short record. This is an outcome record,
   not a transcript. **For next time** writes a sticky on the context so the next
   session for that person opens with it. Homework on the record is what the
   student can do on their access-link page (reading, quiz, writing). Missed
   quiz items come back on that page later; the teacher never sees due dates.
9. Optionally, the tutor issues a **context access link** so the student or family can
   read that record themselves — and do the homework. See "Learner access" below.

The canonical provider-neutral workflow is in
`plugin/skills/prepare-a-tutoring-outline/SKILL.md`. Complete French and German
A1–B2 lessons are in [`examples/tutoring`](../examples/tutoring/README.md) and the
Tutoring Library's **Sample lessons** gallery.

## Outline contract

`Outline v1` is YAML or JSON against
`packages/schema/schema/outline.schema.json`. It contains outline metadata,
semantic steps, and the same typed interactions used by ordinary OpenRoom
sessions.

Supported step kinds are:

- `title`, `statement`, `cards`, `steps`, and `term`
- `activity`, `timer`, `media`, `debrief`, `break`, and `join`
- `interaction`, which references a choice, scale, numeric, text, Q&A, or
  ranking interaction in the outline

OpenRoom chooses the layout for **wired** steps (questions, activities, timers,
join). Talking pages (`title`, `statement`, `media`, `blank`) may also carry
`elements`: text boxes, pictures, and sanitised HTML/SVG in a percent `box`.
That is how an agent ports an existing deck without OpenRoom ingesting the
`.pptx`. The deck editor's freeform inserts (Title, Statement, Image + text,
Empty, Empty + title) write `blank` steps made of such elements; every other
insert writes a wired kind and takes its automatic layout. A wired kind's
singular text slots accept styled `spans` beside their plain text.
`tutorNotes` appear only in the host view and are stripped from learner and
stage snapshots.

A step may say something about its *structure*, and only through closed enums and
keys the step already has. This is the line: naming an arrangement is allowed,
describing pixels is not.

- **`layout`** — one of `title`, `text`, `split`, `grid`, `media`, `poll`,
  `activity`, `timer`, `join`, `blank`. It names which typed arrangement of regions the step gets;
  OpenRoom still decides what that arrangement looks like at each size. A step may
  only claim a layout its own content can fill, so `poll` on a `term` step or
  `timer` on a `cards` step is rejected with the allowed set in the message.
- **`reveal`** — `together`, or an ordered list of groups of the step's **part
  keys**: `header`, `body`, `option-0…`, `cell-0…`, `materials`, `image`. The keys
  are derived from the step's own shape, so there is nothing to invent. Parts you
  do not place are revealed last, one group each — a partial order stays valid
  when the step later grows another item.
- **`breakoutOf: { stepId, afterKey }`** — makes the step an on-demand detail hung
  off one part of a parent step: the tutor opens it if the learner needs it and
  returns to the parent afterwards. One level deep, no cycles, and `afterKey` must
  be a part of that parent.
- **`media`** — an optional picture on a title, statement, cards, steps, term,
  activity, debrief, or interaction step (a media step *is* its picture). Same
  object as a media step: `type`, `url`/`assetId`, `alt`, optional `focal` and
  `aspect`. The layout decides where it sits (`split` beside the words, `text`
  stacked under them). Timer, break, and join cannot carry one.
- **`media.place`** — `left` `right` `top` `bottom` `fill`. Which slot the
  picture occupies. Default follows the step layout.
- **`media.size`** — 20–100, the picture's share of the slide (width for
  left/right, height for top/bottom). The canvas resize handles write this.
- **`media.focal`** — one of nine named points (`top-left` … `bottom-right`)
  saying which part of the frame matters when a media region crops.
- **`activity.materials`** — what the learners need in front of them, distinct
  from `instructions`, which is what they do.

`kicker` no longer exists on a step. It could never be shown (the No-Kicker Rule),
so it was withdrawn; outlines that still carry it validate and the field is
dropped.

## Live behavior

A launched tutoring session uses the existing session lifecycle and transport. The
current semantic step is part of session state, and every connected host, stage,
participant, or tablet follows it by revision.

Outline commands are:

- `outline.next` and `outline.previous`
- `outline.goto` with a step id
- `outline.insert` with a validated step and optional `afterStepId`; an external
  agent must show a generated step privately and obtain tutor approval before
  inserting and displaying it. The live console Insert ribbon opens a compose
  modal first, then inserts with `show: true`. Pass `interaction` when the step
  is a new live poll. `outline.replace` rewrites a content slide already in the
  outline (not interaction steps).
- `mark.set` / `mark.remove` / `mark.clear` — tutor ink. A mark is either a
  **pen** stroke (free points) or one of five **token shapes** — `circle`,
  `rectangle`, `underline`, `strikethrough`, `highlight` — anchored to a
  `partKey` and a `token`, with an optional `endToken` (inclusive, same part)
  when the tutor dragged across a phrase. Every mark carries a `color` of
  `red` | `yellow` | `green` (absent reads as red) and is given an `id` by the
  session (`m<revision>`, so a replay rebuilds the same ids). `mark.remove` rubs
  out one mark by id — an unknown id is a silent success; `mark.clear` takes
  everything, the meaning and the dictionary included. A session holds at most 50
  marks and a stroke keeps its first 200 points. Moving to a different slide
  clears them; revealing or hiding a group on the current slide preserves them.
- Word cards publish the chosen meaning and selected form sections together. A
  replacement removes any previous meaning or forms that the tutor did not include.
  Private lookup and wording drafts live only in the tutor's client. Showing a card
  is explicit; a failed publication leaves the old card intact and offers retry.
  Commands name the current slide and selected word, so a late request cannot put
  a previous slide's explanation onto a new slide. Taking down an older word cannot
  remove a different word's card. The session enforces the 200-character meaning
  and 8 KB dictionary limits. The live command contract ships with `session_command`.

Word lookup itself is not a session command. It is a read, it never enters session
state, and only deliberate publication puts anything on the wall:

- The **dictionary** is the full entry for a word in the language being taught —
  part of speech, headword properties (gender, verb class, auxiliary), and a
  forms table built from grammatical tags rather than from per-language rules, so
  verbs, nouns, adjectives, pronouns, articles, participles and prepositions all
  render through the same path.
- The **meaning** is the short translation into the student's own language. Which
  language that is comes from the Space, not from the request. A space carries
  one pair — `settings.languages = { taught, native }`, set at `#/space/:id/edit`
  and limited to the pairs the dictionary has a verified source for. A lookup
  names a scope (the deck it is editing, or the session it is running) and the
  Worker reads the pair from that scope's space, so nobody can ask for a
  dictionary their space did not configure, and a space with no pair set gets no
  lookup rather than a guess from the outline's locale.

In an **identified** session the learner has their own lookup on their phone —
`POST /api/sessions/:code/dictionary`, on the session capability token they already
hold. It is private to them: it publishes nothing, no one else sees it, and it
is not recorded. (This reverses an earlier rule that students never get a
translate control. A learner reading a foreign sentence needs the same
affordance the tutor has; what stays tutor-only is the ability to put something
on the wall.)

The route is session-scoped, not on `/api/learner/*`, and that is a boundary rather
than a convenience. The learner plane is authenticated by a context access link
(`orlnk_…`), and the participant app is built never to keep one — it calls
`forgetLinkInUrl()` the moment it joins. Reaching `/api/learner/*` from a phone
would mean persisting a context-wide credential beside a session-scoped one, which
is exactly the credential collapse `AGENTS.md` forbids. Its budget is keyed on
`sessionCode` + `participantId`, both already on the verified token, so no IP hashing
is needed and one learner cannot spend another's.

The same lookup reaches the deck editor on the right-click menu (or Alt+Click, since a
focused `contentEditable` swallows the selection right-click in some browsers).
It renders into the properties panel and **writes nothing to the outline** —
which is what keeps `outline-edit.ts` and `outline-fuzz.ts` untouched by this
feature. Adding "insert this meaning as a slide note" later would have to go
through `outline-edit.ts` and be classified in `outline-fuzz.ts`.

A token shape names a word by part key and token index. Every surface numbers a
part's words the same way (split on whitespace, index >> 1), which is what lets
the projector, the console mirror, and the phone mark the same word.

On the console, hovering a word with a shape tool active locks it (a faint tint
in the ink colour) so the tutor sees what a click takes; dragging across words
marks the whole span with one shape; double-clicking a mark's own line rubs that
mark out; and a right-click on a word offers the five shapes and **Look up word**
(the dictionary entry, from which the tutor publishes a meaning above the word)
without changing the active tool.

A phrase is painted separately on each visual line, including a word that wraps.
Resizing, changing learner views and showing hidden text remeasure its tokens.
Freehand strokes use the actual slide rectangle, excluding projector letterboxing.
The learner's Reading view retains word marks; fixed-position pen strokes are
visible in Slide view.

Next reveals one more group before moving forward. Back hides the last revealed
group before returning to the previous slide shown in full. It stops at the first
slide's first group. Browser Present, the live console, phone remote and Desktop
audience keys follow that same order.

Entering an interaction step opens its referenced interaction and closes the
previous one. Entering a content step clears the active interaction. Sessions
without tutoring steps continue to use their existing interaction lifecycle.

## Learner access (context access links)

A student cannot sign in — there is no participant account system and there is not going
to be one. What a tutor can do instead is issue a **context access link**: a revocable
bearer capability scoped to exactly one context.

### Tutor side

Session cookie, space member, **`editor` or above**. A `presenter` may run a session but may
not mint a credential.

| Route | Job |
| --- | --- |
| `POST /api/tutoring/contexts/:id/links` | Mint. Body `{ expiresInDays? }` (default 180, min 1, max 365). `201 { id, token, tokenPrefix, createdAt, expiresAt }`. |
| `GET /api/tutoring/contexts/:id/links` | List. `{ links: [{ id, tokenPrefix, createdAt, expiresAt, revokedAt }] }` — prefixes only. |
| `DELETE /api/tutoring/contexts/:id/links/:linkId` | Revoke. `{ ok: true }`. Sets `revoked_at`; never hard-deletes. |

The raw token is returned **once**, at mint. Only its SHA-256 is stored, and the listing
shows only the `orlnk_…` prefix — a tutor who loses a link mints a new one and revokes the
old. At most **10 live links per context** (`429 link-limit` at the cap); ten is "every
device the household owns", and the cap keeps a compromised tutor account from quietly
farming credentials. Minting on a trashed context is `409 resource-in-trash`.

Browser: existing links are listed on the context hub; minting is its own route
(`#/tutor/contexts/:id/links/new`) because it takes an option and reveals a secret once.

### Learner side

The student opens `#/learn?token=orlnk_…` — a page outside the workspace shell, with no
nav and nothing to sign in to. It calls:

`Authorization: Bearer orlnk_…`. Nothing else is accepted — a session cookie is not even
read on these routes, and an `orpat_` personal token fails the shape check.

| Route | Returns |
| --- | --- |
| `GET /api/learner/me` | `{ contextId, displayName }` |
| `GET /api/learner/sessions` | `{ sessions: [{ id, title, status, record?: { outcomes, homework, artifacts } }] }` — newest first, non-draft, non-trashed, capped at 200. Homework is typed tasks; writing tasks may include the caller's `submitted` body. Never `notes` or `nextNote`. |
| `GET /api/learner/practice` | `{ items: [{ itemId, assignmentRevision, title?, interaction }] }` — due or changed assigned exercises. Optional `?itemId=` revisits one assigned exercise regardless of due state. No `dueAt`, ease, or streak. |
| `POST /api/learner/practice` | `{ itemId, assignmentRevision, attemptId, grade: "again" \| "good", answer }` → `{ attemptId, done: true }` or `{ attemptId, item }`. The answer is typed by exercise format. |
| `PUT /api/learner/writing` | `{ sessionId, taskId, body, assignmentRevision, submissionId }` — retain an immutable response with its original published task. |

Practice attempts preserve the question and answer key the learner saw. Revision and
practice-state checks happen in the database transaction, so a simultaneous tutor edit
or another answer cannot silently overwrite progress. An accepted attempt can be retried
with the same ID and payload, even after an assignment edit; it never advances practice
twice. New attempts require the current revision and current recipient authorization.
An incorrect keyed answer cannot claim a successful grade. Changed exercise content
returns to practice; edits to unrelated homework preserve its existing progress.

The learner keeps the displayed exercise and answer until choosing to load its update.
Failed refreshes can be retried; a withdrawn exercise has a path to the next exercise.
Tutor pickup pairs earlier answers with their original questions, not revised content.
Permanent session/context deletion removes attempts and associated practice state.

In the deck editor's Notes pane, Practice to revisit lets the tutor inspect an original
exercise, learner response and answer key. Add as a slide or Add to homework copies one
chosen exercise in its original format with its complete key. Names and responses stay
in the private preparation view. Copies are ordinary editable deck content, with new
identities and no connection that silently updates them when homework changes.

Learner routes share a **per-client budget of 10 failed authentications per 60 s**, enforced
inside `requireContextLink` so any learner route added later is covered by construction.
Over budget is `429 learner-rate-limited`. This is cost control on the one route family with
no cookie and no session, plus a brake on bulk-validating a leaked batch of links — it is
not anti-brute-force (the secret is 256-bit) and it is not a second factor. A successful
request spends nothing and clears whatever was spent. The client is keyed by a salted
SHA-256 of `CF-Connecting-IP`; the raw address is never stored. The check sessions *before* the
credential is examined, so 429 is reachable identically for an absent, malformed, unknown,
expired or revoked link — the throttle cannot become the oracle the single 401 exists to deny.

**Lapsed continuity is a revoked link to the holder.** When the context's space owner no
longer holds the `continuity` capability, `requireContextLink` answers exactly what a revoked
link gets: the same `401 { error: "unauthorized" }` body, after the same failed-attempt
budget charge. There is deliberately no `continuity-required` (or any other distinct status)
on learner routes: a distinct answer would confirm to a link holder that the credential is
still live and disclose something about the tutor's account, turning "valid but lapsed"
into a probe-able state. The cost is that the learner page cannot say why; the tutor sees
the lock in their own workspace. Nothing is revoked or deleted, so the same link works
again once access returns. Recordings stay deletable by the tutor regardless of billing
and still expire on their 90-day schedule.

### The boundary

A context access link **is not an account**: no `users` row, no sign-in session, no space
membership, no role, no email, no cross-context identity. It never resolves to a signed-in
user and is rejected on every `/api/tutoring/*` and `/api/my/*` path. It grants exactly one
context's learner-visible data — ten students in one space cannot read each other. The
context id is taken from the verified credential and never from a path, query, or body, so
a holder has no vocabulary in which to ask for someone else's context.

Deliberately withheld from every learner response: the tutor's private record notes; the
session code (it would turn a records credential into a session credential); deck and
deck-version ids; space and folder ids; the creating tutor's user id; metadata
fields; and draft or trashed sessions. The query is a **column allowlist**, so a future
migration cannot leak by default.

### Identified sessions

An outline may set `defaults.identityMode: identified` (beside `anonymous` and
`pseudonymous`; the default remains `pseudonymous`). In an identified session the handle is
the context's `display_name` — the name the tutor authored — not a generated session-local
handle. A participant is still never asked to type a name.

`POST /api/join` accepts an optional `contextLink`. The session proves its association through
the launch chain `sessions.session_id → sessions.context_id`, which means **a session created by bare
`POST /api/sessions` filed with no deck has no context, therefore no link can identify into
it**. That is the tight answer, not a gap to route around.

- Identified session, no link → `403 context-link-required`.
- Link offered to a non-identified session → `409 identified-join-unavailable`.
- Bad, revoked, expired, or wrong-context link → one indistinguishable `403
  context-link-invalid`, so a probing holder learns nothing about which sessions exist.
- Identified session still in `lobby` → `409 session-not-started` ("Your tutor has not started the
  session yet."). **The tutor pressing start is the gate**: a leaked link cannot be used
  against an unattended lobby. This applies to `identified` sessions only — anonymous and
  pseudonymous sessions still admit lobby joins, which is how a class files in before the host
  starts. A `frozen` session is still `live`, so a panic freeze never locks a student out of
  re-entry.

The link itself never reaches the Durable Object: the Worker verifies it and forwards only
the resolved display name, so a leaked session capability token can never be walked back into
a context credential. Presenting the same link again re-enters as the same participant
rather than forking a second identity.

## Listening recordings

Add an MP3, WAV or M4A recording in the deck editor, give it a readable label,
choose a listening mode and optionally write a transcript. Desktop embeds chosen
files in the portable deck; cloud decks upload them to the space's media storage.
The listening slide template supplies the structure and a script to replace.

Room audio plays from the tutor's console. The projector and learner devices
have no player in that mode. Individual listening gives each learner playback,
replay, seeking and speed controls on their own device. Nothing autoplays; changing
mode or leaving the slide stops players that are no longer needed.

The transcript stays private until the tutor chooses Show transcript. Hide
transcript removes it from the audience view and subsequent audience responses.
Starting a live session from Present preserves the selected mode and visibility.
Revisiting a slide restores its authored mode and hides the transcript again.
Playback position and speed are local to the device; they are not synchronized
between the tutor and learners.

## Deck images and offline copies

The Theme pane accepts background images and logos, with a description for the
logo, image focal points and a readability overlay. A master shares its design
across slides; a slide can override its background. Desktop embeds imported images
in the file. Browser uploads belong to the current space.

Save a copy downloads the cloud deck with structured image, PDF and audio resources
inside its `.openroom` archive, including backgrounds and logos. A failed media
download stops the export before a new version is published. Desktop prefers the
embedded bytes even when a file is linked to an online copy. Video, embedded websites
and external content inside HTML still need their original online service.

## Storage boundary

D1 holds durable business records: contexts, decks (content metadata),
immutable deck versions, sessions (delivery instances), compact Notes,
trash state, and short-lived deletion intents.
The selected outline is copied into a Durable Object only when a session launches.
The Durable Object owns the live cursor, interaction state, ballots, aggregates,
and synchronization for that session.

The ballot hot path does not read or write D1. Original school files and model
conversations are not OpenRoom records.

## Agent and deletion safety

Browser, MCP, CLI, and direct API calls use the same user-scoped tutoring
services. Interactive sign-in is browser-only. Normal `DELETE` moves a record to
recoverable trash.

An agent may request permanent deletion, but the response is only a short-lived
confirmation URL. The signed-in tutor must open that URL in a browser and press
the permanent-delete button. A personal token, CLI, or MCP client cannot perform
the final purge.

## Explicit non-goals

- Autonomous AI tutoring
- Uploading or indexing original school documents in OpenRoom
- Bundling a general-purpose model subscription
- Replacing the tutor's video-call service
- Storing preparation transcripts
- Free-form slide design or generated CSS

Small live generation remains possible through an external agent, private tutor
preview, and an approved `outline.insert` command.
