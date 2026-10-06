# OpenRoom — Shared Contracts (v1)

Working name: **OpenRoom** (`@openroom/*` packages, `openroom` CLI). Final name is PRD open decision 1.
This document is the single source of truth for types and protocols shared across packages and apps. All builder agents code against THIS document. If something here is ambiguous, pick the simplest interpretation consistent with `docs/PRD.md` and note it in your final report — do not invent new protocol surface.

## Monorepo layout

```
packages/schema        @openroom/schema   — Session JSON Schema, TS types, validator, YAML/JSON normalizer
packages/domain        @openroom/domain   — pure TS session state machine, commands, aggregates, blocklist (no I/O, no platform APIs)
packages/cli           @openroom/cli      — `openroom` CLI: init/validate/preview (+ session commands hitting the HTTP API)
packages/sdk           @openroom/sdk      — tiny browser client: join, snapshot fetch, WS+polling sync, command submit
packages/ui            @openroom/ui       — typed theme-token system: 5 built-in themes x light/dark, CSS-variable emission
apps/worker            — Cloudflare Worker router + SessionDO Durable Object + static asset serving
apps/participant       — participant web app (Vite + React + @openroom/charts)
apps/stage             — projector stage view (Vite + React + GSAP + Three + @openroom/charts)
apps/host              — host console (Vite + React + shadcn + @openroom/charts)
examples/              — example Session YAML files
```

Conventions: TypeScript strict (extend `../../tsconfig.base.json`), ESM only, vitest for tests, minimal dependencies (ajv, yaml, react, hono, TanStack Charts allowed; nothing heavier than the chart stack). Every package has `build` (tsc or vite), `test` (vitest run; a package with no tests uses `vitest run --passWithNoTests`), `typecheck` (tsc --noEmit) scripts. Workspace deps use `"workspace:*"`.

## Session (schema package)

**Default authoring: SimpleSession** (`title` + `questions`) — compiled by
`validateSession` / `parseSession` via `compileSimpleSession`. Agents and `openroom init`
emit this.

**Advanced / runtime SoT: Session** — full `version` / `meta` / `interactions`.
JSON Schema draft 2020-12 is normative at `packages/schema/schema/session.schema.json`.
TS types mirror it. Use Session only for peer instruction, ranking, qna, custom
displays, pedagogy, etc.

```ts
interface Session {
  version: 1;
  meta: { title: string; description?: string; locale?: string; source?: string };
  defaults?: {
    identityMode?: 'anonymous' | 'pseudonymous' | 'identified' | 'roster';
      // default 'pseudonymous'. 'identified' = context access link (see §Context access links).
      // 'roster' = host-typed seat + `orinv_…` (see §Roster). Roster is specified here
      // but not in the shipped JSON Schema until the join path exists — do not author it yet.
    resultVisibility?: 'hidden-until-close' | 'live';  // default 'hidden-until-close'
    allowAnswerChange?: boolean;                   // default true
    theme?: 'default' | 'chalkboard' | 'paper' | 'projector' | 'sherbet';  // default 'default'
  };
  interactions: Interaction[];                     // min 1; ids unique, kebab-case, 1-64 chars
}

type Interaction = ChoiceInteraction | ScaleInteraction | NumericInteraction | TextInteraction | QnaInteraction | RankingInteraction;

interface BaseInteraction {
  id: string;
  type: 'choice' | 'scale' | 'numeric' | 'text' | 'qna' | 'ranking';
  prompt: string;                                  // 1-500 chars
  display?: string;                                // per-type, see table below; validator rejects mismatches
  displayOptions?: DisplayOptions;                 // chart attributes for `display` (stripped/defaulted on normalize)
  resultVisibility?: 'hidden-until-close' | 'live';
  allowAnswerChange?: boolean;
  allowDontKnow?: boolean;                         // adds an explicit "I don't know yet" answer
  notes?: string;                                  // host-only, never sent to participant/stage
  pedagogy?: { objective?: string; explanation?: string; followUp?: string; durationSec?: number }; // estimated teaching time — not a live clock
  /**
   * Optional live countdown in seconds (1–7200). When set, opening the interaction
   * arms `closesAt` as an advisory window. Zero never auto-closes answering.
   * No speed scoring. Distinct from `pedagogy.durationSec`.
   */
  timerSec?: number;
}
interface ChoiceInteraction extends BaseInteraction {
  type: 'choice';
  options: { id: string; label: string; correct?: boolean; misconception?: string }[]; // 2-10 options
  multiple?: boolean;                              // default false
  peerInstruction?: boolean;                       // default false; vote → discuss → revote (see Domain)
}
interface ScaleInteraction extends BaseInteraction {
  type: 'scale'; min: number; max: number;         // integers, max-min between 2 and 10
  minLabel?: string; maxLabel?: string;
}
interface NumericInteraction extends BaseInteraction {
  type: 'numeric'; unit?: string; correct?: number; tolerance?: number; // tolerance requires correct
}
interface TextInteraction extends BaseInteraction {
  type: 'text'; maxLength?: number;                // default 200, cap 500
  correctAnswers?: string[];                       // scored short text; strip until reveal; match = trim + case-insensitive
}
interface QnaInteraction extends BaseInteraction { type: 'qna' }
interface RankingInteraction extends BaseInteraction {
  type: 'ranking';
  options: { id: string; label: string }[];        // 2-6 options; no per-option correct/misconception
  correctOrder?: string[];                         // optional correct permutation of option ids; strip until reveal; E_CORRECT_ORDER if not a permutation
}
```

Display styles (validator enforces; first = default): choice `bars|columns|donut|pie|radial|emoji-pulse`; scale `dots|gauge|bars`; numeric `histogram`; text `list|word-cloud`; qna `list`; ranking `ordered-bars`. Optional `displayOptions` carries chart attributes (orientation, showPercent, showCount, sortBy, colorMode, innerHole, binCount, maxWords, …); normalize strips keys that do not apply to the selected display and fills defaults.

`peerInstruction` is only valid on a choice interaction with `multiple` false or absent — anything else is `E_PEER_INSTRUCTION_CONFIG` with a JSON pointer at `/interactions/<i>/peerInstruction`. It is accepted by the JSON Schema on any interaction so the semantic error code is always the one reported.

Validator API: `validateSession(input: unknown): { ok: true; session: Session } | { ok: false; errors: SessionError[] }` where `SessionError = { code: string; path: string; message: string }`. Codes are stable strings like `E_SCHEMA`, `E_DUPLICATE_ID`, `E_DISPLAY_MISMATCH`, `E_TOLERANCE_WITHOUT_CORRECT`, `E_OPTION_COUNT` (choice 2-10, ranking 2-6), `E_PEER_INSTRUCTION_CONFIG`, `E_CORRECT_ORDER` (ranking `correctOrder` must be a complete permutation of option ids), plus the outline-only `E_UNKNOWN_KIND`, `E_UNKNOWN_REFERENCE`, `E_LAYOUT_MISMATCH`, `E_REVEAL`, and `E_BREAKOUT`. A step whose `kind` is missing or names no branch of the step union reports `E_UNKNOWN_KIND` **alone**, listing the kinds that exist: the union cannot be checked until `kind` picks a branch, so the other branches' complaints describe steps the author never wrote. For a step whose `kind` is valid, only that branch's errors are reported. `parseSession(text: string, format?: 'yaml'|'json')` parses (yaml pkg handles both) then validates. SimpleSession (`questions`, no `interactions`) is compiled first. `compileSimpleSession` / `isSimpleSession` are also exported. `normalizeSession(session)` fills all defaults and returns a canonical session. Also export `participantView(session, interactionId)` returning the interaction WITHOUT `notes`, `correct`, `misconception`, `tolerance`, `correctAnswers`, `correctOrder` fields (pre-reveal safety, API-06). `normalizeTextAnswer` / `textAnswerMatches` compare short-text answers.

### Outline v1

Tutor-led delivery uses `Outline` rather than authored pixels. The outline has `version`, `meta`, ordered `steps`, and ordinary `interactions`. Step kinds are `title|statement|cards|steps|term|activity|timer|media|debrief|break|join|blank|interaction`; CSS, coordinates, and arbitrary layout data are not accepted. `tutorNotes` are host-only and are removed by `projectOutlineStep` / `projectOutlineSteps` before stage or participant projection. `validateOutline` performs schema checks, unique-step checks, and interaction-reference checks, then compiles the outline's interactions to the existing `Session` runtime. `parseOutline` accepts YAML or JSON text.

#### Step presentation: typed structure only

Three optional step fields describe *structure*, never presentation. They are closed enums and derived keys; OpenRoom still chooses the pixels for every step.

| Field | Shape | Rule |
| --- | --- | --- |
| `layout` | `title\|text\|split\|grid\|media\|poll\|activity\|timer\|join\|blank` | Named arrangement of regions. A kind may only claim a layout its own content can fill — `poll` needs an aggregate (`interaction` only), `media` needs an image or video (`media` only), `activity` needs an instruction list, `timer` needs a countdown (`timer`, `break`), `join` is the full-slide session QR (`join` only), `blank` is the empty freeform canvas (`blank` only), `grid` needs two or more peer items (`cards`, `steps`, `debrief`). Anything else is `E_LAYOUT_MISMATCH`, and the message names the step, its kind, and the allowed set. `LAYOUTS_FOR_KIND` is the exported table. |
| `reveal` | `'together'` or `string[][]` | Ordered groups of the step's **part keys**. Every key must exist on that step and appear at most once, and no group may be empty (`E_REVEAL`). Parts the author leaves unplaced are **appended as trailing groups**, not rejected, so partial authoring is safe. `resolveRevealOrder(step, interactions)` returns the order actually played. |
| `breakoutOf` | `{ stepId, afterKey }` | Makes the step an on-demand detail hung off one part of a parent step; the tutor opens it and returns. The parent must exist (`E_UNKNOWN_REFERENCE`), `afterKey` must be a part key **of that parent**, the chain is one level only, and cycles are rejected (`E_BREAKOUT`). |

**Part keys** are derived from a step's own shape by `partKeysForStep(step, interactions?)` — the single implementation the validator and the deck editor UI both use. The vocabulary is closed: `header` (the heading, omitted on `statement` / `timer` / `media` / `blank` when no title is authored, and never on `join`), `body` (when the step has prose), `option-N` (one per option of the referenced interaction), `cell-N` (one per repeated peer item — a card, a list item, a debrief prompt, and a `term`'s optional example), `materials` (an activity's materials list, one part for the whole list), `image` (a media step's media region, or the optional picture on a title / statement / cards / steps / term / activity / debrief / interaction step). A `join` step has no parts — the QR is session state.

`title`, `statement`, `media`, and `blank` steps may also carry `elements` (max 12): `text`, `image`, `html`, `iframe`, or `pdf` objects with a percent `box` `{x,y,w,h}`. `html` is a fragment plus optional `css`, sanitised (no script, iframes, event handlers, `javascript:`, `@import`). An `html` element may instead carry `markdown` as its source, in which case `html` must be exactly `renderMarkdownToHtml(markdown)` — a writer that edits one must regenerate the other, and a mismatch is rejected. Markdown-backed elements are **reading material**: they scroll, and they render with reading typography rather than as a fixed fragment. An `iframe` is a separate typed element with an HTTPS `url` and accessible `title`; it renders sandboxed, without same-origin access, and sends no referrer. A `pdf` uses `url`, retained `assetId`, or package-local `resourceId` plus an accessible title, and opens in a restricted, scrollable PDF viewer. Desktop may locally extract selected pages before embedding them. A site may still refuse framing through its own `frame-ancestors` or `X-Frame-Options` policy, and a PDF server may force a download instead of allowing an inline viewer. Wired kinds must not carry `elements`.

A web-page slide is a blank step with one full-box iframe element:

```yaml
- id: article
  kind: blank
  elements:
    - id: news
      type: iframe
      url: https://example.org/embed/article
      title: News article
      box: { x: 0, y: 0, w: 100, h: 100 }
```

A reading-material slide is a blank step with one full-box markdown-backed `html`
element. Both fields are written, and `html` is exactly what the renderer makes
of `markdown`:

```yaml
- id: background
  kind: blank
  elements:
    - id: readTides
      type: html
      markdown: |
        # Tides

        The moon **pulls** the sea.
      html: |-
        <h1>Tides</h1>
        <p>The moon <strong>pulls</strong> the sea.</p>
      box: { x: 0, y: 0, w: 100, h: 100 }
```

A scrollable PDF slide uses the parallel `pdf` element:

```yaml
- id: handout
  kind: blank
  elements:
    - id: document
      type: pdf
      url: https://example.org/handout.pdf
      title: Session handout
      box: { x: 0, y: 0, w: 100, h: 100 }
```

Two more additions: an optional `media` object on those content kinds (same shape as a media step — `type`, `url`/`assetId`, `alt`, optional `focal`, `aspect`, `place`, and `size`); `media.place` is `left|right|top|bottom|fill`; `media.size` is an integer 20–100 (percent of the slide); `media.focal` is one of nine named points (`top-left … bottom-right`) saying which part of the frame matters when the region crops — a word, never a coordinate — and `activity.materials` is a `string[]` of what learners need, distinct from `instructions`, which is what they do. `timer`, `break`, and `join` cannot carry a picture.

**`kicker` is withdrawn.** The field existed on every step but `DESIGN.md`'s No-Kicker Rule forbids ever rendering an eyebrow label, so it was a promise the product refused to keep. It is gone from the types and the JSON Schema. Because steps are `additionalProperties: false`, it is **stripped rather than rejected**: `stripDeprecatedOutlineFields` (exported, listed in `DEPRECATED_OUTLINE_STEP_KEYS`) drops it before validation, exactly as unknown `displayOptions` keys are stripped today. Stored outlines carrying `kicker` still validate; the field is simply absent from the result. Do not author it.

See [`docs/TUTORING.md`](TUTORING.md) for the human route map and end-to-end preparation and delivery workflow.

Original school documents are deliberately outside this contract: Codex, Claude, or another external preparation client reads them and sends only the derived typed outline plus short provenance labels. OpenRoom stores neither the source file nor the model conversation.

## Domain package (pure functions, no I/O)

The session state machine. Everything is deterministic and serializable; the DO persists what these functions return.

```ts
type SessionStatus = 'lobby' | 'live' | 'ended';
type InteractionStatus = 'pending' | 'open' | 'closed' | 'revealed';

interface SessionState {
  sessionCode: string;
  code: string;                   // 8-char crockford-base32 session code, no vowels ambiguity
  status: SessionStatus;
  revision: number;               // monotonic, bumps on every applied mutation
  session: Session;             // normalized
  theme: string;                  // active theme id, one of the five; seeded from session.defaults.theme
  activeInteractionId: string | null;
  interactions: Record<string, InteractionRuntime>;
  qna: QnaState;                  // session-wide audience Q&A (see §Session Q&A); disabled-and-empty unless session.qna.enabled
  participants: Record<string, { joinedAt: number }>;   // key = participantId
  frozen: boolean;                // panic: no submissions, participant text hidden on stage
  endedAt?: number;
  purgedAt?: number;              // set by purgeBallots (PRD DATA-04); ballots and participants are gone
}
interface InteractionRuntime {
  status: InteractionStatus;
  ballots: Record<string, Ballot>;      // key = participantId; replacement = answer change
  aggregate: Aggregate;                 // recomputed on write, stored
  openedAt?: number; closedAt?: number;
  closesAt?: number;                    // absolute ms auto-close deadline while open with a session timerSec
  round?: 1 | 2;                        // peer-instruction interactions only; absent means round 1
  round1?: { ballots: Record<string, Ballot>; aggregate: Aggregate };  // archive written by interaction.revote
}
type Ballot =
  | { kind: 'choice'; optionIds: string[] }
  | { kind: 'scale'; value: number }
  | { kind: 'numeric'; value: number }
  | { kind: 'text'; text: string; hidden: boolean }   // hidden = blocklisted or host-removed
  | { kind: 'qna'; text: string; hidden: boolean; votes: number }
  | { kind: 'ranking'; optionIds: string[] }        // a COMPLETE permutation of the option ids, best first
  | { kind: 'dont-know' };
type Aggregate =
  | { kind: 'choice'; counts: Record<string, number>; total: number; dontKnow: number }
  | { kind: 'scale'; counts: Record<number, number>; total: number; mean: number | null; dontKnow: number }
  | { kind: 'numeric'; values: number[]; total: number; mean: number | null; median: number | null; dontKnow: number }
  | { kind: 'text'; entries: { participantId: string; text: string; hidden: boolean }[]; total: number }
  | { kind: 'qna'; entries: { participantId: string; text: string; hidden: boolean; votes: number }[]; total: number }
  | { kind: 'ranking'; scores: Record<string, number>; avgRank: Record<string, number | null>; total: number; dontKnow: number };

type Command =
  | { command: 'session.start' } | { command: 'session.end' } | { command: 'session.freeze' } | { command: 'session.unfreeze' }
  | { command: 'interaction.open'; interactionId: string }
  | { command: 'interaction.close'; interactionId: string }
  | { command: 'interaction.reveal'; interactionId: string }
  | { command: 'interaction.revote'; interactionId: string }        // peer instruction: archive round 1, reopen for round 2
  | { command: 'interaction.undoRevote'; interactionId: string }    // peer instruction: restore round 1, discard round 2
  | { command: 'session.advance' }                                     // open next pending, closing current
  | { command: 'session.theme'; theme: string }                        // host-only live theme switch
  | { command: 'text.hide'; interactionId: string; participantId: string }
  | { command: 'text.unhide'; interactionId: string; participantId: string }
  | { command: 'answer.submit'; interactionId: string; answer: AnswerInput }  // participant command
  | { command: 'qna.vote'; interactionId: string; targetParticipantId: string }
  // session-wide audience Q&A (see §Session Q&A):
  | { command: 'qna.ask'; questionId: string; text: string }        // participant; questionId is client-minted
  | { command: 'qna.upvote'; questionId: string }                   // participant; one upvote per participant per question
  | { command: 'qna.hide'; questionId: string }                     // host moderation
  | { command: 'qna.unhide'; questionId: string }                   // host moderation
  | { command: 'qna.stage'; mode: 'off' | 'list' | 'spotlight'; questionId?: string };  // host: projector placement

interface CommandEnvelope { idempotencyKey: string; expectedRevision?: number; actor: Actor; command: Command }
type Actor = { role: 'host' | 'participant' | 'stage'; participantId?: string };

// THE core function — pure, total:
function applyCommand(state: SessionState, env: CommandEnvelope, now: number):
  | { ok: true; state: SessionState; revision: number; effects: Effect[] }
  | { ok: false; error: DomainError };
type Effect = { type: 'notify' };                    // caller coalesces
type DomainError = { code: 'E_REVISION_CONFLICT' | 'E_INVALID_TRANSITION' | 'E_NOT_OPEN' | 'E_FROZEN' |
                     'E_FORBIDDEN' | 'E_UNKNOWN_INTERACTION' | 'E_INVALID_ANSWER' | 'E_INVALID_THEME' |
                     'E_ENDED'; message: string };
```

Ranking answers must be a complete permutation of the interaction's option ids — a partial list, a repeat or an unknown id is `E_INVALID_ANSWER`. The ranking aggregate is a Borda count: with k options, the option a ballot puts in position p (0-based) scores k - p points, so first place is worth k and last is worth 1; `avgRank` is the mean 1-based position, or `null` for every option while `total` is 0. "I don't know" ballots count in `dontKnow` only. Optional interaction field `correctOrder` is reveal metadata only (put-in-order quiz key); it does not change the Borda aggregate.

Peer instruction (`peerInstruction: true` on a choice): `interaction.revote` is host-only and valid only on that interaction when it is `closed` and in round 1. It archives the current ballots and aggregate into `round1`, empties the ballots, recomputes the empty aggregate, sets `round: 2` and `status: 'open'`, makes the interaction active again (closing whatever else was open) and bumps the revision. When the interaction is already in round 2 it is a no-op success WITHOUT a revision bump, checked BEFORE `expectedRevision` like the other documented no-ops (retry safety). `interaction.undoRevote` is the reverse: host-only, valid when a `round1` archive exists and `round === 2` (open, closed, or revealed). It restores the archived ballots and aggregate, sets `status: 'closed'`, `round: 1`, clears the archive, and discards round-2 votes. When already on round 1 (or never revoted) it is a no-op success without a revision bump. Anything else is `E_INVALID_TRANSITION`; a non-host actor gets `E_FORBIDDEN`. Anti-anchoring: the round-1 aggregate reaches participant and stage snapshots ONLY once the interaction is `revealed` (before that the field is present but `null`); the host snapshot carries it from the moment it exists. During round 2 the participant snapshot carries `round: 2` plus `ownRound1Answer` (that participant's own round-1 ballot, or null) and the answered flag starts over.

Theming (`session.theme`): host-only, valid in `lobby` and `live`. `theme` must be one of the five built-in ids (`default`, `chalkboard`, `paper`, `projector`, `sherbet`) — anything else is `E_INVALID_THEME` and the session keeps the theme it had. Re-sending the theme the session already has is an idempotent no-op success WITHOUT a revision bump, checked BEFORE `expectedRevision` like the other documented no-ops (retry safety). A real change bumps the revision and emits a notify, so participant, stage and console all restyle at the same revision. `theme` is not sensitive: it appears verbatim in all three snapshots and is never stripped by `participantView`.

Rules: idempotency is handled by the CALLER (DO stores key→result); `applyCommand` assumes a fresh key. `expectedRevision` mismatch → `E_REVISION_CONFLICT`, EXCEPT re-opening the already-active interaction (`interaction.open` on an interaction already `open`) which is a no-op success WITHOUT bumping revision (INT-06 retry safety). Host-only commands: everything except `answer.submit`/`qna.vote`/`qna.ask`/`qna.upvote`. Text answers pass through `applyBlocklist(text): { hidden: boolean }` — a built-in wordlist in `packages/domain/src/blocklist.ts` (English profanity/slurs, lowercase substring + word-boundary hybrid matching, ~100 entries, plus leetspeak normalization a→@ e→3 i→1 o→0 s→5).

### Session Q&A

Session-wide audience Q&A (`SessionState.qna`, session flag `qna: { enabled, maxLength }`, defaults `{ enabled: false, maxLength: 300 }`, hard cap 500): independent of every interaction — open in `lobby` and `live`, untouched by `interaction.open`/`session.advance`, never a rail step. Shape: `interface QnaState { enabled: boolean; stage: { mode: 'off'|'list'|'spotlight'; questionId?: string }; questions: Record<string, QnaQuestion> }`, `interface QnaQuestion { id; participantId; text; hidden; votes; voters: string[]; createdAt }` with `votes === voters.length` always. Every `qna.*` command is `E_FORBIDDEN` while `enabled` is false. `qna.ask`: questionId is CLIENT-minted (crypto.randomUUID, same trust model as idempotency keys; validated 1-64 chars), text trimmed, non-empty, ≤ the session's maxLength, through `applyBlocklist`; a participant may ask MANY questions; re-asking the identical (id, text) is a no-op success; same id + new text by the OWNER is an edit that keeps voters/votes/createdAt; another actor's id is `E_FORBIDDEN`. `qna.upvote`: unknown id `E_INVALID_ANSWER`, repeat vote `E_FORBIDDEN` (voters ledger is the one-vote authority; self-vote allowed). `qna.hide`/`qna.unhide` (host): flip `hidden`; hiding the spotlighted question resets `stage` to `{ mode: 'list' }`; already-in-state is a documented no-op. `qna.stage` (host): spotlight requires an existing, visible question (`E_INVALID_ANSWER` otherwise); identical placement is a documented no-op. Snapshots — participant: `qna` present only when enabled, `{ maxLength, questions: { id, text, votes, own, votedByYou, hidden, handle? }[] }`, visible questions plus the participant's OWN hidden ones; stage: `{ stage, questions: { id, text, votes, handle? }[] }`, visible only; host: always `{ enabled, stage, questions: { id, participantId, text, hidden, votes, createdAt }[] }` (attribution via the top-level `handles` map). In sessions that assign handles each question carries the asker's `handle` on participant and stage views — public attribution is a deliberate product decision, and in the pseudonymous default the handle is system-assigned and not PII; this is the ONE exception to "peers' handles are never sent". **In an identified session that same slot carries the context's display name**, so audience Q&A there is attributed under the name the tutor authored. That follows from choosing identified mode and is not a separate opt-in; anonymous Q&A in an identified session is not available. Purged sessions drop the attribution automatically (the rewritten `purged-<n>` participantId no longer resolves to a participant record). `voters` never leaves domain snapshots, any role. Order everywhere: votes desc, `createdAt` asc, id. Frozen empties participant/stage question lists (host unaffected); ended blocks all qna commands. Purge anonymizes `participantId` to `purged-<n>` (display order) and empties voter ledgers, keeping text/hidden/votes/createdAt. Back-compat: session states stored before the region existed are patched to `{ enabled: false, stage: { mode: 'off' }, questions: {} }` at every load boundary (`ensureQna`). Host surfaces: LiveHost section + `#/sessions/:id/qna` co-host Q&A desk (same bearer host token; multi-host fan-out already role-tagged); CLI/MCP parity deliberately deferred.

Retention (PRD DATA-04), also in domain and equally pure:

```ts
function purgeBallots(state: SessionState, now: number): SessionState;
```
Drops the per-person layer of a FINISHED session and keeps the aggregates: every `ballots` map becomes `{}` (peer-instruction `round1.ballots` included, with the round-1 aggregate anonymized by the same rules), `participants` becomes `{}`, text/qna aggregate entries keep `text`/`hidden`/`votes` with `participantId` replaced by `purged-<n>` (stable ordinal in stored entry order, 1-based), `purgedAt` is stamped and `revision` bumps by 1. Returns the state unchanged when `status !== 'ended'` (the purge is time-triggered by an alarm and must never race a live session) or when `purgedAt` is already set (idempotent — alarms can fire twice). `hostSnapshot` surfaces `purgedAt`; participant and stage snapshots do not.

Snapshot views (also in domain): `participantSnapshot(state, participantId)`, `stageSnapshot(state)`, `hostSnapshot(state)`. All three carry `theme` (the active theme id) — the wire snapshots forward it unchanged as `theme`.

Group response projection: session groups are live coordination state, not credentials or
space membership. Host snapshots expose group membership and participant labels. A phone
receives only its own group name/spokesperson flag and its shared ballot. Aggregate reveal
rules still apply to other groups and the stage. A group ballot survives spokesperson
changes; membership changes do not move historical answers. Requests bind to the displayed
group so late submissions cannot enter a different group's ballot. Recorded group names
and memberships are removed by the existing ballot purge. Answer counts and progress use
group seats for group questions; joined counts still count people. Private notes and
pedagogy are stripped from participant/stage wire interactions. Peer-instruction round one
stays hidden during discussion in multi-slide decks as well as poll-only decks.
- participant: revision, status, frozen, active interaction (via `participantView`), own current answer, answered-flag; results ONLY if interaction revealed or (`resultVisibility === 'live'` and open/closed). Never notes/correct pre-reveal. Peer instruction adds `round`, `round1Aggregate` (null until revealed) and `ownRound1Answer`. Sessions that assign handles (pseudonymous, and identified where the handle is the context display name) add `yourHandle` (own handle only — peers' handles are never sent, EXCEPT as `handle` attribution on session Q&A questions, see §Session Q&A). While the active interaction is open with a session `timerSec`, snapshots include `closesAt` (absolute ms auto-close deadline).
- stage: revision, status, code, join URL path, participant count, answered count, active interaction (participantView), aggregate only when revealable (same rule as participant), text entries excluding `hidden`, everything text-hidden when frozen. Peer instruction adds `round` and `round1Aggregate` (null until revealed). Same `closesAt` rule as participant.
- host: everything — the session document, notes, and per-interaction status, joined and answered counts, correct answers, hidden entries, and — for peer instruction — `round` plus `round1Aggregate` with no reveal gating. Per-interaction summaries and the active snapshot also carry `closesAt` while armed. Sessions that assign handles add `handles: Record<participantId, handle>`; the stage sees handles only as session-Q&A question attribution, and the CSV export gains a `handle` column (header `interactionId,prompt,participantId,handle,answer,hidden`) in every non-anonymous session — pseudonymous sessions put the session-local handle in that slot, identified sessions put the context display name there. Handles die with the purge (`participants` → `{}`). Retention is unchanged from DATA-04: ballots purged 30 min after end, session deleted at 24 h — the participant-facing notice states this.

## HTTP API (worker)

Base: same origin. JSON everywhere. Static apps: participant at `/`, stage at `/stage/`, host at `/host/`.

```
POST /api/sessions                          host-auth'd (session cookie + CSRF header, or `x-openroom-admin: <ADMIN_KEY secret>`)
                                         body { outline: Outline } → starts a LIVE session right here
                                         (400 missing-outline when the body carries no outline)
                                         → { sessionCode, code, hostToken, stageToken, joinUrl }
                                         a body naming a `deckId` instead falls through to the delivery
                                         plane's filed-session create (see GET|POST /api/sessions below)
PUT  /api/sessions/:sessionCode/assets/:resourceId  host token; raw image/audio/PDF bytes + SHA-256 before session.start
GET|HEAD /api/sessions/:sessionCode/assets/:resourceId  session-scoped ephemeral bytes; single byte ranges supported
POST /api/join                           body { code, recoveryHandle?, contextLink? } → { sessionCode, participantToken, participantId, identityMode, handle? }
                                         handle in pseudonymous sessions: a random session-local "Adjective Animal 1234",
                                         unique per session, assigned by the DO at join — never chosen by the participant.
                                         A matching recoveryHandle reuses the participantId without increasing joined count;
                                         unknown handles do not create participants and failed recovery is rate-limited per session.
                                         recoveryHandle in a non-pseudonymous session → 409 handle-recovery-unavailable.
                                         contextLink (`orlnk_…`) is for identified sessions only: the handle is then the
                                         context's display_name. The Worker verifies the link AND that the session's
                                         originating context matches (sessions.session_id → sessions.context_id) before forwarding
                                         only the display name to the DO — the link never reaches the Durable Object.
                                         identified session without contextLink → 403 context-link-required;
                                         contextLink to a non-identified session → 409 identified-join-unavailable;
                                         invalid / revoked / expired / wrong-context link → 403 context-link-invalid
                                         (one indistinguishable answer, so probing reveals nothing).
                                         identified session still in lobby → 409 session-not-started
                                         (the tutor pressing start is the gate; anonymous / pseudonymous
                                         sessions are unaffected and still admit lobby joins).
                                         Re-presenting the same link re-enters as the same participantId.
                                         A new participant past the session's participantLimit (50 unless the
                                         owner held largeSessions at creation) → 409 session-full; re-entry by
                                         handle, link or roster seat is never refused for size.
                                         A live session with no durable session row has no context, hence NO link
                                         can ever identify into it.
POST /api/mcp                            stateless MCP endpoint (Streamable HTTP, JSON only, no SSE/sessions)
                                         auth `Authorization: Bearer <orpat_… | ADMIN_KEY | mcp-access>`
                                         tools outline_validate / session_create / session_status /
                                         session_results / openroom_api / deck_get / deck_preview /
                                         deck_save_version / deck_draft_put / deck_start /
                                         session_facilitate / session_recap / session_command / picture_search
                                         PAT / user-scoped OAuth: tutoring records and owned sessions only;
                                         ADMIN_KEY cannot access user tutoring records
GET|POST /api/tutoring/contexts          list or create presentation contexts (person|group|class|event|other)
GET|PATCH|DELETE /api/tutoring/contexts/:id
                                         detail, edit, or recoverable trash
GET|POST /api/tutoring/contexts/:id/links
                                         learner credentials for ONE context; session auth, space member, editor or above
                                         (a presenter may run a session but may not mint a credential)
                                         POST body { expiresInDays? } (default 180, min 1, max 365)
                                           → 201 { id, token, tokenPrefix, createdAt, expiresAt }  raw token shown ONCE
                                           422 invalid-expiry | 409 resource-in-trash | 429 { error:"link-limit", max:10 }
                                         GET → { links: [{ id, tokenPrefix, createdAt, expiresAt, revokedAt }] }  prefixes only
DELETE /api/tutoring/contexts/:id/links/:linkId
                                         → { ok: true }; sets revoked_at, never hard-deletes (the audit trail is the point)
                                         404 when unknown or already revoked
GET /api/learner/me                      Authorization: Bearer orlnk_… ONLY → { contextId, displayName }
GET /api/learner/sessions                    Authorization: Bearer orlnk_… ONLY
                                         → { sessions: [{ id, title, status, record?: { outcomes, homework, artifacts } }] }
                                         homework is typed tasks; writing may include submitted. Never notes / nextNote.
GET /api/learner/practice                GET → { items: [{ itemId, interaction }] }  no dueAt
POST /api/learner/practice               { itemId, grade: again|good, answer? } → { done:true } | { item }
PUT  /api/learner/writing                { sessionId, taskId, body }
GET /api/tutoring/contexts/:id/returned  editor+ → { nextNote, writing, missed }  no dates or scores
  (all learner routes)                   per-client budget: 10 failed auths / 60 s → 429 { error:"learner-rate-limited" }
                                         keyed by salted SHA-256 of CF-Connecting-IP (raw IP never stored);
                                         checked before the credential, so 429 is identical for absent / malformed /
                                         unknown / expired / revoked and reveals nothing; success spends nothing and resets
POST /api/tutoring/contexts/:id/restore  restore from trash
POST /api/tutoring/contexts/:id/permanent-deletion
                                         create 15-minute browser confirmation URL; does not purge
GET|POST /api/decks           list or create decks (reusable content); optional validated first version;
                                         createSession:true opts into also filing a draft session (default: none);
                                         current clients send contextId; omission keeps the legacy shape and links "Needs context"
GET|PATCH|DELETE /api/decks/:id
                                         detail {deck, spaceName, folderName, contentVersion, content}, metadata edit, or recoverable trash
GET|POST /api/decks/:id/versions
                                         immutable content versions; POST requires optimistic baseVersion;
                                         a successful POST (including unchanged) clears the deck's draft
GET|POST /api/decks/:id/file-link
                                         bind one stable .openroom file UUID to this deck; editor+ to bind
GET|PUT|DELETE /api/decks/:id/file-locations/:deviceId
                                         caller-owned local path and sync watermark; never shared across users
GET|PUT|DELETE /api/decks/:id/draft
                                         one rolling auto-save draft per deck {source, baseVersion, updatedAt, updatedBy};
                                         source is editor text, NOT validated (half-typed YAML must still save) and is
                                         never read by launch or by the deck detail content; GET 404s when absent;
                                         PUT caps source at 256K chars (413); editor+ to write, member to read
POST /api/decks/:id/restore   restore from trash
POST /api/decks/:id/start     start the current saved deck with {requestId: UUID, stepId?};
                                         requestId becomes the durable session id; same creator/deck retries
                                         reuse the session and keep answers, position and reveals;
                                         presenter+ membership, owner team entitlement for shared access;
                                         draft text is not delivered; ended/expired sessions are not resurrected
POST /api/decks/:id/permanent-deletion
                                         create browser confirmation URL; MCP/CLI cannot confirm it
GET|POST /api/sessions              list or create sessions (one delivery of a deck); POST requires deckId;
                                         context defaults to the deck link for legacy compatibility;
                                         live/completed statuses are server-owned (422 status-server-owned)
GET|PATCH|DELETE /api/sessions/:id
                                         detail, metadata edit, or recoverable trash
GET|PUT /api/sessions/:id/record    curated outcomes, notes, nextNote (Card sticky), homework (string[] or typed tasks), selected artifacts; never transcript/ballots
POST /api/sessions/:id/launch       create an outline-aware session from the selected version;
                                         409 session-already-live when the session is already live
POST /api/sessions/:id/restore      restore from trash
POST /api/sessions/:id/resume       recover live capabilities using current account/space access;
                                         joining does not take presenter control; document references grant nothing;
                                         connection revocation also revokes recovered host capabilities
POST /api/sessions/:id/permanent-deletion
                                         create browser confirmation URL; MCP/CLI cannot confirm it
GET|POST /confirm-deletion/:token        signed-in browser only; GET warning form, POST irreversible purge
GET  /api/my/tokens                      session cookie → { tokens: [{ id, name, prefix, createdAt, lastUsedAt }] }
POST /api/my/tokens                      session + CSRF; body { name? } → 201 { id, name, prefix, createdAt, token }
                                         raw `token` shown once; SHA-256 stored; max 10 active per user
DELETE /api/my/tokens/:id                session + CSRF → revoke
GET  /auth.md                            Auth.md agent-registration guide (Markdown; H1 contains auth.md)
GET  /.well-known/mcp/server-card.json   MCP Server Card (SEP-1649) — serverInfo, transport.endpoint=/api/mcp, capabilities
GET  /.well-known/agent-card.json        A2A Agent Card — skills + JSON-RPC URL /api/a2a
GET  /.well-known/agent-skills/index.json  Agent Skills Discovery RFC v0.2.0 ($schema + skills[{name,type,description,url,digest}])
GET  /.well-known/agent-skills/:name/SKILL.md  skill-md artifact (SHA-256 matches index digest); source of truth is plugin/skills/
                                         DNS-AID (zone, not HTTP): SVCB under _a2a|_mcp|_index._agents.openroom.app
                                         + TXT index; see docs/dns-aid.md
GET  /webmcp.js                          WebMCP progressive script — navigator.modelContext.registerTool tools
                                         (join_session, open_host_console, open_documentation, get_agent_discovery, …)
GET  /.well-known/oauth-protected-resource[/api/mcp]
                                         RFC 9728 PRM: resource, resource_name, authorization_servers,
                                         scopes_supported, bearer_methods_supported:["header"]
GET  /.well-known/oauth-authorization-server[/api/mcp]
                                         RFC 8414 AS metadata + agent_auth { skill, register_uri, claim_uri, identity_types_supported, … }
GET  /.well-known/openai-apps-challenge  OpenAI plugin domain verification (plain text; 404 until OPENAI_APPS_CHALLENGE is set)
GET  /.well-known/api-catalog            RFC 9727 linkset (application/linkset+json); anchors /api and /api/mcp
GET  /openapi.json                       OpenAPI 3.1 for the public HTTP + MCP surfaces (service-desc target)
GET  /api/health                         liveness { status: "ok" } (status link relation)
POST /api/mcp/register                   RFC 7591 dynamic client registration (stateless signed client_id)
GET|POST /api/mcp/authorize              browser consent (session or PAT) → single-use code; exact redirect + consent proof
POST /api/mcp/token                      code + client_id + exact redirect_uri + PKCE S256 → revocable account token
POST /api/mcp/revoke                     token + client_id → idempotent revocation
GET  /api/my/connections                 account's active connected applications, no secrets
DELETE /api/my/connections/:id           own connection only; cookie writes require CSRF; retained host controls also denied
GET  /office/manifest.xml                deployment-relative PowerPoint task-pane XML manifest
GET  /office/taskpane.html               dedicated PowerPoint app; Office frame policy does not apply to other apps
GET  /api/sessions/:sessionCode/state            ?role=participant|stage|host  (Bearer token) → role snapshot { ...,revision }
                                         supports `?afterRevision=N` → 304 if unchanged
POST /api/sessions/:sessionCode/commands         Bearer token; body CommandEnvelope minus actor (server derives actor from token)
                                         → 200 { ok:true, revision } | 409 { ok:false, error }  (409 for E_REVISION_CONFLICT, 422 others)
GET  /api/sessions/:sessionCode/export?format=csv|json   host token → final results
                                         csv = per-ballot; after the ballot purge → 410 { ok:false, error:"ballots-purged" }
                                         json = aggregates; keeps working until the session is deleted
GET  /api/sessions/:sessionCode/ws?token=...     WebSocket upgrade (hibernation API). Server → client: {"v":1,"type":"session.changed","revision":N}.
                                         Fan-out is role-selective (sockets tagged with the token role): host commands (open/close/
                                         reveal/next/freeze/theme/end) → ALL sockets, coalesced ≥250ms; ballots (answer.submit,
                                         qna.vote) and joins → host+stage only, coalesced ≥1s — participant sockets are included only
                                         while the active interaction's results are participant-visible (`resultVisibility:'live'` or
                                         revealed). Participants never need a push for hidden ballots: the submitter has the HTTP ack.
                                         Exception: session Q&A (`qna.ask`/`qna.upvote`) rides the results channel with a coalescing
                                         "include participants" flag (mirrored in DO meta, hibernation-safe) — the question list is a
                                         shared surface, so those ticks always reach participant sockets without loosening the
                                         poll-ballot gating. Hidden group responses additionally notify only current members
                                         of affected groups, using participant tags derived from verified capabilities.
                                         Pending group IDs are mirrored in DO meta for hibernation. Every alarm flush announces
                                         the latest stored revision, including newer coalesced ballots. Client sends nothing except pings.
```

Tokens: HMAC-SHA256 signed via WebCrypto, format `base64url(payload).base64url(sig)`, payload `{ sessionCode, role, participantId?, exp }` (exp: participant 6h, host/stage 12h). Secret from env `TOKEN_SECRET`. Implement sign/verify in `apps/worker/src/tokens.ts`.

SessionDO: SQLite-backed Durable Object named `SessionDO`, id = `idFromName(sessionCode)`. Session code mapping in KV-less MVP: sessionCode IS derived — `sessionCode = code` (the code is the session id), `idFromName(code)`. Persists `state` as JSON in one SQLite row (MVP simplification; measured normalization later), `idempotency` table (key, resultJson, ts), and optional live-only embedded resources in `session_assets` plus 1 MiB `session_asset_chunks`. Start refuses a session whose referenced resources are missing. Single-range GET/HEAD serves those bytes inline; the existing 24-hour session `deleteAll()` removes them with all other session state. The alarm prunes idempotency rows older than 1h. Uses `ctx.acceptWebSocket()` hibernation API + `setWebSocketAutoResponse` for pings. Coalesced notify runs on two channels (broadcast immediately if that channel's last broadcast is older than its interval, else `ctx.storage.setAlarm` — no `setTimeout`): lifecycle (host commands → all sockets, 250ms) and results (ballots/joins → `getWebSockets('host'|'stage')`, 1s, plus `'participant'` sockets only when `resultsVisible(state, activeInteractionId)`; audience computed at send time). A lifecycle broadcast clears any pending results tick — everyone just refetched. This keeps per-round work linear in participants: without it every ballot notified every participant and each notified participant refetched a snapshot (quadratic). Session auto-expiry: alarm ends sessions idle 12h. Optional countdown: when an open interaction has `closesAt` (from the session's `timerSec`), the same multiplexed alarm applies host `interaction.close` at that deadline — no speed scoring.

Presentation contexts, decks (content metadata), immutable deck versions, sessions (delivery instances), Notes, trash state, and deletion intents are ordinary multi-tenant D1 business data. Only the active synchronized session is a Durable Object. Launch copies one selected deck version into the session so the session hot path never reads D1 or calls an AI provider.

Retention (PRD DATA-04), served by the same multiplexed alarm: `PURGE_AFTER_MS = 30 * 60 * 1000` and `DELETE_AFTER_MS = 24 * 60 * 60 * 1000`, both measured from `meta.endedAt` — recorded when a session reaches `ended` by command OR by the idle auto-end. At `endedAt + PURGE_AFTER_MS` the DO applies `purgeBallots`, persists and broadcasts `session.changed` once. At `endedAt + DELETE_AFTER_MS` it closes remaining WebSockets and calls `ctx.storage.deleteAll()`, dropping the in-memory state copy too, so join/state/export take the same 404 path as an uninitialized session. The alarm always re-arms to the nearest remaining deadline (pending broadcast, housekeeping, active `closesAt`, purge, delete); after the wipe there is none.

Worker env bindings (wrangler.jsonc): `SESSIONS: DurableObjectNamespace`, `TOKEN_SECRET`, `ADMIN_KEY`, `ASSETS` (static assets with `not_found_handling: single-page-application` per app dir). Router: hono or hand-rolled — hand-rolled preferred (few routes).

## SDK (browser client)

```ts
createSessionClient({ baseUrl, sessionCode, token, role, onChange(snapshot), onStatus(s: 'connecting'|'live'|'polling'|'offline') })
```
Fetches snapshot, opens WS; on `session.changed` with higher revision → refetch snapshot; falls back to polling (1.5s open / 6s idle, backgrounded 15s) when WS fails twice; resumes WS when possible. Exposes `submit(command)` with auto idempotency key (crypto.randomUUID) and retry-once-on-network-error (same key). Used by all three apps.

Control-plane surfaces are separate factories in the same package, each taking `{ baseUrl, token?, fetch? }` — omit `token` in a browser, where the `or_session` cookie plus the `x-openroom-csrf` header authenticates instead. `createTagsClient` (`packages/sdk/src/tags.ts`), `createPrefsClient` (`prefs.ts`), and `createDesignClient` (`decks.ts`):

```ts
const { decks, assets } = createDesignClient({ baseUrl, token });
decks.get(id, { version? })                  // → { deck, spaceName, folderName, contentVersion, content }
decks.listVersions(id)                       // → [{ version, createdAt, createdBy }] newest first
decks.saveVersion(id, content, baseVersion)  // → { version, unchanged? } · throws DesignConflictError on 409
decks.getDraft(id)                           // → draft, or null when there is none (404 is not a failure)
decks.saveDraft(id, source, baseVersion)     // → { savedAt } · raw YAML, never validated
decks.discardDraft(id)
decks.start(id, { version?, title?, start? })// POST /sessions then POST /sessions/:id/launch → session + sessionId
assets.upload(spaceId, bytes, { name, contentType, alt? })
assets.list(spaceId, query?)
```

`DesignConflictError.latestVersion` carries what the server actually holds, which is what a re-base needs; `FetchLike` accepts `Uint8Array | ArrayBuffer` bodies so `assets.upload` can post the file bytes themselves. The same operations reach the CLI as `openroom deck …` and MCP as `deck_get` / `deck_save_version` / `deck_draft_put` / `deck_start` — see `docs/AGENT.md` for the happy path. The deck editor's footer echoes those exact CLI lines and tool names from one shared definition, `apps/host/src/pages/deck-edit/agent-commands.ts`, so the UI cannot drift from the real commands.

## UI theming (`@openroom/ui`)

The typed token system every surface renders through. Zero runtime dependencies, no framework, no DOM lib — the host console (React + shadcn), the participant app (React + `@openroom/charts`) and the stage (React + GSAP + Three + `@openroom/charts`) all read the SAME CSS custom properties, which is what makes a live `session.theme` switch restyle all three at once. Branding is a **constrained token override, never custom CSS** (PRD SCHOOL-07).

```ts
type ThemeId = 'default' | 'chalkboard' | 'paper' | 'projector' | 'sherbet';
type ThemeMode = 'light' | 'dark';

interface ThemeTokens {                 // keys ARE the CSS variable names (shadcn convention)
  background; foreground;
  card; 'card-foreground'; popover; 'popover-foreground';
  primary; 'primary-foreground'; secondary; 'secondary-foreground';
  muted; 'muted-foreground'; accent; 'accent-foreground';
  destructive; 'destructive-foreground';
  border; input; ring;
  radius;                               // CSS length, e.g. '0.125rem' ('0rem' for projector)
  'chart-1'..'chart-5';                 // categorical viz palette
  'font-sans'; 'font-display';          // font stacks
}                                       // every value is a string; colours are #rrggbb

interface ThemeBranding { accent: string | null; logo: string | null }   // the Pro-tier slots
interface Theme { id: ThemeId; name: string; description: string; branding: ThemeBranding;
                  light: ThemeTokens; dark: ThemeTokens }

THEMES: Record<ThemeId, Theme>;  THEME_LIST: readonly Theme[];  THEME_IDS;  THEME_MODES;
TOKEN_KEYS;  CHART_KEYS;  DEFAULT_THEME_ID;

themeToCssVars(theme: Theme | ThemeId, mode: ThemeMode): Record<string, string>  // keys like '--background'
themeCss(themeId: string): string          // :root + [data-theme-mode="dark"] + prefers-color-scheme block
applyTheme(el, themeId: string, mode): Record<string, string>   // inline vars + data-theme/data-theme-mode
resolveTheme(id: string | undefined | null): ThemeId            // unknown → 'default'
getTheme(id): Theme;  isThemeId(v): v is ThemeId
contrastRatio(a, b): number;  meetsAA(a, b): boolean;  relativeLuminance(hex);  parseHex(hex)
```

CSS-variable naming: every token key becomes `--<key>` verbatim (`--background`, `--card-foreground`, `--chart-3`, `--radius`, `--font-display`). Two extra variables come from the branding slots: `--brand-accent` is always emitted (the branding accent, or the theme's own accent when none is set) and a branding accent additionally overrides `--accent` and `--ring`; `--brand-logo` is emitted as `url("…")` only when the logo URL is `http(s)` or root-relative and free of characters that could escape the declaration.

`applyTheme` takes any object with `style.setProperty` and `setAttribute` (a real `HTMLElement` satisfies it) — it is declared structurally so the package needs no DOM lib and Preact/React/plain-DOM callers use it unchanged. It sets `data-theme="<id>"` and `data-theme-mode="light|dark"` alongside the inline variables.

Accessibility floor: every one of the 10 built-in variants (5 themes x light/dark) is held to WCAG AA 4.5:1 by `packages/ui/test/contrast.test.ts` for `foreground`/`background`, `primary-foreground`/`primary`, `card`, `popover`, `secondary`, `accent`, `destructive` pairs and `muted-foreground`, and to 3:1 for every chart colour against the background. A Pro branding accent must clear the same bar — `meetsAA` is exported so a future branding editor can enforce it.

Dark mode: `themeCss` emits an explicit `[data-theme-mode="dark"]` block plus a `@media (prefers-color-scheme: dark)` block scoped to `:root:not([data-theme-mode="light"])`, so an app that never sets the attribute still follows the system, and an app that sets it wins.

## Apps (all Vite + React — participant and stage also share `@openroom/charts`; host adds shadcn chrome; no router lib — hash or path segments)

Shared visual language: all three apps style themselves exclusively from the `@openroom/ui` CSS variables (`--background`, `--foreground`, `--primary`, `--chart-N`, `--radius`, `--font-sans`, …), applied from the snapshot's `theme` via `applyTheme(document.documentElement, resolveTheme(snapshot.theme), mode)`. Dark mode follows `prefers-color-scheme` unless the app pins `data-theme-mode`. CSS transitions and animations honour `prefers-reduced-motion` (STAGE-08..10).

**Stage / host / participant result charts:** use shared `@openroom/charts` — [shadcn/ui charts](https://ui.shadcn.com/charts) (`ChartContainer` + Recharts) for aggregate visualizations (bars, columns, donut/pie, radial, dots, histogram, ordered-bars, peer dual-series, gauge via radial-text). Ecosystem libs cover the remaining displays: `@isoterik/react-word-cloud` for word-cloud, Magic UI–style marquee for emoji-pulse, shadcn Card composition for text/QnA lists. Charts must paint from `@openroom/ui` `--chart-*` (and related) tokens only; no ad-hoc palette. Accessible text summaries remain mandatory (`Frame` / figcaption / aria-live). Reduced-motion collapses chart animation to instant updates. Do **not** invent a parallel hand-rolled chart system for shapes the catalog or those libs already cover.

- participant (`/`): join form (8-char code, auto-uppercase) → single dominant active interaction; answer + change-answer until close; "I don't know" when enabled; acked state ("Answer received ✓"); offline/reconnecting banner; results view when revealed. Query `?code=XYZ` prefills+auto-joins (QR path).
- stage (`/stage/?session=...&token=...`): big join code + QR (draw QR with a tiny embedded QR lib or hand-rolled — `qrcode-generator` pkg ok, ~10KB), joined/answered counts, prompt, **shadcn/Recharts** aggregate visualization per display style (bars, columns, donut, pie, radial, dots, histogram, list, word-cloud, gauge, emoji-pulse) with `displayOptions`, hidden-until-reveal handling, frozen state hides text.
- host (`/host/`): sign in → paste/upload deck YAML → create session with the signed-in session; live console: interaction list with status chips, open/close/reveal/advance buttons, keyboard shortcuts (space=advance, o/c/r, f=freeze), joined/answered counts, per-text-entry hide/unhide, links to stage & join, end session, export buttons; chart type + `displayOptions` authoring; stage-mirror preview should use the same chart stack as stage where practical. Deployment admin credentials are never entered or stored in the browser.

## CLI

`openroom init [file]` (writes starter YAML), `openroom validate <file>`, `openroom preview <file>` (prints interaction-by-interaction summary incl. participant view), `--json` stable output for all. Live-session commands — the CLI verb stays `session` while the wire commands it sends are `session.start`/`session.end`/`session.advance`/`session.freeze`/`session.unfreeze` — (`openroom session start <file> --url --admin-key`, `open/close/reveal/advance/end`, `revote <interactionId>` (peer instruction: archive round 1 and reopen for round 2), `freeze/unfreeze`, `theme <themeId>` → `session.theme` (the five built-in ids; an unknown id is a usage error, exit 2, before any request), `hide/unhide <interactionId> <participantId>` → `text.hide`/`text.unhide`, `results`, `export`) hit the HTTP API. `results` prints the participantId and hidden flag of every text/qna entry, which is where the `hide` argument comes from. Participant actions (`answer.submit`, `qna.vote`) are deliberately absent: the CLI holds a host capability, not a seat in the session. Exit codes: 0 ok, 1 validation failed, 2 usage error.

**Deck commands** — `openroom deck get|save|draft|versions|start <id> --url <base> --token <bearer>` (`packages/cli/src/commands/deck.ts`). `get` prints the deck file as YAML on **stdout** and its summary on stderr, so `openroom deck get <id> > deck.yaml` captures the document and nothing else; `--version <n>` reads an older stamped version. `save --file deck.yaml` runs `parseOutline` **locally first**, so a broken deck file costs zero round trips and reports the same schema errors the server would; `--base <n>` defaults to the deck's `currentVersion`, read immediately before the write, and a stale base surfaces as `E_VERSION_CONFLICT` carrying `latestVersion` rather than a bare `E_HTTP 409`. `draft get|put|discard` is the unvalidated working text (`put` sends the file verbatim — no local parse, because the server does not validate drafts either). `versions` lists the stamped history newest first. `start` files a session and launches it, printing the session id, code and join URL. All of it goes through the same `/api/tutoring/**` allowlist as `openroom api`.

## Example decks (`examples/`)

`seg-camp.yaml` (choice pulse-check, 5 myth-buster choice questions with correct+misconception, discussion text prompt, numeric estimation, closing word-cloud text), `exit-ticket.yaml`, `peer-instruction.yaml` (uses `peerInstruction: true` and the revote cycle), `estimation.yaml`, `ranking.yaml` (classroom prioritization with an `ordered-bars` ranking), `04-type-answer.yaml` (`text` + `correctAnswers`), `05-correct-order.yaml` (`ranking` + `correctOrder`), `06-true-false.yaml` (True/False as a `choice` preset). All must pass `openroom validate`.

## Auth and control plane (v1)

Everything above describes the **session plane**: capability tokens, the SessionDO, the ballot hot path. This section adds the **control plane**: who the host is, what they own, and how they get back to a session. The two planes are deliberately separate — a session cookie is never accepted on a session route, and a capability token is never accepted on a control-plane route, so a leaked session link stays scoped to exactly one session.

**The only D1 access during a live session is one INSERT at session creation.** Joining, answering, snapshots, WebSocket fan-out and export never touch D1.

### D1 binding and schema

Worker binding `DB: D1Database` (wrangler.jsonc `d1_databases`, `database_name: "openroom"`, `migrations_dir: "migrations"`). The committed `database_id` is a placeholder — the integrator replaces it with the id from `wrangler d1 create openroom`. Miniflare/vitest ignores it and uses a local database.

**The schema's source of truth is `apps/worker/src/db/schema.ts`** (drizzle-orm table definitions). SQL migrations are **generated, never handwritten**: edit `schema.ts`, then run `bun run db:generate` in `apps/worker` (`drizzle-kit generate`, configured by `apps/worker/drizzle.config.ts`). Output lands in `apps/worker/migrations/` — currently a single squashed `0000_init.sql` plus the `meta/` snapshot directory, **which must stay committed** because drizzle-kit diffs against it to produce the next migration. Wrangler (`migrations_dir`) and the vitest harness (`readD1Migrations`) both read that same directory, so a generated migration needs no copy step. The runtime does **not** use drizzle: request handlers keep issuing raw `env.DB.prepare()` statements; `schema.ts` exists purely so the DDL has one authoritative definition.

Core tables (28 in all; the rest cover media, archives, learner state, desktop file links and auth tickets):

```
users(id PK, google_sub UNIQUE NOT NULL, email NOT NULL, name, created_at, entitlements DEFAULT '{}', prefs DEFAULT '{}')
auth_sessions(id PK, user_id → users(id), created_at, expires_at)      idx: user_id, expires_at
spaces(id PK, owner_user_id, name, created_at, updated_at, settings DEFAULT '{}')
folders(id PK, space_id, parent_id?, name, sort_order, created_at, deleted_at?)
decks(id PK, space_id, folder_id?, context_id?, created_by, title, shape, current_version, metadata_json, created_at, updated_at, deleted_at?)
deck_versions(id PK, deck_id → decks(id), version, content_json, created_at, created_by, content_hash?, source_kind, source_file_id?, source_local_revision?, UNIQUE(deck_id, version))
sessions(id PK, space_id, folder_id?, deck_id → decks(id), deck_version, context_id?, created_by, title, shape, status, metadata_json, created_at, updated_at, deleted_at?)
live_sessions(code PK, user_id?, title?, created_at, ended, deck_id?, deck_version?, session_id?, space_id?)
space_members(space_id, user_id, role owner|editor|presenter, invited_by?, created_at, PK (space_id, user_id))
space_invites(id PK, space_id, email lowercase, role editor|presenter, invited_by, created_at, accepted_at?, accepted_by?, revoked_at?)
item_tags(space_id, item_type deck|session|record|context, item_id, tag, created_at, created_by?)
```

`sessions` is the **filed** session — a row in a space, made by starting a deck. `live_sessions` is the **running** session directory: one row per join code, pointing back at `session_id` and at the `deck_id`/`deck_version` it was started from. `auth_sessions` is the sign-in cookie table and has nothing to do with either.

Workspace hierarchy: **Space → Folder → Deck → Session**. There is no level between a space and its folders: the space *is* the work area, and folders nest inside it. A folder holds two item types: **decks** (reusable, versioned content) and **sessions** (one teaching of a deck, created by **starting** it — there is no scheduling anywhere, browser or API; launching a session creates its live session). First `GET /api/my/spaces` bootstraps a Personal space with a "My sessions" folder.

Collaboration puts the sharing boundary on the **space**. The effective role on a space is the `space_members` row if one exists, else **owner** when the caller is the space's `owner_user_id` — personal spaces are single-member, so a space with no member rows behaves exactly as it did before sharing existed. "Shared with me" = has a `space_members` row on a space you do not own. `space_invites.id` is 16 random bytes and doubles as a future emailed accept-link token; a partial unique index allows one *pending* invite per (space, email); acceptance requires the session user's email to match (`users.email` is not unique, so invites are matched at accept time, never resolved to a user id at invite time). `deck_versions.created_by` attributes each version to the teacher who saved it.

`users.entitlements` is reserved for manual development grants to accounts without
any Paddle customer mapping. Linked accounts derive capabilities from verified
subscription state and the current approved price catalog through
`apps/worker/src/entitlements.ts`. Only billing ingestion/reconciliation writes
subscription state; neither client requests nor checkout redirects can grant
access. Interface preferences live separately in `users.prefs`. Closed allowlist; unknown keys are ignored; only JSON `true` sets a flag:

```
{ keep, roster, rawExport, branding, team, continuity, largeSessions, connectors }  // all boolean, default false
```

| Flag | Unlocks |
| --- | --- |
| `keep` | Snapshot the ended session to R2 (`session_archives`); DO still purges at 30 min and dies at 24 h |
| `roster` | Create a session with `identityMode: roster` and mint `orinv_…` seats |
| `rawExport` | Per-ballot / named CSV (and ballots inside a `keep` snapshot) |
| `branding` | Create and edit shared brand kits; existing kits and designs remain readable after downgrade |
| `team` | Invite and admit new space members; start new shared sessions. Existing paid session collaboration continues while membership remains valid |
| `continuity` | The teaching loop: session Notes (`/api/sessions/{id}/record`, including `nextNote` and homework), context people and access links, returned and learner work, creating identified sessions, and `/api/learner/*`. Read from the space owner. Denied as `403 continuity-required` (learner routes: the revoked-link `401`). Contexts themselves, trash, restore, permanent deletion and link revocation are never gated |
| `largeSessions` | A live session admits more than `FREE_SESSION_PARTICIPANT_LIMIT` (50) participants. Read from the space owner (the personal creator outside a space) once, at session creation, and carried into the DO; joins never read D1 and a later lapse changes nothing for that session. Admin-key sessions have no owner and no limit. Without it, a new participant past the limit receives `409 session-full` from `POST /api/join`; re-entry by an admitted participant (recovery handle, access link or roster seat) is always admitted. The host snapshot carries `participantLimit` when one applies |
| `connectors` | Reserved, unimplemented archive delivery workflows; rejected in Paddle price catalogs |

Free hosts see every flag `false`. A deployment without `PADDLE_ENVIRONMENT` is
self-hosted: every account sees every flag `true` except `connectors`
(docs/BILLING.md). `/api/me` returns the parsed object. No user route may write this column.

### Export split

`GET /api/sessions/{id}/export` (host capability):

- `format=json` — aggregates only. Free until the DO is wiped.
- `format=csv` — **aggregate** CSV (one row per interaction, counts). Free until the DO is wiped.
- `format=ballots` — today's per-ballot CSV (including `handle` when the session is not anonymous). Requires `rawExport` or `identityMode === 'roster'`. `410 ballots-purged` after DATA-04 unless a `keep` archive exists.

`session_results` (MCP) stays the JSON aggregate shape. Do not add a ballot tool on the free MCP path.

### Named session invites

A host types display names for **one session**. Each `orinv_…` token is shown once.
The Worker verifies it against that session code and forwards only the display
name and seat key into the DO. Lobby join is allowed. Direct, deck and MCP creation
check the paid capability before allocating an audience. In a space this belongs
to the space owner; invitees need no personal licence. After downgrade, existing
invites may still join and hosts can read or revoke them; minting new invites
requires current paid access.

### Session archives

REST and MCP run the same completion service after the DO accepts `session.end`.
The space owner's `keep` capability (or the personal creator's for a session
outside a space) writes one R2 snapshot and D1 pointer per session. Aggregates are
always retained; individual responses require `rawExport` at capture. The DO
still enforces DATA-04; archive retention is 90 days. Retried end commands cannot
create additional archives or extend that retention.

Archive reads use account authentication: cookie, PAT or connected-client OAuth,
including CLI and MCP. Current space membership controls shared archive access;
personal archives require their owning account. Existing archives remain readable
after downgrade until expiry. A removed member loses access even if they started
the session or have their own paid subscription. Live/participant/learner tokens
never grant access to account archives.

The capture includes readable labels for all eight interaction types. Later deck
edits cannot relabel these answers. The readable document includes visible text
and audience questions but excludes automatic participant identifiers, hidden
entries, answer keys and teaching guidance. Authored text can still contain names.
The standalone HTML report escapes submitted text and loads no external resources
or scripts. Raw JSON and individual-response CSV are separate downloads and may
contain hidden entries and identifiers; the UI prompts the host to review files
before sharing.

`#/results/:id` opens one read-only file from the deck's Library panel or the ended
Desktop session strip. Titles and available formats identify files; no date/status
ledger or results navigation shelf is introduced. The account API supports exact
deck/session filters and bounded cursor pagination under the same access check.

A saved deck's durable session identity exists independently of its optional
student context. The host bootstrap returns that identity even when context is
null, preserving the private scratchpad's handoff to Notes and the deck's Library
location. A temporary session with no durable row returns neither identity nor
context. This bootstrap remains unavailable to participants and learners.

Session details expose `canEdit` from the current space role and trash state.
Shared Notes remain readable to presenters, while editor access permits direct
saves; this does not introduce an approval workflow. Writes always recheck access.
The host renders saved content read-only for presenters and keeps their private
scratchpad in the browser, with a text download. Editing roles never upload that
scratchpad automatically. A refused save preserves the local notes instead of
discarding the draft. Query caches are account-scoped and do not keep displaying
saved content after an authorization error.

### Google OIDC (authorization code + PKCE)

Config comes from `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` secrets, with optional `GOOGLE_AUTH_URL` (default `https://accounts.google.com/o/oauth2/v2/auth`) and `GOOGLE_TOKEN_URL` (default `https://oauth2.googleapis.com/token`) overrides. When `GOOGLE_CLIENT_ID` is unset the Google auth routes answer **501 `{error:"auth-not-configured"}`**.

**Dev demo accounts.** When `DEMO_AUTH=1` (set in `.dev.vars` for local only — **never in production**), static seed accounts (`alice` / `bob` / `cara`, password `demo`) can mint a real `or_session` cookie without Google. Demo users are upserted under synthetic subjects `demo:<username>` so the deck library, session ownership, quota and recovery all work identically to Google sign-in. The host app shows a combobox + username/password form when demo is on.

```
GET  /api/auth/status           → { google, demo, accounts:[{username,email,name}] }
POST /api/auth/demo/login       → 200 { user } + session cookie  (body {username,password})
                                → 401 invalid-credentials | 501 demo-auth-disabled
GET  /api/auth/google           → 302 to Google, or 501 when unconfigured
                                → `?desktop=1` marks the start as a Desktop handoff
GET  /api/auth/google/callback  → 302 /host/ with the session cookie set
                                → desktop starts: 200 HTML that opens `openroom://auth/desktop?ticket=`
POST /api/auth/desktop/redeem   → 200 { ok:true } + session cookie; ticket is one-use
POST /api/auth/logout           → 200 { ok:true }, cookie cleared          (csrf header required)
GET  /api/me                    → 200 { user:{ id, email, name, entitlements } | null }
```

`/api/auth/google` generates a random `state` and a PKCE verifier, stores both in a **signed, HttpOnly, 10-minute** `or_oauth` cookie (`Path=/api/auth`), and redirects with `scope=openid email profile`, `code_challenge_method=S256` and `redirect_uri = <origin>/api/auth/google/callback`.

The callback verifies the state cookie, exchanges the code with the PKCE verifier plus the client secret, then **parses the `id_token` payload without verifying its JWS signature**. That is safe *here specifically*: the token was not handed to us by a client — we fetched it ourselves over TLS, directly from Google's token endpoint, in a confidential-client exchange authenticated by our client secret and bound to our PKCE verifier. Provenance comes from the transport, which is exactly the case OIDC Core §3.1.3.7 carves out. We additionally check `iss` ∈ {`https://accounts.google.com`, `accounts.google.com`}, `aud === GOOGLE_CLIENT_ID`, and `exp`. **If an id_token ever arrives from anywhere else** (an implicit flow, a client POST, a cached blob) this shortcut becomes a vulnerability and full JWKS verification is mandatory.

The user is upserted by `google_sub`, a `sessions` row is created with a 30-day expiry, and `Set-Cookie: or_session=<signed session id>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`. Cookie values are HMAC-signed with `TOKEN_SECRET` using the same primitive as capability tokens (`signCookieValue`/`verifyCookieValue` in `tokens.ts`), so a tampered cookie is rejected before it reaches D1.

OpenRoom Desktop must not run the Google hop inside Electron. Forwarding only `accounts.google.com` after `/api/auth/google` has already set `or_oauth` in Electron leaves the callback in the system browser without the PKCE cookie. Desktop therefore opens the **start** URL (`/api/auth/google?desktop=1`) in the system browser so the whole dance, cookie included, stays there. The callback then mints a two-minute one-use ticket and returns an interstitial that opens `openroom://auth/desktop?ticket=…`. Desktop redeems the ticket on `POST /api/auth/desktop/redeem` and stores `or_session` in its own cookie jar. Interactive authentication stays a browser action; the custom-scheme hop is only the return.

Session lookup is **exactly one D1 read per request and nothing is cached** — a logout must take effect on the very next request, and a primary-key hit is not worth trading for revocation latency.

**CSRF.** Every cookie-authenticated *mutating* route requires the header `x-openroom-csrf: 1` (403 `{error:"csrf-required"}` otherwise). `SameSite=Lax` already prevents a cross-site form or `fetch` from carrying the cookie on a POST; the header is defence in depth — a simple cross-origin form cannot set it, so the protection survives a SameSite regression or a lax browser. Identity is checked *before* the header, so an anonymous caller gets 401, not a confusing 403. Browser clients send `credentials: 'same-origin'` on every control-plane call.

### Context access links and the learner surface

**Five credential families now coexist, and none is ever accepted where another belongs.**

| Credential | Shape | Proves | Unlocks |
| --- | --- | --- | --- |
| Sign-in session | `or_session` cookie (+ `x-openroom-csrf: 1` on writes) | who the tutor is | control plane only |
| Personal API token | `Authorization: Bearer orpat_…` | the same tutor, headless | control plane minus final purge |
| Deck capability token | `Authorization: Bearer <signed>` | a seat in one live session | exactly that session |
| **Context access link** | `Authorization: Bearer orlnk_…` | possession of one context's learner credential | exactly that context's learner-visible records |
| **Roster invite** | `orinv_…` | this named seat on one session's roster | join that one session as that host-authored name |

`orlnk_<id>_<secret>` (id 16 bytes, secret 32 bytes, both base64url) deliberately mirrors `orpat_` so the two are distinguishable in logs and cannot be confused by a shape check. Only `sha256Hex(token)` is stored; `token_prefix` (first 12 chars) is what the listing shows. Liveness is entirely in the SQL — the row must exist, be unrevoked, be unexpired, and point at a context that is not trashed — so there is no code path where a dead link resolves. Purging a context deletes its links outright.

**The boundary — an invariant, in the same voice as the session-token rule in `apps/worker/src/auth.ts`:**

A context access link resolves to a `VerifiedContextLink` (`{ linkId, contextId, displayName }`) and **never to a `SessionUser`**. It therefore physically cannot be handed to `requireControlUser`, to `/api/tutoring/*`, or to `/api/my/*`. It creates no `users` row, no session, no space membership, and nothing derived from a space role. It grants exactly one context's learner-visible data — ten students in one space cannot read each other. **The blast radius of a leaked link is exactly one context.**

Two structural consequences that a later change must not erode:

- **`/api/learner/*` is dispatched before the control plane.** No learner path can fall through to cookie or PAT auth; an unknown `/api/learner/*` path returns 404 from the learner router rather than continuing down the chain. `requireContextLink` never reads the cookie jar, so no amount of browser state can promote a request into a learner response.
- **The context id comes from the credential, never from the request** — no path parameter, no query string, no body field. A caller has no vocabulary in which to *ask* for another context, so cross-context reads fail by absence of a request shape rather than by an access check that a later refactor could mis-order.
- **The throttle lives in the guard, not in the routes.** `requireContextLink` spends a per-client budget (10 failures / 60 s, `learner_auth_attempts`) before it looks at the credential, so every learner route — including ones not written yet — is budgeted by construction, and `429 learner-rate-limited` is reachable identically for an absent, malformed, unknown, expired or revoked link. It is cost control on the only cookie-less route family plus a brake on bulk-validating a leaked batch; against a 256-bit secret it is not, and is not claimed to be, anti-brute-force. Clients are keyed by a salted SHA-256 of `CF-Connecting-IP` — a raw-IP column would contradict the data-minimisation posture, so there isn't one.
- **Identified sessions require a started session.** `POST /api/join` with a `contextLink` is `409 session-not-started` while the session is in `lobby`; the tutor pressing start is the gate, so a leaked link cannot be used against an unattended lobby. Anonymous and pseudonymous joins are unchanged.

**Withheld from every learner response** (the query is a **column allowlist**, not `SELECT *` with deletions, so a future migration cannot leak by default): `session_records.notes` (tutor-private assessment prose); `session_records.session_code` (a live-session join code — handing it over would convert a records credential into a session credential); `sessions.deck_id` / `deck_version` and `session_records.deck_version` (tutor IP, shared across contexts); `sessions.space_id` / `folder_id` (someone else's filing structure); `sessions.created_by` (the tutor's user id); `sessions.metadata_json` (internal tutor metadata, no learner contract); and draft or trashed sessions (unpublished tutor planning).

**Tutor-side authorization** for `/api/tutoring/contexts/:id/links*` is space member **and `editor` or above**. Minting a credential is a privilege-escalation primitive, so a `presenter` — who may run a live session but may not change the library — must not be able to. Defaults: 180-day expiry (≈ one school year; long enough that nobody re-mints mid-term, which is the failure mode that gets links pasted into group chats), bounds 1–365 days, and at most **10 live links per context**.

### Live-session creation, quota and recovery

`POST /api/sessions` now accepts **either** credential:

- **Session cookie** (the normal path): requires the CSRF header. Quota is **20 sessions per rolling 24h per user** (a `COUNT` over `sessions`); beyond it, **429 `{ok:false, error:"session-quota"}`**. On success a `sessions` row is inserted with `user_id` and `title` from the outline's `meta.title`.
- **`x-openroom-admin`** (ops override): unchanged and unquota'd — CLI, scripts, incident response. The session is created with **no owner** and no `sessions` row.

Neither credential ⇒ 401, as before.

```
GET /api/my/sessions   → { sessions: [{ code, sessionCode, title, createdAt, ended, recoverable, hostToken?, stageToken? }] }
```

Session-auth'd. Live sessions **younger than 12h and not marked ended** are `recoverable: true` and come back with a **freshly minted host + stage token** — this completes LIVE-11 cross-device recovery: sign in on the second device, click reconnect, keep running the session.

Tokens are minted **optimistically**. The listing does not ask the SessionDO whether each session is still alive: that would be one cross-DO round trip per session on every page load, and cross-DO chatter is exactly what this design avoids. `sessions.ended` is therefore **advisory only** — nothing writes it back from the DO. A session that has ended, auto-expired or been wiped simply 404s the moment the console uses its token, which is the same path an uninitialised session already takes. The DO remains the single authority on liveness.

### Workspace (spaces and folders)

All session-auth'd; all writes require the CSRF header. The **deck library itself is not here** — decks and filed sessions are the delivery plane's `/api/decks` and `/api/sessions` (documented under §HTTP API); this section is only the containers they are filed in. Every stored deck version is validated with `@openroom/schema` (`validateOutline`) before it is written and rejected with **422 `{error:"invalid-content", errors: SessionError[]}`**.

```
GET      /api/my/spaces                  → { spaces: [{id,name,role,shared,createdAt,updatedAt}] }  owned + shared
POST     /api/my/spaces                  body { name } → 201
GET      /api/my/spaces/:id              → { space:{…,role,settings}, itemTags, folders, decks, sessions, records, liveSessions }  (?folderId=)
                                         decks = filed decks; sessions = filed sessions; liveSessions = running join codes
                                         liveSessions[] = { code, sessionCode, title, createdAt, ended }
PATCH    /api/my/spaces/:id              body { languages: {taught,native}|null } → { ok, settings }   editor+; 422 unsupported-language-pair
POST     /api/my/spaces/:id/folders      body { name, parentId? }              editor+
PATCH/DELETE /api/my/folders/:id                                              editor+ (legacy DELETE hard-removes)
POST     /api/my/folders/:id/trash                                            editor+ recoverable subtree trash
POST     /api/my/folders/:id/restore                                          editor+
POST     /api/my/folders/:id/permanent-deletion                               editor+ returns browser confirmation URL
GET      /api/my/folders/trash                                                top-level trashed folder subtrees
POST     /api/my/folders/:id/copy                                             editor+ duplicates the folder subtree only
GET      /api/my/sessions                → { sessions: […] }  live-session directory + recovery (see above)
```

Folder copy duplicates **only the folder subtree** — names and nesting. No items are cloned: a copied folder comes back empty of decks and sessions. (Item cloning existed once for the deleted legacy library type and was removed with it.)

The authoring CRUD that used to be listed here is `/api/decks` and `/api/sessions` in the delivery plane:

```
GET|POST     /api/decks                    ?spaceId=&folderId=&contextId=&trash=1 · POST editor+ · 201
GET|PATCH|DELETE /api/decks/:id            detail (?version=N) · rename/move · recoverable trash
GET|POST     /api/decks/:id/versions       POST body { content|outline, baseVersion } → 201 { version }
                                           400 base-version-required · 409 version-conflict { latestVersion }
                                           422 { error:"invalid-content", errors: SessionError[] }
GET|PUT|DELETE /api/decks/:id/draft        rolling unvalidated auto-save
POST         /api/decks/:id/restore        · POST /api/decks/:id/permanent-deletion
GET|POST     /api/sessions                 filed sessions; POST requires deckId
GET|PATCH|DELETE /api/sessions/:id         · POST /api/sessions/:id/{launch,restore,permanent-deletion}
```

`spaces.settings` is a whole-object JSON column, following
the `users.prefs` precedent. Today it carries one key, `languages: { taught, native }` — the pair a
language-tutoring space teaches, and the only place any surface learns it. It is closed to the
pairs `packages/schema/src/languages.ts` has a verified dictionary source for; anything else is
refused with 422 `unsupported-language-pair` rather than stored. An absent key means the space is
not a language-tutoring space, which is why the dictionary answers 422 `languages-not-configured`
instead of guessing from an outline's locale.

`/api/my/folders/:id*` addresses a folder by its own id; its parent is a space. There is no level
between a space and its folders, and no route for one: callers list spaces at `GET /api/my/spaces`
and open one at `GET /api/my/spaces/:id`. The product is pre-production, so nothing that was
removed leaves an alias or a redirect behind.

The console uses the recoverable trash routes for decks, sessions and folders. Hard `DELETE`
remains available on decks, sessions and folders for API clients that want it; permanent purge in
the console always requires the short-lived signed-in browser confirmation page. A permanent
deletion is confirmed in the browser only — MCP and the CLI can create the intent but cannot
confirm it. Deletion-intent resource types are `context | deck | session | folder`, and trash
covers the same four.

### Space collaboration

Three roles, enforced in the control plane only (the session plane stays capability-token-only): **owner** manages the space and its members, **editor** creates and edits material, **presenter** may read decks and create sessions (`POST /api/sessions` with a `spaceId` requires any role on that space) but gets **403 `forbidden`** on every mutation. No school hierarchy, rosters, or org admin.

```
GET    /api/my/spaces/:id/members          → { role, members:[{userId,email,name,role,invitedBy}], invites?:[…] }  invites only for owners
POST   /api/my/spaces/:id/invites          body { email, role: editor|presenter } → 201   owner; 409 already-member|already-invited
PATCH  /api/my/spaces/:id/members/:userId  body { role }                                  owner; 400 space-owner for the space's own owner
DELETE /api/my/spaces/:id/members/:userId                                                 owner
GET    /api/my/invites                     → { invites:[{id,role,spaceId,spaceName,inviterName,createdAt}] }  pending, for my email
POST   /api/my/invites/:id/accept          → { ok, spaceId, role }   403 when the session email does not match
DELETE /api/my/invites/:id                 → revoke                  owner of the invite's space
```

**Versions are immutable** (PRD SESSION-04): `deck_versions` rows are only ever INSERTed, never UPDATEd, and there is deliberately no "edit version" endpoint — editing a deck means appending version N+1, so a session started from version 3 keeps pointing at exactly what that session ran. Saves carry **optimistic concurrency**: the client sends the `baseVersion` it loaded; a stale base returns `409 version-conflict` carrying `latestVersion` instead of silently appending (the same shape as the session plane's `expectedRevision` → `E_REVISION_CONFLICT`), and the `UNIQUE(deck_id, version)` constraint converts a lost insert race into the same 409. "Restore an old version" is implemented client-side as *save it again as N+1* — never as history rewriting. Access is checked on every read and write via the effective space role; an inaccessible deck id is a 404, never a 403 (no existence oracle).

### Media plane (uploads)

Pictures, audio, MP4, and PDF for the retained deck editor media library. Bytes live in R2 (`MEDIA`), an index row lives in D1 (`media_assets`); a media or PDF element stores **both** `assetId` (provenance) and `url` (what every rendering surface already reads), so the stage and participant projections need no knowledge of this plane.

```
POST   /api/tutoring/spaces/:spaceId/assets?name=…&alt=…   raw bytes, Content-Type = the real type
                                                            image/* or video/mp4, ≤ 20 MiB, editor+
                                                            → 201 { asset: { id, url, name, contentType, size, alt, kind, createdAt, createdBy } }
                                                            415 unsupported-media-type · 413 asset-too-large
GET    /api/tutoring/spaces/:spaceId/assets?query=          space member; `query` filters name + alt
DELETE /api/tutoring/assets/:id                            uploader or editor+; removes bytes and row
GET    /api/assets/:id                                     public read, immutable cache, ETag, ranges
```

`GET /api/assets/:id` is **deliberately unauthenticated**: the id is a random UUID and acts as the capability, because a picture on a slide is fetched by the stage, by participant phones, and by learners holding no session. That makes an upload exactly as private as an unguessable CDN path — fine for teaching material, not a place for anything that must not leak if a URL is forwarded. Responses carry `Content-Security-Policy: default-src 'none'; sandbox` so uploaded bytes can never run as a document on the app's own origin. Source: `apps/worker/src/assets.ts`.

### Host app

On load: one `/api/me`. Signed out, it probes `/api/auth/status` and shows Google and/or the demo-account form depending on what the deployment offers. Signed in, the sidebar shows the account, a **My decks** panel (load into the editor, save as a new deck or a new version, with server validation errors rendered inline) and a **My sessions** panel (reconnect straight into the console with the minted tokens). Browser session creation requires the signed-in session; there is no deployment-key fallback in the host UI.

### Worker env additions

`DB: D1Database`; `MEDIA: R2Bucket` (bucket `openroom-media`; `wrangler dev` and the vitest pool simulate it locally from the binding alone, no setup — a first deploy needs `wrangler r2 bucket create openroom-media`); secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; optional vars `GOOGLE_AUTH_URL`, `GOOGLE_TOKEN_URL`; dev-only `DEMO_AUTH=1`. Source: `apps/worker/src/auth.ts` (identity, cookies, OIDC, demo login) and `apps/worker/src/control.ts` (live-session directory, quota, recovery) and `apps/worker/src/delivery.ts` (decks and filed sessions).


## Live co-facilitation

An account-backed host capability identifies one facilitator inside one session.
It never authenticates the control plane. Live host requests recheck current D1
membership. Collaboration paid for at session creation is retained for that session,
so billing expiry does not interrupt teaching; otherwise current owner team access
is required. New shared sessions always require current owner access. Participant
ballots remain entirely on the session Durable Object path. Joining as a facilitator is explicit and does not
change the active presenter. Moderator commands cover hiding responses and managing
live groups. All presentation changes require the active presenter; only the creator
or current space owner can explicitly recover presentation control. Handoff preserves
the cursor, reveals, timers and ballots. A presenter may use multiple devices.

Command authorization runs before idempotency replay. Idempotency keys are scoped to
the verified actor. Facilitator identity and recovery permission on host snapshots
come from verified server input, never public query parameters. Stage and participant
projections omit facilitator details. A removed member may retain a revision-only
socket, but cannot read any subsequent host snapshot or execute commands. Session
retention purges facilitator names along with participant names and group membership.

## Paddle billing boundary

`POST /api/billing/paddle/webhook` accepts only a verified Paddle signature over the
raw request body. It is a provider endpoint, not a peer-client account operation.
Environment-scoped customer ownership is established separately by authenticated
checkout; webhook metadata never identifies an OpenRoom user. Event deduplication
and subscription updates commit atomically. Linked accounts resolve capabilities
through `readEntitlements` using verified subscription state, expiry and the current
approved price catalog; the manual
development field does not override it. See [billing configuration and lifecycle
rules](BILLING.md) for implemented behavior and remaining release work.


## Shared brand kits

Brand kits are space-owned design resources stored in D1. Editor access and the
space owner’s branding entitlement authorize writes; kit membership reads use the
same control-plane credentials as decks. No kit is an account, entitlement or live
session credential. Deletion is recoverable trash. An update carries the current
revision and cannot overwrite an intervening edit.

A kit stores resolved DeckDesign values. Applying it to a deck copies those values
and resets per-slide design overrides while preserving template composition. There
is no mutable brand-kit reference in the deck. Uploaded asset IDs in a kit must be
images in its owning space; private file resource IDs cannot be stored there. Palette
contrast checks apply to both base surfaces. Custom and photographic backgrounds
still require visual review. The normative agent instructions remain beside the
openroom_api tool in packages/mcp/src/tools.ts.


## Selected workshop recap boundary

A recap is a downloaded document produced from a facilitator's explicit selection.
Its source is one live session, including its ended state before response retention
expires. It is not a session collection, a new library record, or a copy of the host
snapshot. No content is selected by default and nothing is automatically published.

The candidate projection allowlists prompts, aggregate rows and visible response
text. It never spreads an interaction, aggregate, ballot or Q&A object. Choice,
scale, numeric and ranking results are supported; numeric results contain only mean
and median, not individual values. Text and Q&A are selected separately. Hidden
content, participant identifiers/handles, answer keys, tutor notes, private pedagogy,
credential material and session identifiers are excluded from the final artifact.
Names written inside authored or audience text remain text for facilitator review.

Selections carry the source revision. Any intervening session change returns 409;
refresh clears item choices while preserving the facilitator's authored text.
The final JSON is assembled from the current authoritative source, never from
client-supplied result objects. Purged source data returns 410. Rendering escapes
plain text and produces script-free HTML with no remote assets. The browser preview
and HTML download use the same renderer. Editing invalidates the reviewed download.

The live endpoint accepts only host session capabilities. The account endpoint
accepts the control-plane credentials and rechecks current facilitator access,
including the owner's shared-space entitlement; cookie POSTs require CSRF. CLI,
MCP and the browser reach the same projection/selection service. Reading a recap
neither joins facilitation nor takes presentation control, and leaves ballot state
unchanged. The MCP tool description owns its callable contract.

## Frozen PowerPoint slide composition

A composed session belongs to one space and one optional context, using the same
start permission and owner-paid collaboration as a saved deck. Its durable session
row anchors Notes/results to the first connected source deck. It stores the frozen
outline separately from list metadata; learner responses never include that
internal outline. The public activity mapping identifies native slides, source
versions and composed steps. Only current account/space access can recover live
capabilities from a public session reference.

The composition snapshots any selected OpenRoom slides and attached details in native slide
order. A repeated question gets separate interaction IDs on each native slide;
revisiting a slide uses its original composed IDs. Retried starts and source edits
do not rebuild existing session content. The common launch path uses the stored
composition, including recovery before live allocation. The Durable Object remains
authoritative for current position, reveals and responses.

A slide master may carry a saved theme override, so composed source decks retain
their palettes and fonts. The resolver chooses master theme before deck theme,
including the fallback background. Shared brand-kit validation checks all palettes.
The first connected activity supplies session-wide settings and the shared aspect
ratio; individual question visibility and answer-change rules are materialized
from each source. The original PowerPoint slide content is never uploaded.

Slide embed codes use `openroom-slide:1:<deckId>:<stepId>`. They identify a stable
source slide and convey no access. The editor saves before issuing a code; the
PowerPoint client resolves it through the authenticated deck API. A detail slide
chosen on its own becomes a top-level composed step. Incomplete unselected
questions do not block embedding a content slide; selected live questions still
pass strict session validation before a durable composed session is written.

Content runtimes publish activation requests only in visible read/slideshow view.
The signed-in pane checks the saved session, frozen composition, current native
selection, and current presentation authority before sending `outline.goto`. The
request channel carries no live capability. Repeated requests for the current
slide are no-ops, preserving response, reveal, and closed-answer state.
