# Build brief: docs — Documentation, manual, DESIGN.md amendments and journey board

Depends on (already merged into tutoring-ux before you start): slides-renderer, participant, workspace-library, agent-surface, live-console, notes-learner, deck-editor, desktop, layout-journeys

Journey numbers reserved for this cluster (use only these for new UC files): UC-60

Decisions that apply: D1, D5, D7, D8, LD12 (full text in decisions.md next to this file)

## Cluster summary from triage

Update the manual, reference docs, plugin docs and landing page after the code clusters merge, and write the journey contract pages. Replace the hand-built join URL instructions with the outcome of D1, bring live-session, questions, notes, library, contexts, learner-links, learner, media, present, shortcuts and troubleshooting to the real labels, add one chapter that walks a tutor and a student through the first lesson including the paid gate, fix the TUTORING.md route rows to the shipped redirects, rewrite the AGENT.md happy path around personal tokens, and correct tool counts, skill lists and Desktop menu names. The landing page gets plain noun headings and no eyebrows. Add contract pages for UC-44 to UC-49 and the board rows with status from an actual run, correct coverage.md, and edit AGENTS.md and DESIGN.md only where a decision outcome or a verified drift requires it.

## Verification named by triage

["bun run --filter openroom-site build", "Run the e2e/manual specs (capture and manual) after label edits", "bun run verify as the last step", "Contract pages for UC-44 to UC-49 are written from the merged specs; board rows take status from an actual run and are never invented"]

## Owned files

- AGENTS.md
- DESIGN.md
- apps/site/**
- docs/**
- docs/AGENT.md
- docs/TERMINOLOGY.md
- docs/TUTORING.md
- docs/journeys/README.md
- e2e/manual/**
- examples/tutoring/**
- plugin/**
- plugin/skills/prepare-a-language-outline/SKILL.md

## Chunks

- chunk 1: desktop-13, onboarding-01, start-join-04, start-join-15, agent-path-01, site-manual-05, onboarding-15, site-manual-07, site-manual-13, editor-authoring-02, voice-media-02, notes-homework-03, student-place-06, site-manual-02, site-manual-08
- chunk 2: editor-authoring-14, site-manual-04, voice-media-01, agent-path-14, second-lesson-15, agent-path-04, notes-homework-15, review-next-10, learner-page-15, agent-path-03, site-manual-09, site-manual-15, editor-authoring-09, gap-phone-soft-keyboard-and-short-viewport-13, agent-path-06

## Findings (full records from the audit; verdict and verdictReason are the skeptic's; needs-decision items are now settled by decisions.md)

```json
{
 "id": "desktop-13",
 "title": "Docs disagree with the Desktop UI: Settings > Live server, 'Put online', 'Prepare this deck', and Start/Present",
 "surface": "docs",
 "kind": "copy",
 "severity": "low",
 "observed": "docs/DESKTOP.md:55 and docs/SELF-HOST.md:27 tell a signed-out tutor to set the relay under Settings > Live server, but the workspace Settings route shows the sign-in page when signed out, so that path is unreachable; only File > Live server... in a file window works. docs/DESKTOP.md:61 calls the action 'Put online' while the UI says 'Save to workspace...' (button, dialog title, and an error that says 'Use File -> Save to workspace'). AGENTS.md:25 and docs/AGENT.md:162 call the pane 'Prepare this deck' while the pane heading is 'Agent' with the line 'Claude, ChatGPT, or an API key.' docs/DESKTOP.md:49-51 says Start is off when signed out with no live server, while the Presenter's Start session stays enabled (see desktop-06).",
 "expected": "Docs and UI use one name per action and describe paths that exist.",
 "repro": [
  "Navigate a signed-out Desktop window to openroom://app/host/index.html#/settings: sign-in page.",
  "Compare docs strings with the File tab and the Agent pane."
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/desktop/91-settings-signed-out.png",
  "/Users/uti/Desktop/openroom/docs/DESKTOP.md:55",
  "/Users/uti/Desktop/openroom/docs/DESKTOP.md:61",
  "/Users/uti/Desktop/openroom/docs/SELF-HOST.md:27",
  "/Users/uti/Desktop/openroom/AGENTS.md:25",
  "/Users/uti/Desktop/openroom/docs/AGENT.md:162",
  "/Users/uti/Desktop/openroom/packages/editor/src/agent/AgentPane.tsx:485-489"
 ],
 "files": [
  "docs/DESKTOP.md",
  "docs/SELF-HOST.md",
  "docs/AGENT.md",
  "AGENTS.md",
  "packages/editor/src/agent/AgentPane.tsx"
 ],
 "fix": "Update the docs to 'File > Live server...' and 'Save to workspace', and either rename the pane heading to 'Prepare this deck' (and update the Agent term in TERMINOLOGY.md) or change the docs to say 'Agent pane'.",
 "needsDecision": false,
 "scenario": "desktop",
 "verdict": "confirmed",
 "verdictReason": "Verified. docs/DESKTOP.md:55 and docs/SELF-HOST.md:27 send a signed-out tutor to Settings > Live server; navigating a signed-out Desktop window to #/settings shows the sign-in page and no 'Live server' text, so that path is unreachable and only File > Live server... works. docs/DESKTOP.md:61 says 'Put online' while the UI says 'Save to workspace...'. AGENTS.md:25 and docs/AGENT.md:162 say 'Prepare this deck' while the pane heading is 'Agent' (AgentPane.tsx:485-489). Docs-only fix: align the docs to the UI (Agent pane, Save to workspace, File > Live server...). Drop the fourth bullet (Start/Present): it is the same root cause as desktop-06 and should be fixed there, with the DESKTOP.md live-sessions table updated afterwards.",
 "reproduced": true
}
```

```json
{
 "id": "onboarding-01",
 "title": "Unknown hashes render a bare 'Page not found' outside the shell; AGENTS.md says they land on the Library",
 "surface": "workspace",
 "kind": "defect",
 "severity": "low",
 "observed": "Every unmatched hash (#/nonsense, #/sessions, #/decks, #/home, #/students, #/tutor, #/space/<id>/zzz) renders a standalone 'Page not found' heading and a link labelled 'Home' on an empty page: no sidebar, no header, no sign-in. Signed out, #/nonsense shows 'Page not found' while a known route such as #/space/abc shows the sign-in form. The documented deck route #/decks/<existingId> (AGENTS.md CRUD section, docs/TERMINOLOGY.md routes table) is also unmatched and shows the same page. The 'Home' link goes to the Library ('Home' is not a destination in the product).",
 "expected": "AGENTS.md: 'an unknown hash lands on the Library rather than 404ing'. A mistyped or stale bookmark should arrive in the Library (or at sign-in when signed out) with the normal chrome.",
 "repro": [
  "Sign in as cara (or stay signed out).",
  "Open <origin>/host/#/nonsense.",
  "Observe the 'Page not found' page. Repeat with #/decks, #/sessions and #/decks/<a real deck id>."
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/onboarding/11-unknown-hash-1280.png",
  "apps/workspace/src/app-router.tsx:158-163 (root notFoundComponent)",
  "AGENTS.md:260; docs/TERMINOLOGY.md:203,207"
 ],
 "files": [
  "apps/workspace/src/app-router.tsx",
  "docs/TERMINOLOGY.md",
  "AGENTS.md"
 ],
 "fix": "Make the root notFoundComponent a replace-redirect to to.library() (signed-out visitors then get the sign-in form, signed-in tutors the shell). Either add a #/decks/$deckId route that redirects to the editor or delete #/decks/:id from AGENTS.md:262, TERMINOLOGY.md:103,210 and docs/TUTORING.md:70,78. Correct 'Home' to 'Library' in TERMINOLOGY.md:203.",
 "needsDecision": false,
 "rules": [
  "AGENTS.md Naming: unknown hash lands on the Library"
 ],
 "scenario": "onboarding",
 "verdict": "confirmed",
 "verdictReason": "Reproduced signed out and signed in: #/nonsense and #/decks/<real id> render a bare 'Page not found' + 'Home' outside the shell, while a known route (#/space/abc) shows sign-in. Code: apps/workspace/src/app-router.tsx:158-163 (root notFoundComponent); only /decks/new and /decks/$deckId/edit exist (app-router.tsx:293,316). AGENTS.md:260 says an unknown hash lands on the Library; TERMINOLOGY.md:203 says Home (docs disagree with each other and with the code). Recoverable with one link and not on the typical onboarding path, so low rather than medium. The server only emits #/decks/:id/edit (packages/mcp/src/tools.ts:685), so #/decks/:id is a docs-vs-router mismatch, not a broken emitted link.",
 "reproduced": true
}
```

```json
{
 "id": "start-join-04",
 "title": "Join code and QR are printed on the Stage, the phone Remote and the Join page link of an identified session, although the console header hides them",
 "surface": "stage",
 "kind": "defect",
 "severity": "low",
 "observed": "In identified session F65BFJHX the console header shows 'Léa' instead of the code, but: the Stage on the question slide shows the code F65BFJHX and a QR code beside '0 joined' (25-stage-identified-question.png); the phone Remote shows the code in large type (60-remote-identified.png; PresenterRemote.tsx:233 has no showCode gate); the Session menu item 'Join page' has href /join/?code=F65BFJHX (22-menu-identified.png). The Stage snapshot has no identityMode (packages/sdk/src/types.ts:809-850; only ParticipantSnapshot has it at line 806), so StageView.tsx:294-298 (Rail) and :677-680 (IdleScreen) cannot hide it. The Stage is the surface shared on the video call. The QR/code leads a student to 'This session is only open to people with an access link.' The Stage on the title slide shows no join information at all (23-stage-identified-title.png).",
 "expected": "One rule for the identified mode across console, Stage and Remote: no code or QR, because a code alone cannot admit anyone.",
 "repro": [
  "Start an identified session from the Library",
  "Open Session menu > Stage; advance to the question slide",
  "Open Session menu > Remote on a phone (or the Remote route) and read the code"
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/start-join/25-stage-identified-question.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/start-join/60-remote-identified.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/start-join/22-menu-identified.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/start-join/23-stage-identified-title.png",
  "apps/stage/src/StageView.tsx:294",
  "packages/editor/src/live/PresenterRemote.tsx:233",
  "packages/domain/src/wire-snapshots.ts:139"
 ],
 "files": [
  "packages/domain/src/wire-snapshots.ts",
  "packages/sdk/src/types.ts",
  "apps/stage/src/StageView.tsx",
  "packages/editor/src/live/PresenterRemote.tsx",
  "packages/editor/src/live/HostHeader.tsx",
  "packages/editor/src/live/LiveHost.tsx",
  "DESIGN.md"
 ],
 "fix": "Add identityMode (or a boolean) to the stage wire snapshot and the SDK StageSnapshot (it carries no name, so the stage-never-gets-handles rule holds). StageView Rail (StageView.tsx:294-298) and IdleScreen (:677-680) hide the code and QR when identified, showing 'Waiting for the student' where the join block was. Leave PresenterRemote and the 'Join page' item as they are until start-join-01 is decided. Reconcile the DESIGN.md sentence ('the waiting board is the only screen that prints the join address').",
 "needsDecision": false,
 "rules": [
  "Credential boundary: stage never receives handles (UC-07) - the flag carries no name"
 ],
 "scenario": "start-join",
 "verdict": "confirmed",
 "verdictReason": "Reproduced. Identified session 7XZZ9K27: the Stage on the question slide shows the code 7XZZ9K27 and a QR beside '0 joined'. The stage wire snapshot has no identityMode (my /state?role=stage keys: no identityMode; wire-snapshots.ts:139-153 vs the participant snapshot, which has it). PresenterRemote.tsx:231-233 prints host.code with no gate. The Session menu 'Join page' href is /join/?code=7XZZ9K27. LiveHost.tsx:361-366 says the code is 'not shown anywhere in this console for such a session ... invites bystanders', so Stage and Remote contradict the product's own rule, and the QR leads to 'only open to people with an access link'. DESIGN.md says the waiting board is the only screen that prints the join address, yet the question rail does. Severity low: no credential leaks (a code alone admits nobody) and the 1:1 student is already in. Fix must stay in step with start-join-01: the code is currently the tutor's only source for the hand-built link, so do not remove it from the Remote or the 'Join page' href until 01 is decided.",
 "reproduced": true
}
```

```json
{
 "id": "start-join-15",
 "title": "Docs disagree with the shipped join flow",
 "surface": "docs",
 "kind": "gap",
 "severity": "low",
 "observed": "docs/TERMINOLOGY.md:268 says a handle is 'Never typed by the participant in any mode', but the Join screen has a typed Handle field behind 'Rejoin with handle' (join.tsx:90-110). TERMINOLOGY.md:320 limits 'room' to the brand, while apps/participant/index.html:12 titles the join page 'Join a room'. docs/TUTORING.md:398 quotes 'Your tutor has not started the session yet.' but the product says 'The tutor has not started the session.' (session-do.ts:643). apps/site/src/content/docs/live-session.md:26 says 'select the join code to copy its link', which is false for identified sessions where the code is hidden; learner-links.md:47-53 sends the tutor to a SESSION_CODE the console does not show. DESIGN.md says the waiting board is the only screen that prints the join address, but the Stage rail prints it on question slides.",
 "expected": "Docs describe what the product does.",
 "repro": [
  "Read the cited lines and compare with 30-lobby-not-started.png and 21-console-identified.png"
 ],
 "evidence": [
  "docs/TERMINOLOGY.md:268",
  "docs/TERMINOLOGY.md:320",
  "docs/TUTORING.md:398",
  "apps/site/src/content/docs/live-session.md:26",
  "apps/site/src/content/docs/learner-links.md:47",
  "apps/participant/index.html:12"
 ],
 "files": [
  "docs/TERMINOLOGY.md",
  "docs/TUTORING.md",
  "apps/site/src/content/docs/live-session.md",
  "apps/site/src/content/docs/learner-links.md",
  "DESIGN.md",
  "apps/participant/index.html"
 ],
 "fix": "Edit the five passages after start-join-01 and start-join-05 are decided. Handle row: 'typed only to recover a pseudonymous seat'. Change the page title to 'Join a session'. Align the TUTORING.md quote with the shipped message. Make live-session.md and learner-links.md describe the identified flow as it actually works. Fix the DESIGN.md sentence about the join address.",
 "needsDecision": false,
 "scenario": "start-join",
 "verdict": "confirmed",
 "verdictReason": "Verified each citation. TERMINOLOGY.md:268 says Handle is 'Never typed by the participant in any mode', while join.tsx:90-115 has a typed Handle field behind 'Rejoin with handle'. TERMINOLOGY.md:320 limits 'room' to the brand, and apps/participant/index.html:12 titles the page 'Join a room' (page title seen in the browser). TUTORING.md:398 quotes 'Your tutor has not started the session yet.' while the relay sends 'The tutor has not started the session.' (session-do.ts:643). live-session.md:26 says to select the join code, which an identified console hides. learner-links.md:47-53 sends the tutor to a SESSION_CODE the console does not show (only the 'Join page' href has it). DESIGN.md says the waiting board is the only screen that prints the join address, while the Stage question rail prints it. Low: docs only.",
 "reproduced": true
}
```

```json
{
 "id": "agent-path-01",
 "title": "An identified session can be started that nobody can join, with no warning",
 "surface": "agent",
 "kind": "defect",
 "severity": "high",
 "observed": "session_create with defaults.identityMode: identified returns ok and a join code. deck_start of an identified deck that has no contextId does the same (deck 2a355289, code GQ4D36SM). outline_validate says ok for both. POST /api/join for these codes answers 403 context-link-required 'This session is only open to people with an access link' even with a valid orlnk_ link. On the learner join page the student sees 'That access link is not valid for this session.' (blames the link; the real cause is that the session has no student). The prepare-a-language-outline skill tells agents to set identityMode: identified by default, and the only warning is in the run-a-session skill and docs/AGENT.md:122, not in the session_create, deck_start or outline_validate descriptions. Working path that was verified: deck filed under the student context + identified + deck_start with start true + context link.",
 "expected": "The tool that creates or launches an identified session refuses (422) when the session has no student context, naming the fix (file the deck under a student and use deck_start). The tool descriptions state the rule. The join page does not blame a valid link.",
 "repro": [
  "Create a token in Settings.",
  "MCP tools/call session_create with outline {version:1, meta:{title:'t'}, defaults:{identityMode:'identified'}, steps:[{id:'a',kind:'title',title:'Hi'}], interactions:[]} -> ok, code F5834B3W.",
  "POST /api/join {code, link:<valid orlnk_ token>} -> 403 context-link-required.",
  "Open /join/?code=F5834B3W&link=<token> on a phone -> 'That access link is not valid for this session.'",
  "Alternatively POST /api/decks without contextId + the same content, then deck_start -> live session, same result."
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/agent-path/learner-dead-identified.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/agent-path/learner-notstarted.png",
  "packages/mcp/src/tools.ts:176-195 (session_create) and 392-416 (deck_start)",
  "apps/relay/src/session-do.ts:610-620 (join refusal text)",
  "plugin/skills/prepare-a-language-outline/SKILL.md:30-35",
  "plugin/skills/run-a-session/SKILL.md:65-72"
 ],
 "files": [
  "packages/mcp/src/tools.ts",
  "apps/workspace-worker/src/delivery/sessions.ts",
  "apps/relay/src/session-do.ts",
  "apps/participant/src",
  "plugin/skills/prepare-a-language-outline/SKILL.md"
 ],
 "fix": "Reject an identified session_create outright (it can never have a context) and an identified launch whose session has no context_id, with a 422 that names the fix (file the deck under a student, then deck_start). Run the check after the continuity check, because apps/workspace-worker/test/continuity-access.test.ts:93-94 expects 403 for a free account starting a context-less identified deck. State the rule once in the session_create, deck_start and openroom_api descriptions (AGENTS.md: surface facts belong in tool descriptions). Qualify identityMode: identified in the language skill as 'only when the deck is filed under the student'. Do NOT change the join refusal text for a context-less session: apps/workspace-worker/src/index.ts:496-499 deliberately returns one indistinguishable answer so a probing holder learns nothing about which sessions or contexts exist; a distinct message would be an oracle and violates the credential boundary.",
 "needsDecision": false,
 "rules": [
  "Credential boundary: identified sessions admit joins only while live",
  "AGENTS.md one source per fact: tool facts belong in tool descriptions"
 ],
 "scenario": "agent-path",
 "verdict": "confirmed",
 "verdictReason": "Reproduced in my instance. MCP session_create with defaults.identityMode identified returned ok with join code P4DMWTB8; POST /api/join with a valid orlnk_ link (body field is contextLink, not link; the learner page maps ?link= to contextLink at apps/participant/src/app.tsx:53-57) answered 403 context-link-invalid 'That access link is not valid for this session.' A deck with no contextId and identityMode identified started through deck_start as 201 live (code 53W2H5CZ) with the same dead end. Cause: apps/workspace-worker/src/index.ts:496-503 requires sessionContextId === link.contextId and a context-less session never has one. Nothing refuses it at creation: createSessionFromOutline (index.ts:217-221) and launchSessionForUser (index.ts:287-291) only check the continuity capability. The tutor console hides the join code for identified sessions (packages/editor/src/live/LiveHost.tsx:358-366), so the tutor has no fallback. Tool text (packages/mcp/src/tools.ts:182, 387) never states the context requirement; the rule exists only in skills and docs/AGENT.md:122, and prepare-a-language-outline/SKILL.md:30-35 sets identified as a default while run-a-session/SKILL.md:65-72 forbids it.",
 "reproduced": true
}
```

```json
{
 "id": "site-manual-05",
 "title": "No chapter walks one tutor and one student through a first lesson; the paid gate is undocumented",
 "surface": "manual",
 "kind": "gap",
 "severity": "medium",
 "observed": "start.md is a generic create-present-collect flow (its experience table lists Tutoring in one row). The 1:1 path is spread across contexts, learner-links, notes, homework, learner and review, and the order a tutor needs (New space Tutoring, Add student, Set language, Create link, New deck, Start session, End session, Notes, Review) is never written down in one place. On billed deployments Notes, homework, learner links and identified sessions sit behind a 'Homework and Notes' lock with a Plans button (ContinuityLock.tsx, billing/api.ts:56); no chapter mentions that lock, and the account.md plan table has no continuity row, so a tutor who reaches Create link on a free plan meets an unexplained lock. docs/journeys/UC-39-first-tutoring-lesson.md already describes this path but is not linked from the manual.",
 "expected": "One plainly named chapter for the 1:1 flow in the order of use, with the plan requirement stated where each gated step is introduced.",
 "repro": [
  "Read start.md, then contexts.md, learner-links.md, notes.md in order.",
  "Search the manual for 'Homework and Notes' or 'Plans': no 1:1 chapter mentions the lock."
 ],
 "evidence": [
  "apps/site/src/content/docs/start.md:1-30",
  "apps/site/src/content/docs/account.md:15-35",
  "apps/workspace/src/components/ContinuityLock.tsx",
  "apps/workspace/src/billing/api.ts:56",
  "docs/journeys/UC-39-first-tutoring-lesson.md"
 ],
 "files": [
  "apps/site/src/content/docs/start.md",
  "apps/site/src/content/docs/contexts.md",
  "apps/site/src/content/docs/learner-links.md",
  "apps/site/src/content/docs/notes.md",
  "apps/site/src/content/docs/account.md",
  "e2e/manual/capture.spec.ts"
 ],
 "fix": "Add one plainly titled chapter that follows the order of use (New space Tutoring, Add student, Set language, Create link, New deck, Start session, End session, Notes, Review) with exact on-screen labels. State at Student access links, Notes and Homework that they need a plan that includes Homework and Notes, shown by a lock with Plans. Add a 'Homework and Notes' row to the account.md capability table. Check order values in the front matter before choosing 11.",
 "needsDecision": false,
 "scenario": "site-manual",
 "verdict": "confirmed",
 "verdictReason": "Verified by reading. No manual chapter walks one tutor and one student through a first lesson. start.md is generic and lists Tutoring as one table row. A grep of all chapters finds no mention of the 'Homework and Notes' lock or the Plans button (ContinuityLock.tsx, section aria-label 'Homework and Notes', Plans link). The account.md capability table has no row for continuity, although billing/api.ts:56 labels it 'Homework and Notes'. The Notes, homework, learner-link and identified-session steps are gated, and the manual never says so. AGENTS.md and TERMINOLOGY.md confirm the gate: continuity is paid, and a deployment without billing holds every capability. The proposed chapter breaks no rule, and a plain title is fine. The local instance has no billing, so the lock itself was not rendered; the code settles it.",
 "reproduced": false
}
```

```json
{
 "id": "onboarding-15",
 "title": "Manual and reference docs disagree with the product on the first-run path",
 "surface": "docs",
 "kind": "copy",
 "severity": "low",
 "observed": "start.md tells readers to open 'a student's or class's Library' and select Sample lessons, but the button is rendered for Tutoring spaces only (never in Classroom). account.md and powerpoint.md say 'Settings → Connected apps' while the page heading is 'Connected applications'. docs/TERMINOLOGY.md says unknown hashes land on Home and lists #/decks/:id 'Deck detail', neither true (see onboarding-01), and treats #/ as a Home screen that does not exist. The manual never mentions the Getting started card, the Choose experience step, or that a first space starts as Classroom.",
 "expected": "Docs match visible labels and routes; the first-run chapter describes what a new tutor sees.",
 "repro": [
  "Read start.md 'Create a deck' paragraph on sample lessons and look for the button in a Classroom space.",
  "Compare account.md:58 with the Settings page headings."
 ],
 "evidence": [
  "apps/site/src/content/docs/start.md:32",
  "apps/site/src/content/docs/account.md:58",
  "apps/workspace/src/components/ConnectedApps.tsx:12",
  "apps/workspace/src/pages/SpacePage.tsx:536 (samplesTo only for tutoring)",
  "docs/TERMINOLOGY.md:203,207"
 ],
 "files": [
  "apps/site/src/content/docs/start.md",
  "apps/site/src/content/docs/account.md",
  "apps/site/src/content/docs/powerpoint.md",
  "docs/TERMINOLOGY.md"
 ],
 "fix": "Say 'In a Tutoring space, open Sample lessons' in start.md; use 'Connected applications' in account.md, powerpoint.md and agents.md; add first-run text after onboarding-02/05 are decided; fix TERMINOLOGY routes together with onboarding-01.",
 "needsDecision": false,
 "scenario": "onboarding",
 "verdict": "confirmed",
 "verdictReason": "start.md:32 tells readers to open 'a student's or class's Library' and select Sample lessons, but the button renders only for Tutoring spaces (SpacePage.tsx:617). account.md:58 and powerpoint.md:39 say 'Connected apps' while the Settings heading is 'Connected applications' (ConnectedApps.tsx:12). The manual never mentions the Getting started card or that a first space starts as Classroom. The TERMINOLOGY.md route corrections belong to onboarding-01; the first-run text should wait for the onboarding-02/05 decisions.",
 "reproduced": true
}
```

```json
{
 "id": "site-manual-07",
 "title": "Every student has its own language pair and starts without one; the manual does not say so",
 "surface": "workspace",
 "kind": "gap",
 "severity": "low",
 "observed": "Adding a student creates a per-student space. The student card then reads 'No language pair set for this space. Word lookup needs one. Set language', for Camille and again for the group 'Leo and Ines' (and in the manual's own library.png). A tutor with ten French students sets the same pair ten times. contexts.md 'Set teaching languages' describes the form but not that it is per student, and the Sample lessons page offers 'Both languages' regardless of the pair.",
 "expected": "The pair set for the first student is offered for the next one, or the manual states plainly that each student has its own.",
 "repro": [
  "Add student 'Camille', then Add student or group 'Leo and Ines'.",
  "Open each student's Library: both cards show the no-language-pair message.",
  "Read contexts.md 'Set teaching languages'."
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/site-manual/lib-after-start.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/site-manual/second-student.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/site-manual/space-edit.png",
  "apps/site/src/content/docs/contexts.md:29-33"
 ],
 "files": [
  "apps/workspace/src/pages/tutor/Contexts.tsx",
  "apps/workspace/src/components/ContextPanel.tsx",
  "apps/site/src/content/docs/contexts.md"
 ],
 "fix": "Preselect the language pair of the tutor's most recent student in the Add student form, and add one sentence to contexts.md that the pair belongs to each student.",
 "needsDecision": false,
 "scenario": "site-manual",
 "verdict": "needs-decision",
 "verdictReason": "Verified. Each student gets its own space (sp_ctx_<id>). The language pair lives on the space by design (control-utils.ts:62-70: it is 'how one student is taught two languages'). Every new student card says 'No language pair set for this space. Word lookup needs one. Set language'. contexts.md:29-33 does not say the pair is per student, so that gap is real, and the one-sentence manual fix is safe. The auditor's code fix is a product choice, not a patch. The Add student form has no language field, so 'preselect the most recent student's pair' means adding a typed field to the create route and guessing which sibling to inherit from, which is wrong for a student taught two languages. Severity is low: it is a one-time setting per student and lookup is optional.",
 "options": [
  "Manual only: add a sentence to contexts.md that the language pair belongs to each student and is set once per student.",
  "Add an optional language pair field to the Add student route, prefilled from the pair last saved on another of the tutor's student spaces and always editable.",
  "Add a tutor-level default pair in Settings that new student spaces start with.",
  "Show the pair of the sample lesson being opened as a one-click 'Set language' suggestion on the student card."
 ],
 "reproduced": true
}
```

```json
{
 "id": "site-manual-13",
 "title": "Manual labels differ from the UI for Notes prompt, next-lesson note and access links",
 "surface": "manual",
 "kind": "copy",
 "severity": "low",
 "observed": "library.md:58 and notes.md:11 say the Library's 'Write the notes' prompt; the link text is 'Write Notes for <deck title>' (WorkspaceUpdates.tsx:26). contexts.md says to read the previous private 'Next step'; the panel and consoles label it 'Next session' (ContextPanel.tsx:42, LiveHost.tsx:602, DeckEditor.tsx:431). The Library shows a 'Student access links' disclosure, while the chapter is titled learner-links and refers to 'learner links'.",
 "expected": "The manual uses the label on the screen; TERMINOLOGY.md decides the noun for the person (student in the UI).",
 "repro": [
  "End a session and open the Library: the prompt reads 'Write Notes for Au cafe, A1'.",
  "Open a student's Library: the disclosure reads 'Student access links'."
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/site-manual/lib-after-start.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/site-manual/after-end.png",
  "apps/site/src/content/docs/library.md:58",
  "apps/site/src/content/docs/notes.md:11",
  "apps/workspace/src/components/WorkspaceUpdates.tsx:26",
  "apps/workspace/src/components/ContextPanel.tsx:42"
 ],
 "files": [
  "apps/site/src/content/docs/library.md",
  "apps/site/src/content/docs/notes.md",
  "apps/site/src/content/docs/contexts.md",
  "apps/site/src/content/docs/learner-links.md"
 ],
 "fix": "Edit library.md:58 and notes.md:11 to 'Write Notes for <deck>'. Edit contexts.md:37 to 'Next session'. Do not rename the access-link headings in the manual. If the UI headings should agree, align the two UI strings under TERMINOLOGY.md (access link; learner for the person).",
 "needsDecision": false,
 "scenario": "site-manual",
 "verdict": "confirmed",
 "verdictReason": "Two of the three label mismatches are real. The Library prompt is a link reading 'Write Notes for <title>' (WorkspaceUpdates.tsx:26), but library.md:58 and notes.md:11 say 'Write the notes'. contexts.md:37 says private 'Next step' in the context panel, whose label is 'Next session' (ContextPanel.tsx:42; the Notes form field is 'Next step', which is correct). The third is not a manual error. The UI uses both 'Student access links' (SpacePage.tsx:594 disclosure) and 'Learner access links' (ContextLinks.tsx:138 card title), and the manual quotes each correctly. The inconsistency is inside the UI. TERMINOLOGY.md says 'access link' in UI copy and 'learner' for the person reading through it, so the auditor's 'use Student access links everywhere' fix is not supported.",
 "reproduced": false
}
```

```json
{
 "id": "editor-authoring-02",
 "title": "Two tabs overwrite each other silently, then the stale tab can never save again",
 "surface": "deck-editor",
 "kind": "defect",
 "severity": "medium",
 "observed": "The draft route is an upsert guarded only by `baseVersion === current_version`, so two tabs on the same deck overwrite each other's draft with no warning (tab B's 'Saved' replaced tab A's slide). After tab A stamps a version (Start session or Save a copy), tab B's PUT returns 409 version-conflict; the saver retries at 1s, 4s, 10s and then shows 'Couldn't save' permanently. There is no banner, no reload or merge offer, and edits stay only in memory. The conflict banner (Keep this draft / Use saved version) is only evaluated at load time. The public manual tells users to 'make a further edit to retry', which cannot succeed because baseVersion stays stale.",
 "expected": "A second tab learns it is out of date: either on save (409) or on focus, it shows the same Keep this draft / Use saved version choice, and re-bases after the choice. A draft written by another tab is not replaced without a prompt.",
 "repro": [
  "Open the same deck in tab A and tab B.",
  "In A add a slide and wait for 'Saved'. In B (loaded earlier) add a different slide and wait for 'Saved'. Reload A: A's slide is gone and no banner ever appeared.",
  "In A click Start session (stamps a new version) and return to Edit deck.",
  "In B type anything: the pill goes 'Couldn't save - retrying', then 'Couldn't save' and stays that way."
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/editor-authoring/46-tabB-after-A-save.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/editor-authoring/47-tabB-409.png",
  "apps/workspace-worker/src/delivery/decks.ts:590-604",
  "packages/editor/src/deck-edit/useDraftSave.ts:37",
  "packages/editor/src/deck-edit/useDraftSave.ts:47",
  "apps/workspace/src/pages/DeckEditorPage.tsx:251",
  "apps/site/src/content/docs/deck-editor.md (save errors: 'make a further edit to retry')"
 ],
 "files": [
  "apps/workspace-worker/src/delivery/decks.ts",
  "apps/workspace/src/pages/DeckEditorPage.tsx",
  "packages/editor/src/deck-edit/useDraftSave.ts",
  "apps/site/src/content/docs/deck-editor.md"
 ],
 "fix": "On a 409 `version-conflict` from the drafts slot, have DeckEditorPage refetch designQuery and set `draftConflict(true)`. The existing banner (Keep this draft / Use saved version) then appears, and `resolveDraft` must use the refetched detail, not the stale one. Optionally add an optional `expectedSavedAt` check on PUT /draft that returns 409 `draft-conflict`, and keep it optional so CLI and agent clients still work. Change the manual sentence so it no longer promises that a further edit retries after a conflict. Add no locks or presence.",
 "needsDecision": false,
 "rules": [
  "A deck is a file: no locks, approvals or capacity editors"
 ],
 "scenario": "editor-authoring",
 "verdict": "confirmed",
 "verdictReason": "Reproduced the stale-tab half. I stamped v3 through the API while the editor was open on base v2 and then added a slide in the UI. Four PUT /draft requests returned 409 and the pill ended on 'Couldn't save' with no banner and no way out (12-stale-409.png). History still said 'v2 · latest' although v3 existed. Code: decks.ts:590-604 upserts the draft whenever baseVersion equals current_version, so two tabs on the same version overwrite each other (last writer wins, read from code, not driven). useDraftSave.ts:47 stops after the retry delays and waits for another edit. DeckEditorPage.tsx:84 is the only place `draftConflict` is set, and it runs only on load. The manual's 'make a further edit to retry' (deck-editor.md:58) cannot succeed after a version conflict. Optimistic concurrency is not a lock or a presence feature, so the product rules allow a fix. I lowered severity from high to medium. It needs a second client such as another tab, a library-row Start session, a co-teacher, or the desktop agent. The pill does show the failure, and server-side version history is intact.",
 "reproduced": true
}
```

```json
{
 "id": "voice-media-02",
 "title": "Recording that stops on its own looks like a finished take, with no notice",
 "surface": "learner-page",
 "kind": "gap",
 "severity": "medium",
 "observed": "Every unrequested stop ends in the same quiet preview with Send response enabled and no message. Confirmed cases: page hidden (visibilitychange, phone lock) at 0:06 gave a 0:07 preview; switching to the Practice tab (UC-18 asserts the track ends but nothing tells the learner); track lost after 3 s (device disconnect) gave a 0:03 preview and no alert; the 5:00 limit auto-stops and shows a 4:59 preview. The earlier 'Response sent' card stays above the new preview, so it is unclear which take is current. A student who was cut off mid-sentence can send a truncated answer believing it is complete. In the 5-minute run nothing warns near the limit either (timer only, no change at 4:30).",
 "expected": "When the recorder stops for any reason other than the student's own Stop, show a role=status notice with the reason and the length kept, for example 'Recording stopped at 0:07 because the page was hidden. Listen to it, then send it or record again.' and 'You reached the five-minute limit.' Optionally show remaining time in the last 30 seconds.",
 "repro": [
  "Open the learner page with a working microphone, tap Record response",
  "After a few seconds dispatch a hidden visibilitychange (or lock the phone), or call track.stop() on the stream, or wait 5:00",
  "Return to the page: preview of the short or capped take with Send response enabled, no alert or status"
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/gap-voice-recording-and-listening-audio-real-media/06-after-hidden.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/gap-voice-recording-and-listening-audio-real-media/five-after-limit.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/gap-voice-recording-and-listening-audio-real-media/mic-ended-after-3s.png",
  "apps/workspace/src/pages/learner/VoiceTask.tsx:45-52,62-66,91-96"
 ],
 "files": [
  "apps/workspace/src/pages/learner/VoiceTask.tsx",
  "apps/workspace/src/lib/learner-copy.ts",
  "e2e/journeys/UC-18-voice-homework.spec.ts",
  "apps/site/src/content/docs/learner.md"
 ],
 "fix": "Set a stop-reason ref (hidden, inactive tab, limit, device ended) before calling stop(), and treat an onstop that arrives without a user Stop as a device end. Afterwards show a role=status LearnerMessage next to the preview with the reason and kept length, for example 'Recording stopped at 0:07 because the page was hidden. Listen to it, then send it or record again.' Add en/fr/de strings and a UC-18 assertion for the tab-switch case. Skip a limit-warning countdown unless wanted.",
 "needsDecision": false,
 "rules": [
  "Colour never carries meaning alone",
  "docs/TERMINOLOGY.md vocabulary"
 ],
 "scenario": "gap-voice-recording-and-listening-audio-real-media",
 "verdict": "confirmed",
 "verdictReason": "Reproduced by calling track.stop() on the live stream about 0.5 s into a recording. The recorder ended in the normal preview with Send response enabled, no role=alert and no status text (v02-track-loss.png). The code agrees. visibilitychange, the active=false effect and the 5:00 timer all call stop() (VoiceTask.tsx:45-52,62-66), and onstop then runs prepare() with no record of why it stopped (lines 91-96). The only stop messages are recordingStopped (MediaRecorder error) and recordingTooLarge. UC-18 deliberately stops the track on a tab change but never tells the learner, so a student cut off mid-sentence sees an ordinary preview and can send a truncated answer. This is the 'recording stopped on tab switch without notice' failure the scenario names. The 4:30 remaining-time warning is optional and not needed. The 'which take is current' point is weak (the new take sits under the sent card with its own Send button).",
 "reproduced": true
}
```

```json
{
 "id": "notes-homework-03",
 "title": "Library write-notes prompt names the deck, not the student; identical rows, no overflow, docs disagree",
 "surface": "workspace",
 "kind": "copy",
 "severity": "low",
 "observed": "The Library strip shows 'Write Notes for Au cafe' as a small underlined text link, once per unwritten session. After three lessons on the same deck it showed three identical links. It shows at most three (slice(0,3)) with no sign that more exist. The Notes page heading is also 'Session notes - Au cafe' with no student name, so the tutor cannot tell which lesson a link or page is for. AGENTS.md specifies 'Write the notes for {person}'s session' and the manual (notes.md, library.md) says 'Write the notes', but the UI says 'Write Notes for {title}'. The prompt is No-Ledger compliant (no time, count or status word), and the inspector already disambiguates written Notes with 'Au cafe 2', so the prompt and page are the inconsistent places.",
 "expected": "Prompt reads 'Write the notes for Lea's session' using the context's person name (still timeless), the Notes heading names the student, and docs and UI use the same words.",
 "repro": [
  "Start and end the same deck three times for one student, cancelling Notes each time",
  "Open the student's Library: three identical 'Write Notes for Au cafe' links",
  "Open one: heading is 'Session notes - Au cafe'"
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/notes-homework/21-identical-prompts.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/notes-homework/17-notes-second.png",
  "/Users/uti/Desktop/openroom/apps/workspace/src/components/WorkspaceUpdates.tsx:18-26",
  "/Users/uti/Desktop/openroom/AGENTS.md:159-161",
  "/Users/uti/Desktop/openroom/apps/site/src/content/docs/notes.md:11"
 ],
 "files": [
  "apps/workspace/src/components/WorkspaceUpdates.tsx",
  "apps/workspace/src/pages/tutor/SessionNotes.tsx",
  "apps/site/src/content/docs/notes.md",
  "apps/site/src/content/docs/library.md"
 ],
 "fix": "Use the context's displayName per AGENTS.md ('Write the notes for Lea's session'); this needs the name resolved from the loaded contexts or added to the /api/my/home row. Name the student in the Notes heading. Do NOT add the ' · 2' ordinal the auditor suggests: a visible session ordinal is a count of how often a deck was taught and sits against the No-Ledger rule next to this prompt. Show a distinct row only per session, and accept that same-student rows may read alike. Update library.md and notes.md to the final wording.",
 "needsDecision": false,
 "rules": [
  "No-Ledger rule (stays compliant)",
  "docs/TERMINOLOGY.md headings name the person"
 ],
 "scenario": "notes-homework",
 "verdict": "confirmed",
 "verdictReason": "Reproduced: three unwritten sessions of one deck give three identical 'Write Notes for Au cafe' links (WorkspaceUpdates.tsx:26), the Notes heading is 'Session notes — Au cafe' with no student (SessionNotes.tsx:171), and slice(0,3) hides further rows although the worker returns up to 6 (home.ts:36). AGENTS.md:159-161 specifies the timeless prompt 'Write the notes for {person}'s session', and the manual says 'Write the notes', so the UI deviates from the written spec. Severity lowered to low: it needs several unwritten sessions to be ambiguous, and the deck title does tell one lesson from another across decks.",
 "reproduced": true
}
```

```json
{
 "id": "student-place-06",
 "title": "Folder rename, duplicate and trash are reachable only by right-click in the rail; deck rows have no menu, F2 or slow-click",
 "surface": "workspace",
 "kind": "defect",
 "severity": "low",
 "observed": "The context menu exists only on rail folder rows, and the root row has Open and New folder inside. Folders in the list, and deck rows (LibraryList), have no menu and no inspector. F2 and slow-click rename are not implemented. A synthetic Shift+F10 opened nothing (the ContextMenu key did). Focus drops to BODY after a folder is created or renamed. Duplicate sibling folder names are allowed. This contradicts AGENTS.md ('the context menu is never the only path', F2 / slow-click rename) and the manual (library.md line 44 and shortcuts.md line 21: Shift+F10 opens the focused row's context menu).",
 "expected": "Every folder and deck row offers the same verbs through a menu, a keyboard shortcut and a visible control. Focus returns to the renamed row. Duplicate sibling names are refused or auto-numbered.",
 "repro": [
  "Select a folder row in the rail and press F2: nothing happens.",
  "Focus a deck row and press Shift+F10: no menu.",
  "Right-click a deck row: no menu.",
  "Create two folders both named New folder: both are kept."
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/student-place/22-new-folder-inline.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/student-place/23-folder-created.png",
  "apps/site/src/content/docs/shortcuts.md:21",
  "apps/site/src/content/docs/library.md:44"
 ],
 "files": [
  "apps/workspace/src/components/TreeRail.tsx",
  "apps/workspace/src/components/LibraryList.tsx",
  "apps/workspace/src/pages/SpacePage.tsx",
  "apps/site/src/content/docs/shortcuts.md",
  "apps/site/src/content/docs/library.md"
 ],
 "fix": "Either add a context menu to LibraryList deck and folder rows with the inspector's verbs (Open, Start session, Duplicate, Move to trash, plus Rename for folders), or correct library.md and shortcuts.md to say only rail folders have a menu. Optionally add F2 rename on rail folders (AGENTS.md allows it). Do not add a visible ⋯ column. Treat duplicate sibling folder names (refuse or auto-number) as optional polish.",
 "needsDecision": false,
 "rules": [
  "AGENTS.md CRUD routes",
  "UC-15"
 ],
 "scenario": "student-place",
 "verdict": "confirmed",
 "verdictReason": "Partly confirmed, overstated in places. Confirmed in code and UI: folder rename, duplicate and trash exist only in the rail's context menu (TreeRail.tsx); F2 does nothing on a focused rail folder; right-click on a deck row opens no menu; and library.md:44 ('Right-click a row to open its action menu') and shortcuts.md:21 (Shift+F10 opens the focused row's context menu) describe a row menu that LibraryList rows do not have. createFolderRoute accepts duplicate sibling names. Overstated: the ContextMenu key opened the rail menu (Open, New folder inside, Rename, Duplicate, Move to trash), so there is a keyboard path, and a Playwright Shift+F10 is not a valid test of the native contextmenu event. Deck verbs are all reachable in the inspector, so the 'menu is never the only path' invariant holds for decks, and only folders depend on the menu. AGENTS.md lists F2 and slow-click as allowed, not required. Rule problem in the fix: 'a visible control' on rows conflicts with 'There is no visible ⋯ column in the folder browser'. Low severity.",
 "reproduced": true
}
```

```json
{
 "id": "site-manual-02",
 "title": "Session started from the editor lives in an overlay on the editor URL; reload drops the tutor back into the editor",
 "surface": "live-console",
 "kind": "defect",
 "severity": "medium",
 "observed": "Start session in the deck editor opens the Presenter as a portal dialog over #/decks/:id/edit; the URL never changes. After a browser reload mid-lesson the tutor sees the plain editor with Start session enabled and nothing saying a session is live (after-reload.png). The only way back is Library, Live now, Rejoin (lib-after-start.png). A session started from the Library uses #/sessions/CODE instead; opening that address on a device without stored credentials shows 'No credentials for session ... on this device. Sign in and open the session from Home, or append the host token: #/sessions/CODE?token=HOST_TOKEN', which names a token the tutor never sees and a Home that is the Library. The manual covers Live now (live-session.md:83,91) but not reload, and library.md:11 says reload preserves location, which is only true for the Library.",
 "expected": "Reload or a second tab during a lesson returns to the same live console, or at least the editor shows a Live now banner with Rejoin; the missing-credentials page says in plain words how to rejoin without mentioning host tokens.",
 "repro": [
  "Open a deck for a student, Start session from the editor top bar.",
  "Reload the page: the editor shows with an orange Start session button and no live indicator.",
  "Go to Library: Live now shows Rejoin for the session.",
  "Open #/sessions/<id> in a fresh browser profile: the HOST_TOKEN message appears."
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/site-manual/live-console.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/site-manual/after-reload.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/site-manual/lib-after-start.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/site-manual/session-id-missing.png",
  "apps/workspace/src/pages/DeckEditorPage.tsx:288-296",
  "packages/editor/src/presenter/Presenter.tsx:118-122",
  "apps/workspace/src/app-router.tsx:132-143"
 ],
 "files": [
  "apps/workspace/src/pages/DeckEditorPage.tsx",
  "packages/editor/src/presenter/Presenter.tsx",
  "apps/workspace/src/app-router.tsx",
  "apps/site/src/content/docs/live-session.md",
  "apps/site/src/content/docs/troubleshooting.md"
 ],
 "fix": "Navigate to #/sessions/CODE after a successful start from the editor. In the editor, show the existing 'Live now' / Rejoin chip, with the word, when a session for this deck is live, so Edit deck and reload no longer offer a second Start session unannounced. Replace the MissingSession copy with 'Sign in on this device and use Rejoin under Live now in the Library.' and add a reload entry to troubleshooting.md.",
 "needsDecision": false,
 "scenario": "site-manual",
 "verdict": "confirmed",
 "verdictReason": "Reproduced. After Start session from the editor the URL stays #/decks/:id/edit (portal in Presenter.tsx:118-122, DeckEditorPage.tsx:288-296). After reload the editor shows an enabled Start session and no live indicator. Library shows 'Live now' with 'Rejoin <title>', which goes to #/sessions/CODE. In a fresh profile that route shows 'No credentials for session ... append the host token: #/sessions/CODE?token=HOST_TOKEN' (app-router.tsx:132-143, copy is developer-facing). Edit deck from the live console returns to the same indicator-less editor. Stronger than the auditor found: pressing Start session again after reload creates a second live session, and the Library then lists two 'Rejoin Plain' entries (the manual says starting again creates another session, live-session.md:90). A mid-lesson reload therefore invites a duplicate session. The auditor's fix is sound and breaks no rule, since 'Live now' is a state of now. Do both parts: navigate to #/sessions/CODE after a start from the editor, and show Live now / Rejoin in the editor when a session for this deck is live. library.md:11 is about Library location only, so that sub-claim is a nit.",
 "reproduced": true
}
```

```json
{
 "id": "site-manual-08",
 "title": "Live session chapter names controls the console does not have",
 "surface": "manual",
 "kind": "copy",
 "severity": "medium",
 "observed": "live-session.md:35-40 lists Open, Close, Hide results, Reopen as the question actions, and live-session.md:60 and questions.md:71 name 'Undo revote'. The console's Answers group has Close answering, Results shown, Second vote and 'Back to first vote'; Results has Reveal results or Call out the correct answer; there is no Open, Hide results or Reopen for a question (Reopen card is a different action). The manual's own live-results.png shows the real labels and contradicts its table. The bottom bar says Next slide / Next, the table says Next. e2e/manual has no test that checks named labels.",
 "expected": "Every bold control name in the manual exists with that exact label.",
 "repro": [
  "Start any session with a question slide.",
  "Compare the Answers and Results groups with the table in live-session.md 'Open, close, and reveal a question'."
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/site-manual/live-question.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/site-manual/live2.png",
  "apps/site/public/docs/images/live-results.png",
  "packages/editor/src/live/LiveRibbon.tsx:151,159,161-165,189,195",
  "apps/site/src/content/docs/live-session.md:35-40,60",
  "apps/site/src/content/docs/questions.md:71"
 ],
 "files": [
  "apps/site/src/content/docs/live-session.md",
  "apps/site/src/content/docs/questions.md",
  "e2e/manual/manual.spec.ts"
 ],
 "fix": "Rewrite the table in live-session.md to the real labels (Close answering, Reveal results / Call out the correct answer, Second vote, Back to first vote, the H shortcut for hiding or showing the result, Blank). Replace 'Undo revote' with 'Back to first vote' in live-session.md and questions.md. Do not add a label-scanning test.",
 "needsDecision": false,
 "scenario": "site-manual",
 "verdict": "confirmed",
 "verdictReason": "Verified against LiveRibbon.tsx:149-195. The Answers group has 'Close answering', a 'Results shown' status chip (not a button), 'Second vote' and 'Back to first vote'. The Results group has 'Reveal results' or 'Call out the correct answer'. There is no 'Open', 'Hide results' or question 'Reopen' control. 'Hide results' exists only as the H shortcut (shortcuts.md:43), and 'Reopen card' is the dictionary card. live-session.md:35-40,60 and questions.md:71 name controls that the console does not label, and the manual's own live-results.png shows the real labels. Do not add the proposed spec that scans bold manual labels against app labels: AGENTS.md testing rules discourage source-scan tests, and manual drift is not a product regression.",
 "reproduced": false
}
```

```json
{
 "id": "editor-authoring-14",
 "title": "Docs disagree with the product on slide-rail keys, pane tab names and the plan.yaml chip",
 "surface": "docs",
 "kind": "copy",
 "severity": "low",
 "observed": "(1) apps/site/src/content/docs/shortcuts.md:29 says 'Use Up and Down within the slide rail to navigate thumbnails'. In the product ArrowDown/ArrowUp on a focused rail row do nothing (focus and selection stay); only Alt+ArrowUp/Down is handled and it reorders slides (ThumbnailRail.tsx:155-164), which the manual never mentions. The rail is ten separate Tab stops. (2) docs/IA.md:100 lists the task pane as 'Deck / Notes / History'; the product shows Design / Theme / Notes / History (the manual is correct). (3) The Design pane says 'Named arrangements. An agent fills the same ones.' (design.tsx:142), which is unexplained to a tutor. (4) The ribbon chip reads 'plan.yaml' with title 'deck.yaml' and a menu labelled 'Open YAML' that copies a CLI command instead of opening anything.",
 "expected": "The manual describes the keys that exist (Alt+Up/Down reorders), or the rail supports roving arrow navigation as documented; IA.md names the four real tabs; chip and menu use one file name and say what they do.",
 "repro": [
  "Focus slide row 2 in the rail and press ArrowDown: selection stays on 2.",
  "Compare docs/IA.md:100 with the task pane tab labels.",
  "Click the plan.yaml chip and read the menu."
 ],
 "evidence": [
  "apps/site/src/content/docs/shortcuts.md:29",
  "packages/editor/src/deck-edit/ThumbnailRail.tsx:155-164",
  "docs/IA.md:100",
  "packages/editor/src/deck-edit/properties/design.tsx:142",
  "packages/editor/src/deck-edit/Ribbon.tsx:685-711",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/editor-authoring/59-notes-entered.png"
 ],
 "files": [
  "apps/site/src/content/docs/shortcuts.md",
  "docs/IA.md",
  "packages/editor/src/deck-edit/ThumbnailRail.tsx",
  "packages/editor/src/deck-edit/properties/design.tsx",
  "packages/editor/src/deck-edit/Ribbon.tsx"
 ],
 "fix": "Make the minimum change first: correct shortcuts.md to describe Tab and Alt+Up/Down, correct IA.md to the four real tabs, and reword the chip menu title ('Copy command to read the deck as YAML') with one file name. Reword design.tsx:142 to 'Choose how the slide is arranged.' Roving-tabindex arrow navigation in the rail is an optional accessibility improvement, not required to fix the mismatch.",
 "needsDecision": false,
 "scenario": "editor-authoring",
 "verdict": "confirmed",
 "verdictReason": "Confirmed. In the browser, with focus on rail row 1 of a 3-slide deck, ArrowDown left focus on row 1 and Tab moved to row 2, so the manual's 'Use Up and Down within the slide rail to navigate thumbnails' (shortcuts.md:29) is false. ThumbnailRail.tsx:155-164 handles only Alt+Arrow, which reorders slides, and the manual never mentions it. docs/IA.md:100 lists the task pane as 'Deck / Notes / History', but the product shows Design / Theme / Notes / History. The chip reads 'plan.yaml' with title 'deck.yaml' and a menu headed 'Open YAML' whose items copy CLI commands (Ribbon.tsx:685-711). design.tsx:142 says 'Named arrangements. An agent fills the same ones.', and the browser app has no agent surface. These are documentation and copy mismatches.",
 "reproduced": true
}
```

```json
{
 "id": "site-manual-04",
 "title": "Landing page headings are slogans, contrast lines and eyebrow labels",
 "surface": "site",
 "kind": "copy",
 "severity": "medium",
 "observed": "apps/site/src/pages/index.astro: h1 'Hear from everyone, not just the first hand up.' (contrast slogan, group framing); h2 'Walk into every lesson prepared.', 'Know who's lost before you move on.', 'Get the honest answer, not the polite one.' (taglines, the last a 'X, not Y' pair); h2 'Try it in your next session.'; three '<p class=\"audience\">' eyebrow labels above the headings ('For tutors', 'For teachers', 'For training, workshops and meetings'); a 'Free to use' bullet in the facts list. The only plain headings are 'How it works' and its three h3 steps. The page does not say what a tutor can do in a 1:1 lesson in plain terms.",
 "expected": "Plain descriptive noun headings and direct statements of what the product does, with no eyebrows, taglines or contrast pairs.",
 "repro": [
  "Open <origin>/ and read the h1 and each section heading.",
  "View source or read apps/site/src/pages/index.astro lines 44, 72-73, 89-90, 106-107, 133, 141."
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/site-manual/site-home.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/site-manual/m-home.png",
  "apps/site/src/pages/index.astro:44",
  "apps/site/src/pages/index.astro:72-73",
  "apps/site/src/pages/index.astro:89-90",
  "apps/site/src/pages/index.astro:106-107",
  "apps/site/src/pages/index.astro:133",
  "apps/site/src/pages/index.astro:141"
 ],
 "files": [
  "apps/site/src/pages/index.astro"
 ],
 "fix": "Delete the three audience eyebrows. Use plain noun h2s ('Tutoring', 'Classroom', 'Training and workshops'). Make the h1 a factual statement of what the product does. Replace 'Try it in your next session.' with 'Start' or 'Open the workspace'. Make the 'Free to use' bullet match account.md, or remove it.",
 "needsDecision": false,
 "rules": [
  "No slogan headings, no paired or contrast slogans, no eyebrow labels (user's global rule)"
 ],
 "scenario": "site-manual",
 "verdict": "confirmed",
 "verdictReason": "The served page at <origin>/ matches index.astro. h1 'Hear from everyone, not just the first hand up.' is a contrast slogan. h2s 'Walk into every lesson prepared.', 'Know who's lost before you move on.', 'Get the honest answer, not the polite one.' (an X-not-Y pair) and 'Try it in your next session.' are taglines. Three <p class=\"audience\"> eyebrows (lines 72, 89, 106) sit above headings. This breaks the user's global no-slogan rule and the DESIGN.md No-Kicker Rule. The fix is within the rules: plain noun headings, no eyebrows, a factual h1. 'Free to use' is a claim about terms, and the teaching loop (Notes, learner links) is a paid continuity capability. Replace it with a factual line that matches account.md, or drop it.",
 "reproduced": true
}
```

```json
{
 "id": "voice-media-01",
 "title": "Permissions-Policy blocks the microphone on every page, so the Record button can never work",
 "surface": "learner-page",
 "kind": "defect",
 "severity": "high",
 "observed": "apps/workspace-worker/public/_headers:17 serves 'Permissions-Policy: geolocation=(), microphone=(), camera=()' on /* including /host/, where the learner page (#/learn) lives. On the running instance getUserMedia is rejected with NotAllowedError although the fake-media flags and the microphone permission were granted. Chrome logs 'Permissions policy violation: microphone is not allowed in this document'. document.featurePolicy.allowsFeature('microphone') is false. The learner sees 'The microphone is unavailable. Allow microphone access and try again, or choose an audio file.', which cannot be fixed by allowing anything. Only file upload works. UC-18 stays green because the spec replaces navigator.mediaDevices.getUserMedia with a stub (e2e/journeys/UC-18-voice-homework.spec.ts:23 and :88-100), so the header is never in play. The site manual (learner.md:46, troubleshooting.md:65) and UC-18 acceptance both tell students to allow microphone access.",
 "expected": "A student who taps Record gets the browser's microphone prompt on the learner page. The header should allow microphone=(self) at least for /host/ (the app that hosts #/learn), keep camera and geolocation disabled, and a journey check should fail if the served header forbids microphone.",
 "repro": [
  "Start the instance, open <origin>/host/#/learn?token=<orlnk_ link with a voice task> in Chrome with the fake-media flags",
  "Tap Record response",
  "See the red 'microphone is unavailable' alert; in DevTools run document.featurePolicy.allowsFeature('microphone') -> false",
  "curl -sI <origin>/host/ | grep -i permissions-policy -> microphone=()"
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/gap-voice-recording-and-listening-audio-real-media/02-recording.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/gap-voice-recording-and-listening-audio-real-media/03-recording-live.png (same session after stripping the header in the test browser: recording works)",
  "apps/workspace-worker/public/_headers:17",
  "e2e/journeys/UC-18-voice-homework.spec.ts:23",
  "apps/site/src/content/docs/learner.md:46"
 ],
 "files": [
  "apps/workspace-worker/public/_headers",
  "e2e/journeys/UC-18-voice-homework.spec.ts",
  "docs/journeys/UC-18-voice-homework.md",
  "apps/workspace-worker/test"
 ],
 "fix": "Do not add a second Permissions-Policy line: Cloudflare joins duplicate header values with a comma (documented). I tested this in a scratch wrangler dev with a copy of the file. Keep the /* rule, then add a block for /host/* (and /host) that detaches the broader value and sets the narrow one: '/host/*' then '! Permissions-Policy' then 'Permissions-Policy: geolocation=(), microphone=(self), camera=()'. Locally /host/ returned microphone=(self) and /other/ kept microphone=(). Leave apps/relay/public/_headers and office.ts unchanged. Add a worker or asset test that GET /host/ does not contain 'microphone=()'. Have UC-18 assert document.featurePolicy.allowsFeature('microphone') before it stubs getUserMedia. Optionally split the alert text so a persistent denial points to the browser's site settings.",
 "needsDecision": false,
 "rules": [
  "Credential boundary unaffected: header change only",
  "docs that disagree with the product"
 ],
 "scenario": "gap-voice-recording-and-listening-audio-real-media",
 "verdict": "confirmed",
 "verdictReason": "Reproduced in Chrome with fake-device flags and the microphone permission granted. document.featurePolicy.allowsFeature('microphone') is false, the console logs 'Permissions policy violation: microphone is not allowed in this document', and Record ends in 'The microphone is unavailable...' with no timer. curl on my instance and on https://openroom.app/host/ both return 'permissions-policy: geolocation=(), microphone=(), camera=()', so Record cannot work in production on any browser that honours the header. Source: apps/workspace-worker/public/_headers:17. UC-18 hides this by replacing getUserMedia with a stub (e2e/journeys/UC-18-voice-homework.spec.ts:23). docs/qa/2026-09-19-first-use.md:143 lists real microphone use as unverified. Only the file-upload fallback works. The site manual (learner.md:46, troubleshooting.md:65) tells students to allow microphone access. The fix is a header change only and touches no credential or product rule.",
 "reproduced": true
}
```

```json
{
 "id": "agent-path-14",
 "title": "Agent docs disagree with the product in several small places",
 "surface": "docs",
 "kind": "copy",
 "severity": "low",
 "observed": "(1) docs/AGENT.md:187 says 'Twelve focused tools' while its own table and tools/list have fourteen. (2) plugin/README.md lists two skills in the tree and prose although plugin/skills holds five (make-this-interactive, port-a-deck, prepare-a-language-outline are missing). (3) docs/AGENT.md:29 names a 'Prepare' area of the host UI; the sidebar has Library, Students/Classes, Shared and Trash (no Prepare). (4) /openapi.json describes nextNote as 'Sticky on the Card' (retired meaning of Card). (5) CLI usage says `deck start` will 'open the live console'; it prints a code and opens nothing. (6) run-a-session says to send a token created at POST /api/my/tokens; an agent with no token cannot call it, Settings is the path. (7) Skill wording assumes a group in a 1:1 flow: 'tells the undecided half of the session what to think', 'a session of people', 'nobody answers by copying the session'.",
 "expected": "Counts, skill lists and nouns match the shipped surface; 1:1 skills speak of one student.",
 "repro": [
  "Count the rows of the AGENT.md tool table versus tools/list.",
  "ls plugin/skills; compare with plugin/README.md.",
  "curl <origin>/openapi.json and search 'Sticky on the Card'."
 ],
 "evidence": [
  "docs/AGENT.md:29,187",
  "plugin/README.md:26-39",
  "apps/workspace-worker/src/api-catalog/openapi.ts:824",
  "packages/cli/src/run.ts:30",
  "plugin/skills/run-a-session/SKILL.md:21-23,45-47",
  "plugin/skills/prepare-a-tutoring-outline/SKILL.md:55-56"
 ],
 "files": [
  "docs/AGENT.md",
  "plugin/README.md",
  "apps/workspace-worker/src/api-catalog/openapi.ts",
  "packages/cli/src/run.ts",
  "plugin/skills/run-a-session/SKILL.md",
  "plugin/skills/prepare-a-tutoring-outline/SKILL.md"
 ],
 "fix": "Correct items 1-5 only (tool count, skill list, 'Prepare', 'Card' to student/context in OpenAPI, the `deck start` help text); do not edit the skills for item 6 or 7.",
 "needsDecision": false,
 "rules": [
  "docs/TERMINOLOGY.md vocabulary",
  "AGENTS.md one source per fact"
 ],
 "scenario": "agent-path",
 "verdict": "confirmed",
 "verdictReason": "Items 1-5 verified: docs/AGENT.md:187 says 'Twelve focused tools' above a 14-row table and tools/list returns 14 tools; plugin/README.md:15-39 lists two skills but plugin/skills has five; docs/AGENT.md:29 names a 'Prepare' area that the Library, Students, Shared, Trash sidebar does not have; openapi.ts:824 says 'Sticky on the Card' (and :434 'this Card'; AGENTS.md retires Card for context); CLI help says `deck start` will 'open the live console' and it opens nothing. Item 6 is refuted: AGENTS.md explicitly allows token creation as the one route literal in a skill. Item 7 is refuted as taste: run-a-session and the tutoring skill are written for any audience including groups.",
 "reproduced": true
}
```

```json
{
 "id": "second-lesson-15",
 "title": "A new student's empty place opens with an uppercase eyebrow and a slogan heading; API text uses retired Card",
 "surface": "workspace",
 "kind": "copy",
 "severity": "low",
 "observed": "The empty person view shows TUTORING in text-xs font-semibold uppercase tracking-wider above Open a sample and make it yours. DESIGN.md retires tracked caps and the copy rule bans eyebrows and taglines. OpenAPI and CONTRACTS use Card for context in the nextNote description, against TERMINOLOGY.",
 "expected": "Plain label with no eyebrow; the vocabulary matches TERMINOLOGY.",
 "repro": [
  "Add a student and read their empty place",
  "Read the nextNote description in the OpenAPI document"
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/gap-second-lesson-pickup-through-ui/34-noor-person.png",
  "apps/workspace/src/components/SpaceWelcome.tsx:23",
  "apps/workspace-worker/src/api-catalog/openapi.ts:824",
  "docs/CONTRACTS.md:398"
 ],
 "files": [
  "apps/workspace/src/components/SpaceWelcome.tsx",
  "apps/workspace-worker/src/api-catalog/openapi.ts",
  "docs/CONTRACTS.md"
 ],
 "fix": "Remove the label paragraph and use a plain noun heading such as 'Sample deck'. Replace 'Sticky on the Card' in openapi.ts and 'Card sticky' in CONTRACTS.md with 'student' or 'context'.",
 "needsDecision": false,
 "scenario": "gap-second-lesson-pickup-through-ui",
 "verdict": "confirmed",
 "verdictReason": "Reproduced on a new student's empty place. The Getting started label rendered with computed style text-transform uppercase, letter-spacing 0.6px and 12px (SpaceWelcome.tsx:23, raw text-xs font-semibold uppercase tracking-wider). DESIGN.md retires uppercase tracked caps and eyebrow labels, and the user's copy rule bans eyebrows and catchy headings. The heading 'Open a sample and make it yours' is also a tagline-style title. 'Card' for a context in openapi.ts:824 and CONTRACTS.md:398 contradicts TERMINOLOGY.md.",
 "reproduced": true
}
```

```json
{
 "id": "agent-path-04",
 "title": "Launch and link results give the agent no usable join, stage or student-link URL",
 "surface": "agent",
 "kind": "gap",
 "severity": "medium",
 "observed": "deck_start and session_create return joinUrl as a relative path '/join/?code=CM7N4DHX', and no stage URL or remote URL at all (stageToken only). POST .../links returns the secret token but no URL. The URL shapes exist only in app code or the manual: learner join /join/?code=&link=<token> (apps/site learner-links.md), stage /stage/?session=&token= (apps/workspace/src/api/sessions.ts:289), learner page /host/#/learn?token= (destinations.ts:181). docs/AGENT.md:381-383 and the tutoring skill step 8 say the agent returns the join and stage URLs to the tutor. CLI `deck start` prints 'session X' and 'code X' (same value twice) and a relative join path; `session start` does build a stage URL, so the two CLI start commands differ. The learner join worked once the URL was hand-built.",
 "expected": "Every start/link result carries absolute joinUrl (with the link for an identified session), stageUrl and the learner-page URL, built by the server, so an agent can hand them to the tutor or student without knowing URL formats.",
 "repro": [
  "MCP deck_start {deckId} -> body.joinUrl '/join/?code=...', no stage URL.",
  "openroom_api POST /api/tutoring/contexts/{id}/links {} -> {token, learnerId, ...} with no url.",
  "openroom deck start <id> --url ... --token ... -> 'session CODE / code CODE / join /join/?code=CODE'."
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/agent-path/learner-join.png (join worked with a hand-built URL)",
  "packages/mcp/src/tools.ts:731-756",
  "packages/cli/src/commands/deck.ts:276-330",
  "packages/cli/src/commands/session.ts:196-218",
  "docs/AGENT.md:381-383",
  "plugin/skills/prepare-a-tutoring-outline/SKILL.md:51 (step 8)"
 ],
 "files": [
  "packages/mcp/src/tools.ts",
  "apps/workspace-worker/src/delivery/sessions.ts",
  "apps/workspace-worker/src/tutoring.ts",
  "packages/cli/src/commands/deck.ts",
  "docs/AGENT.md"
 ],
 "fix": "Add absolute joinUrl, stageUrl to the launch results (deck_start, session_create, CLI deck start) and an absolute learnerUrl and joinUrl-with-&link= to the link-mint response, built server-side (respect the join origin setting). For an identified session the launch result must not present a bare /join/?code= as usable; only the link-bearing URL minted with the link is. Putting the one-time orlnk_ token into the URL returned by the same mint call exposes nothing new. Drop the duplicate 'code' line from `deck start`.",
 "needsDecision": false,
 "rules": [
  "AGENTS.md one source per fact"
 ],
 "scenario": "agent-path",
 "verdict": "confirmed",
 "verdictReason": "Reproduced. MCP deck_start returned joinUrl '/join/?code=D2RDMJ4R' (relative) plus hostToken and stageToken but no stage URL; POST /api/tutoring/contexts/{id}/links returned {id, tokenPrefix, token, learnerId, displayName, expiresAt} with no URL; CLI `deck start` printed the code twice and a relative join path, while `session start` builds a stage URL (packages/cli/src/commands/session.ts:196-218), so the two CLI start commands differ. docs/AGENT.md:381-383 and prepare-a-tutoring-outline step 8 tell the agent to return stage and join URLs to the human, but no tool result lets it do that without knowing /stage/?session=&token= (apps/workspace/src/api/sessions.ts:289) and /host/#/learn?token= (destinations.ts:181) formats.",
 "reproduced": true
}
```

```json
{
 "id": "notes-homework-15",
 "title": "Write-notes prompt, continuity lock states, save-failure fallback and /api/my/home have no browser or worker test",
 "surface": "workspace",
 "kind": "gap",
 "severity": "low",
 "observed": "Confirmed the lead: no e2e references 'Write Notes' or the lock; ContinuityLock has only a static-markup unit test; UC-37 fixtures cover only the billing page. 'Your access changed', 'Add to private notes' and the device fallback appear in no test, and /api/my/home (the needsRecord SQL with its ended/recovery-window HAVING clause and the continuity filter) has no worker test. UC-39 and UC-19 cover only the happy-path Notes save. The three stale and ambiguity defects above went unnoticed for that reason.",
 "expected": "A journey covers end session, write-notes prompt, Notes save failure and the lock (via route interception), and a worker test covers /api/my/home.",
 "repro": [
  "grep -rn 'Write Notes' e2e returns nothing",
  "grep -rn 'my/home' apps/workspace-worker/test returns nothing"
 ],
 "evidence": [
  "/Users/uti/Desktop/openroom/e2e/journeys/UC-39-first-tutoring-lesson.spec.ts",
  "/Users/uti/Desktop/openroom/apps/workspace/src/components/ContinuityLock.test.tsx",
  "/Users/uti/Desktop/openroom/apps/workspace-worker/src/home.ts:50-90"
 ],
 "files": [
  "e2e/journeys/UC-39-first-tutoring-lesson.spec.ts",
  "e2e/journeys/UC-19-individual-assignments.spec.ts",
  "apps/workspace-worker/test/continuity-access.test.ts",
  "docs/journeys/UC-39-first-tutoring-lesson.md"
 ],
 "fix": "Narrow the scope: add a worker test for /api/my/home (ended, recovery window, lapsed owner) and a browser step for the write-notes prompt (including the post-End staleness from notes-homework-04) and 'Add to private notes'; do not duplicate the access-lost coverage UC-38 already has.",
 "needsDecision": false,
 "rules": [],
 "scenario": "notes-homework",
 "verdict": "confirmed",
 "verdictReason": "Partly true. Confirmed: no e2e or worker test covers the Library write-notes prompt, the /api/my/home needsRecord query (the only 'my/home' test is in apps/relay), the 'Add to private notes' button, or the ContinuityLock states in a browser (only the static ContinuityLock.test.tsx and the worker continuity-access.test.ts). Refuted: the claim that 'Your access changed' and the device fallback appear in no test is wrong. e2e/journeys/UC-38-saved-results.spec.ts:40-76 changes a member to presenter, asserts 'Your access changed', the disabled Save, the device-notes textbox after reload, the download, and the resumed save. This is a test gap, not a UX defect, so severity is low.",
 "reproduced": false
}
```

```json
{
 "id": "review-next-10",
 "title": "One note has three names, and share and student/learner are used loosely in the review loop",
 "surface": "workspace",
 "kind": "copy",
 "severity": "low",
 "observed": "The field is labelled Next step on the Notes form, appears as Next session on the person view, in the editor banner and in the live console, and is called For next time in docs/TUTORING.md. docs/CONTRACTS.md still says Card sticky, a retired term. The form never says where the note will appear. Share means three things: the person-view Share button opens the space member invite page, Share feedback publishes to the student, and Not shared describes the space. The person view mixes Student access links with Review learner work.",
 "expected": "One label per concept. Next step helper text says it shows on the person view and as a banner in the next deck. Share on the person view says what it does.",
 "repro": [
  "Session notes: field Next step",
  "Person view: Next session sticky",
  "Click Share on the person view: Share this space, Invite"
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/review-next/tutor-15-notes.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/review-next/tutor-28-share.png",
  "apps/workspace/src/pages/tutor/SessionNotes.tsx:178",
  "docs/TUTORING.md:109",
  "docs/CONTRACTS.md:398",
  "apps/workspace/src/pages/SpacePage.tsx:566"
 ],
 "files": [
  "apps/workspace/src/pages/tutor/SessionNotes.tsx",
  "apps/workspace/src/components/ContextPanel.tsx",
  "apps/workspace/src/pages/SpacePage.tsx",
  "docs/TUTORING.md",
  "docs/CONTRACTS.md",
  "docs/TERMINOLOGY.md"
 ],
 "fix": "Pick one label for the note (Next step, matching the form and API field) and use it in the sticky and both banners, or keep 'Next session' and say it on the form. Add one helper line on the Notes form ('Shown on this student's page and above the next deck'). Replace 'For next time' and 'Card sticky' in docs/TUTORING.md and docs/CONTRACTS.md. Leave Share and student/learner as they are.",
 "needsDecision": false,
 "rules": [
  "docs/TERMINOLOGY.md: Card is retired"
 ],
 "scenario": "review-next",
 "verdict": "confirmed",
 "verdictReason": "Narrowed. Confirmed: the Notes form labels the field 'Next step' with no helper text saying where it appears (SessionNotes.tsx:178), while the person view, editor banner and live banner say 'Next session' (ContextPanel.tsx:42, DeckEditor.tsx:431, LiveHost.tsx:602). docs/TUTORING.md:109 still says 'For next time' and docs/CONTRACTS.md:398 says 'Card sticky', which uses a term TERMINOLOGY.md retires. Refuted parts: student vs learner is documented (TERMINOLOGY.md:127-128 and the Students entry), and renaming the person-view Share affects every Share in the workspace (the editor top bar uses the same spaceMembers target), so it is outside this scenario.",
 "reproduced": true
}
```

```json
{
 "id": "learner-page-15",
 "title": "Docs disagree with the product: learner view documented as read-only 'me' and 'sessions'; UC-15 frames the learner flow as group work",
 "surface": "docs",
 "kind": "gap",
 "severity": "low",
 "observed": "docs/TERMINOLOGY.md describes the learner view as backed by `/api/learner/*` (`me`, `sessions`), a 'read surface', 'not a place anything is written'. The shipped page writes practice grades, writing, voice uploads, and audio trash and restore, and reads feedback and practice. UC-15's title and purpose ('private group work', 'a tutoring group') and its fixture (a French conversation group, Léa and Noor) frame the learner link around groups, while the audited scenario is one tutor and one student. Separately, a zero-byte recording (microphone yields no data) is reported as 'Choose an audio file under 20 MB.' because prepareAudio uses audioTooLarge for !blob.size, which the docs do not mention.",
 "expected": "TERMINOLOGY.md lists all learner routes and says the learner view writes only the learner's own work (practice grades, writing, voice) and never tutor-side records. UC-15 gains a one-student fixture. An empty recording gets its own message such as 'No sound was recorded. Check the microphone and try again, or choose an audio file.'",
 "repro": [
  "Compare docs/TERMINOLOGY.md lines 107-113 and 194-197 with api/learner.ts exports (writing, voice, practice, feedback).",
  "In an environment where MediaRecorder yields 0 bytes (observed in headless Chromium without an audio device), press Record then Stop: the 20 MB message appears."
 ],
 "evidence": [
  "docs/TERMINOLOGY.md:112",
  "docs/journeys/UC-15-learner-links.md:1-8",
  "apps/workspace/src/api/learner.ts:77-127",
  "apps/workspace/src/pages/learner/VoiceTask.tsx:15",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/learner-page/shots/p3-F-recorded.png (zero-byte recording reported as 'Choose an audio file under 20 MB.')"
 ],
 "files": [
  "docs/TERMINOLOGY.md",
  "docs/journeys/UC-15-learner-links.md",
  "apps/workspace/src/pages/learner/VoiceTask.tsx",
  "apps/workspace/src/lib/learner-copy.ts"
 ],
 "fix": "Update the TERMINOLOGY.md learner-view row: list all /api/learner/* routes and say the learner view writes only the learner's own work (practice grades, writing, voice) and never tutor-side records. Add an audioEmpty string in EN, FR and DE ('No sound was recorded. Check the microphone and try again, or choose an audio file.') used when !blob.size. Leave UC-15 alone.",
 "needsDecision": false,
 "scenario": "learner-page",
 "verdict": "confirmed",
 "verdictReason": "Two of the three parts hold. (1) docs/TERMINOLOGY.md:112 describes the learner view as `/api/learner/*` (`me`, `sessions`), 'the read surface', 'not a place anything is written', but learner.ts:3-6 and the router (:144-160) expose practice grades, writing, voice upload, feedback and audio trash and restore. This is a real doc and code mismatch, and it also contradicts docs/CONTRACTS.md:358. (2) VoiceTask.tsx:15 maps an empty blob (`!blob.size`) to 'audioTooLarge' ('Choose an audio file under 20 MB.'), a wrong message for a zero-byte recording. I did not reproduce it because there is no microphone here, but the code settles it. It needs a device that yields no data, so low severity. The third part, UC-15 framed around groups, is not a defect: UC-15 deliberately covers a group and link replacement, and 1:1 learner flows are covered by UC-16 to UC-23.",
 "reproduced": false
}
```

```json
{
 "id": "agent-path-03",
 "title": "docs/AGENT.md 'whole happy path' cannot be followed with a personal token",
 "surface": "docs",
 "kind": "defect",
 "severity": "medium",
 "observed": "docs/AGENT.md:73-96 prescribes `openroom session start session.yaml --url $BASE --admin-key $KEY`, an HTTP table using header x-openroom-admin, and says 'That is the whole happy path'. The same file (lines 147-155) says to prefer a personal token and that the ops key is limited to ops requests. `session start` has no --token option: with the PAT as --admin-key it answers 'error: POST /api/sessions -> unauthorized'; with --token it answers 'missing required option --admin-key'. A tutor's agent has only a PAT. What works for a tutor is `deck start` followed by `session facilitate <code> --token`, which the happy path never mentions; `deck start` itself prints no stage URL and does not write .openroom.json, and a following `session status` says 'run \"openroom session start\" first', pointing back at the command that cannot work.",
 "expected": "The documented happy path works with the credential the Settings page hands out, and the CLI error after `deck start` points at `session facilitate`.",
 "repro": [
  "Create a token in Settings.",
  "openroom init s.yaml; openroom session start s.yaml --url <origin> --admin-key <orpat_ token> -> unauthorized.",
  "openroom deck start <deckId> --url <origin> --token <orpat_ token> -> prints session, code, join only.",
  "openroom session status -> 'no active session (.openroom.json missing) - run \"openroom session start\" first'."
 ],
 "evidence": [
  "docs/AGENT.md:73-96, 142-155",
  "packages/cli/src/commands/session.ts:180-190",
  "packages/cli/src/state.ts:46-55 (E_NO_SESSION text)",
  "apps/site/src/content/docs/cli.md:60-66 (the manual does show deck start then session facilitate)"
 ],
 "files": [
  "docs/AGENT.md",
  "packages/cli/src/commands/session.ts",
  "packages/cli/src/state.ts",
  "packages/cli/src/commands/deck.ts"
 ],
 "fix": "Rewrite the docs/AGENT.md happy path around token + deck start + session facilitate and keep the ops-key flow labelled as operator/self-host only. Change E_NO_SESSION to name both `session start` and `session facilitate <code> --token`. Optionally let `session start` accept --token (POST /api/sessions already accepts a PAT) and let `deck start` write the state file. Fix the 'open the live console' help text. Do not duplicate command lists in more places (AGENTS.md one source per fact).",
 "needsDecision": false,
 "rules": [
  "AGENTS.md one source per fact",
  "docs that disagree with the product"
 ],
 "scenario": "agent-path",
 "verdict": "confirmed",
 "verdictReason": "Reproduced with the built CLI. `session start s.yaml --admin-key <orpat_>` answers 'error: POST /api/sessions -> unauthorized'; with --token it exits 2 'missing required option --admin-key'; it only works with the deployment ops key (dev-admin). `deck start <id> --url --token` prints 'session X / code X / join /join/?code=X', writes no .openroom.json, and the next `session status` says 'no active session ... run \"openroom session start\" first' (packages/cli/src/state.ts:46-55). docs/AGENT.md:73-96 presents the ops-key flow as 'the whole happy path', while the same file (142-155) says tutors use a personal token. The public manual apps/site/src/content/docs/cli.md:60-66 already shows the working path (deck start, then session facilitate, which stores state), so the damage is the internal canonical doc, the E_NO_SESSION text, and the help line 'deck start ... open the live console' (nothing opens). Downgraded from high to medium because the public manual and MCP are correct.",
 "reproduced": true
}
```

```json
{
 "id": "site-manual-09",
 "title": "docs/TUTORING.md route table describes routes that no longer behave that way",
 "surface": "docs",
 "kind": "defect",
 "severity": "low",
 "observed": "Line 65: #/tutor/contexts is 'the one non-folder shelf, grouped by kind'; it only redirects to the Library. Line 67: the context hub shows 'linked decks + sessions, notes secondary'; the route redirects and the student's Library shows decks only, plus Student access links and Review learner work. Line 70: #/decks/:id is a detail route that 'leads with its teaching history'; it renders 'Page not found'. Line 73: Home shows 'upcoming/recent sessions' and a 'Get started' card; #/ is the first space's Library with a Live now row, and 'upcoming' contradicts the no-scheduling rule. Line 76: 'Unknown hashes land on Home'; they render Page not found with a Home link. Line 78: '#/decks/:id* legacy aliases remain reachable'; #/decks/:id does not.",
 "expected": "The route table lists the routes that exist and what they do now.",
 "repro": [
  "Open #/decks/<existing id>: Page not found.",
  "Open #/tutor/contexts and #/tutor/contexts/<id>: redirect to the Library with ?contextId=.",
  "Open #/nonsense: Page not found."
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/site-manual/deck-detail-404.png",
  "docs/TUTORING.md:65,67,70,73,76,78",
  "apps/workspace/src/app-router.tsx:158-160",
  "apps/workspace/src/pages/tutor/Contexts.tsx"
 ],
 "files": [
  "docs/TUTORING.md",
  "docs/IA.md"
 ],
 "fix": "Rewrite the route table rows: #/tutor/contexts and #/tutor/contexts/:id redirect to the student's Library; no #/decks/:id detail route; #/ is the Library of the current space with a Live now row; unknown hashes show Page not found. Drop 'upcoming'.",
 "needsDecision": false,
 "scenario": "site-manual",
 "verdict": "needs-decision",
 "verdictReason": "The drift is real and reproduced. #/tutor/contexts and #/tutor/contexts/:id redirect to the student's Library with ?contextId=. #/decks/:id and #/nonsense render 'Page not found' with a Home link. #/ is the first space's Library. There is no 'upcoming' sessions list, and the Home guided card is now the Library first-run card. The conflict is that AGENTS.md says 'an unknown hash lands on the Library rather than 404ing' and lists #/decks/:id as a browser hash, so the auditor's rewrite ('unknown hashes show Page not found') would document behaviour that contradicts the repository rules. Either the router or the rules must change. This is internal developer documentation, so severity is low.",
 "options": [
  "Fix the router so unknown hashes and #/decks/:id land on the Library (as AGENTS.md states), then update the TUTORING.md rows to that behaviour.",
  "Keep the 404 and amend AGENTS.md plus TUTORING.md to say unknown hashes and #/decks/:id show Page not found.",
  "Rewrite only the unambiguous TUTORING.md rows now (contexts redirects, drop 'upcoming', Home as the Library with Live now, remove the 'Get started' card claim) and leave the two 404 rows until the choice is made."
 ],
 "reproduced": true
}
```

```json
{
 "id": "site-manual-15",
 "title": "IA.md, the journeys board and the manual coverage map list things that do not match the repo",
 "surface": "docs",
 "kind": "defect",
 "severity": "low",
 "observed": "IA.md:73 says the Library has three panes (tree rail, list, inspector); the screen has a space navigation rail plus the folder tree, desk and inspector. IA.md:83 says there is one create button, 'New deck'; the Library shows New deck in the sidebar, the header and the list, plus New folder and Sample lessons. docs/journeys/README.md has no rows for UC-39 to UC-42 although e2e/journeys/UC-39..UC-42 specs and docs/journeys/UC-39..42 pages exist (UC-43 is listed). Contract pages are missing for UC-05, 06, 07, 10, 11 and 12. docs/manual/coverage.md:31 points at Remote.tsx, which does not exist (the file is packages/editor/src/live/PresenterRemote.tsx).",
 "expected": "The docs name the layout, the buttons and the files that exist, and the status board lists every journey spec.",
 "repro": [
  "List e2e/journeys and compare UC numbers with the board rows in docs/journeys/README.md.",
  "Search the repo for Remote.tsx."
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/site-manual/lib-after-start.png",
  "docs/IA.md:73,83",
  "docs/journeys/README.md:74",
  "docs/manual/coverage.md:31"
 ],
 "files": [
  "docs/IA.md",
  "docs/journeys/README.md",
  "docs/manual/coverage.md"
 ],
 "fix": "Add UC-39 to UC-42 rows to docs/journeys/README.md with a status taken from an actual run, not invented. Add the missing contract pages for UC-05, 06, 07, 10, 11 and 12 if the journey loop is to be kept. Change Remote.tsx to PresenterRemote.tsx in docs/manual/coverage.md. Leave the IA.md Library description unchanged.",
 "needsDecision": false,
 "scenario": "site-manual",
 "verdict": "confirmed",
 "verdictReason": "Part of this finding survives. docs/journeys/README.md has board rows through UC-38, then UC-43; UC-39 to UC-42 specs and contract pages exist but have no rows. docs/journeys has no contract pages for UC-05, 06, 07, 10, 11, 12, although the README loop requires one per journey. coverage.md:31 cites Remote.tsx, which does not exist; the file is packages/editor/src/live/PresenterRemote.tsx. The IA.md claims are refuted. IA.md:73 'Three panes: tree rail · list · inspector' matches AGENTS.md. The left space and student navigation is workspace shell chrome, not a Library pane. IA.md:83 'One create button, New deck' means one kind of create (a deck), and the several New deck entry points all create a deck. This is internal documentation hygiene, hence low.",
 "reproduced": false
}
```

```json
{
 "id": "editor-authoring-09",
 "title": "Notes tab caption says 'Saved on this device' and never says the notes are private",
 "surface": "deck-editor",
 "kind": "copy",
 "severity": "medium",
 "observed": "The Notes textarea is labelled 'Notes for <slide>' with the caption 'Saved on this device.' The note is stored in the deck outline (step.tutorNotes) and saved with the cloud draft; it appeared in the live console after Start session, so the caption is wrong. Nothing tells the tutor the note is host-only. I confirmed the participant snapshot (GET /api/sessions/<code>/state?role=participant) contains neither the marker text nor a tutorNotes key, so the product is right and the copy is not. The live console 'Private notes' box repeats the same caption. 'Notes' is also the name of the post-session lesson record, so the word means two things.",
 "expected": "The caption states what is true: saved with the deck, visible only to the tutor, never sent to students. Terminology keeps 'Notes' for the lesson record and names these 'Tutor notes' or 'Private notes'.",
 "repro": [
  "Select slide 2, open the task pane Notes tab and type text.",
  "Read the caption: 'Saved on this device.'",
  "Click Start session, then select slide 2 in the console: the text appears in Private notes.",
  "Join as a participant with the code and fetch the participant state: the text is absent."
 ],
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/editor-authoring/59-notes-entered.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/editor-authoring/60-live-console.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/editor-authoring/61-live-notes.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/audit/editor-authoring/part-state.json",
  "packages/editor/src/deck-edit/properties/notes-dictionary.tsx:63-88",
  "packages/editor/src/deck-edit/outline-edit/parts.ts:38-39"
 ],
 "files": [
  "packages/editor/src/deck-edit/properties/notes-dictionary.tsx",
  "packages/editor/src/live/LiveHost.tsx",
  "docs/TERMINOLOGY.md"
 ],
 "fix": "Replace the Notes-tab caption with 'Saved with the deck. Students never see these notes.' Leave the live console scratchpad caption alone. Treat renaming the tab as a separate terminology question (it collides with the post-session 'Tutor notes' field), not part of this fix.",
 "needsDecision": false,
 "rules": [
  "docs/TERMINOLOGY.md vocabulary: Notes"
 ],
 "scenario": "editor-authoring",
 "verdict": "confirmed",
 "verdictReason": "Reproduced. I typed a marker into the Notes tab. The caption reads 'Saved on this device.' (25-notes-tab.png), but GET /api/decks/:id/draft contains the marker and localStorage does not. The note is `step.tutorNotes` in the outline (parts.ts:38), saved with the cloud draft, so the caption is false (notes-dictionary.tsx:88). The claim that the live console box 'repeats the same caption' is wrong. The console shows the deck note read-only and a separate device-local scratchpad whose 'Saved on this device.' is accurate (SessionAside.tsx:217-232). The auditor's proposed caption 'Only you see this' is also wrong. Deck notes are visible to space members and co-hosts, as the manual says for tutor notes (notes.md:21). Renaming the tab to 'Tutor notes' would collide with the post-session 'Tutor notes' field label (SessionNotes.tsx:179).",
 "reproduced": true
}
```

```json
{
 "id": "gap-phone-soft-keyboard-and-short-viewport-13",
 "title": "No journey or contract covers a short viewport, landscape or the keyboard",
 "surface": "manual",
 "kind": "gap",
 "severity": "low",
 "observed": "26 journey viewports are 390x844 and the other phone sizes are 320x700, 340x900, 360x780 or similar tall boxes. None sets a height below 700 for the participant app, none focuses a field and then checks that Send stays in view, and none scrolls the phone page. UC-16 and UC-13 assert phone behaviour but only at full height, which is why findings 01-03 shipped green. The earlier learner-live, learner-page and review-next audits list the keyboard as not exercised.",
 "expected": "A journey asserts that Send, the answered state, the Q&A list and Reading content are reachable by scroll at 390x340 and 844x390, and that a focused field and Send are both inside visualViewport.",
 "repro": [
  "grep for `setViewportSize` or `viewport:` in e2e/journeys/*.spec.ts for the participant app: only tall sizes appear."
 ],
 "evidence": [
  "e2e/journeys/UC-16-homework-practice.spec.ts:27 (390x844)",
  "e2e/journeys/UC-05-session-qna.spec.ts",
  "docs/journeys/README.md (status board, no short-viewport journey)"
 ],
 "rules": [
  "docs/journeys/README.md contract loop: document, encode, fix UI"
 ],
 "files": [
  "e2e/journeys/UC-05-session-qna.spec.ts",
  "e2e/journeys/UC-16-homework-practice.spec.ts",
  "docs/journeys/README.md"
 ],
 "fix": "Following the README contract loop (doc, red spec, UI fix, commit together), add a journey (for example UC-44, or extend UC-05, UC-16 and UC-39) that at 390x340 and 844x390 scrolls to Send, the answered state with Change answer, the session Q&A list, Reading content and the join button. Record the real-keyboard check as a manual 'physical devices pending' status like UC-18, not as an assertion.",
 "needsDecision": false,
 "scenario": "gap-phone-soft-keyboard-and-short-viewport",
 "verdict": "confirmed",
 "verdictReason": "Verified by grep of e2e/journeys: every participant-phone check uses 390x844 (the narrower ones are 320x700 in UC-09 and UC-26, still tall); the only short heights are UC-41 (1000x480 and 1180x650), which is the workspace editor. docs/journeys/README.md has no short-viewport or landscape journey, so findings 01 and 03 shipped green. This is a coverage gap rather than a UX defect, so it stays low. A Playwright journey cannot raise a real keyboard or assert visualViewport, so the auditor's keyboard assertion is not encodable.",
 "reproduced": true
}
```

```json
{
 "id": "agent-path-06",
 "title": "The per-student workflow is only reachable through openroom_api, whose description lists paths the allowlist rejects",
 "surface": "agent",
 "kind": "defect",
 "severity": "low",
 "observed": "SERVER_INSTRUCTIONS never mention students/contexts, identified sessions, learner links or records. There is no named tool or CLI subcommand to list or create decks or contexts; everything goes through openroom_api (description 9,770 characters, mixing billing, brand kits, PowerPoint, space invites and the tutoring flow). That description writes 'POST /decks creates a deck', '/decks/{id}/versions', '/decks/{id}/draft', 'POST /sessions/{id}/launch', 'POST /spaces/{spaceId}/assets' without the /api or /api/tutoring prefix; calling GET /decks returns 'path is outside the tutoring API allowlist' with no list of what is allowed (the CLI error does list three prefixes, and `openroom api` help says </api/tutoring/...> although decks and sessions are not under it). Request bodies for POST contexts (displayName, kind, context{language,level,goals}) and POST /api/decks are not in the description. Lead check (one source per fact): confirmed in part. The identified-session constraint, the token recipe (`POST /api/my/tokens` in run-a-session, which an agent without a token cannot call) and session-lifetime facts live only in skills/docs. Refuted for prepare-a-tutoring-outline: it restates no API paths. The iframe/pdf/markdown rules are stated three times (SERVER_INSTRUCTIONS, outline_validate, AGENT.md).",
 "expected": "Paths in descriptions are exact and runnable. The tutoring sequence (find or create student, deck under student, identified, start, link, record) is stated once in a tool description, and a tutoring agent is not made to read billing and brand-kit contracts to find it.",
 "repro": [
  "MCP openroom_api {method:'GET', path:'/decks'} -> isError true 'path is outside the tutoring API allowlist'.",
  "CLI: openroom api GET /decks -> 'error: api path is outside /api/tutoring/contexts, /api/decks, and /api/sessions'.",
  "Read tools/list: openroom_api description length 9770."
 ],
 "evidence": [
  "packages/mcp/src/tools.ts:232-265 (relative paths at 241, 242, 258, 262)",
  "packages/mcp/src/server.ts:35-56",
  "packages/cli/src/run.ts:41-49",
  "plugin/skills/run-a-session/SKILL.md:21-23"
 ],
 "files": [
  "packages/mcp/src/tools.ts",
  "packages/mcp/src/server.ts",
  "packages/cli/src/run.ts",
  "packages/cli/src/commands/api.ts",
  "plugin/skills/run-a-session/SKILL.md"
 ],
 "fix": "Prefix the relative paths in the openroom_api description with /api, remove or correct the raw-bytes asset-upload sentence for the MCP tool (or route it), make the allowlist error list the allowed prefixes (as the CLI error already does), and fix the CLI api help line. Do NOT split openroom_api or move a tutoring sequence into it as a separate rewrite: the identified-session rule is covered by agent-path-01's fix, and the single gateway tool is the existing design. Do NOT delete the POST /api/my/tokens line from run-a-session as proposed: AGENTS.md names token creation as the one route literal allowed in a skill (reword it to say it needs a signed-in session or Settings if wanted).",
 "needsDecision": false,
 "rules": [
  "AGENTS.md one source per fact: tool facts belong in tool descriptions, not skills"
 ],
 "scenario": "agent-path",
 "verdict": "confirmed",
 "verdictReason": "Narrowed. Reproduced: openroom_api GET /decks answers 'path is outside the tutoring API allowlist' with no list (tools.ts:603-605); the description is 9,770 characters and writes paths without the /api prefix at tools.ts:241-242, 258, 262 even though its first sentence (236-237) lists the prefixed allowed paths. New evidence: the asset-upload sentence (tools.ts:262-265) is not runnable through openroom_api at all, because POST /api/tutoring/spaces/{id}/assets passes the schema regex (packages/schema/src/tutoring-paths.ts:22-23) but handleTutoringApi returns null for it, so the same 'outside the tutoring API allowlist' error appears (apps/workspace-worker/src/mcp.ts:131) and the tool only sends JSON bodies anyway. `openroom api` help line says </api/tutoring/...> although decks and sessions are not under it. SERVER_INSTRUCTIONS (server.ts:35-56) indeed never mention students or links, but the openroom_api description does carry the tutoring contract.",
 "reproduced": true
}
```
