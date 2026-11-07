# Resolved decisions

The user accepted every recommendation. Build to the recommended option; the other options are listed only for context.

## Tutoring decisions (D1–D24)

### D1 (agent-surface): How does a tutor who works only in the browser start a named (identified) lesson?

Chosen: Keep identified an agent-door feature. It leaves the credential boundary and free live sessions untouched, matches how the manual already describes identified mode, and agent-path-04 closes the practical gap by returning the finished URL. Revisit the console action only if tutors without an agent ask for it.

Findings: start-join-01, editor-authoring-04, site-manual-01

- Identified stays an agent-door feature: The prepared outline sets identityMode and deck_start or the CLI return the finished join URL that already carries the student link (agent-path-04). The manual says the browser has no named-join control. No credential-boundary impact; a browser-only tutor runs nickname lessons.
- Console action Copy student link: In identified sessions the Session menu offers Copy student link: the tutor pastes the student orlnk_ link once and the console builds /join/?code=..&link=.. locally without storing it. Gives browser-only tutors a path with no server change, but the presenter then handles a credential, which needs a credential-boundary review.
- Deck-level identified switch: A continuity-gated switch writes defaults.identityMode through outline-edit.ts, classified in outline-fuzz.ts, exposed as an EditorServices slot (absent slot means no switch). Adds a new deck-level setting, still needs a link-composing step, and free accounts get 403 at start.
- Link-only join resolved by the Worker: /join/?link=orlnk_.. resolves the live session through sessions.context_id and returns only a participant token. Creates a second association path, which AGENTS.md forbids, and is ambiguous when a context has several live sessions; needs a credential-boundary review.

### D2 (workspace-library): What should Start session do when the same deck is already live for the same student?

Chosen: Keep Start, add the quiet Rejoin cue and a single confirmation. It follows the file model in AGENTS.md (Start always files a new session, Live now is a state of now) while ending the silent duplicate. The agent API stays free: an additive requestId in agent-surface covers retries.

Findings: start-join-02, second-lesson-09, live-console-01, agent-path-05

- Replace Start with Rejoin while the deck is live: Stops a second concurrent session of one deck in the inspector, editor top bar and Presenter. Acts as a lock and bends the file model, where a deck can be started more than once.
- Keep Start, add a quiet Live now - Rejoin cue and one confirmation: The inspector, editor top bar and Presenter show Live now - Rejoin beside Start session; pressing Start while a recoverable live session of this deck and student exists asks once: rejoin it, or start another. Needs deckId and context on MySession. Escape stays the documented exit after armed lookup is cancelled first.
- Leave Start as is and only disambiguate Live now rows: Rows name the student (second-lesson-01, which ships regardless). Silent double starts remain possible.

### D3 (live-console): Does the teacher UI keep its classroom phrasing in one-to-one lessons?

Chosen: Keep canonical strings and change only the outliers. The canonical phrases are mandated in AGENTS.md, DESIGN.md and TERMINOLOGY.md, groups are a first-class tutoring concept, and the editor may not import from apps/.

Findings: start-join-13, live-console-13, editor-authoring-13, onboarding-07

- Keep canonical strings, change only the outliers: The row format (2 ask the class, AGENTS.md:154 and DESIGN.md:341) and the End dialog body (TERMINOLOGY.md:287) stay. Change Prepare workshop recap to Prepare recap, the welcome card audience question, the name placeholder to e.g. Camille, and the plural Students language label. No documentation conflict; some class wording stays visible to tutors.
- Neutral wording everywhere: 2 questions on rows, Prepare recap, Everyone is disconnected. Requires amending AGENTS.md, DESIGN.md and TERMINOLOGY.md first, then code, tests (contents-meta) and the manual. One copy set for every experience.
- Experience-aware noun through an optional EditorServices slot: Tutoring rows read 2 ask the student; an absent slot means the class. Acceptable under the no-global-isTutoring rule only if the slot changes copy and never tools; adds slot plumbing and two copy sets.

### D4 (participant): What does the participant screen show for a one-learner session?

Chosen: Use one neutral set of strings with an English phone UI. It avoids a count-dependent copy path and a licence-boundary change, fixes the visible one-learner awkwardness, and leaves the first-vote visibility question (live-console-07) for a separate schema decision.

Findings: learner-live-13, gap-phone-soft-keyboard-and-short-viewport-12, learner-live-08, live-console-07

- One neutral set of strings and an English phone UI: Neutral wording for peer instruction, group and Q&A text (for example: Talk it through, then vote again), the stage peer line reads Discuss. Compare reasons, then vote again., an empty aggregate (total 0) renders nothing, the page title becomes Join a session, and lesson text gets a lang attribute when the lesson language is known. No snapshot change and no new localisation architecture; phone controls stay English only.
- Vary by participant count and localise through a shared MIT package: Copy switches when exactly one learner has joined, and the EN/FR/DE learner copy moves out of apps/workspace into a shared MIT package with an interface-language field in the join response. Best fit for French and German students; a large cross-package change that needs a licence-boundary review because learner-copy is AGPL app code.
- Leave as is and document it: Peer and group modes are class features and a tutor will not pick them for 1:1; the mixed-language phone UI is stated in the participant manual.

### D5 (notes-learner): Which colour do primary buttons take on the learner page?

Chosen: Keep blue on the learner page and amend DESIGN.md. The two-hue rule defines orange as a live class, the learner page is asynchronous, and the recording timer still takes live orange as a running clock (that part ships in the cluster either way).

Findings: learner-page-10, notes-homework-12, review-next-12, voice-media-14

- Orange (live variant) for every learner primary button: Follows DESIGN.md literally (every student press, blue never on a student button). The asynchronous learner page then shows the live hue though nothing is live, which blurs orange as the sign that a class is in it.
- Keep action blue and amend DESIGN.md: One sentence in DESIGN.md Buttons: orange means a session is live; the learner page, which TERMINOLOGY.md says is not a participant, keeps blue. No code change; keeps the two-hue meaning.
- Orange only for buttons that deliver work: Save, Check and Send response use live; navigation actions stay blue. Mixed signal inside one page.

### D6 (notes-learner): Which session leads the learner Lesson tab, and how are repeated titles told apart?

Chosen: Lead with the newest written session, hide record-less sessions from the learner, label it Latest session and add a silent ordinal for repeated titles. It needs no dates and keeps the learner on the last homework that exists.

Findings: learner-page-02, notes-homework-06, second-lesson-03, second-lesson-13

- Newest session with a record, label Latest session, silent ordinal for repeats: The learner API omits sessions without a record, the headline is the newest written session, and repeated deck titles read French verbs and French verbs - 2, mirroring tutor Notes. No date is shown; the existing empty message covers a learner with no records.
- Newest session leads only while live or just ended: Otherwise the newest written session leads. Shows an in-progress lesson but needs a rule for just ended and still lists record-less sessions.
- Keep the order and open Earlier sessions by default: Smallest change; the headline still reads This session with Nothing written up yet when the newest session has no record.
- Add a date to each card: Needs an explicit exception to the titles-only rule in TERMINOLOGY.md for the learner page; not recommended.

### D7 (workspace-library): Is the tutor workspace desktop-only, responsive, or split?

Chosen: Make the form and Notes routes responsive and keep the Library desktop-only with a notice. Tutors write Notes after a lesson on whatever device is at hand, the treatment already exists for Settings, and DESIGN.md only specifies collapse for the live console and participant.

Findings: onboarding-03, student-place-12, notes-homework-13, review-next-13

- Desktop-only by design: Keep the 980 px shell, add a one-line notice below 980 px, align the Library two-pane breakpoint with the shell minimum so 980 to 1023 is not broken, and record it in DESIGN.md Layout and the manual. Cheapest; Notes cannot be written on a phone.
- Whole shell responsive: Collapse the 244 px sidebar below lg, show the inspector as a panel, and drop min-w-[980px]. Largest change across Library, person view and surrounding pages.
- Responsive for form and Notes routes only: Add student, Space settings, Sample lessons, session Notes and Review learner work take the account-page treatment Settings already has; the Library stays at 980 px with the notice and the breakpoint alignment.

### D8 (deck-editor): How should the deck editor behave below 1024 px?

Chosen: Collapse the pane below lg for tablets and show the larger-screen notice below md while keeping Present and Start session usable. Authoring is a desktop task, but running a lesson from a tablet is not.

Findings: editor-authoring-11

- Responsive collapse: The task pane becomes an overlay below lg and the rail a drawer below md, with Present and Start session reachable at every width. Most work.
- Tablet only: Collapse the pane below lg and show Open on a larger screen to edit below md, keeping Present and Start session usable.
- Declare the editor desktop-only: State it in DESIGN.md Layout and the manual and show the notice at 768 px and below. No layout work.

### D9 (workspace-library): How does a new tutor reach the Tutoring experience on first run?

Chosen: Promote Choose experience and add the Sample lessons link. It is the smallest change, keeps the experience a navigation and starter choice only (AGENTS.md), and needs no default or spec rewrite.

Findings: onboarding-02, site-manual-06, onboarding-05

- Promote Choose experience in the first-run card: Choose experience becomes primary weight, the Tutoring card adds a Sample lessons link beside Open sample deck, and Choose experience disappears once an experience is saved. The default stays Classroom and UC-12 keeps its starter assertion.
- Radios inside the card: A Personal space that never saved an experience shows the three experiences with one Continue; the Tutoring primary action opens the Sample lessons gallery and the five-slide starter moves to Classroom and Training (update UC-12).
- Default the first Personal space to Tutoring: Changes the parseSpaceSettings default and the bootstrap in workspace.ts, plus UC-12 and UC-39; classroom tutors then start under Students.
- Landing carries an experience hint: The For tutors sign-in passes a hint into the first space; other entry points stay Classroom.

### D10 (workspace-library): How does a student own space present experience and language pair?

Chosen: Show only what applies in a student space. It fixes the move-out-of-Students bug, keeps the documented one-space-per-context model, and removes the surprise of a blank pair.

Findings: onboarding-04, onboarding-11, site-manual-07

- Show only what applies in a student space: Space settings in a student own space is titled with the student name and shows Dictionary languages and brand kits only; Choose experience is not rendered. Add student gets an optional language-pair field prefilled from the pair last saved on another student, and the panel says No language pair for Camille. Keeps one space per context and the per-student pair.
- Show the experience read-only: Inherited experience is displayed but not editable; stops the student moving out of Students but leaves a settings page with little to change.
- Drop student spaces from the switcher: Students appear only under Students; needs the AGENTS.md switcher sentence changed and a check that invited spaces still list.
- Copy only: Replace the word space with the student name and say in the manual that the pair is per student; the experience control can still move a student to Classes.

### D11 (workspace-library): Where does a tutor move a student to Trash?

Chosen: Add Move to trash to the Edit student page with the confirm. Trash and restore already exist, and the manual already promises the action.

Findings: student-place-01, site-manual-03

- Move to trash on the Edit student page: A confirm names the student decks, access links and learner work; trash and restore routes already exist. The trashed person URL shows a trashed state with Restore and the space is hidden from the nav while trashed. Edit student is a typed-record route, not a CRUD drawer.
- Demoted action in the context panel: Same dialog, banner and nav behaviour, reachable from the panel beside Edit; the Edit page stays fields-only.
- Keep trashing agent, CLI and MCP only: Delete the manual sentence in contexts.md; the trashed-URL rendering and nav fixes still ship.

### D12 (workspace-library): What happens to a folder decks when the folder is trashed?

Chosen: Cascade. It keeps Trash a recoverable place and matches the file model. Regardless of the choice, counts and search ignore decks under a trashed folder and the purge confirmation matches what is deleted.

Findings: student-place-02

- Cascade: Trashing a folder moves its decks and sessions to Trash with it; Restore brings them back; purge deletes them and the confirm names the contents. Matches a file manager.
- Re-file at trash time: Decks move to the space root when the folder is trashed, the confirm says so, and the purge page says the decks are kept. Simple, but Restore does not return decks to the folder.
- Block trashing a non-empty folder: The tutor must move or trash the decks first. Safest, adds friction.

### D13 (workspace-library): Should New deck inside a student own space link the deck to that student?

Chosen: Open a student space Library as the Students view and name the student in the editor. It keeps the explicit-selection rule in AGENTS.md and removes the split that hides decks from the person view.

Findings: editor-authoring-03

- Inherit the space single context: Every New deck in a student space gets contextId. Simplest for tutors, but AGENTS.md says only an explicitly selected student supplies contextId and an implicit choice is never made.
- Open the student space Library as the Students view: One New deck behaviour: contextId comes only from the explicit person view, and the editor top bar names the linked student read-only (an optional prop, absent without a context).
- Mark unlinked decks: The editor top bar and Library rows show which decks are not linked; two New deck behaviours remain.

### D14 (workspace-library): Do Library rows and the inspector summarise the saved version or the draft?

Chosen: Read the draft in the list query. AGENTS.md says a row states what is in the file, and this also covers a closed tab.

Findings: review-next-01

- Read the rolling draft when one exists: The list query parses the draft (fallback to the saved version if it does not parse), so the row, inspector and thumbnail match the editor. Costs a parse for rows with drafts.
- Stamp a version when the tutor leaves through Back: Library and History stay version-based, as Start already stamps. A closed tab leaves the row stale and History grows with each Back.
- Add an explicit Save to the File tab: Keeps the Library version-based and rewords the Saved badge; adds a step to a file that autosaves.

### D15 (notes-learner): Can a tutor withdraw feedback that was already shared?

Chosen: Show the shared copy and a reason now. A withdraw path changes learner visibility and deserves its own request; the reason text ships in the cluster either way.

Findings: review-next-02

- Stop sharing action with a confirm: Clears published_json after a confirm. Changes what the learner can see, so it needs a clear label and a manual line.
- Sharing an empty form means withdraw: Hidden meaning behind a disabled-looking button; after a confirm only.
- Keep sharing as is, show the shared copy and a reason: Show what the learner can see inside the form and put a reason beside the disabled Share button. No new visibility semantics.

### D16 (notes-learner): Where do missed practice answers and shared corrections surface for the tutor?

Chosen: Keep the placement and name it in the Learner work empty text. It follows the documented design with the smallest change.

Findings: review-next-06

- Own pane tab Learner when a student is linked: Separates learner-derived pickers from private Notes; adds a tab and a naming question.
- Rename the existing tab: Avoids the clash with the after-session Notes record; touches docs and journeys.
- List missed practice on the Learner work page with a link into the picker: No counts or dates; needs a read API and a new list.
- Keep placement and name it in the Learner work empty text: TUTORING.md:340 and UC-23 specify the Notes pane; the text says where practice answers and corrections appear.

### D17 (participant): What do the participant Leave, ended and first-join screens say?

Chosen: Leave forgets the device with a confirm, with the neutral ended text and the one-line identified additions. It keeps the credential boundary (a code alone never resumes a seat, no link held in memory) and fills the PRD notice gap.

Findings: start-join-03, start-join-08, learner-live-10, site-manual-10

- Leave forgets the device, with a confirm; neutral ended text; one line for identified: Leave asks that you will join as a new participant; the ended view hides Leave and the name notice; the identified ended view adds Your personal link opens your lesson page.; identified joins show Your tutor sees your name in this lesson. once per browser (the retention line waits for approved text). No credential is kept after the session and the snapshot is unchanged.
- Leave keeps the capability while the session is live: Re-entry by code resumes the seat until the session ends. Fewer duplicate participants on a shared device, but a code alone would resume a seat, which the name design rejects.
- Tutor End attaches a next-step line to the ended snapshot: New snapshot field; nextNote is excluded from the snapshot on purpose.
- Hide stale controls only: No new text or notice; identified learners still get no notice (PRD.md says the text must exist before launch).

### D18 (live-console): What does the console show of a single learner answer?

Chosen: Show a console-only line after Close answering. Results stay hidden until the tutor acts, the stage mirror is unchanged, and the tutor still sees what the student chose.

Findings: live-console-06

- Console-only line after Close answering: For example Camille: Arriver avant 18 h (correct), in the header or aside and on the remote; the stage stays unchanged and nothing is stored.
- Stage plain answer card for one learner: Replaces percentage bars when exactly one learner has joined; changes the stage for a case the stage cannot always detect.
- Keep the charts and add 1 of 1: Smallest change; still no name or option text.

### D19 (live-console): What does Blank do?

Chosen: Rename to Hide results and Show results. The control hides question results only, so the honest name needs no new command.

Findings: live-console-08

- Rename to Hide results and Show results: Matches the current behaviour (it hides question results only). Update live-session.md and the H shortcut text. aria-pressed, a visible text state and a disabled-state title ship in the cluster either way.
- Add a real blank-stage command that works on any slide: Keeps the name Blank; new command and wire message, plus a decision on audience behaviour.
- Keep the name and behaviour: Only the aria-pressed, text state and title fixes; the name stays misleading.

### D20 (deck-editor): How should pictures from a link and stock photos survive Save a copy?

Chosen: Warn at insert time and name the slide in the Save a copy error. Link validation, Enter submit, preview and an honest alt text ship in the cluster either way.

Findings: editor-media-03

- Import on pick: The control plane copies the picture into the space as an asset so it travels; needs server work and storage rules.
- Keep https links as online references in Save a copy: The package already supports online blocks for assets; the copy then depends on the remote server and says so in one line.
- Warn at insert time: Say that an external picture must be uploaded before Save a copy and name the slide in the error. Cheapest.
- Remove the From a link tab: Does not solve stock photos; combine with one of the above.

### D21 (live-console): How do one-to-one lessons treat Room audio and its wording?

Chosen: Keep the default and change the wording. The mode names appear in TUTORING.md, UC-24 and five docs, and TERMINOLOGY.md retires room only as an object you start, edit or end.

Findings: voice-media-04, editor-media-14

- Default new audio to Individual listening in Tutoring spaces: Needs an experience hint in the editor and keeps Room audio elsewhere; changes defaults by experience.
- Keep the default, change the wording: Replace The projector and learner devices stay silent with one plain fact, make the Listening starter third instruction one-learner wording, and update media.md, present.md and TUTORING.md. Mode names stay.
- Rename the modes everywhere: For example Tutor plays and Learner plays across the editor pane, ListeningControls and five manual pages; a taste and scope change.
- Documentation only: The console help stays misleading.

### D22 (agent-surface): Should revoking a personal token end the host controls it already minted?

Chosen: Bind PAT-minted host tokens to the token id. Revoking a credential should revoke what it granted, and the mechanism already exists for OAuth connections.

Findings: agent-path-10

- Bind host tokens minted through a token to that token id: Same mechanism as OAuth connectionId; control commands stop after revoke and the revoke dialog says so. Needs a relay check on each command.
- Keep host tokens independent and say so: The dialog states that sessions already started keep working until they end or the 12 h host token expires; docs/AGENT.md is corrected.
- Keep behaviour and add the 12 h lifetime to the dialog: Point to ending live sessions from the Library; weakest.

### D23 (live-console): What happens to private notes on Desktop and relay sessions?

Chosen: Warn, offer Copy notes, and keep Present audience-only with a pointer. It stops the silent loss with no new persisted state and no risk of showing private notes on a shared screen.

Findings: desktop-03, desktop-09

- Warn and offer Copy notes; Present stays audience-only: The aside caption and the End dialog say notes are cleared at End when the session has no record; a Copy notes button shows when notes are non-empty; Present empty state names the console and the editor Notes tab as the place for tutor notes.
- Warn only, and add a tutor notes panel to Present: The caption and End line change; a collapsible Notes panel, hidden by default, appears in the Presenter tutor window and never in the audience state. Risk when a single screen is shared.
- Keep notes per file on this computer: Offered the next time the file opens until cleared; adds persisted private state.
- Document only: Weakest; the caption stays misleading.

### D24 (workspace-library): Does the person folder get a quiet Notes group?

Chosen: Add the quiet Notes group. AGENTS.md already describes it as the shipped design, and the code is the part that drifted.

Findings: student-place-15

- Add the quiet Notes group: Titles only, silent ordinal for repeated titles, no dates, on the person view as AGENTS.md:262, TERMINOLOGY.md:144 and TUTORING.md:67 state; settle the label as Next session.
- Remove the claim from the docs: Delete it from AGENTS.md, TERMINOLOGY.md and TUTORING.md and keep the inspector-only path.
- Fix wording drift and the Trash row origin now: Leave the Notes-group question open.

D1 was confirmed explicitly by the user: identified stays an agent-door feature. D5 was confirmed explicitly: learner page keeps action blue and DESIGN.md is amended (docs cluster).

## Slide layout decisions (LD1–LD19; numbered D1–D19 in docs/qa/2026-11-06-slide-layout.md)

### LD1: What is the capacity policy for wired text (cards, steps, activity, debrief, statement, term, title)? Today the type scale is fixed, nothing fits text, and the schema caps are far above capacity (cards 4x100 chars, steps about 6, activity 6 short, statement about 350 chars fit at 16:9).

Chosen: Document budgets plus advisory warnings first (D2 carries the channel), together with the C1 safe-centring fix so the heading survives. Then pilot renderer tiers for cards and steps behind the capacity matrix test, since count alone cannot fix 6-card slides. Reject hard caps; defer the density key.

- Document budgets and add advisory warnings: No render change and no stored deck breaks. Budgets come from a shared estimator scaled by aspect, safeArea and a font margin, stated once in the outline_validate description. Agents learn before launch; learners still see clipping if the agent ignores the warning.
- Renderer tiers by item count and longest text (closed, deterministic, no new keys): Columns by count (3 columns for 3 and 5-6), smaller cell type at 5 or more items, line clamp so no half lines. Changes the look of existing decks. Verified: columns alone are not enough (6 cards 3.91 to 1.16 cqw), so type steps are needed; the live wall and editor stay identical.
- Closed-enum density key on cards and steps: New schema key resolved by OpenRoom into tiers. Gives authors control but is a contract change and adds a vocabulary agents must learn.
- Hard per-layout caps that reject: Strongest signal, but stored and imported decks stop validating and budgets differ per aspect and font. Not recommended.

### LD2: How does an agent get fit, readability and resolved-layout feedback? outline_validate returns only ok or errors, with no warnings and no resolved layout; the editor notice measures one open slide.

Chosen: Add the warnings array and resolved layout to outline_validate and deck_save, computed per deck aspect and safeArea from the estimator, with the contract described once in tools.ts. Keep descriptions-only guidance as the first step while the estimator is built.

- Non-blocking warnings array plus resolved layout per step on outline_validate and deck_save: New optional result field, backward compatible for clients that ignore it. Needs a shared estimator in packages/schema and one description in tools.ts. Text-only agents get the signal; MCP response shape changes.
- Warnings only in deck_preview: Smaller surface, but agents that skip preview get nothing, and Desktop Prepare agents cannot call deck_preview.
- Headless measurement in preview or CI returning overflow per step: Accurate for the real font and aspect, heavy to run and unavailable to text-only agents.
- Descriptions only, no result change: Cheapest, but no per-deck feedback; drift risk between text and CSS.

### LD3: How should media.place left, right, fill, top and bottom behave on layouts that cannot hold them (title, text, grid, and the default layouts of statement, cards, steps, debrief)? Today the picture stays in flow at natural height and pushes text off the slide; the editor already normalises through layoutForMediaPlace but agent writes do not.

Chosen: Ship the cap now, normalise left and right to split at render time (not fill), document the resulting table in the tool description, and add a warning for pairs that were normalised. Do not reject.

- Cap the in-flow picture only (CSS), keep place semantics: No contract change. Text never disappears; place left, right and fill still do not place anything and the picture sits above or below the text. Safe under every other option.
- Renderer normalises left and right (and fill where a media layout exists) to split when the kind allows it: Matches editor behaviour and what authors expect. Changes what an authored layout means (TUTORING.md says the layout decides where the picture sits), so effectiveLayout takes media into account and the schema and slides tables need a parity test.
- Validator error E_MEDIA_PLACE listing the places the resolved layout supports: Strict feedback for agents, but stored decks already carrying such pairs stop validating without migration.
- Document the place-by-layout table only: No behaviour change; relies on agents reading the description.

### LD4: What range and meaning do media.size and place fill have on split, and how do top and bottom behave on split? Today size 100 or fill removes the text column, size 80 leaves 13.8 cqw, and top and bottom render as right with size as column width, contradicting the documented height meaning.

Chosen: Render clamp with fill falling back to the media layout, document that split honours left and right (top and bottom render as right), correct the size description, and add a warning once D2 exists.

- Render clamp: split picture column at most about 60-65 percent, fill on split resolves to the media layout, top and bottom on split documented as right: No contract change and stored decks keep validating. Verified that a 60 percent clamp fixes size 80 and fill at all aspects. Size values above the clamp stop having an effect.
- Schema cap of about 70 on split or reject fill outside the media layout: Clear error, but contradicts the documented 20-100 range and the editor slider (MEDIA_SIZE_MAX 100) and breaks stored decks.
- effectiveLayout routes size 80 or more, or fill, to the media layout: Keeps the full range meaningful, but silently changes the layout the author named.
- Render split with top and bottom as a stacked single column: Makes the documented height meaning true but adds a second composition inside split; larger CSS and test surface.
- Warning only: Depends on D2; the slide stays broken until the author acts.

### LD5: What happens to element boxes that extend past the slide (x+w or y+h above 100), boxes over the master logo or footer band, and the stale '16:10' wording?

Chosen: Fix the description now, warn through D2, and consider rejection only after a migration pass over stored decks. Do not clamp at render.

- Fix the description now and add a warning for out-of-canvas boxes and boxes over the footer band or logo: No stored deck breaks; editor writes already clamp, so only agent and imported boxes warn.
- Reject x+w>100 or y+h>100 with a semantic error: Matches what every editor write guarantees, but stored decks and ported pptx content that bleeds off the edge fail validation; needs a migration note.
- Clamp at render time: Always drawn inside the slide, but changes the saved meaning of a box and the clamp rule (shrink or shift) must be chosen.
- Document only: No signal for agents.

### LD6: How should centred title, statement and media stacks behave when reveal groups show parts one at a time? Hidden parts are not rendered (a rule in parts.ts), so the stack re-centres and the heading moves up to 15 cqw; a stat appears above an already visible heading.

Chosen: Top-align stacks that have a reveal, and make the stat reveal order match its visual position. Grid and split reflow (LG-09, SP-11) are fixed in C1 without a decision.

- Top-align stacks when the step has a reveal: Shown parts never move, but the final composition of revealed steps differs from the unrevealed default (heading no longer centred). Needs a root data attribute for 'has reveal'.
- Reserve space with an empty box for hidden parts: Cannot reserve text height without putting text in the DOM (not allowed by parts.ts); only works for pictures and grid cells.
- Keep the reflow and document it; align the reveal order with the visual order of stat and header: No behaviour change; presenters still see the jump.

### LD7: What should the live wall show for an interaction step's title, body, media and layout? The wall draws prompt plus counter (chart after results); editor, Presenter, Desktop and MCP preview draw title, body and options as authored.

Chosen: Document it in the tool description now and warn through D2 when those fields are present on an interaction step; fix the editor skeleton collision independently. Decide plate parity after the blind-voting policy is stated.

- Wall draws step title and body (and options before voting) above or beside the prompt: Authors get what they preview, but it ends blind voting unless options stay hidden, and it takes plate height the charts already lack (D11).
- Previews use the live Question plate: Preview equals wall, but the editor loses its slide-style arrangement of poll steps; large change to the editor and Presenter.
- Reject or ignore title, body and media on interaction steps and say so in the outline tool description: Honest contract; existing decks keep rendering in the editor with fields the wall ignores unless a warning is added.
- Document only: Cheapest; the mismatch stays.

### LD8: What should the phone show by default below 640 px? Slide mode keeps projector proportions (body 7.5-9.75 px, 6 px at 320 wide, materials caption 5 px) and Reading is a toggle that defaults off. Reading is only usable after the scroll fix in C3.

Chosen: After the scroll fix, collapse list type sizes to a small token set and default to Reading for dense list kinds below 640 px with the choice remembered.

- Default Reading for dense list kinds (cards, steps, activity, debrief) below 640 px, remember the learner's choice: Legible text without a manual toggle; Slide stays for title, statement, media and polls. Ink marks on slide geometry need the toggle first.
- Raise the smallest cqw list sizes to the grid body size and collapse eleven list sizes into 2-3 tokens: Helps every surface; reduces capacity on the wall slightly and changes UC-40 expectations.
- Container-query type floor for narrow plates: Changes the 'identical geometry' promise of Slide mode.
- Keep Slide default; rely on the toggle and pinch zoom: No change; most phone learners see 7-9 px text.

### LD9: How is contrast guarded for image backgrounds, overlays, palettes and text over pictures? Brand kits are checked; deck design, overlays and span colours are not; the editor default overlay is white 0.8 for every family.

Chosen: Palette-aware default (C2) now, advisory warnings via D2, and no rejection. Treat text over pictures and span colours as author guidance in the tool description.

- Palette-aware editor default overlay now, plus advisory contrast warnings through D2: Fixes the product's own 1:1 default with no contract change; warnings flag overlay against foreground and palette pairs below 4.5:1 using colorContrast; stored decks unchanged.
- Reject failing overlays and palettes like brand kits: Breaks stored and imported decks.
- Closed-enum text panel token on image elements: Removes free colour over pictures but adds a vocabulary and a render feature.
- Document only: No signal.

### LD10: What is the default picture fit on the media layout, and what minimum share does the picture get? Today a still uses cover in a box about 84 x 33.5 cqw (71 percent of a 16:9 photo, 30 percent of a portrait); aspect gives a contain frame; focal means crop.

Chosen: Keep cover, ship the caption cap and minimum picture height, and document aspect for portrait images in the tool description.

- Keep cover; clamp caption and minimum picture height (C1); document that portrait images need layout split or media.aspect: Preserves the documented crop model and focal meaning; portrait stills still crop by default.
- Contain by default, cover only when focal or aspect is authored: Whole picture visible; empty bands around non-matching pictures; changes the deliberate default.
- Choose split automatically for portrait pictures: Needs the loaded image size at render time; layout depends on the asset.
- Let the media region ignore the safe-area padding: Larger picture, breaks the stated shared inset.

### LD11: How is vertical room allocated on the wall question plate? Prompt is fixed at 4cqw whatever its length, a visible caption repeats the chart (about 108 px at 8 options, deliberate for STAGE-06), and block padding uses the safe area (about 30 percent of the height), leaving about 230 px for 8 long options.

Chosen: Cap block padding in cqw, add the closed prompt ramp (no truncation first), shorten the visible caption to one line, then do the Q03 label floor (D12) and the Q04 inline results layout on the recovered height.

- Cap block padding on interaction plates with a cqw value, length-based prompt ramp from closed cqw tokens clamped to 3 lines, and a one-line visible caption (full text stays sr-only): Reclaims the most room and keeps a colour-independent reading for the room; prompts over three lines are truncated on the wall only if the clamp is used, so the full text must stay on the phone.
- Revert the caption to sr-only and rely on per-bar values: Most room back; loses the visible reading for people who cannot distinguish the colours, against PRD STAGE-06.
- Apply the safe area only to the prompt, give results the full plate: Large room gain; results can touch the slide edge on projectors with overscan.
- Lower the prompt cap on question steps from 500 characters: Breaking contract change; storage limit becomes a wall limit.

### LD12: What is the type floor for result text on the wall? Chart labels fall to 5 px, secondary text is 14-16 px, and DESIGN.md has nine type tokens for the console but no wall scale; DESIGN.md forbids rem or vh caps on single charts.

Chosen: Define the cqw ramp with a label floor near 1.1 cqw (about 20 px at 1920), after D11 recovers the height; make the correct badge a fixed token.

- Define a small wall type ramp in cqw (label, value, tick, note) and use it in stage-ui.css and the chart code: Consistent back-row legibility; adds tokens to DESIGN.md and needs the D11 height first.
- Map wall chart text to existing tokens and accept 14 px as the floor: No new tokens; 14 px remains the floor for secondary text.
- Raise only bar values and tick labels to the caption size: Cheap partial gain.

### LD13: What happens to display values the schema and MCP descriptions offer but the charts never draw (cards, tally, emoji, number, dots, scale, sentence, rank, wordcloud alias)?

Chosen: Document them as aliases of the real displays in the tool text and normalise at read time; implement tally and number only if a lesson needs them.

- Implement the cheap ones (number, tally, sentence), alias or drop the rest: Honest enum; needs an alias map for saved decks.
- Keep all as documented aliases normalised at read time and say so in the tool text: No breakage; the enum stays larger than the set of looks.
- Remove them from the enum and the option-key table: Breaking for saved decks without a migration.
- Implement every display: Most work, largest chart surface and test matrix.

### LD14: Should the smallest span size and the heading role be changed? Span size 25 percent renders 0.65 cqw (2.4 px on a phone); a text element with role heading is the same size as body.

Chosen: Give role heading a size now (visual contract only), and warn on span sizes under 60 through D2; raise the minimum only after checking stored decks.

- Raise SPAN_SIZE_MIN to about 60 and give role heading a size (1.4em): Usable range and hierarchy; changes what validates for stored decks.
- Give role heading a size only: No stored-deck break; unreadable spans remain legal.
- Warning only: Depends on D2.
- Leave as is: Heading role stays visually flat.

### LD15: How do slide font metrics become stable across machines? The sans stack declares Inter first, nothing ships it, so Arial is used; wider fallbacks (Verdana as a DejaVu proxy) raise flagged steps from 8 to 12 of 63 and authors with Inter see different wrapping.

Chosen: Drop Inter from the slide stack (it is never shipped) and keep a margin in the estimator; DESIGN.md says console typography relies on system fonts, so bundling for slides is not justified yet.

- Self-host a subset of Inter via @font-face: Same metrics everywhere; adds bytes to every surface and the MCP preview.
- Drop Inter and declare an Arial or Liberation-compatible stack: Matches what is measured today; the visual identity stays as rendered.
- Keep the stack and add a font-width safety margin to any fit estimate: No render change; estimates stay conservative.

### LD16: How do content and master furniture (logo, footer) share space when safeArea is 3-12? The logo (top 2, right 3, 9x4 cqw) and footer are fixed while content padding follows safeArea.

Chosen: Reserve the logo band in the top padding at render time and keep the footer reservation from C1; no schema change.

- Content padding is at least the furniture extent (about 6.5 cqw top with a logo): No collisions in the allowed range; safeArea 3 behaves like 6.5 with a logo and loses the capacity safeArea 3 was meant to give. Footer reservation is already in C1.
- Schema minimum safeArea 5 when a logo or footer is present: Visible rule for authors; breaks stored decks.
- Warning only: Depends on D2.
- Leave as the author's choice: Headings can print under the logo.

### LD17: Should question slides on the wall keep the 240 px join rail? It is documented design (DESIGN.md) and makes the question slide 19-27 percent smaller than a content slide at 1280x720 and 1024x768.

Chosen: Keep the rail; fix the clipping of the counter label in the mirror (SP-07) and revisit only if D11 does not recover enough height.

- Keep the rail and trim only the 3-line prompt clipping: No design change; question slides stay smaller.
- Collapse the rail to a corner badge under about 1100 px width: Larger slide on projectors and screen share; late joiners lose the large join code.
- Constant slide width with the rail as an overlay: Consistent type; the overlay may cover content.

### LD18: Should the wall question chrome ('answers so far', 'Results hidden', 'joined / answered') follow the deck locale? The app has no localisation layer.

Chosen: Use the small closed string table for stage question chrome, limited to the three locales the lessons use.

- Leave English-only until the planned localisation work: French and German lessons show English chrome.
- Small closed string table for stage question chrome keyed on meta.locale (fr, de, en): Immediate fix for language lessons; first localisation code in the stage.
- Neutral chrome with numerals and icons only: No strings to translate; changes the plate's accessibility text.

### LD19: Should design accept a family name alone (design.theme {family: paper}) and fill the palette, or keep requiring the full resolved palette?

Chosen: Keep the full palette, list the families in the error (C5), and put one preset example in the tool description; revisit partial input if agents still fail.

- Accept a family alone, fill colors and fonts from defaultDeckDesign, store the resolved design: Short agent input; changes the contract from resolved to partial input.
- Keep the full palette and list the families in the unknown-family error: No contract change; agents still copy a palette.
- Expose family presets in the outline_validate description or a small tool: Agents can copy a valid palette; adds text or a tool.
