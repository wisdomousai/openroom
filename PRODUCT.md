# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Teachers, lecturers, trainers, workshop facilitators, and independent tutors running live sessions online or in person. They operate under time pressure, often with material received shortly before the hour they teach. Participants need no OpenRoom account to join a session. A tutor can hand one student a revocable access link to that student's own context — a capability scoped to one context, not an account and not a login. The stage can be projected, screen-shared, or shown on a tablet; video calls remain in the tutor's existing video service.

## Product Purpose

OpenRoom (working name) is **decks in a shared space** — also openable as a local document on desktop.

The whole product is three things:

1. **Deck** — what the teacher opens, edits, and starts. A deck is a file: a local `.openroom` document or the same file in a cloud folder, kept, edited, duplicated, and moved to trash. Verbs: open · edit · start · duplicate · trash. Not schedule, book, or approve.
2. **Share / invite** — a **space** is the sharing boundary. Invite colleagues; they see the same folders and decks.
3. **Common tutoring space** — folders of decks; start a session when you teach; optionally write short Notes after. Live presentation is the deck started with people in it.

An external agent (Codex, Claude Desktop, MCP, CLI) can prepare and control the same surface. OpenRoom delivers and synchronizes; it does not wrap a general-purpose model and it is **not** an ERP or SaaS ops dashboard for teachers.

## Product Routes

- **Deck (desktop or library):** open a deck → edit → **Start session**.
- **Share:** one surface on the space (members + invite). Location is a place, not a foreign-key form.
- **Who (thin):** a context names who a deck is for. A label, not a CRM.

What must not return: week-score dashboards, session calendars, multi-entity admin shelves, or any UI that treats teaching as resource planning.

## Positioning

Decks and outlines are portable YAML or JSON files against published JSON Schemas. Wired steps (questions, activities, timers, join) receive automatic layouts and cannot carry arbitrary CSS or coordinates. Talking pages (`title`, `statement`, `media`, `blank`) may carry boxed `elements` — text, pictures, and sanitised HTML/SVG — so an agent can port an existing slide file and then wire the class. The editor's insert catalog splits along the same line: freeform inserts (Title, Statement, Image + text, Empty, Empty + title) instantiate as boxed-element boilerplate the author drags, resizes and formats, while wired inserts keep the automatic layout of their kind. A wired kind's singular text slots — heading, body, a statement's headline number, a question's prompt — accept styled spans; its lists, options and materials stay plain. Original `.pptx` files stay with the agent. Participants do not create accounts: there is no participant sign-up, no password, and no email is collected in any mode. Identity in a session is never typed by the participant — by default it is a system-generated session-local handle, and in an identified session it is the display name the tutor already wrote on the context. The one credential a student may hold is a context access link: a revocable bearer capability, scoped to exactly one context, that lets them read their own sessions and records and nothing else. The browser apps contain no ads, trackers or analytics scripts. Browser, API, CLI, and MCP are peer clients of the same application services; only interactive sign-in and final irreversible deletion confirmation are browser-only.

## Operating Context

The host creates an outline in the deck editor or imports YAML, starts a session, then opens and reveals questions from the console, phone remote, CLI, or MCP. For tutoring, the external agent reads original school documents locally and sends OpenRoom only a derived outline and curated presentation context. Management data lives in D1; only a launched synchronized session lives in a Durable Object. OpenRoom purges ballots and participant records 30 minutes after a session ends, then deletes the live session after 24 hours.

## Capabilities and Constraints

Six interaction types are implemented: choice, scale, numeric, text, Q&A and ranking. Tutor delivery adds typed title, statement, cards, steps, term, activity, timer, media, debrief, break, join, blank, and interaction steps. Tutor notes stay out of participant and stage snapshots. Presentation contexts (person, group, class, event), decks, immutable deck versions, sessions, curated post-session records, recoverable trash, and browser-confirmed purge intents are implemented in the business control plane. Revocable per-context access links and the learner read surface they unlock (own sessions and curated records only) are implemented; identified sessions, enterable only with such a link, are implemented. Five built-in themes can switch during a live session. The hosted default forgets (ballots 30 minutes after end, the live session 24 hours). `users.entitlements` is readable (`keep`, `roster`, `rawExport`, `branding`, `team`, `connectors`) and still all-false for every account; gates, archives, roster invites, and a payment webhook are not implemented. Original document storage, video calling, and a built-in heavy outline-generation model are not implemented.

## Brand Commitments

- Name: OpenRoom (working title; final name undecided).
- Voice: factual, no marketing fluff — the user's standing instruction for all copy is "no AI slop, just facts."
- **Binding visual constraint (updated 2026-08-16): three-surface fills carry structure; two shadows only (`--shadow-page` on the desk, `--shadow-overlay` on dialogs/menus). No gradients, no blur, no glass, no glow. Applies to all four surfaces (host, participant, stage, site). The stage's ambient 3D layer follows the same language: crisp sharp-edged geometry in solid theme colors, no fog/alpha washes.**
- The five theme identities (chalkboard, paper, projector, sherbet, default) are product features and must stay distinct within that language.

## Evidence on Hand

Working production deployment with ~512 automated tests; examples/ directory of real deck outlines (exit-ticket, peer-instruction, ranking). No testimonials, customers, benchmarks or pricing exist — never invent them. Source not yet published; license undecided (AGPL under consideration).

## Product Principles

- **Dead simple by default.** Open → people answer → show results → next. Complexity (second vote, themes, pedagogy notes) is opt-in and never hijacks the primary path.
- **Machine-readable outlines.** The deck editor, schema validator, MCP, CLI, and HTTP API use the same outline contracts. MCP validates and saves tutoring outlines, manages contexts and decks, starts and controls sessions, and reads aggregate results. See `docs/AGENT.md`.
- **External agents, product-owned delivery.** Original source documents and heavy preparation stay in the user's chosen agent. OpenRoom stores the deliverable, not the model workflow.
- **One CRUD route, one job.** Collections never contain create/edit forms, CRUD drawers, or modals. Create, detail, the deck editor, and Notes each have a dedicated route. A selected row opens an entity panel that says what the thing is, its state, and the one thing to do next; it edits only the item's identity — rename and where it is filed — and routes everything else to the item's own route.
- **Recoverable by default.** Delete means Move to trash. Permanent purge requires a short-lived confirmation page in a signed-in browser and cannot be completed through MCP or CLI.
- The stage is the product's face: legible from the back row first, expressive second.
- Host effort is the scarce resource: glanceable, few decisions, no ceremony.
- Participants are guests: one thumb, ten seconds, nothing to learn.
- Data honesty: what is shown is exactly the aggregate; text summaries never lag animations.
- Ephemerality is a feature: nothing persists that doesn't need to.

## Accessibility & Inclusion

WCAG AA contrast enforced by tests on all theme variants. prefers-reduced-motion honored everywhere (animations become instant). 44px touch targets on participant. Correctness never color-only. Keyboard navigable console; aria-live announcements in ranking UI.
