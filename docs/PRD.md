# Open Classroom Interaction Platform

Product requirements document

- Status: Draft for product and technical review
- Version: 0.3
- Date: 2026-08-05
- Changes in 0.3: Numeric added as an interaction primitive (estimation with correct-value reveal); display styles introduced as a presentation attribute on primitives (donut, emoji pulse, dot strip, gauge, histogram, ticker, word cloud, rank animation); pin-on-image, point-allocation, and rating-matrix listed as V2 entry-type candidates.
- Changes in 0.2: presentation integrations restructured into tiers behind a P0 feasibility spike; MVP slimmed with a dogfood exit criterion; compliance and trust posture added; go-to-market and monetization sharpened; host recovery, classroom rate-limit, and session-code resolution requirements added; metrics hierarchy with a north star; risks section added; participant text switched from approval-gated to display-first with host emergency controls; smooth animated stage visualizations made a first-class requirement (STAGE-08 to STAGE-11).
- Working category: Open classroom interaction
- Working name: To be decided

## 1. Executive decision

Build an open-source, classroom-first interaction platform for live polls, concept checks, quizzes, Q&A, exit tickets, and lightweight surveys.

The core product is not a slide editor. It is a portable interaction runtime. A host defines a session as a versioned `Session` document, publishes it, and runs it through the same domain model from PowerPoint, Google Slides, a web presentation, the host application, CLI, API, or an agent.

The hosted product gives individual educators the complete live interaction experience without charging for fundamental poll types, moderation, or aggregate exports. The session then forgets. Revenue comes from Practice and Training (the session becoming data: branding, roster, kept archive, named export), a small School membership (one shared space, one invoice), and future embedding. The participant experience remains account-free, advertising-free, and free of commercial tracking. Distribution is agent marketplaces, not comparison SEO.

The live runtime is designed for very low infrastructure cost:

- Static browser applications for host, participant, and stage views.
- One SQLite-backed Cloudflare Durable Object as the authoritative state machine for each live session.
- HTTP requests for commands and ballot submission.
- Cloudflare Hibernation WebSockets for state-change notification while allowing inactive session objects to sleep.
- Adaptive HTTP polling only as a compatibility fallback.
- No D1 query, Queue message, LLM call, or answer logging on the ballot hot path.

## 2. Source precedence and settled corrections

This PRD consolidates the directional source specification and subsequent product decisions. Where they disagree, the following later decisions take precedence:

1. The live session uses a Durable Object plus Hibernation WebSockets. Durable Object state is authoritative; WebSockets are an inexpensive notification transport, not the source of truth.
2. HTTP handles deterministic mutations and acknowledgements. Hibernating WebSockets notify connected browsers about session revisions. Polling is a fallback, not the primary live transport.
3. School Pro does not control teaching practice. There is no school teaching profile, centrally applied poll policy, mandatory agent guidance, or organization-wide pedagogical configuration.
4. School Pro is a lightweight school space, membership, shared library, curation, billing, and supporter product. It does not change the live-session engine.
5. The hosted product uses one shared application and control plane. School Pro does not create per-school deployments, databases, or infrastructure.

## 3. Product thesis

### One-sentence version

A classroom interaction deck is a portable file that educators, applications, and agents can prepare and run live.

### Core promise

A host can turn source material into a live interaction deck, start a session quickly, and let participants join and respond with minimal friction on ordinary devices and unreliable networks.

### Product surfaces

The product has five equally important interfaces:

1. A simple host web application.
2. Presentation integrations for PowerPoint, Google Slides, and the web.
3. A participant web application and projector-safe stage view.
4. A deterministic CLI and documented API.
5. Agent surfaces through schemas, skills, API operations, and MCP.

### Validated reference use case: SEG Summer Camp

The Entrepreneurship & Leadership Lab built for the Swiss Education Group summer camp is the product's first reference implementation and the clearest evidence for the wedge.

The three-hour workshop contains 59 presentation steps and 14 live interaction moments: an opening pulse check, five myth-buster questions, discussion prompts, five rapid real-or-fake questions, and a closing word cloud. It uses only two interaction primitives, choice and text aggregation, yet those primitives support orientation, knowledge checks, discussion, energizers, and reflection.

The implementation already demonstrates the essential experience:

- The presentation and audience voting page are one Cloudflare application.
- Participants enter the session once and keep the same `/vote` page open.
- Entering a presentation step with a `pollId` activates its question automatically.
- Leaving that step closes the current question or activates the next one.
- HTTP requests handle joins, votes, host actions, and immediate acknowledgements.
- One Durable Object owns active state, participants, ballots, and aggregates.
- The Durable Object uses the Hibernation WebSocket API to update the presentation and participant pages.
- Participants see the next question automatically and can change a vote while it remains open.
- The projector surface combines teaching content, QR access, response counts, timers, and results without switching to a separate event dashboard.

This replaced an earlier workflow built on a hosted event-polling platform. That replacement is the product insight: for this teaching job, the platform added interface, setup, and commercial packaging, but no interaction value. The lightweight integrated runtime fitted the workshop better.

The opportunity is therefore:

> Keep the tiny part that changes the session, remove the event-platform machinery around it, and make the interaction deck portable.

The summer-camp implementation is evidence for the experience, not the production architecture in full. The reusable product must replace its deliberate one-off shortcuts:

- One fixed event becomes many isolated sessions.
- One global presenter token becomes short-lived, session-scoped capabilities.
- Required participant names become system-generated, session-local handles by default, with explicit anonymous mode available.
- A JavaScript poll array becomes the versioned `Session` schema.
- Whole-state persistence on every mutation becomes normalized session-local SQLite state and measured write behavior.
- Full-state broadcast on every vote becomes coalesced revision notification or compact snapshots.
- Client-generated voter identifiers become signed participant capabilities.
- A fixed 200-person cap becomes a tested 500-participant normal-session target.
- A WebSocket-only client becomes Hibernation WebSockets with adaptive HTTP polling fallback.
- Unmoderated word-cloud output gains host removal controls and a panic hide, while staying display-first by default.

### Presentation integration model

The product must work inside the host's existing presentation tool. It provides three first-class integration surfaces:

1. PowerPoint integration.
2. Google Slides integration.
3. Web embedding through components and an SDK.

All three surfaces use the same published deck, session, command API, and participant join flow. An integration may associate an interaction with a slide or presentation step, open it when that step becomes active, close or replace it when the presenter advances, and render compact live results. The integration is a client of the interaction runtime; it does not create a separate poll engine.

The `Session`, not the deck, owns the interaction sequence. Deck binding is a convenience layer over the runtime's own ordering and manual controls (LIVE-10); when a host platform cannot signal slide changes, the host advances interactions from the runtime and the experience degrades gracefully rather than breaking.

Automatic slide-bound activation is platform-constrained and is therefore delivered in tiers, gated by a feasibility spike (INT-00):

- Tier A - web SDK: full automatic activation. The host application controls its own navigation events. P0.
- Tier B - PowerPoint: best-effort automatic activation through per-slide content add-ins, which do render during slideshow but carry load latency, weak slide-exit signals, and enterprise add-in policy risk. P1, shaped by the spike.
- Tier C - Google Slides: Apps Script add-ons do not execute during present mode, so the initial integration is a companion remote (a runtime window or phone view the host advances alongside the deck), with a browser-extension path evaluated later. P1, shaped by the spike.

The product does not import, convert, edit, or take ownership of the underlying presentation. PowerPoint remains PowerPoint, Google Slides remains Google Slides, and a web presentation remains the host application.

### Participant session entry

Every live session has a short, human-readable session code. The canonical participant flow is:

1. Open the universal participant join page.
2. Enter the session code shown by the host.
3. Receive a session-scoped participant capability.
4. Join the session without creating an account. (In an identified session the participant additionally presents a tutor-issued context access link; that link is a capability, not an account.)
5. Remain in the same participant session as questions change.

A QR code may encode the join URL and session code as a convenience shortcut. It does not replace the session-code model. Participants who cannot or do not want to scan must always be able to type the code.

The pricing and complexity hypothesis must still be validated beyond this reference case. The summer-camp build proves that the smaller interaction layer can work; it does not by itself quantify incumbent willingness to switch.

### Product principles

- No participant friction: no install and no account by default.
- Portable by construction: decks are inspectable YAML or JSON documents, not data trapped in an editor.
- Agent-native: agents use the same schema and operations as the GUI.
- Classroom-first: optimize for formative assessment and teaching decisions, not conference spectacle.
- The live picture is the product: during facilitation the core activity is measuring input and feedback in real time, so stage visualizations must feel alive - smoothly animated, immediately legible from the back of the session, and satisfying to watch fill in - without becoming gamified spectacle.
- The stage is a cinematic surface, built in three layers: a theme-reactive ambient background (WebGL, subtle), a strictly 2D legible chart layer (**shadcn/ui charts / Recharts**, theme-token colours, motion that respects reduced-motion), and a moment layer for reveal choreography. Data is never rendered in 3D; atmosphere may be. Hard guardrails: 60fps on ordinary projector hardware, reduced-motion collapses to instant updates, no-WebGL falls back to static styling, the high-contrast projector theme mutes the ambient layer, and accessible text summaries always carry the data. Cinematic quality serves comprehension; leaderboards and countdown pressure remain off by default.
- Free fundamentals: do not paywall basic interaction, moderation, or *aggregate* export. A per-ballot, named, or archived export is paid memory, not a poll-type gate.
- Privacy before analytics: collect operational aggregates, not participant surveillance data.
- Scale to zero: idle sessions should consume no continuously running compute.
- Low bandwidth by default: small static applications, compact snapshots, and graceful reconnection.
- No model dependency: live sessions must work without an AI provider.
- Own-your-data open source: the code is open and independently deployable. A productized, supported self-host path is deliberately deferred until real demand shows up — schools buy outcomes, not deployment options, even when they employ OSS people in the basement.

## 4. Goals and non-goals

### Goals

- Let a host create or import a valid classroom interaction deck.
- Start a live session and accept participant responses with minimal setup.
- Give hosts immediate aggregate evidence they can act on during teaching.
- Support anonymous participation without persistent participant identities.
- Make every core workflow available through deterministic programmatic interfaces.
- Keep the live hot path inexpensive enough that hosted classroom interaction can remain broadly free.
- Provide an honest School Pro offer whose value is shared resources, administrative simplicity, and support for the commons.
- Keep the codebase independently deployable (open source, single-deployment shape) without promising or productizing self-hosting for now.

### Explicit non-goals

The initial product is not:

- A slide editor, PowerPoint clone, or hosted office suite.
- A video-conferencing platform.
- A student information system, roster system, or CRM.
- An examination, proctoring, or surveillance system.
- A gradebook or grade-passback product.
- A native mobile application.
- A real-time collaborative deck editor. (Space sharing with versioned, conflict-detected saves — see docs/CONTRACTS.md §Space collaboration — is in scope; live co-editing of one deck is not.)
- A presentation import or conversion service.
- A built-in AI subscription or model-billing product.
- A multi-region enterprise control plane.
- A 30,000-person conference product.
- A data warehouse.

## 5. Users and jobs

### Host

Teachers, lecturers, trainers, workshop leaders, and meeting hosts need to:

- Turn learning objectives or source material into useful interactions.
- Start a session without navigating a settings maze.
- See response and connection counts clearly.
- Identify confusion and adapt the session.
- Hear from quieter participants.
- Remove an inappropriate submission from the projector instantly when classroom discipline alone is not enough.
- Leave with an understandable summary and portable export.

### Participant

Participants need to:

- Open the universal join page and enter the displayed session code, or use its QR shortcut.
- Understand the active question.
- Submit from an old or low-powered device.
- Receive an unambiguous acknowledgement.
- Change an answer until close when permitted.
- Ask a question without creating an account.
- Recover cleanly from connection loss.

### School steward

A school steward needs to:

- Verify and maintain the school space.
- Manage teacher membership with minimal administration.
- Curate useful collections of shared resources.
- Control what is deliberately published as school-owned content.
- Handle one annual payment.
- Receive a simple usage and public-benefit impact statement.

The steward does not define or enforce how teachers teach.

### Agent

An agent needs to:

- Discover and validate the session-document schema.
- Generate valid drafts without needing a proprietary editor.
- Publish immutable deck versions.
- Control a live session only with explicit, narrowly scoped authorization.
- Retrieve aggregates without gaining raw-response access implicitly.
- Produce pedagogically useful summaries without sending participant content to a model by default.
- Behave predictably under retries, stale revisions, and automation.

## 6. Core domain model

### Session

`Session` is the canonical, portable product object.

Required characteristics:

- JSON Schema is the normative machine-readable contract.
- YAML and JSON serializations are supported.
- Every interaction has a stable identifier.
- Decks can contain host-only notes.
- Drafts are mutable; published versions are immutable.
- Editing a published deck creates a new version.
- The web editor, CLI, API, MCP tools, and agents use the same schema.

Minimum deck fields:

- Metadata: title, description, locale, and optional source provenance.
- Defaults: identity mode, result visibility, retention mode, and answer-change behavior.
- Ordered interactions.
- Optional pedagogical metadata: learning objective, misconception labels, explanation, estimated duration, and host follow-up.

### Interaction primitives

The domain should use a small set of composable primitives instead of unrelated poll types:

- Choice: single or multiple selection. True/false and yes/no are presets of Choice, not separate types.
- Scale: bounded numeric or labeled scale for agreement, confidence, and rating.
- Numeric: open numeric entry for estimation, guessing, and calculation results, with an optional unit label, optional correct value, and optional tolerance range for quiz scoring. Scale is bounded and labeled; Numeric is unbounded entry.
- Text: short or long plain-text response.
- Ranking: ordered preferences (Borda). Optional `correctOrder` is quiz-key reveal metadata, not a change to the preference aggregate.
- Q&A: participant questions, voting, and moderation.

Sequence is deck structure, not an interaction type: the ordered grouping and delivery flow of a deck is expressed by the deck document itself (ordered interactions, optional grouping), and participants never see a "sequence" object.

A quiz is a choice, numeric, or text interaction with scoring - exact option match for choice, tolerance range for numeric, accepted strings for text (`correctAnswers`) - and a quiz-oriented reveal. Ranking may carry an optional `correctOrder` permutation for a put-in-order key without changing the Borda preference aggregate. None of these are separate storage models. True/false and yes/no are choice presets.

### Display styles

Visual variety comes from a `display` attribute on an interaction, not from new interaction types. A display style changes how the stage renders an aggregate; it never changes the ballot shape, the aggregation, or the storage model. Each primitive has a sensible default and a small set of alternates:

| Primitive | Default display | Alternates |
| --- | --- | --- |
| Choice | Animated bars | Donut; emoji pulse (compact reaction strip) |
| Scale | Dot strip (each response a dot) with average marker | Gauge |
| Numeric | Histogram with median and mean markers | - |
| Text | Live list / ticker | Word cloud |
| Ranking | Ordered bars with rank-change animation | - |

Quiz-oriented reveal applies to any scored interaction: the distribution is shown with the correct answer highlighted (for numeric, the correct value is overlaid on the histogram); a per-question summary is optional and there is no leaderboard by default.

Every display style must satisfy the accessible text summary (STAGE-06) and the animation, legibility, and reduced-motion requirements (STAGE-08 through STAGE-10). A style that cannot meet them does not ship.

### Classroom behaviors

The schema must be able to express:

- Hide results until close.
- Manual reveal of results and correct answers.
- Answer changes while open.
- An explicit "I do not know yet" response.
- Confidence plus correctness.
- Estimation reveal: show the correct value against the class distribution after close.
- Explanations after reveal.
- Peer instruction: vote, discuss, vote again.
- Misconception labels attached to distractors.
- Anonymous muddiest-point prompts.
- Exit tickets.
- No leaderboard by default.
- Anonymous, pseudonymous, or identified response modes, with pseudonymous session-local handles as
  the hosted default and explicit anonymous mode available when recovery is not needed.
- Host notes invisible to participants and the stage view.

## 7. End-to-end user journeys

### Create and prepare

1. The host starts from a blank deck, a slide file, pasted notes, or an imported question set.
2. The editor or an agent produces a `Session` draft.
3. The system validates the draft and returns structured errors with field paths.
4. Preview renders the participant and stage experience without starting a session.
5. Publish creates an immutable version.
6. Subsequent edits create another version without changing existing sessions.

### Run live

1. The host starts a session from a published deck version.
2. The platform creates a session and displays a short code and QR code.
3. Participants join without creating accounts. An identified session additionally requires the tutor-issued context access link for that context; no other session type accepts one.
4. The host opens an interaction.
5. Participants submit through an idempotent HTTP command and receive an acknowledgement.
6. The session Durable Object updates ballots and aggregates.
7. Connected clients receive coalesced revision notifications through Hibernation WebSockets.
8. The host closes the interaction and optionally reveals results or the correct answer.
9. The host advances to the next interaction or ends the session.

### Reflect and reuse

1. Ending the session freezes the final session state.
2. Aggregate results remain available according to retention policy.
3. Raw responses are purged or retained according to the explicit identity and retention mode.
4. The host can export CSV and JSON.
5. An agent may summarize aggregate results within its granted scope.
6. The host may copy or revise the deck for later reuse.

## 8. Functional requirements

Priority meanings: P0 is required for MVP launch; P1 is required soon after MVP; P2 is later.

### Decks and authoring

| ID | Priority | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| SESSION-01 | P0 | The system shall publish a versioned JSON Schema for `Session`. | A session document can be validated locally without the hosted service. |
| SESSION-02 | P0 | The system shall accept YAML and JSON session documents. | Equivalent YAML and JSON inputs produce the same normalized session. |
| SESSION-03 | P0 | Validation shall return stable error codes and JSON field paths. | GUI, CLI, and API show the same validation failures for the same input. |
| SESSION-04 | P0 | Published deck versions shall be immutable. | Editing a published deck creates a new version identifier. |
| SESSION-05 | P0 | The web editor shall support all MVP interaction fields. | A host can create and publish an MVP deck without editing source files. |
| SESSION-06 | P0 | Preview shall render participant and stage states without creating a live session. | Preview creates no billable live-session record or participant capability. |
| SESSION-07 | P1 | Decks shall support source provenance and import metadata. | Imported or agent-generated content can identify its origin without exposing private source content to participants. |
| SESSION-08 | P0 | PowerPoint, Google Slides, and web hosts shall be able to bind a slide or sequence step to an interaction identifier without using a built-in slide editor. | Entering or leaving a bound step can open, close, or replace an interaction through the documented command API. |

### Session lifecycle and host controls

| ID | Priority | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| LIVE-01 | P0 | A session shall reference exactly one immutable deck version. | Deck edits cannot alter a session already created from an older version. |
| LIVE-02 | P0 | Session states shall be `draft`, `lobby`, `live`, and `ended`. | Invalid transitions return a structured conflict response. |
| LIVE-03 | P0 | Interaction states shall be `pending`, `open`, `closed`, and `revealed`. | Ballots are accepted only while the interaction is open. |
| LIVE-04 | P0 | Each mutating command shall include an idempotency key and expected session revision. | Replaying a command cannot apply it twice; stale revisions are rejected deterministically. |
| LIVE-05 | P0 | The host shall open, close, reveal, advance, freeze, and end from one live console. | All primary controls fit without visiting a settings screen. |
| LIVE-06 | P0 | The console shall show joined, connected, and answered counts distinctly. | A host can distinguish presence from response completion. |
| LIVE-07 | P0 | Keyboard controls shall cover primary live commands. | A host can operate a normal session without a pointing device. |
| LIVE-08 | P0 | A panic action shall freeze submissions and hide participant-generated stage content. | One action prevents new submissions and removes all participant-generated content from display. |
| LIVE-09 | P1 | The host may configure an optional accessible timer. | Timer expiry does not silently close an interaction unless explicitly configured. |
| LIVE-10 | P0 | The runtime shall support both manual controls and host-sequence-driven activation. | The same session state transitions and authorization checks apply whether a host clicks a control or an integrated deck issues the command. |
| LIVE-11 | P0 | A host shall be able to recover the live console from another device mid-session. | After a host device failure, re-authenticating on any browser restores full console control of the running session with no lost session state or accepted ballots. |

### Participant experience

| ID | Priority | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| PART-01 | P0 | Every live session shall have a short session code accepted by a universal participant join page. | A participant can enter the displayed code and reach the session without creating an account. A session whose deck selects `identityMode: identified` additionally requires a context access link (403 `context-link-required` without one) and a session the tutor has already started (409 `session-not-started` in the lobby); no account is created in either case. |
| PART-02 | P0 | The participant view shall show one dominant active interaction. | Unrelated navigation and host controls are absent. |
| PART-03 | P0 | Each ballot submission shall receive a clear accepted or rejected acknowledgement. | Network retries never create duplicate counted responses. |
| PART-04 | P0 | Participants may change an answer until close when the deck permits it. | The final accepted ballot replaces the earlier ballot for aggregation. |
| PART-05 | P0 | The participant app shall show offline and reconnecting states. | A participant can tell whether the latest answer reached the session. |
| PART-06 | P0 | The static application shell shall be cacheable. | A previously loaded participant app can render connection state during a transient network loss. |
| PART-07 | P0 | No third-party advertising, behavioral trackers, or fingerprinting shall run in the participant app. | Automated inspection finds no such third-party requests or persistent cross-session participant identifier. |
| PART-08 | P0 | Host and participant text shall render as plain text or through a strict allowlist. | XSS fixtures never execute in host, participant, or stage applications. |
| PART-09 | P0 | Participants shall remain in one joined session while interactions change. | The next active question appears automatically without rescanning, re-entering a code, or navigating to another event page. |
| PART-10 | P0 | A QR code shall be offered as a shortcut to the same coded session. | Scanning resolves the session code automatically; typing the code remains fully supported. |

### Stage view and host text controls

| ID | Priority | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| STAGE-01 | P0 | The stage route shall be projector-safe and contain no host controls. | Opening the stage URL cannot mutate session state. |
| STAGE-02 | P0 | Join code and QR code shall occupy a stable, legible area. | Results and question changes do not move the join information unexpectedly. |
| STAGE-03 | P0 | Results shall remain hidden until the session reaches the configured reveal state. | No result data is included in participant or stage payloads before authorization to reveal. |
| STAGE-04 | P0 | Participant text is display-first; a built-in blocklist and one-tap removal are the only controls. | Open-text and Q&A content appears on the stage as it arrives. A built-in, always-on blocklist (slurs and profanity, maintained in the product, not configured per session) silently keeps matching submissions off the stage; the host can remove anything that slips through with one action, and panic (LIVE-08) hides everything. There is no approval queue, no moderation dashboard, and no per-session filter settings. |
| STAGE-05 | P0 | Aggregate updates shall be coalesced and rate-capped. | A burst of ballots does not produce one stage broadcast per ballot. |
| STAGE-06 | P0 | Charts shall have an accessible textual summary. | The current aggregate can be understood without relying only on color or graphics. |
| STAGE-07 | P0 | The stage experience shall be embeddable beside or inside host-owned presentation content. | PowerPoint, Google Slides, and a web host can render compact session-code, join, response-count, and result components without exposing host authority to the audience. |
| STAGE-08 | P0 | Live visualizations shall animate smoothly between aggregate states. | Bars, scales, and counters interpolate between coalesced snapshots at a steady frame rate on ordinary projector hardware; values never teleport or flicker, and a full 500-participant burst produces fluid motion, not jank. |
| STAGE-09 | P0 | Stage charts shall be designed for projector legibility. | Type sizes, contrast, and spacing are readable from the back of a classroom at typical projector resolutions; the layout does not shift as counts grow. |
| STAGE-10 | P0 | Animation shall respect reduced-motion preferences and never carry sole meaning. | With reduced motion enabled, states update without interpolation and nothing is lost; the accessible text summary (STAGE-06) always matches the animated state. |
| STAGE-11 | P1 | Reveal moments shall support a deliberate, host-triggered animated transition. | Revealing results or a correct answer plays a short, calm transition that focuses attention without leaderboard or countdown pressure. |

### Results, export, and retention

| ID | Priority | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| DATA-01 | P0 | Aggregate results shall be available after session end according to workspace retention. | Aggregate retrieval never requires raw-results permission. |
| DATA-02 | P0 | Aggregate JSON and aggregate CSV shall be available without a paid poll-type gate. Per-ballot and named exports require `rawExport` or a roster session. | A free host can export counts for every MVP interaction type. A ballot-level CSV is refused without the entitlement (or after purge, without an archive). |
| DATA-03 | P0 | Aggregate and raw-result permissions shall be separate. | `results:aggregate` never implies `results:raw`. |
| DATA-04 | P0 | The default hosted mode shall purge individual ballots after the short operational window while retaining permitted aggregates. | A deletion test confirms ballots are removed on schedule. |
| DATA-05 | P0 | Participant answer content shall never be written to application logs. | Log inspection under test traffic contains identifiers and operational counts only. |
| DATA-06 | P1 | Large or asynchronous exports may be stored temporarily in R2. | Export objects expire automatically and are authorized independently of session join capabilities. |

### CLI, API, MCP, and agents

| ID | Priority | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| API-01 | P0 | Every core GUI operation shall have an API equivalent. | Authoring and live smoke tests can complete without browser-only endpoints. |
| API-02 | P0 | Every object shall have a documented schema and stable identifier. | Generated clients can represent decks, versions, sessions, interactions, commands, and aggregates. |
| API-03 | P0 | Mutating operations shall support dry-run where meaningful and idempotency everywhere. | Automation can validate a live command without applying it when dry-run is supported. |
| API-04 | P0 | CLI commands shall support non-interactive execution and stable JSON output. | CI can validate, publish, start, control, and export without parsing human prose. |
| API-05 | P0 | Live-control tokens shall be short-lived and narrowly scoped. | A token granting `results:aggregate` cannot control or end a session. |
| API-06 | P0 | Correct answers shall not be disclosed to agents or clients before reveal. | Pre-reveal resources and tool results omit scoring keys. |
| API-07 | P0 | Participant text shall be treated as untrusted data, never as agent instructions. | Prompt-injection fixtures cannot cause live commands or data exfiltration. |
| API-08 | P1 | A remote stateless MCP endpoint shall expose outline validation, the user-scoped tutoring control plane, retained archives, shared-session facilitation, presenter handoff, and aggregate results. | Shipped tools map to the same application/domain services as the browser: `outline_validate`, `session_create`, `session_status`, `session_results`, `openroom_api`, `deck_get`, `deck_preview`, `deck_save_version`, `deck_draft_put`, `deck_start`, `session_facilitate`, `session_recap`, `session_command`, `picture_search`. |
| API-09 | P1 | Canonical agent skills shall be provider-neutral and stored once. | Provider-specific discovery paths reference the canonical skill source. |
| API-10 | P0 | A small web SDK shall expose session creation, session-code display, session state, commands, and embeddable result primitives. | The summer-camp interaction pattern can be rebuilt without importing the product's host application. |
| API-11 | P0 | Every tutoring business operation shall be available to browser, API, CLI, and MCP peer clients through the same user-scoped application service. | A PAT integration test creates a context and deck, launches it, and controls the owned session through MCP; CLI wire tests cover the same routes and outline commands. |
| API-12 | P0 | Normal deletion shall be recoverable; permanent deletion shall require an expiring signed-in browser confirmation. | MCP/CLI may request and return the confirmation URL but cannot call the purge endpoint; anonymous/PAT confirmation fails. |
| API-13 | P0 | External preparation agents shall receive original school material directly and OpenRoom shall store only derived typed outlines and curated records. | No source-document upload or model-wrapper route exists; outline provenance contains labels only. |
| API-14 | P0 | Collection, create, detail, edit, and deck editor surfaces shall be separate routes. | A collection route never renders a create/edit form, CRUD drawer, or modal. A selected row may open an entity panel that edits only the item's identity — rename, tags, filing — and routes every typed field to the item's own route. |

### Tutor-led sessions

Tutoring is an additional delivery workflow in the same OpenRoom account, not an autonomous AI tutor. An external agent reads last-minute school material, works out what is needed, and produces a constrained `Outline v1`. OpenRoom persists presentation contexts, deck metadata, immutable outline versions, and a compact Notes in D1. It copies the selected outline into a Durable Object only when the tutor launches a synchronized session. Video remains external.

The tutor can navigate semantic steps, open existing interaction types, and approve a small generated step for live insertion. OpenRoom owns automatic layout and strips tutor notes from participant/projector views. It does not accept authored CSS or coordinates and does not proxy the heavy model workflow.

The implemented workspace routes, preparation flow, storage boundary, live commands, and deletion safeguards are documented in [`docs/TUTORING.md`](TUTORING.md).

### Presentation integrations

| ID | Priority | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| INT-00 | P0 | A feasibility spike shall validate slide-bound activation on PowerPoint and Google Slides before INT-01 and INT-02 are committed. | The spike prototypes a PowerPoint per-slide content add-in during slideshow, confirms Google Slides present-mode constraints, evaluates companion-remote and browser-extension paths, and produces written go/no-go acceptance criteria for INT-01 and INT-02. |
| INT-01 | P1 | The product shall provide a PowerPoint integration (Tier B) using the public session and command model. | A host can bind an interaction to a PowerPoint slide, start a session, display its code, advance between bound interactions, and show live results without opening the full host application, within the activation fidelity established by INT-00. |
| INT-02 | P1 | The product shall provide a Google Slides integration (Tier C) using the same session and command model. | A host can run the bind, start, code-display, advance, and result workflow alongside Google Slides through the companion remote, with automatic activation only if INT-00 validates a viable mechanism. |
| INT-03 | P0 | The product shall provide a web integration through documented components and an SDK. | A web host can embed session-code, active-interaction, response-count, and result views and can issue authorized host commands. |
| INT-04 | P0 | Presentation integrations shall not store an independent copy of live session state. | Reloading or switching integration clients reconstructs the current state from the session Durable Object. |
| INT-05 | P0 | All integrations shall use short-lived, session-scoped host capabilities. | A capability copied from one session cannot control another session or administer the host's account. |
| INT-06 | P0 | Advancing a presentation shall be safe under retries and duplicate navigation events. | Repeated activation of the same bound interaction does not reset votes or increment the session revision unnecessarily. |
| INT-07 | P0 | Integrations shall preserve manual host control. | The host can disable automatic slide activation or manually open, close, reveal, and advance when presentation event hooks are unavailable. |

Initial CLI surface:

```text
poll init
poll validate <deck>
poll preview <deck>
poll publish <deck>
poll session start <deck-version>
poll session status <session>
poll session open <session> <interaction>
poll session close <session> <interaction>
poll session reveal <session> <interaction>
poll session end <session>
poll results <session> --aggregate
poll export <session> --format csv|json
poll deploy cloudflare
poll doctor
```

## 9. School Pro requirements

### Product promise

School Pro gives a school a recognizable private space, a shared resource library, simpler teacher access, one payment, and evidence that its membership supports the free and open product.

The school gets a bookshelf, not a principal inside every poll.

### Included capabilities

| ID | Priority | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| SCHOOL-01 | P1 | A school may create a verified school space with a stable library URL. | The school name and verified status are visible to its members. |
| SCHOOL-02 | P1 | Teachers may authenticate with familiar Google or Microsoft accounts. | Membership can be established through invitation or a verified email domain without SAML or SCIM. |
| SCHOOL-03 | P1 | Two roles shall exist initially: teacher and steward. | Teachers use and contribute resources; stewards manage membership and curation. |
| SCHOOL-04 | P1 | Teachers may publish copies of their decks into the school library. | The school-owned copy has its own owner and version history; the teacher's private original is unchanged. |
| SCHOOL-05 | P1 | Stewards may curate collections from school-owned resources. | A collection is a list of references, not a policy applied to teacher decks. |
| SCHOOL-06 | P1 | Teachers may browse, copy, adapt, publish back, or ignore school collections. | No school content or setting is applied automatically. |
| SCHOOL-07 | P1 | Branding shall be limited to school name, logo, one accent color, library URL, and optional supporter badge. | Custom CSS, fonts, white-labeling, and custom domains are unavailable. |
| SCHOOL-08 | P1 | The school shall receive one annual payment flow and renewal. | No seat allocation or monthly teacher reconciliation is required. |
| SCHOOL-09 | P1 | The school shall receive an annual usage and impact statement. | The statement uses aggregates and does not expose participant identities or answers. |

### School Pro exclusions

Do not build the following as School Pro features in the initial product:

- A school teaching profile or organization-wide instructional defaults.
- Mandatory agent guidance.
- Per-school deployment or dedicated database.
- SAML, SCIM, directory synchronization, or roster provisioning.
- LMS integration, grades, or grade passback. Student *accounts* are no longer excluded — see the participant-data posture — but they stay minimal-collection and never carry a staff role. A context access link remains a revocable capability scoped to one context, and does not silently become an account.
- Bespoke retention policies or customer-specific data residency.
- Custom domains, custom CSS, design systems, or white-labeling.
- Department-level access-control hierarchies.
- Concurrent collaborative deck editing. (Shared spaces with owner/editor/presenter roles and optimistic-concurrency saves exist; simultaneous live editing does not.)
- Per-seat allocation and reconciliation.
- Bespoke legal agreements, onboarding, or priority-support commitments.

These may only be reconsidered through an explicit product decision that includes operational cost, sales complexity, and impact on the shared runtime.

## 10. Technical architecture

### Topology

```text
Host app      Participant app      Stage app
     |                      |                  |
     +---------- static assets ---------------+
                            |
                     Worker API router
                    /        |         \
             auth/decks    session route   exports
                 |             |          |
                 D1      Session Durable  R2
                           Object
                         /        \
                 SQLite state   Hibernating
                                  WebSockets
```

### Browser applications

- Build separate host, participant, and stage entry points as static client applications.
- Treat the PowerPoint add-in, Google Slides add-on, and web SDK as clients of the same Worker API and session protocol.
- Never store reusable host credentials or authoritative session state inside a presentation file.
- Avoid server-side rendering until a measured requirement justifies it.
- Keep the participant app lean and cacheable; no fixed bundle-size budget (an earlier 100 KB target was dropped as arbitrary — "low bandwidth by default" is judged by real load behavior on classroom networks, not a number).
- Theming is a first-class typed token system (colors, type scale, radii, chart palette, logo and accent branding slots), shared by participant, stage, and host surfaces. Built-in themes are presets of the token schema; paid branding later is a constrained token override — never custom CSS — which is how SCHOOL-07's branding cap is enforced in code. Lean surfaces are still fully styled: the join/vote screen is the second most-seen surface in the product and carries the session's theme and branding.
- Cache the application shell and immutable hashed assets.
- Keep participant and stage routes free of editor and administrator code.

### Worker router

The stateless Worker router is responsible for:

- Host authentication and authorization.
- Deck and school APIs.
- Session-code resolution and participant capability issuance.
- Routing session commands and reads to the correct Durable Object.
- WebSocket upgrade routing.
- OpenAPI and MCP endpoints.
- Coarse abuse controls and export authorization.

It must not become an alternative session-state store.

Session-code resolution must not become a hidden per-participant D1 dependency. The code-to-Durable-Object mapping shall use an epoch-scoped `idFromName` derivation or a KV entry created at session start, so a join burst of hundreds of participants does not translate into a D1 read per join. D1 remains the durable index of sessions, not the join hot path.

### D1 control plane

D1 stores low-frequency control-plane data such as:

- Users and authentication identities.
- Schools, domains, members, entitlements, and collections.
- Decks and immutable deck versions.
- Session index and final aggregate references.
- API tokens and workspace policies.
- Usage totals and administrative audit events.

D1 must not receive a write for every ballot.

### Session Durable Object

Exactly one SQLite-backed Durable Object owns a normal live session.

It owns:

- Authoritative session and interaction state.
- Monotonic session revision.
- Active participant capabilities and session-local pseudonyms.
- Ballots and answer replacement.
- Aggregates.
- Q&A, votes, and moderation state.
- Idempotency keys.
- Host, moderator, and stage capabilities.
- State-transition records needed for recovery and audit.
- Connected Hibernation WebSockets.

The object must reconstruct current state from SQLite after hibernation. In-memory aggregates are an optimization, not the sole durable record.

### HTTP command path

Representative endpoints:

```text
POST /sessions/{sessionCode}/answers
POST /sessions/{sessionCode}/interactions/{interactionId}/open
POST /sessions/{sessionCode}/interactions/{interactionId}/close
POST /sessions/{sessionCode}/interactions/{interactionId}/reveal
POST /sessions/{sessionCode}/advance
POST /sessions/{sessionCode}/freeze
POST /sessions/{sessionCode}/end
GET  /sessions/{sessionCode}/state?afterRevision={revision}
```

Each mutation includes:

```json
{
  "idempotencyKey": "01K...",
  "expectedRevision": 42,
  "command": "interaction.close",
  "interactionId": "oxygen-source"
}
```

The HTTP response is the authoritative acknowledgement for the caller.

### Hibernation WebSocket path

- Use the Durable Objects Hibernation WebSocket API through `acceptWebSocket`.
- Do not use the standard WebSocket acceptance path that prevents hibernation.
- Keep sockets connected while allowing the object to leave memory when idle.
- Prefer small revision notifications or compact state snapshots.
- Coalesce answer-count and aggregate notifications.
- Configure automatic ping/pong responses where appropriate so heartbeats do not wake the object.
- On reconnect, the client provides its last known revision and fetches the current snapshot.
- Do not require replay of a complete event stream.

Representative notification:

```json
{
  "v": 1,
  "type": "session.changed",
  "revision": 48
}
```

### Adaptive polling fallback

When a network blocks WebSockets:

- Poll every 1 to 2 seconds while an interaction is open.
- Poll every 5 to 10 seconds in the lobby or while results are being discussed.
- Back off substantially while the browser is backgrounded.
- Use revision or ETag semantics so unchanged responses are minimal.
- Stop polling immediately when a Hibernation WebSocket connection is restored.

Polling is a compatibility path and must not drive the default cost model.

### Live hot-path invariants

For a ballot submission, the Session Durable Object shall:

1. Validate the participant capability.
2. Validate the current interaction and answer shape.
3. Check the idempotency key.
4. Insert or replace the participant's current ballot.
5. Update the aggregate.
6. Return an acknowledgement.
7. Schedule or emit a coalesced session revision notification.

The hot path shall not:

- Query D1.
- Call an LLM.
- Emit a Queue message per ballot.
- Write participant answer content to application logs.
- Broadcast a full result snapshot per ballot.
- Accept typing events or scale-drag events.
- Create one R2 object per ballot.

### R2 and Queues

Use R2 only for uploaded media, large requested exports, optional raw-response archives under explicit policy, and limited school branding assets.

Queues are optional for session-close processing, export generation, webhooks, and retention work. Never enqueue every ballot.

## 11. Identity, privacy, and retention

### Anonymous ephemeral mode - explicit opt-out

- Random, short-lived participant capability.
- No name or email.
- No cross-session identity.
- Ballots retained only for live operation, answer changes, recovery, and the configured short purge window.
- Aggregates retained according to the host or workspace policy.

### Pseudonymous mode - shipped

- Random identity stable within one session: the default `defaults.identityMode: pseudonymous` assigns each participant a system-generated session-local handle ("Amber Fox 4827") at join. Never user-chosen — no self-declared PII enters the system.
- The browser stores the session capability by session id and session code for automatic rescans. If an iOS QR window discards that storage, the participant can type the same handle to recover the original participant id and receive a fresh session capability. Failed recovery attempts are rate-limited inside the session Durable Object.
- No linking across classes or sessions: handles exist only inside one session's state and die with the DATA-04 purge.
- Raw-response retention: shares the DATA-04 defaults (ballots purged 30 minutes after end, session deleted at 24 hours), stated in the participant notice.
- Participant notice: shown immediately after join, before the first answer can be submitted ("In this session you appear as **{handle}**. Remember it: you can use it to rejoin if this QR window closes. No name or account is collected, and the handle is never linked to other sessions. Individual answers are deleted 30 minutes after the session ends."). Deviation from the original "before joining" wording: the mode is only knowable after session resolution, and joining itself submits no content.
- Visibility: host console and CSV export only, plus each participant's own handle. The stage and other participants never receive handles.

### Learner records access - shipped

The first non-staff read path in the product. A tutor mints a **context access link**
(`orlnk_…`, prefix distinct from the `orpat_` personal API token) for one context and
gives it to that student or family. It is a capability, not an account:

- One context-local learner, nothing else. Group learners share published lesson material;
  each sees only their own submissions, practice and published feedback. Both learner and
  context identity come from the credential, never a caller-supplied identifier.
- A link never resolves to a signed-in user, never grants space membership, and is
  rejected on every `/api/tutoring/*` and `/api/my/*` route.
- Minting requires `editor` or above on the space. A `presenter` may run a session but
  may not mint a credential.
- Shown once at mint (only the SHA-256 is stored), default lifetime 180 days, at most
  10 live links per context, revocable at any time. Revocation sets `revoked_at`; the
  row is never hard-deleted, because the record of which capability existed and when it
  was withdrawn is the point of a revocable credential.
- The learner sees only their own sessions and the curated Notes (outcomes, homework,
  artifacts). Tutor-private notes, past session codes, deck identifiers, filing
  structure, the tutor's user id, series and metadata fields, and draft or trashed sessions
  are all withheld — by an explicit column allowlist, so a future migration cannot leak
  by default.

### Identified mode - shipped, link-gated

`defaults.identityMode: identified` joins `anonymous` and `pseudonymous`. The
default is unchanged: `pseudonymous`. Identified mode is never a global switch and
is never reachable by a participant deciding to identify themselves.

- **The identity is authored by the tutor, not by the participant.** The handle in an
  identified session is the context-local learner's display name, authored by the tutor.
  A stable learner id supplies the seat; credential replacement retains the same seat.
  The `packages/domain/src/handles.ts` wordlist is not used.
  No name field is ever shown to a participant, so no self-declared PII enters the
  system in any mode.
- **Entry requires a context access link.** `POST /api/join` accepts an optional
  `contextLink`. An identified session without one is `403 context-link-required`; a link
  offered to a non-identified session is `409 identified-join-unavailable`.
- **The session must provably belong to the link's context.** The association is the
  launch chain `sessions.session_id → sessions.context_id`. A session created by bare
  `POST /api/sessions` filed with no deck has no context, therefore **no link can ever
  identify into it**. A live link presented to a session belonging to a different context
  gets the same indistinguishable `403 context-link-invalid` as a revoked or forged
  one.
- **The tutor's start is the gate.** An identified session is joinable only once its host
  has started the session; a session still in the `lobby` answers `409 session-not-started`
  ("Your tutor has not started the session yet."). A leaked link therefore cannot be
  used against an unattended lobby — it only ever works inside a window a tutor is
  present for and can see. Anonymous and pseudonymous sessions are unchanged and still
  admit lobby joins.
- **The learner plane is throttled per client.** `/api/learner/*` is the only route
  family with no cookie and no session, so `requireContextLink` spends a budget of ten
  failed authentications per 60 s per client before it examines the credential, and
  answers `429 learner-rate-limited` beyond it. This is cost control on an
  unauthenticated D1-hitting endpoint plus a brake on bulk-validating a leaked batch of
  links; against a 256-bit secret it is not anti-brute-force, and it is not a second
  factor. Clients are keyed by a **salted SHA-256 of `CF-Connecting-IP`** — storing the
  raw address would contradict this document's data-minimisation posture, so no
  column holds one. Because
  the check precedes the credential lookup, the 429 is identical for an absent,
  malformed, unknown, expired or revoked link and is no more of an oracle than the 401.
- **Still no account.** No `users` row, no session, no space membership, no email,
  no password, no cross-session identity. The link is a revocable bearer capability
  scoped to exactly one context and is withdrawn by revoking it.
- **Re-entry is the link.** Presenting the same link again lands on the same
  participant id, so a page reload does not fork a student into two identities.
- Retention is unchanged: DATA-04 purge applies, and the identified handle dies with
  the participant records like any other handle.
- Open: identified mode must ship its own participant notice text before launch (see
  the bullet at the end of this section) — that text does not yet exist.

The product shall not implement browser fingerprinting. Small-group aggregate suppression must be configurable to reduce reidentification risk.

### Compliance and trust posture

Anonymous-by-default is a compliance architecture, not only an ethics choice. FERPA, GDPR, and COPPA obligations attach to identifiable personal data; a runtime that never collects participant names, emails, accounts, or cross-session identifiers converts a school's legal review into a short answer. That answer must be written down and published:

- Procurement one-pager: participants join without accounts, no participant PII is collected in the hosted default mode, ballots are purged on a stated schedule, aggregates contain no identities, and no participant data is sold, profiled, or used for advertising.
- Under-13 participation: because participants have no accounts and provide no personal information, COPPA consent mechanics are not triggered in anonymous or pseudonymous mode. **Identified mode rests on a different argument, deliberately.** The tutor is the controller: they already know the student, they author `contexts.display_name`, and they own the records. OpenRoom collects nothing *from* the child — no name field is ever shown to a participant or student, and no marketing, profiling, or advertising use exists. A student account, where one is issued, requests a provider-anonymised identity and grants read access to records the tutor created; it is not the point of collection.

  > **⚠ Three items still need a human before this is published.** The controller
  > argument above is the product's position; these are the gaps underneath it.
  >
  > 1. **Retention.** The COPPA answer for anonymous mode is underwritten by the ephemeral
  >    session: ballots purge 30 minutes after end, sessions delete at 24 hours. The durable
  >    tutoring tables have **no retention policy at all** — the only TTL in the control
  >    plane is the 15-minute deletion-confirmation token. `contexts.display_name`,
  >    `contexts.context_json` and `session_records.notes` persist until a human trashes *and*
  >    purges them. A child's records survive indefinitely by default. This is the widest
  >    gap and it is an engineering one, not a legal one.
  > 2. **Age floor on the account path.** Sign in with Apple and Google both effectively
  >    require 13+. An account-based student path therefore cannot serve under-13s at all,
  >    while a context access link can — which is a reason to keep the link as the primary
  >    mechanism rather than a stepping stone to accounts.
  > 3. **Notice text.** The line below already requires identified mode to ship its own
  >    participant notice and retention defaults *before* launch. That text does not exist.
  >
  > Unexamined free text remains unpreventable by design: `context_json`, `session_records.notes`,
  > `outcomes_json`, `homework_json` and outline `tutorNotes` accept anything a tutor types.
  > OpenRoom does not inspect them, and inspecting them would be worse. What the product
  > controls is reach and lifetime — reach is enforced, lifetime is item 1.
- Host and School Pro accounts do create GDPR processor duties. The product shall offer a standard, lightweight, non-negotiated data processing agreement, a published subprocessor list, and a clear statement of data location within Cloudflare's jurisdiction options.
- Pseudonymous and identified modes must each ship with their own participant notice text and retention defaults before launch, not after.

Bespoke legal agreements remain excluded (see School Pro exclusions); the strategy is one strong standard posture rather than negotiated variance.

## 12. Security requirements

- Use a seven- or eight-character cryptographically random session code, with optional PIN.
- Treat the session code as a discoverability secret, not as host authority or sufficient proof to retrieve protected results.
- Expire session codes when the session ends and prevent immediate confusing reuse.
- Issue short-lived signed capabilities with separate host, moderator, stage, and participant permissions.
- Never embed host authority in participant or stage applications.
- Enforce exact session-local limits inside the Durable Object and coarse limits at the Worker edge.
- Edge rate limits must be classroom-aware: hundreds of legitimate participants often share one school NAT address, so per-IP limits must be set far above per-classroom peaks or keyed to session and capability instead. Precise per-participant limits live in the Durable Object, keyed by capability, never by IP.
- Apply Turnstile only after suspicious behavior or for abuse-prone session creation, not as default participant friction.
- Enforce strict text and upload limits.
- Render untrusted content as plain text or through a very small allowlist.
- Apply an explicit Content Security Policy and secure, same-site cookies where cookies are used.
- Require idempotency keys and expected revisions for live commands.
- Exclude correct answers from pre-reveal payloads.
- Exclude participant content from logs, traces, and product analytics.
- Provide workspace-level cost circuit breakers and automatic session expiry.
- Record administrative and policy changes without recording ballot content.
- Provide a one-click hide-all and freeze action for projector abuse.
- Treat imported materials and participant submissions as untrusted input to agents.

## 13. Accessibility and low-bandwidth requirements

Target WCAG 2.2 AA for host, participant, and stage applications.

Release gates:

- Complete keyboard operation and visible focus.
- Screen-reader names, roles, states, and live announcements.
- No color-only meaning.
- Reduced-motion support.
- High-contrast projector mode.
- 200 percent zoom without loss of function.
- Large mobile touch targets.
- Correct reading order.
- Accessible chart summaries.
- Timers that can be extended, paused, or disabled.
- Cached static shell.
- Reconnection that preserves the latest accepted answer.
- HTTP polling fallback when WebSockets are unavailable.
- No required camera, microphone, or location permission.

Leaderboards and countdown pressure are off by default.

## 14. Observability and reliability

### Collect

- Session starts and ends.
- Active session counts.
- Join success rate.
- Ballot acknowledgement latency.
- Aggregate update latency.
- Deck error and reconnect counts.
- Durable Object processing time.
- SQLite writes per attendee-session.
- Export failures.
- Deployment version.
- Workspace-level usage totals.

### Do not collect

- Every click.
- Every answer in logs.
- Participant browsing history.
- Persistent device fingerprints.
- Cross-session anonymous identities.
- Raw content for product analytics.

### Proposed MVP service targets

These targets require validation under load before they become public commitments:

- Participant join success: at least 99.5 percent for valid session codes.
- Ballot acknowledgement: p95 under 500 ms excluding client network latency.
- Aggregate visible to host and stage: p95 under 1 second after accepted ballot.
- Duplicate counting after retry: zero.
- Session recovery after hibernation: no lost accepted ballot or invalid state transition.
- Supported normal session: 500 simultaneous participants.
- Raw answer content found in logs: zero.

### Required tests

- State-machine property tests.
- Duplicate, retry, and out-of-order command tests.
- Hibernation, reinitialization, and reconnect tests.
- 500-participant burst and sustained-session tests.
- WebSocket-blocked adaptive polling tests.
- Cross-browser mobile tests.
- Automated and manual accessibility audits.
- Open-text XSS fixtures.
- Prompt-injection fixtures.
- Cost regression tests.
- Data deletion verification.
- Agent authorization tests that separate aggregate and raw results.
- Tests proving correct answers cannot be accessed before reveal.

## 15. Cost guardrails

- No dynamic Worker execution for static assets where Cloudflare static asset routing can serve them directly.
- No D1 read or write per ballot.
- No Queue message per ballot.
- No LLM call in a live session unless a host explicitly invokes a separate optional workflow.
- No success log per ballot; sample operational logs without content.
- One coalesced usage update per session or workspace interval, not per event.
- At most one normal background close job per session.
- Automatic expiry for abandoned sessions and temporary exports.
- Strict text, media, and export limits.
- Rate-capped aggregate broadcasts.
- Alarms only for necessary session lifecycle work.
- Alerts on unexpected request, duration, row-write, R2 operation, log-volume, and queue growth.
- A cost regression test must estimate requests and writes per attendee-session before release.

## 16. Open-source and self-hosting requirements

**Status: deferred.** Self-hosting is not a launch promise. This section is retained as design reference so the architecture keeps the door open at zero cost; nothing in it is roadmap-committed until demand is demonstrated.

"Self-hosting" is two different promises, and the product must not conflate them:

1. **Bring-your-own-Cloudflare (supported now, the primary path).** A single deployment under the operator's own Cloudflare account. This delivers operational independence — the operator's data never touches our instance, their domain, their configuration, effectively free at school scale — but it is not infrastructure sovereignty: the runtime is still a US cloud provider, which matters to exactly the privacy-driven adopters most likely to want this path. Marketing and documentation must call this what it is.
2. **Single-node sovereign deployment (roadmap, V2 candidate).** Because `packages/domain` is pure TypeScript with no platform APIs and the Durable Object is a thin shell (storage, WebSockets, alarms), a Node adapter — one process, SQLite files for session state, `ws` for sockets, timer-based alarms, serving the same static apps — can host the identical domain on a VPS or on-premises box. This is true self-hosting for the data-sovereignty audience (e.g. European public schools restricted from US cloud providers). It is a deliberate adapter, not a Docker-orchestrated distributed system, and it stays single-node by design.

The account-free identity model independently reduces how much hosting location matters: in the default pseudonymous mode the handle is generated by the system, is session-local, and is not a real-world identity. Identified mode is the exception and is opt-in per deck: the handle there is the display name the tutor wrote on the context, so a tutor who names a context after a real person is choosing to put that name in the session.

The bring-your-own-Cloudflare path is a single deployment initiated by the CLI:

```text
npx @project/cli deploy cloudflare
```

The deployment workflow shall:

1. Authenticate with Cloudflare.
2. Create or select D1.
3. configure the Durable Object namespace and SQLite migration.
4. Apply D1 and Durable Object migrations.
5. Optionally create R2 when media or large exports are enabled.
6. Generate required application secrets.
7. Deploy the Worker and static applications.
8. Create the first administrator.
9. Run a health check.
10. Print host and participant URLs.

Self-hosting must not require Docker or a continuously running server.

Proposed repository structure:

```text
apps/
  host/
  participant/
  stage/
  worker/

packages/
  domain/
  schema/
  ui/
  sdk/
  cli/
  mcp/
  skills/
  testing/

infra/
  cloudflare/

examples/
  biology/
  mathematics/
  language-learning/
  peer-instruction/
  exit-ticket/

docs/
```

Licensing is a decision to lock before implementation. The source direction proposes AGPL for the hosted server and web applications, with more permissive licensing considered for protocols, schemas, and SDKs to encourage interoperability. Decided: the core (packages, relay, stage, participant, Office, Desktop) is MIT and the workspace (workspace client, workspace Worker, site) is AGPL-3.0-only; `LICENSING.md` maps every directory.

## 17. Delivery plan

### Phase 0 - protocol first

Deliver:

- `Session` JSON Schema, complete with all primitives (including Numeric) and the `display` attribute from the start; rendering lands per phase, the contract does not churn.
- YAML and JSON parser and normalizer.
- Validator with stable errors.
- Immutable deck-version model.
- Example deck library.
- CLI `init`, `validate`, and `preview`.
- Initial authoring and question-quality skills.
- Domain and state-machine tests.

Exit criterion: a deck can be created, validated, previewed, and versioned locally without the hosted application.

### MVP - live classroom core

Deliver:

- Host authentication.
- Deck library and a minimal web editor covering MVP interaction fields; editor polish follows once the runtime is proven, since Phase 0 CLI/YAML plus agent generation covers early adopters.
- Universal participant join page with short session code and QR shortcut.
- Host, participant, and stage applications.
- Smooth animated live stage visualizations meeting STAGE-08 through STAGE-10.
- Web components and embedding SDK (integration Tier A).
- INT-00 presentation-integration feasibility spike, run early in the MVP phase.
- Choice, scale, numeric, text, and Q&A.
- Default display styles: bars, dot strip, histogram, live list.
- Display-first participant text (STAGE-04): built-in always-on blocklist, one-tap removal, panic hide-all. No approval queue, no moderation settings.
- Anonymous ephemeral mode.
- One SQLite-backed Durable Object per session.
- Hibernating WebSockets and adaptive polling fallback.
- Open, close, reveal, advance, freeze, end, and cross-device console recovery (LIVE-11).
- CSV and JSON export.
- Rate limits and automatic session expiry.
- CLI live controls.
- Documented API.
- MCP deck and aggregate operations; live control may follow immediately after the core authorization model is proven.
Deferred out of MVP: PowerPoint and Google Slides integrations (P1, gated by INT-00) and editor refinement.

Exit criteria, both required:

1. Dogfood: a real workshop on the scale of the SEG reference (roughly 50 or more presentation steps, 10 or more interaction moments) is authored, published, run, ended, and exported entirely on the product.
2. Load: a 500-participant test session completes without violating hot-path cost or privacy invariants.

### V1 - school library and reusable teaching patterns

Deliver:

- PowerPoint integration (Tier B) and Google Slides integration (Tier C), shaped by the INT-00 spike.
- Public deck library with shareable, discoverable decks (moved forward from V2; this is the primary acquisition loop).
- Ranking and quiz-oriented visualization.
- Alternate display styles: donut, emoji pulse, gauge.
- Peer-instruction comparison.
- Word-cloud visualization with live display and host removal controls.
- Pseudonymous mode (shipped).
- Google and Microsoft host sign-in.
- Verified School Pro spaces.
- Teacher and steward membership.
- School-owned resources and curated collections.
- Limited school branding.
- Annual billing and impact statement.
- Webhooks and localization where justified.

### V2 - optional intelligence and scale

Candidates, subject to evidence:

- Single-node sovereign self-host adapter: Node + SQLite + ws hosting the unchanged domain (§16 tier 2).
- Pin-on-image entry with heatmap display (first entry type requiring media upload and R2).
- Point-allocation entry (split 100 points across options).
- Rating-matrix entry (rate several items on one scale).
- Aggregate misconception summaries.
- Agent-suggested follow-up questions.
- Deterministic threshold-based facilitation suggestions.
- Question-bank interchange.
- Large-session sharding.
- On-demand local or serverless summarization.
- Public and institution deck discovery.
- Optional hosted AI credits.
- OEM embedding SDK.

LTI, grade passback, SAML, SCIM, custom residency, and dedicated infrastructure are not assumed roadmap commitments.

## 18. Success metrics

### North star and activation

North star: **weekly active sessions with at least one opened interaction and at least five participants.** This counts real facilitated sessions, not signups or created decks.

Activation funnel, measured end to end:

1. Signup (or first CLI/agent authentication).
2. First published deck.
3. First live session with participants.
4. Second live session within 30 days (the habit signal for an episodic product).

Counter-metric: median setup time from deck to live session. Growth achieved by adding setup friction is a regression.

### Product

- Median time from source material to a valid deck.
- Median time from published deck to live session.
- Participant join completion rate.
- Ballot acknowledgement latency.
- Percentage of sessions using more than one interaction.
- Host reuse within 30 days.
- Percentage of sessions using anonymous mode.
- Decks created through API, CLI, MCP, or agent workflows.
- First-attempt agent validation success.

### School Pro and sustainability

- Schools with multiple active hosts.
- Shared resources and collection reuse per school.
- School memberships per 100 active hosted hosts.
- Support hours per school.
- Annual renewal rate.
- Hosted gross margin excluding optional AI usage.
- Portion of operating cost funded by memberships and support.

The strongest conversion signal is: enough educators at one school already use the free product that the institution wants a shared library, one payment, and a way to support it.

### Cost

- Worker requests per attendee-session.
- Durable Object requests per attendee-session.
- Durable Object active milliseconds per attendee-session.
- SQLite writes per attendee-session.
- Log events per attendee-session.
- R2 operations per session.
- Polling-fallback share of client time.
- Optional AI cost per generated deck.

## 19. Decisions locked by this PRD

1. `Session` is the portable product contract.
2. The GUI is a client of the same domain and command model as the CLI, API, MCP, and agents.
3. Published decks are immutable versions.
4. PowerPoint, Google Slides, and web embedding are first-class host surfaces, delivered in tiers (web SDK first) behind the INT-00 feasibility spike; the `Session`, not the deck, owns the sequence.
5. Participants join through a universal page using a short session code; QR is a shortcut to the same session.
6. One SQLite-backed Durable Object owns one normal live session.
7. HTTP commands are authoritative mutations and acknowledgements.
8. Hibernating WebSockets are the primary state-change notification channel.
9. Adaptive HTTP polling is a compatibility fallback.
10. No D1, Queue, LLM, R2, or content-logging operation occurs per ballot.
11. Anonymous, session-scoped participation is the hosted default. Identified participation exists, is opt-in per deck, and is reachable only with a tutor-issued context access link — never by self-registration.
12. Core polling, moderation, and *aggregate* exports are not premium poll-type gates. A per-ballot or named export is paid memory (`rawExport` / roster), not a locked interaction type.
13. There is no slide editor or hosted office conversion service.
14. School Pro is a shared library and membership product, not an institutional policy engine.
15. School Pro does not alter the live-session runtime.
16. The product does not monetize student attention or participant data.
17. The north-star metric is weekly active sessions with at least one opened interaction and at least five participants.
18. Stage visualizations are a first-class product surface: smoothly animated, projector-legible, and reduced-motion safe (STAGE-08 through STAGE-10).
19. Charge when the session becomes data. School Pro is legitimacy (shared space, one invoice). Practice and Training are the payers. Agent marketplaces, not comparison SEO, are the cheap global channel. OEM is a license when asked.
20. Participant text is display-first with a built-in always-on blocklist, one-tap removal, and panic hide. There is no approval queue, moderation dashboard, or per-session filter configuration.
21. Display style is a presentation attribute of an interaction primitive; it never introduces a new ballot shape, aggregate, or storage model.

## 20. Open decisions before implementation

1. ~~Product name, package scope, and primary domain.~~ **Decided:** product is OpenRoom (`@openroom/*` packages); primary domain is `openroom.app`. The working CLI name `poll` almost certainly collides with existing packages and shell conventions; the final CLI binary name follows the product name (still open).
2. Final license split between web/server, schemas, SDKs, and skills.
3. Host authentication provider for the hosted MVP.
4. Exact anonymous-ballot purge interval and aggregate retention defaults. Implemented defaults (DATA-04) are 30 minutes from session end to ballot purge and 24 hours from session end to full session deletion; the final hosted defaults, and whether they are configurable per session or per deck, remain open.
5. Whether MVP MCP includes live control or initially ships deck and aggregate operations only.
6. Final public service-level targets after the load-test baseline.
7. Free hosted abuse and usage guardrails.
8. School Pro price bands and whether they differ by school size or supporter contribution only.
9. Minimum aggregate group size for privacy suppression.
10. Blocklist sourcing and languages (which wordlists ship built-in, and how updates reach self-hosted deployments).

## 21. Current Cloudflare basis

The architecture relies on current Cloudflare capabilities documented as follows:

- [Durable Objects overview](https://developers.cloudflare.com/durable-objects/)
- [Durable Objects rules and coordination model](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [WebSocket Hibernation best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Durable Objects pricing and duration behavior](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Workers static assets](https://developers.cloudflare.com/workers/static-assets/)

These platform assumptions must be rechecked before implementation if Cloudflare limits or pricing change.

## 22. Risks and accepted tradeoffs

- **Single-cloud coupling (accepted, contained).** The cost model, the Durable Object session, and the one-command deploy path all assume Cloudflare — the price of near-zero marginal session cost, accepted deliberately. The containment is architectural: the coupling lives entirely in `apps/workspace-worker`; the domain is platform-free, which keeps the single-node Node/SQLite adapter (§16 tier 2) an adapter-sized effort rather than a rewrite. Docker-orchestrated multi-node hosting remains a non-goal.
- **Slide-integration platform constraints (mitigated).** Neither Office.js task panes nor Apps Script add-ons run during presentation mode; automatic slide-bound activation depends on workarounds (content add-ins, companion remote, browser extension). Mitigation: the tiered integration model, the INT-00 spike, and the decision that the deck, not the slide file, owns the sequence.
- **Incumbent response (watched).** Incumbents are shipping AI authoring, which erodes convenience-based differentiation. Mitigation: anchor on pricing structure, portability, self-hosting, and participant-data posture, which their business models resist copying.
- **Episodic usage and retention (designed for).** Weekly-at-best usage makes habit fragile. Mitigation: the reuse loop (deck library, versioned reuse), the public deck library, and the second-session-in-30-days activation metric.
- **Anonymous abuse surface (designed for).** Account-free sessions invite disruptive text and spam session creation. Classroom discipline is the primary control for participant behavior; anonymity weakens it only at the margin. Mitigation: a built-in always-on blocklist, display-first text with one-tap removal, panic hide-all and freeze, Turnstile on suspicion, strict limits, and session expiry.
- **Monetization hypothesis (open).** Willingness to pay by schools and individuals is unvalidated. Mitigation: multiple candidate revenue lines (individual Pro, professional hosts, OEM embedding, managed hosting, School Pro patronage) with none load-bearing for survival of the free core, whose hosting cost is structurally low.
