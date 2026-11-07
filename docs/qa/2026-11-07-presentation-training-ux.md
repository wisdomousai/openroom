# Presentation and training UX audit — 7 November 2026

## Scope

Nine scenario audits covered one-to-many live sessions: a trainer or presenter with 20 to 200 participants, online (the stage screen-shared in a video call, participants on a laptop tab or a phone) or in a room (projector stage, phones joining by QR). The scenarios were Training space set-up and deck authoring, start and join, the live console, the stage, the participant phone and laptop, Q&A with a co-facilitator, workshop groups with the recap and saved results, the PowerPoint add-in through the simulated Office adapter, and the agent plugin skills (port-a-deck, make-this-interactive, run-a-session) over MCP and the CLI.

Each auditor drove its own disposable local runtime (`node scripts/verify-browser.mjs --serve`: empty storage, demo sign-in, the real Worker, database and live-session objects) with real browsers for the presenter, co-facilitator, stage and one or two participants. A scripted audience of 30 to 200 SDK participants (`crowd.mjs` in the run's scratch directory, built on `packages/sdk`) answered every question that opened and asked and upvoted Q&A. A Sonnet skeptic per scenario then tried to refute each finding, re-driving its own runtime when the evidence was ambiguous. A coverage critic listed untested states; this pass ran no follow-up audits. Items already listed in `docs/qa/2026-11-07-tutoring-ux-open-work.md` were excluded.

The local runtime has no billing configured, so every account holds every entitlement. The 50-participant cap and the team, branding and keep gates were judged from code. Screenshot paths below are relative to the run's scratch directory (`audit/<scenario>/`, `verify/<scenario>/`); they are not committed.

Run size: 20 Sonnet agents, 3.36M tokens, 79 minutes.

## Results

| Verdict | Count |
| --- | --- |
| Confirmed | 81 (high 5, medium 29, low 47) |
| Needs a product decision | 40 (high 2, medium 13, low 25) |
| Refuted | 11 |
| Deferred (of the confirmed) | 1 |

## Code that changed during the run

The tutoring repair pass committed 43 commits to `tutoring-ux` while this audit ran (`0d5a331..912d2b9`). Auditors that started later saw newer code than those that started first. These files changed and are named by findings below; re-check those findings against the current branch before building them.

| File | Findings |
| --- | --- |
| `apps/participant/src/answer.tsx` | participant-a11y-11, participant-answer-03, participant-answer-08 |
| `apps/participant/src/live/body.tsx` | groups-after-03, groups-after-10, groups-after-11, live-console-05, live-console-14, participant-answer-08, participant-copy-10, participant-end-15, participant-peer-07, qna-cofacilitation-13, training-setup-05 |
| `apps/participant/src/live/screen.tsx` | participant-a11y-11, participant-copy-10, participant-qna-01, participant-qna-02, participant-qna-09, participant-sdk-12, qna-cofacilitation-13 |
| `apps/participant/src/live/step-view.tsx` | participant-copy-10, training-setup-05 |
| `apps/participant/src/styles.css` | participant-a11y-11, participant-layout-06, qna-cofacilitation-08, start-join-13 |
| `apps/stage/src/stage-ui.css` | live-console-01, powerpoint-addin-05, qna-cofacilitation-03, stage-wall-01, stage-wall-02, stage-wall-03, stage-wall-04, stage-wall-07, stage-wall-09, stage-wall-11, stage-wall-13, start-join-01, start-join-04, start-join-08 |
| `apps/workspace/src/components/ItemDetailPanel.tsx` | live-console-12 |
| `apps/workspace/src/components/SpaceWelcome.tsx` | training-setup-07 |
| `apps/workspace/src/pages/DeckEditorPage.tsx` | training-setup-04 |
| `apps/workspace/src/shell/WorkspaceShell.tsx` | training-setup-07 |
| `docs/AGENT.md` | agent-plugin-01, agent-plugin-03, agent-plugin-04, agent-plugin-06, agent-plugin-12 |
| `docs/CONTRACTS.md` | agent-plugin-07 |
| `e2e/journeys/UC-44-participant-phone-states.spec.ts` | participant-copy-10 |
| `packages/editor/src/deck-edit/Ribbon.tsx` | start-join-01, start-join-07, start-join-10, training-setup-01, training-setup-06, training-setup-14 |
| `packages/editor/src/deck-edit/properties/design.tsx` | qna-cofacilitation-05, training-setup-01, training-setup-02 |
| `packages/editor/src/live/HostHeader.tsx` | groups-after-12, live-console-09, qna-cofacilitation-10, start-join-02, start-join-09 |
| `packages/editor/src/live/PresenterRemote.tsx` | live-console-07, live-console-10, live-console-14, qna-cofacilitation-11 |
| `packages/editor/src/live/SessionAside.tsx` | groups-after-09, groups-after-14, live-console-02, live-console-05, qna-cofacilitation-01, qna-cofacilitation-02, qna-cofacilitation-05, qna-cofacilitation-06, start-join-07, training-setup-01 |
| `packages/editor/src/presenter/Presenter.tsx` | training-setup-08 |
| `packages/mcp/src/tools.ts` | agent-plugin-03, agent-plugin-07, agent-plugin-09, agent-plugin-12 |
| `packages/schema/src/outline-errors.ts` | agent-plugin-13 |
| `packages/schema/src/outline-fit.ts` | agent-plugin-05, agent-plugin-09, agent-plugin-13 |
| `packages/schema/src/outline-types.ts` | start-join-07 |
| `packages/slides/src/Listening.tsx` | stage-wall-14 |
| `packages/slides/src/slide-types.ts` | start-join-03 |

## Fix clusters

Clusters own disjoint files so they can be built in parallel. Dependencies are merge order. A finding listed in two clusters has parts in both.

| Cluster | Findings | Depends on |
| --- | --- | --- |
| participant: Participant join, phone states and copy | 14 | — |
| console-run: Live console run flow | 9 | — |
| qna-groups: Q&A moderation, co-facilitation and groups | 8 | — |
| stage: Stage legibility and join display | 11 | — |
| training-editor: Training experience and deck editor | 7 | — |
| recap-results: Recap, saved results and workspace routing | 8 | — |
| office: PowerPoint add-in | 10 | stage |
| agent: Agent surface, MCP and CLI | 7 | — |
| docs: Documentation, manual and skill text | 11 | participant, console-run, qna-groups, stage, training-editor, recap-results, office, agent |

### Participant join, phone states and copy

Fix the join form and every phone-side string and state a group participant meets. This covers paste handling of the 8-character code, neutral host wording on code-only error and gone screens, field-linked join errors, question draft retention, a 'Question sent' confirmation, a single Q&A count, round-2 banner timing, time-is-up text, quiet countdown announcements, a readable handle at 320 px and a width cap on laptop tabs. Tutor wording stays on personal-link and identified paths, which are recorded decisions D3, D4 and D17.

Files: `apps/participant/src/**`, `packages/slides/src/timer.tsx`, `packages/sdk/src/client.ts`, `e2e/journeys/UC-44-participant-phone-states.spec.ts`

Verification: vitest in apps/participant (join-error.test.ts, join and qna tests; add 'abcd efgh' and ' ABCDEFGH ' paste cases); vitest in packages/slides for the timer announce change; UC-44-participant-phone-states (update the wrong-code and gone-screen assertions); UC-05-session-qna (run only, owned by qna-groups); No new UC journey needed. Add steps to UC-44 for paste, offline question draft and the round-2 banner after close.

| Finding | Severity | Observed | Evidence |
| --- | --- | --- | --- |
| participant-a11y-05: Question countdown is a polite live region that changes every second | medium | CountdownLabel renders `<p class='countdown' aria-live='polite'>` with text such as '1:29 remaining' that changes every second. A screen reader reads it out every second while the participant tries to read the options and answer. The slide timer is a role=timer with aria-live='polite' while running (packages/slides/src/timer.tsx:96-98), which has the same effect. Seen in the source and the accessi … | `apps/participant/src/live/countdown.tsx:25-30`, `packages/slides/src/timer.tsx:96-98` |
| participant-layout-06: Laptop tab has no content width limit: results chart fills 1240 px and sits below the fold | medium | At 1280x800 the answer options and tab bar are 1240 px wide and the 'compact' results chart is a ~1240x410 frame with option labels floating about 300 px from their bars. A 4-option result pushes the last row below the fold. At 640 px the chart looks fine. The 34rem max-width in styles.css applies to some blocks only (lines 216, 1462). Laptop participants in online sessions get the stretched chart … | `audit/participant/53-p2-results-1280.png`, `audit/participant/54-p2-640.png`, `audit/participant/40-poll-1280.png`, `apps/participant/src/styles.css` |
| participant-peer-07: After the second vote closes the banner still says 'second vote is open' | medium | I closed round 2 and then revealed. The participant page kept the orange banner 'Second vote - second vote is open' above the answer, 'Answer received' and the round comparison. In the source the round-2 banner depends only on snapshot.round === 2, not on whether the question is open (body.tsx:113,188), and its text is 'Vote again.' there. The served build uses the older wording. | `audit/participant/23-pi-reveal.png`, `audit/participant/22-pi-closed2.png`, `apps/participant/src/live/body.tsx:113,188-204` |
| participant-qna-02: Typed question is erased when sending fails offline, and the error does not say it was lost | medium | I went offline, typed 'Offline question about the roadmap?' in Ask a question, and tapped Send question. The field was emptied at once and the banner said only 'No connection to the session.' The text was gone. The question never appeared after reconnecting. Answers behave differently: they keep the draft and say 'Your answer was not sent'. | `audit/participant/37-offline-qna.png`, `apps/participant/src/qna.tsx:31-35 (setText('') runs before the result)`, `apps/participant/src/live/screen.tsx:142-155 (askSessionQuestion, generic fail())` |
| qna-cofacilitation-08: Participant sees no confirmation after sending a question and their own question lands about 10,000 px down | medium | After 'Send question' on the iPhone viewport the form clears and the tab count goes 104 to 105, nothing else: no 'Sent', scroll and focus unchanged (scrollY 0, no active element). The new question has 0 votes, so it sorts last (index 104 of 105) in a page 9,997 px tall. A participant cannot tell it arrived, cannot find it, and may ask again (duplicates). The Q&A list has no search or 'my questions … | `audit/qna-cofacilitation/14-p1-after-ask.png`, `audit/qna-cofacilitation/13-p1-qna.png`, `apps/participant/src/qna.tsx:28-56` |
| start-join-05: Pasting a code with a space or leading space is cut to 7 characters, so Join stays disabled | medium | The code input has maxLength={8} and sanitises in onInput. A paste of '6q7r 9h8k' (the code as typed in a chat) is cut by the browser to '6q7r 9h8' before the handler runs, leaving '6Q7R9H8' and '7/8 characters' with Join disabled and no explanation (21-laptop-paste-7chars.png). Typing the same text key by key gives the correct 8 characters. A leading space or a copied 'Code: ' prefix fails the sa … | `audit/start-join/21-laptop-paste-7chars.png`, `apps/participant/src/join.tsx:70-78` |
| training-setup-05: Tutor, student and lesson wording reaches participants and the stage in a group session | medium | The join error for a wrong or ended code shows 'Check it with your tutor.' (I saw this on a phone). The waiting screen says 'Waiting for your tutor to start', the no-code hint 'ask your tutor for the join code', and the ended screen 'Your personal link opens your lesson page.' join-error.ts also has 'Your tutor has not started the session yet.', 'Ask your tutor for a new one' (twice) and 'come bac … | `audit/training-setup/28-join-wrong.png`, `apps/participant/src/join.tsx:158`, `apps/participant/src/join.tsx:185-186`, `apps/participant/src/join-error.ts:3-17` |
| participant-a11y-11: Handle is cut off at 320 px and is the only way to rejoin; tablist and radio groups need a Tab stop each | low | At 320 px the topbar shows 'Steady Crane ...' and the full handle is only in a title tooltip (.handle has ellipsis, styles.css:604-611). The handle notice is dismissible, so after Dismiss a participant on a narrow phone cannot read the handle needed for 'Rejoin with handle'. Keyboard on the laptop: Now and Q&A are two Tab stops with role=tab and no arrow-key handling or tabpanel; each answer optio … | `audit/participant/55-p3-320.png`, `apps/participant/src/styles.css:604-611`, `apps/participant/src/live/screen.tsx:303-322` |
| participant-copy-10: Join, gone and error copy tells a corporate participant to ask their 'tutor' about a 'lesson' | low | Source strings still assume tutoring: join.tsx:158 'Waiting for your tutor to start', join.tsx:185-186 'ask your tutor for the join code', join-error.ts:3 'the personal link your tutor sent you to come back to the lesson', :13 'Check it with your tutor', :14 'Your tutor has not started the session yet', :16-17 'Ask your tutor for a new one', body.tsx:71 'Your personal link opens your lesson page', … | `apps/participant/src/join-error.ts:3,13,14,16,17`, `apps/participant/src/join.tsx:158,185-186`, `apps/participant/src/live/body.tsx:71`, `apps/participant/src/live/screen.tsx:259` |
| participant-qna-09: Q&A: own question lands at the bottom, hidden state is unexplained, tab and heading counts disagree, no edit | low | With 31 questions sorted by votes, my new question appeared as the last row with no confirmation and the field was cleared, so a participant has to scroll about 3,600 px to see it landed. After moderation my question showed the single word 'Hidden', with no statement that others cannot see it and no way to re-ask differently. The tab said 'Q&A (30)' while the heading said 'Questions (31)' because … | `audit/participant/32-qna.png`, `audit/participant/33-qna-hidden.png`, `apps/participant/src/qna.tsx:58-62,79-81`, `apps/participant/src/live/screen.tsx:320` |
| participant-timer-04: A timed question that reaches 0s stays open with no 'time is up' state | low | A choice question with timerSec 20 shows '20s remaining', then '0s remaining' in orange while all options stay selectable. I tapped Planning at 0s and 'Answer received' appeared. The schema says the window is advisory and the presenter closes (packages/schema/src/types.ts:139), but the participant is never told this. 40 people read '0s remaining' as closed or as a bug. In a 100-person room nobody … | `audit/participant/51-timed-zero.png`, `apps/participant/src/live/countdown.tsx:25-31`, `apps/participant/src/live/body.tsx:~145` |
| qna-cofacilitation-13: Join error says 'Check it with your tutor' for any ended or wrong code in a group session (and other tutor/lesson strings) | low | Joining the ended town hall's code on the phone shows 'This session has ended, or the code is wrong. Check it with your tutor.' (join-error.ts:13, screenshot 45), the most common error for late or mistyped joiners in a corporate group. Same file: 'Your tutor has not started the session yet.' (:14), 'Ask your tutor for a new one' (:16-17). join.tsx:158 'Waiting for your tutor to start' and :185-186 … | `audit/qna-cofacilitation/45-p2-join-ended.png`, `apps/participant/src/join-error.ts:13-17`, `apps/participant/src/join.tsx:158,185-186`, `apps/participant/src/live/body.tsx:71` |
| start-join-06: Tutor wording in messages a group participant can reach | low | A code that is wrong or belongs to an ended session shows 'This session has ended, or the code is wrong. Check it with your tutor.' (25-wrong-code.png, join-error.ts:13). GoneScreen, shown when a stored seat is refused for good, says 'Ask your tutor for the join code.' (join.tsx:185-186). Narrowing the lead: 'Waiting for your tutor to start' (join.tsx:158), 'Your tutor has not started the session … | `audit/start-join/25-wrong-code.png`, `audit/start-join/47-phone-not-started.png`, `apps/participant/src/join-error.ts:13`, `apps/participant/src/join.tsx:185-186` |
| start-join-13: Join input error is not tied to the field and the field shows no invalid state | low | On a wrong code the red message appears in a separate status region below the buttons (25-wrong-code.png). The input sets aria-invalid but aria-describedby points only at the character counter, and the field looks the same as before. A code arriving by link or QR leaves focus on the page, not on the Join button, so Enter on a laptop does nothing until the user clicks Join. | `audit/start-join/25-wrong-code.png`, `apps/participant/src/join.tsx:25-31`, `apps/participant/src/join.tsx:79-80`, `apps/participant/src/join.tsx:137-139` |

### Live console run flow

Fix the live console header and primary actions for a group session. This covers the Session menu at 560 to 760 px, a host-only round-one split for peer instruction, consistent result-state labels derived from what the audience sees, the Clock group whenever a clock is running, 'Show next part' labelling for reveal groups, one Freeze and Close answering vocabulary on the remote, a toast that clears the Next button, the stale stage preview on session switch and the raw text-sm uses. Work stays inside the files listed here.

Files: `packages/editor/src/live/HostHeader.tsx`, `packages/editor/src/live/LiveHost.tsx`, `packages/editor/src/live/LiveRibbon.tsx`, `packages/editor/src/live/hostFlow.ts`, `packages/editor/src/live/hostFlow.test.ts`, `packages/editor/src/live/PresenterRemote.tsx`, `packages/editor/src/live/SessionFullNotice.tsx`, `packages/editor/src/live/SessionFullNotice.test.tsx`, `packages/editor/src/live/useStageMirror.ts`, `packages/editor/src/live/liveClock.ts`, `packages/editor/src/live/components.test.tsx`, `packages/editor/src/live/QuestionRailFooter.tsx`, `packages/editor/src/live/Results.tsx`, `packages/editor/src/live/outline-navigation.ts`, `packages/editor/src/live/PeerSplit.tsx (new)`, `packages/ui/src/toasts.tsx`, `packages/domain/src/groups.ts`, `packages/domain/src/apply/helpers.ts`, `packages/domain/src/apply/interactions.ts`, `e2e/journeys/UC-01-choice-reveal.spec.ts`, `e2e/journeys/UC-03-peer-instruction.spec.ts`, `e2e/journeys/UC-49-live-console-narrow-and-keys.spec.ts`, `e2e/journeys/UC-60-live-rejoin.spec.ts`

Verification: vitest in packages/editor (hostFlow, liveClock, SessionFullNotice, components); vitest in packages/domain if helpers or groups change; UC-49 (extend the width assertion to 560, 640, 720 and 800 px), UC-01, UC-03, UC-60; New UC journey step warranted: extend UC-03 with the host-only round-one split and the primary label between rounds. Extend UC-01 to the corrected result labels. No new journey file.; useStageMirror needs a unit test: switch session code and expect token and snapshot reset. Use key={live.sessionCode} on LiveHost in the shared router only if that file is free. Otherwise reset inside the hook.

| Finding | Severity | Observed | Evidence |
| --- | --- | --- | --- |
| live-console-04: Peer instruction: the host cannot see the round-one split, so the 30-70% rule in examples/peer-instruction.yaml cannot be applied | high | After Close answering on a peer-instruction question the stage and mirror show only '38 answers so far · results hidden'. No percentages exist anywhere in the host DOM (only the option labels). The deck notes tell the facilitator to look at the correct share and choose Second vote (30-70%) or explain (above 70%) or reteach (below 30%). The primary button is still 'Reveal the results', and 'Call ou … | `audit/live-console/36-pi-closed.png`, `audit/live-console/37-pi-revote.png`, `examples/peer-instruction.yaml:44-50`, `packages/domain/src/snapshots.ts:97-103` |
| start-join-02: Console header hides the Session menu from 560 to about 680 px, and squashes it near 800 px (worse than start-join-12) | high | start-join-12 says the clip starts below 554 px. Measured on the live console: the Session menu icon button shrinks to 18 px wide at 760 px, and from about 682 px down the header is wider than the viewport. At 640 px End session is cut at the right edge (menu left edge 664, so it is off-screen); at 600 and 560 px the Session menu is entirely off-screen. The hide rule in HostHeader.tsx only applies … | `audit/start-join/55-console-640.png`, `audit/start-join/56-console-760.png`, `packages/editor/src/live/HostHeader.tsx:158-185` |
| live-console-06: Result state labels contradict each other after Close, Reveal and Hide | medium | Close answering on a hidden-until-close choice question puts the bars on the stage at once (the chip 'Results shown' lights), yet the primary still says 'Reveal the results'; it actually only adds the correct mark ('Call out the correct answer' in the ribbon). After H the ribbon still says '✓ Correct answer shown' and the footer still says 'results up' while the stage shows only a count. On scale … | `audit/live-console/12-choice-closed.png`, `audit/live-console/13-choice-revealed.png`, `audit/live-console/14-hidden-after-reveal.png`, `packages/editor/src/live/hostFlow.ts:41-46` |
| live-console-07: A running timer step follows the presenter into later slides as an overtime pill, and no later slide can stop it | medium | The 120 s discussion timer was started and left running. On the next slides (break, peer-instruction question, a live-inserted question) the stage corner showed a pill counting 0:15, then +0:08, +1:12, +3:21 and +7:12 overtime, and the footer said '+3:21 on stage'. The Clock group (Start, Pause, Reset, minus, plus) exists only on the timer step itself (LiveHost.tsx:852), so on the question slides … | `audit/live-console/35-pi-open.png`, `audit/live-console/36-pi-closed.png`, `audit/live-console/46-inserted.png`, `audit/live-console/54-remote-timer.png` |
| live-console-10: Reveal groups: the primary says 'Next slide' while a press shows the next part, and no part counter exists | low | On the Agenda slide with reveal groups (header, then body) only the header is shown on the stage and mirror. The orange primary, the footer Next and the ribbon Next all say 'Next slide' / 'Next'; ArrowRight revealed the body, and only the next press changed slide. Nothing shows 'part 1 of 2' and the rail row has no indicator. The footer shows 'Slide 2 of 14' only. | `audit/live-console/09-agenda.png`, `audit/live-console/10-agenda-2.png`, `packages/editor/src/live/hostFlow.ts:48-60` |
| live-console-14: Freeze is called Frozen, Paused, Answers paused and Hidden while paused across surfaces; Close answers vs Close answering | low | Console button 'Freeze' / 'Unfreeze' and banner 'Frozen. Submissions are blocked and participant text is hidden on stage.'; the stage plate and phone say 'Paused' and 'Answers paused.'; the list chart says 'Hidden while paused.' The phone remote says 'Close answers' where the console says 'Close answering'. The phone keeps showing the results table while frozen. | `audit/live-console/47-frozen.png`, `audit/live-console/48-phone-frozen.png`, `audit/live-console/53-remote.png`, `packages/charts/src/displays/list.tsx:45-47` |
| stage-wall-08: Console stage preview stays on the previous session's feed after switching session | low | useStageMirror initialises stageToken once from live.stageToken and never resets stageSnapshot when live.sessionCode changes. After switching the console hash from session S4 to S6, the preview kept S4's word-cloud '46 answers so far' until a page reload. The wrong numbers appear beside the right session code. | `audit/stage-wall/console-timer.png`, `audit/stage-wall/console-stale-after5s.png`, `audit/stage-wall/console-after-reload.png`, `packages/editor/src/live/useStageMirror.ts:22-62` |
| start-join-12: The 'Join link copied' toast covers the Next slide button | low | Tapping the code chip or Copy join link shows the toast at the bottom right of the console, over the top of the primary 'Next slide' button for its duration (37-copy-toast.png). The copy action is used mid-session to paste the link into a chat. The code chip itself still has no visible affordance (start-join-10, tracked). | `audit/start-join/37-copy-toast.png`, `packages/editor/src/live/LiveHost.tsx:630`, `packages/editor/src/live/LiveHost.tsx:1198` |
| start-join-15: Session full notice uses raw text-sm and tells the presenter nothing beyond 'Session full' | low | SessionFullNotice.tsx:29 uses the raw text-sm class (DESIGN.md:301 forbids it), and LiveHost.tsx:764 does the same for 'Session ended'. The notice says only 'Session full' with a Plans button for owners and editors; it does not say the limit or that new people are being turned away, and participants see 'This session is full.' (session-do.ts:729). Judged from code and unit tests: this local runtim … | `packages/editor/src/live/SessionFullNotice.tsx:29`, `packages/editor/src/live/LiveHost.tsx:764`, `DESIGN.md:301` |

### Q&A moderation, co-facilitation and groups

Make console Q&A and groups usable at 100 questions and 30 or more participants. Hidden and answered items sort below active ones on the desk with a text search, a hidden count and a stable order, and the console Moderate responses list moves near the top for the focused text question. Hidden cards get Unhide and a truthful label, card buttons get question-named labels, a 403 on a command becomes a fatal 'access removed' state, Dissolve asks first, the groups form gets a sticky Save and spokesperson select, and 'Added by' shows a name. All of it derives from props SessionAside already receives, so LiveHost is not edited here.

Files: `packages/editor/src/live/QnaDesk.tsx`, `packages/editor/src/live/SessionAside.tsx`, `packages/editor/src/live/GroupsPanel.tsx`, `packages/editor/src/live/useHostSession.ts`, `packages/editor/src/live/FacilitationControls.tsx`, `packages/editor/src/live/utils.ts`, `packages/domain/src/qna.ts`, `packages/domain/src/types.ts`, `packages/domain/src/apply/qna.ts`, `packages/domain/src/apply/groups.ts`, `packages/domain/src/facilitation.ts`, `packages/domain/src/snapshots.ts`, `packages/domain/src/blocklist.ts`, `apps/relay/src/export.ts`, `apps/workspace-worker/src/members.ts`, `apps/workspace/src/pages/SpaceMemberPages.tsx`, `e2e/journeys/UC-05-session-qna.spec.ts`, `e2e/journeys/UC-30-workshop-groups.spec.ts`, `e2e/journeys/UC-31-co-facilitation.spec.ts`

Verification: vitest in packages/editor (QnaDesk, GroupsPanel, useHostSession); vitest in packages/domain only if qna.ts or snapshots.ts change. Do not change sortedQuestions order, because participants use it.; vitest in apps/workspace-worker (members listing) and apps/workspace (SpaceMemberPages); UC-30 (Dissolve now confirms), UC-31, UC-05; New UC journey step warranted: add Q&A moderation to UC-31 (hide, unhide, desk sort, removed co-facilitator sees the access-removed state).

| Finding | Severity | Observed | Evidence |
| --- | --- | --- | --- |
| groups-after-09: Groups pane is a short scroll box: member form, spokesperson buttons and Save sit under the notes block | medium | At 1280x720 the Groups form scrolls inside a 281 px area (form height 1848 px for 30 participants). At 1440x900 with facilitator notes shown, the list of groups and the member list get about 370 px or 120 px (27-edit-t5.png). Each ticked member adds a 'Make spokesperson' button row. Save group and Cancel are at the bottom of the scroll. After saving, the scroll position of the previous form is kep … | `audit/groups-after/10-newgroup.png`, `audit/groups-after/27-edit-t5.png`, `audit/groups-after/32-dissolved.png`, `packages/editor/src/live/SessionAside.tsx` |
| groups-after-10: Dissolve removes a group at once, and members and spokesperson are not shown to the participants | medium | 'Dissolve' deletes the group on the first click with no confirmation and no undo; its members drop back to 'Your facilitator will assign you to a group.' (GroupsPanel.tsx:80-84). A new group with the same name starts with a fresh answer. On the phone a non-spokesperson sees 'Discuss together. Your spokesperson sends the shared answer.' with no name of the spokesperson or of the table mates (28-p1- … | `audit/groups-after/32-dissolved.png`, `audit/groups-after/28-p1-after-handover.png`, `audit/groups-after/29-p2-after-handover.png`, `packages/editor/src/live/GroupsPanel.tsx:80-84` |
| live-console-02: Hiding a single offensive answer means scrolling to the bottom of the slide rail, then a nested list that shows 2 rows at 1440x900 | medium | The 'Moderate responses' list (Hide / Unhide per answer) is the last block of the Session aside, under all 14 rail rows and above Private notes. At 1440x900 its heading sits at y=898 (off screen); after scrolling the aside it shows two rows inside its own scroll box. With 38 answers the list is long, entries are in oldest-first order so new answers append at the bottom, and a Hide click takes abou … | `audit/live-console/23-moderate-list.png`, `audit/live-console/26-moderate-bottom.png`, `audit/live-console/27-after-hide.png`, `packages/editor/src/live/SessionAside.tsx:249-275` |
| qna-cofacilitation-02: 100 questions cannot be moderated: no sort, find, filter or answered/unanswered view; 3 cards visible at 1440x900 | medium | With 100 questions the console Q&A panel is 9,533 px tall inside a 412 px scroll area (about 3 cards visible); the desk page is 4,899 px of one-line rows. Order is only votes desc then age, so rows reorder as votes arrive under the moderator's cursor (rows of the same text with different votes jump). There is no search, no 'unanswered only', no 'new since I looked', no hidden-count, and hidden or … | `audit/qna-cofacilitation/10-alice-qna.png`, `audit/qna-cofacilitation/11-bob-desk.png`, `audit/qna-cofacilitation/23-bobremote-desk.png`, `packages/domain/src/qna.ts:35-44 sortedQuestions` |
| qna-cofacilitation-07: Console question cards have no Unhide or undo, and say 'Hidden from stage' when participants lose it too | medium | In SessionAside's card variant a hidden or answered question shows only 'Hidden from stage' / 'Answered · hidden from stage' text and no button (QnaDesk.tsx:228-231). A mis-tapped Hide or Answered (buttons are 46x28 and 76x28 px at 12 px, side by side, no confirmation) cannot be undone from the console; the presenter must open the desk page, where the row is somewhere in 100. The wording is wrong: … | `audit/qna-cofacilitation/15-alice-hidden-card.png`, `packages/editor/src/live/QnaDesk.tsx:228-231` |
| qna-cofacilitation-09: Removed co-facilitator is not told: console and desk stay 'Live'-looking with active buttons, then 'Command failed (HTTP 403)' | medium | After alice removed bob from the space while live, bob's console header changed to a small 'Offline' and the lists stopped updating (alice's later hide never appeared), but every Hide/Spotlight/Answered button stayed enabled; pressing Hide produced the toast 'Command failed (HTTP 403)'. The server correctly rejected the command (positive: no moderation after removal). 'Offline' is the same word as … | `audit/qna-cofacilitation/29-remove-dialog.png`, `audit/qna-cofacilitation/32-bobdesk-stale.png`, `audit/qna-cofacilitation/33-bobconsole-stale.png`, `apps/workspace-worker/src/facilitation.ts:36-39` |
| qna-cofacilitation-12: Question card buttons are indistinguishable for assistive tech and small: 102 'Hide', 102 'Answered', 28 px high at 12 px | low | In the console Q&A cards (variant 'cards') the buttons have no aria-label, so a screen-reader list shows 102 buttons named 'Hide', 102 'Answered', 101 'Show on stage'; the desk rows variant labels them with the question text, so the two views disagree. Targets measure 106x28, 76x28 and 46x28 px at 12 px, adjacent, on rows that reorder; on the 390 px desk the Spotlight and Hide pair are 86x32 and 5 … | `audit/qna-cofacilitation/23-bobremote-desk.png`, `packages/editor/src/live/QnaDesk.tsx:233-269 vs 304-325` |
| qna-cofacilitation-15: Share page 'Added by' shows the raw user id of the inviter | low | On Share this space, the row for the invited co-facilitator reads 'Added by  Zlg6mKJpp5rtZKgEAbwWGw' (alice's id) instead of her name, in the flow that adds a co-facilitator (UC-31 step 1). The removal dialog from the same screen is plain and works. | `audit/qna-cofacilitation/28-members.png` |

### Stage legibility and join display

Make the stage readable from the back row and honest about its numbers. Scale rail code, QR and counts with the stage. Give Q&A spotlight its own layout with a labelled vote count. The list caption uses the real total and drops 'Most recent'. The word cloud fits its plate with a single count. Peer round 2 gets a text key and row-aligned bars. The emoji legend is fixed. A text-labelled reconnect chip shows on every screen. The break and Materials kickers above headings are removed. The sample QR on the Join step is replaced by plain text when no session exists. Decisions D6 to D11 land in these same files.

Files: `apps/stage/src/**`, `packages/charts/src/**`, `packages/slides/src/StepLayout.tsx`, `packages/slides/src/StepLayout.test.tsx`, `packages/slides/src/deck-slide.css`, `packages/slides/src/slide-types.ts`, `packages/slides/src/Listening.tsx`, `packages/slides/src/MeaningCard.tsx`, `packages/domain/src/aggregate.ts`, `apps/workspace/src/lib/library-actions.ts`, `e2e/journeys/UC-50-wall-chart-labels.spec.ts`, `e2e/journeys/UC-40-slide-display-parity.spec.ts`

Verification: vitest in apps/stage and packages/charts (list caption total, peer key, emoji legend, word cloud); vitest in packages/slides (update the sample-QR expectation in StepLayout.test.tsx); UC-50, UC-40, UC-36 (run only, owned by office); Screenshot check at 1920x1080, 1280x720 and 1024x768 with a crowd of 40 or more; New UC journey step warranted: extend UC-50 with the spotlight layout, the real-total Q&A caption and the offline chip. No new journey file.

| Finding | Severity | Observed | Evidence |
| --- | --- | --- | --- |
| agent-plugin-08: Stage word cloud starts blank, renders small, and its text summary overlaps the response count | medium | On the stage at 1280x720 with 27 answers, the plate showed only the heading for several seconds, then the cloud arrived. The cloud takes about 25% of the plate width and the smallest words are about 18 px, which is poor from the back row. A tiny '27 responses' caption sits on top of the visible '27 responses. Most common words: ownership (5), budget (4), ...' summary line, which is cut off with an … | `audit/agent-plugin/14-stage-cloud.png`, `audit/agent-plugin/14b-stage-cloud.png` |
| qna-cofacilitation-03: Stage Q&A list shows about 5 of 100 questions, the last row is clipped, and its caption states wrong numbers | medium | At 1920x1080 the list mode shows 5 full cards plus one cut-off card (screenshot 12); the list holds 24 entries (maxItems 24) in a 535 px scroll box that nobody can scroll on a projector, with no 'and 76 more' line. The visible one-line caption (kept visible on purpose, stage-ui.css LD11) reads '24 questions. Most recent: Can you repeat the second point? (36)': the count is the cap, not the 100 ask … | `audit/qna-cofacilitation/12-stage-qna-list.png`, `audit/qna-cofacilitation/38-stage-after-answered-spotlight.png`, `packages/charts/src/displays/list.tsx:40-49,87-90`, `apps/stage/src/stage-ui.css:587-604` |
| qna-cofacilitation-04: Spotlighted question renders at list size (24 px) in a half-empty plate | medium | A spotlighted 300-character question appears at about 24 px inside a card that fills about 15% of the 1080 px plate; roughly half the plate is blank (screenshot 18). The 'Audience Q&A' heading is 4x larger than the question the room is meant to read. It is the same card as list rows, with a bare '0' badge. | `audit/qna-cofacilitation/18-stage-spotlight-long.png`, `apps/stage/src/StageView.tsx:372-405` |
| stage-wall-03: Q&A spotlight does not enlarge the question and shows an unlabelled vote number | medium | Spotlight renders the same 28px card under a larger 'Audience Q&A' heading. At 640x360 the question is clipped to three lines. The vote badge is a bare number. The rail's 'answered' count stays visible during Q&A although it relates to an unrelated interaction. | `audit/stage-wall/qna-spot-1920x1080.png`, `audit/stage-wall/qna-spot-640x360.png`, `apps/stage/src/StageView.tsx` |
| stage-wall-11: Offline notice exists only in the rail; content slides and outline steps show none | medium | 'Reconnecting...' is a 13px line in the rail, and the rail is shown only when showRail (not idle, no outline content). On a content slide the stage can freeze with no indication, and a stale chart looks live. Evidence is code-level plus incidental flap screenshots (Playwright setOffline did not drop the sockets). | `audit/stage-wall/offline-outline.png`, `apps/stage/src/StageView.tsx` |
| stage-wall-12: Peer round-2 comparison has no key and bars do not align with rows | medium | Round 2 reveal draws grey versus blue bars with no key. The only legend is the caption 'Round 1: ... round 2: ...'. Bars do not line up with their rows. | `audit/stage-wall/peer-r2-reveal.png` |
| start-join-08: Rail QR is capped at 160 px and the code at 32 px at every resolution | medium | On the 1920x1080 stage the rail QR is 160 px wide, 8 percent of the width, and the code is 32 px (16-stage-q.png). On a 3 m projected image that is about 25 cm for the QR, scannable from roughly 2.5 m, far short of the back row of a room for 40 to 200 people. The Join slide QR is about 375 px (46-stage-join-slide.png), so the rail is the weak part. CSS uses fixed pixel caps (.rail__qr max-width 16 … | `audit/start-join/16-stage-q.png`, `apps/stage/src/stage-ui.css:196-228` |
| live-console-13: Break step has no countdown and a kicker line above the heading | low | The break step (minutes: 10) renders 'Break' with a small '10 minute break' line above it and the author's body; there is no countdown on the stage and the console ribbon has no Clock group on it (unlike the timer step). The line above the heading is the eyebrow pattern DESIGN.md forbids. | `audit/live-console/31-timer.png`, `packages/slides/src/StepLayout.tsx:586` |
| stage-wall-10: Emoji-pulse legend doubles the emoji and the empty state draws emoji as if voted | low | The legend renders splitEmoji(o.label) then o.label (which already starts with the emoji): '😵 😵 Lost 37%'. With zero answers the marquee still draws one emoji per option. The marquee shows only some options at an instant, and under reduced motion it freezes in a fixed row. | `audit/stage-wall/emoji-hd.png`, `audit/stage-wall/emoji-reduced-hd.png`, `packages/charts/src/displays/emoji-pulse.tsx:85` |
| stage-wall-13: Rail counts and brand are 15px; histogram and word cloud use space poorly | low | 'N joined / N answered' and the brand are 15px on a 1920 wall. The histogram repeats its stats (28px '123 answers - mean 50.6 - median 51 h' plus the 19px caption), has 13px axis labels and no unit on the axis. The word cloud fills about 40% of the width and splits long text into fragments ('beca', 'bec'). | `audit/stage-wall/num-hist-hd.png`, `audit/stage-wall/cloud-hd.png`, `apps/stage/src/stage-ui.css:159` |
| start-join-03: Join slide shows a scannable sample QR and the code ABCD1234 in the Presenter before the session starts | low | A Join slide in the editor canvas and in the Presenter before Start session draws a real QR (https://join.openroom.app/) and the code ABCD1234, with nothing marking it as a sample (42-join-slide-editor.png, 44-presenter-join-slide-nosession.png). Only the inspector line says 'QR code appears when the session starts.' A presenter who presents locally first and starts the session on a later slide pr … | `audit/start-join/42-join-slide-editor.png`, `audit/start-join/44-presenter-join-slide-nosession.png`, `audit/start-join/46-stage-join-slide.png`, `packages/slides/src/StepLayout.tsx:39` |

### Training experience and deck editor

Fix the editor flows a trainer meets building a 60-minute deck. Sequence inserts follow the previous block instead of interleaving. The gallery 'All' view and search include sequences and the dialog is retitled. Timer style, Mark correct and Remove answer get distinct accessible names with pressed state. Narrow editors start with the task pane closed. Rehearsal shows notes and uses the full area, and the Timing pane copy is corrected. The inert School branding teaser is removed from the theme dialog. Decisions D1 to D5 about Q&A authoring, vocabulary, question settings and planned duration land in these files.

Files: `packages/editor/src/deck-edit/**`, `packages/editor/src/presenter/Presenter.tsx`, `packages/ui/src/theme-studio.tsx`, `packages/schema/src/slide-templates.ts`, `packages/schema/src/workshop-sequences.ts`, `apps/workspace/src/pages/SpaceEditPage.tsx`, `apps/workspace/src/shell/experiences.ts`, `apps/workspace/src/shell/WorkspaceShell.tsx`, `apps/workspace/src/components/SpaceWelcome.tsx`, `e2e/journeys/UC-08-deck-editor.spec.ts`, `e2e/journeys/UC-14-slide-templates.spec.ts`, `e2e/journeys/UC-41-editor-overflow.spec.ts`, `e2e/journeys/UC-54-editor-insert-and-panes.spec.ts`, `e2e/journeys/UC-13-deck-design.spec.ts`, `e2e/journeys/UC-42-empty-drafts.spec.ts`, `e2e/journeys/UC-53-deck-editor-recovery.spec.ts`, `e2e/journeys/UC-59-slide-fitting.spec.ts`

Verification: vitest in packages/editor (templates insertWorkshop returning first and last step ids, with a two-sequence order test; TemplateGallery search; AskDialog names); vitest in packages/ui (theme-studio) and packages/schema (workshop-sequences); UC-14, UC-54, UC-08, UC-41, UC-59; New UC journey step warranted: UC-14 insert two sequences in a row and assert slide order. UC-54 gets a 768 px task-pane-closed assertion.; Do not hide Term, Homework or Recap by experience in this cluster, because AGENTS.md:258 forbids it.

| Finding | Severity | Observed | Evidence |
| --- | --- | --- | --- |
| training-setup-03: Inserting workshop sequences or templates one after another interleaves them | high | After a sequence is inserted, selection moves to its first slide. The next insert is placed after that first slide, so it lands inside the previous sequence. I inserted Check-in, Think/discuss/revote, Scenario decision, Team challenge, Prioritize and Commitment in a row. The result was Check-in's title at slide 2 and its Debrief at slide 21, with the other sequences stacked in reverse between them … | `audit/training-setup/10-after-all-seq.png`, `packages/editor/src/deck-edit/DeckEditor.tsx:861-865`, `packages/editor/src/deck-edit/outline-edit/templates.ts:15-19` |
| live-console-12: School and tutoring wording shows up in a Training space | low | With the space set to Training: the Library row reads '14 slides · 9 ask the class'; the live Insert tab offers 'Term' (a vocabulary slide) next to Statement and Question; the Theme & branding dialog (opened from the Session menu) has a 'School branding' block labelled 'Pro · coming soon' with a sample 'Northfield High', and mini-previews titled 'Which gas?'; after the session the deck inspector l … | `audit/live-console/04-library-training.png`, `audit/live-console/40-theme.png`, `audit/live-console/44-insert-tab.png`, `audit/live-console/60-library-after-end.png` |
| training-setup-08: Present rehearsal is capped at 820 px, shows no notes, and lets keyboard focus escape into the editor | low | At 1440 px the rehearsal slide is only about 820 px wide (width: min(100%, 820px, ...) in Presenter.tsx:137), with large empty margins. Presenter notes are not shown, so the facilitator cannot rehearse the notes that the sequences ship. The overlay declares role=dialog aria-modal but the editor beneath stays reachable. Tabbing past Previous and Next goes to the editor's 'Back, Untitled, Saved, Sha … | `audit/training-setup/20-present.png`, `audit/training-setup/22-present-timer.png`, `packages/editor/src/presenter/Presenter.tsx:118,134-140` |
| training-setup-10: Workshop sequences are only found under a 'Workshops' chip in a dialog titled 'Choose a slide' | low | The six sequences insert three to four slides each, but they appear only after the 'Workshops' chip is chosen. 'All' omits them and typing in 'Find a template' under All does not search them. The dialog title and subtitle ('Choose a slide / Use your deck's theme. Every word and question stays editable.') do not say that sequences exist or that notes are included. Each card previews only the first … | `audit/training-setup/07-gallery-all.png`, `audit/training-setup/08-gallery-workshops.png`, `packages/editor/src/deck-edit/TemplateGallery.tsx:12-16,19-21` |
| training-setup-11: Timer Style options 'countdown' and 'countup' are both labelled '4:12' | low | In the Timer Style grid the first two buttons both read '4:12'. The real names (countdown, countup) are only a title tooltip. The accessible name for both is '4:12', so a keyboard or screen-reader user cannot tell them apart. Their visuals are also identical. | `audit/training-setup/10-after-all-seq.png`, `packages/editor/src/deck-edit/properties/timing.tsx:145-154` |
| training-setup-12: Ask dialog: 'Mark correct' and 'Remove this answer' buttons share one name each and expose no state | low | Each answer row has a button 'Mark correct' that becomes '✓ Correct' when on. It has no aria-pressed and its name does not say which option (A, B, C). Every row's remove button is named 'Remove this answer'. With several correct answers allowed, a keyboard or screen-reader user cannot tell which are marked. | `audit/training-setup/13-ask-multi.png`, `packages/editor/src/deck-edit/AskDialog.tsx:386-405` |
| training-setup-14: At 768 px the editor opens with the task pane and squeezes the canvas to about 190 px; the ribbon scrolls with no cue | low | At 768 px the 244 px rail and 320 px pane leave a canvas about 190 px wide. Closing the pane gives a usable canvas. The Home ribbon cuts off after 'Play' and the whole Insert group (including Ask) is clipped. The Row is overflow-x-auto with no visible affordance. At 1280 and 1440 px the layout is fine. In the live console the 768 px footer clips 'Reveal the results' and the ribbon cuts 'Hide resul … | `audit/training-setup/31-editor-768.png`, `audit/training-setup/32-editor-768-closed.png`, `audit/training-setup/30-editor-1280.png`, `packages/editor/src/deck-edit/Ribbon.tsx:113` |

### Recap, saved results and workspace routing

Let the presenter reach the recap and exports after End session, using the account recap route when no host token is stored, and link Prepare recap and Saved results from Session notes and the End dialog. The End dialog states the 30-minute retention in one plain sentence. Group names are carried into the recap candidates, the recap HTML and the saved report. The recap page gets Select all, Clear and an N selected line, the eyebrow labels are removed from both generated pages, and saved results show response counts. The deck editor remounts per deck id so a hash change cannot write one deck over another.

Files: `apps/workspace/src/app-router.tsx`, `apps/workspace/src/pages/DeckEditorPage.tsx`, `apps/workspace/src/pages/SessionRecapPage.tsx`, `apps/workspace/src/pages/SavedResultsPage.tsx`, `apps/workspace/src/pages/tutor/SessionNotes.tsx`, `apps/workspace/src/editor-services.tsx`, `packages/editor/src/live/EndSessionDialog.tsx`, `packages/editor/src/live/useSessionExit.ts`, `packages/editor/src/live/session-exit.ts`, `packages/editor/src/live/session-exit.test.ts`, `apps/relay/src/session-recap.ts`, `packages/schema/src/session-recap.ts`, `packages/schema/src/saved-results.ts`, `e2e/journeys/UC-33-workshop-recap.spec.ts`, `e2e/journeys/UC-38-saved-results.spec.ts`, `e2e/journeys/UC-06-library.spec.ts`

Verification: vitest in apps/workspace (add a router test: editor A then editor B shows B's title and draft target; recap fallback without a host token); vitest in apps/relay (recap candidates with groupName, no participant ids or handles) and packages/schema (recapHtml and savedResultsHtml without eyebrow); UC-33, UC-38, UC-06; New UC journey step warranted: UC-33 opens the recap after End session from Session notes. UC-38 asserts response counts and group names.

| Finding | Severity | Observed | Evidence |
| --- | --- | --- | --- |
| groups-after-01: After End session the recap, JSON and CSV exports cannot be reached from the UI | high | Confirming End session routes the presenter straight to 'Session notes - Untitled' (#/sessions/<id>/record). useSessionExit.ts:129 clears the stored host token. Opening #/sessions/CODE or #/sessions/CODE/recap by hand then shows 'This session is not open on this device. Sign in on this device and use Rejoin under Live now in the Library.' An ended session is not under Live now. 'Prepare recap', 'D … | `audit/groups-after/35-ended.png`, `audit/groups-after/42-recap-after-end.png`, `audit/groups-after/39-inspector.png`, `packages/editor/src/live/useSessionExit.ts:129` |
| training-setup-04: Editor shows a stale deck, and a false 'changed somewhere else' banner, after a same-tab hash navigation between two decks | high | With deck B open in the editor, I changed the URL hash to deck A's /edit address without a reload. The URL showed A but the editor kept B's title and 5 slides. Duplicate then failed with 'Couldn't save' and the banner 'This deck was changed somewhere else since you opened it. Your edits are kept below. [Keep this draft] [Use saved version]'. The server rejected the write only because B's base vers … | `audit/training-setup/41-stale-editor.png`, `apps/workspace/src/pages/DeckEditorPage.tsx:96-134`, `apps/workspace/src/app-router.tsx:308-323` |
| groups-after-02: The presenter is never told that answers and the recap source are deleted 30 minutes after the end | medium | The participant phone tells people 'Answers are deleted 30 minutes after the session ends' (apps/participant/src/live/screen.tsx:239). The presenter's End dialog only says 'Participants are disconnected and results are final.' (EndSessionDialog.tsx:30). The recap page learns about it only through a 410 on load, with the error 'The session responses have been deleted...' (SessionRecapPage.tsx:33). … | `audit/groups-after/34-end-dialog.png`, `audit/groups-after/17-p1-joined.png`, `packages/editor/src/live/EndSessionDialog.tsx:30`, `apps/relay/src/session-do.ts:99-105,510` |
| groups-after-04: Group name is dropped from the recap, preview and saved report | medium | On stage each group answer is labelled with its group ('Table 1'). The ballots CSV also carries the group name. recapCandidates (session-recap.ts:27-29) keeps only the text and the question prompt for text entries. The recap page lists group answers as 'priorities data / What does your table recommend?' with no table name. The downloaded HTML repeats the question as an h3 above every answer (four … | `audit/groups-after/46-recap-full.png`, `audit/groups-after/40-saved.png`, `audit/groups-after/recap-download.html`, `apps/relay/src/session-recap.ts:27-29` |
| groups-after-06: Recap selection is one checkbox per answer, with no select all, filter or count (56 boxes for 40 people) | low | With 40 participants the recap page is 5856 px high and has 56 checkboxes: 4 results, 40-odd text answers under 'Discussion points', 8 Q&A items. There is no select all or clear, no 'selected: N', no sort by Q&A votes, and no way to tell a duplicate from a different answer. Q&A items show no vote count. Text answers are headed 'Discussion points', which they are not. At 200 participants this is un … | `audit/groups-after/46-recap-full.png`, `audit/groups-after/45-recap-empty.png`, `apps/workspace/src/pages/SessionRecapPage.tsx:66` |
| groups-after-08: Recap HTML has an eyebrow label above its title and ranking points are unexplained | low | recapHtml() renders <div class="eyebrow">Workshop recap</div> above the h1, with uppercase letter-spacing .12em. DESIGN.md and the copy rule ban eyebrow labels above headings. The footer reads 'Selected and reviewed by the facilitator · OpenRoom' in a file the trainer forwards to a manager. Ranking tables show 'Points' (95, 87, 58) with no explanation of how points are computed and a heading '40 r … | `audit/groups-after/48-recap-preview2.png`, `audit/groups-after/recap-download.html` |
| groups-after-13: Saved results show no response counts and no group names | low | The Saved results page lists ranking rows 'Better context 40' and 'Earlier notice 40' with a heading and a 'Points' column, but not how many people answered (15 of 32 in my run, in the JSON: aggregate total 15) and not the participant count. A tie is shown as two different rows. Text results are an unlabelled list of 5 strings. The recap shows '40 responses'; the saved page does not, so the two do … | `audit/groups-after/40-saved.png`, `audit/groups-after/saved.json`, `apps/workspace/src/pages/SavedResultsPage.tsx:51-54` |
| live-console-11: After End session the presenter gets a blank three-field Notes form; results are only in the Library inspector | low | End session asks 'End this session? Participants are disconnected and results are final.' and then lands on 'Session notes — Difficult conversations' with Outcomes (one per line), Next session and Private notes. It is the generic Notes page (not tutoring-specific: no student picker), but it shows nothing about the session just run (40 participants, 12 questions, no summary or link to recap, counts … | `audit/live-console/56-end-dialog.png`, `audit/live-console/57-after-end.png`, `audit/live-console/60-library-after-end.png`, `packages/editor/src/live/EndSessionDialog.tsx:30-33` |

### PowerPoint add-in

Bring the pane onto the product's own look: plain headings, no eyebrows or taglines, the two-hue palette, the nine type tokens and standard focus rings. Fix the live panel order so session controls lead and stale notices clear. The rehearsal preview renders at a fixed design size and scales to the iframe. Network failures show a plain sentence. The Start wording is consistent, the status is text and not a disabled button, targets reach 32 px, slide rows get names and the bound slide is named. Decisions D26 and D27 land here.

Files: `apps/office/src/**`, `apps/workspace-worker/src/office.ts`, `apps/workspace-worker/src/mcp-oauth.ts`, `apps/workspace-worker/src/oauth-connections.ts`, `apps/workspace/src/components/ConnectedApps.tsx`, `e2e/journeys/UC-34-powerpoint-connection.spec.ts`, `e2e/journeys/UC-35-powerpoint-live.spec.ts`, `e2e/journeys/UC-36-powerpoint-display.spec.ts`

Verification: vitest in apps/office; vitest in apps/workspace-worker only if D27 is accepted; UC-34, UC-35, UC-36; Screenshot check of the pane at 320 and 340 px, welcome and live; No new UC journey needed. Extend UC-36 with the scaled rehearsal preview.

| Finding | Severity | Observed | Evidence |
| --- | --- | --- | --- |
| powerpoint-addin-01: Pane chrome has a slogan heading, eyebrow labels and its own green palette and type scale | medium | The sign-in screen shows the eyebrow 'MAKE ROOM FOR EVERY VOICE' above the 32 px heading 'Your slides. A shared conversation.' The header carries 'FOR POWERPOINT' and the pane uses uppercase tracked eyebrows 'DECK SLIDES', 'JOIN CODE', 'REHEARSAL' and 'SLIDE 2 · QUESTION'. style.css uses a green palette (#245e4f, #205f4f), amber focus rings (#bf8f2e), weight 700 and off-scale sizes of 10, 11, 12, … | `audit/powerpoint-addin/a1-fallback.png`, `audit/powerpoint-addin/a2-05-slides.png`, `apps/office/src/App.tsx:59 and :64`, `apps/office/src/App.tsx:99 (DECK SLIDES) and :101 (Slide n · kind)` |
| powerpoint-addin-04: Rehearsal preview is a fixed 16:9 box about 300 px wide and clips result rows | medium | At 340 px the rehearsal iframe is about 300x170. Revealed choice results are clipped: the first row's label is cut and the third row is half hidden ('Explain the cost…'). Text wall rows are cut at the second card. Revealing also shows the large 'Results' overlay and confetti, which covers the bars in screenshots taken within about a second. The preview cannot be enlarged or scrolled, so the presen … | `audit/powerpoint-addin/a4-02-rehearse-revealed.png`, `audit/powerpoint-addin/a3-04-rehearse-text.png`, `apps/office/src/style.css:3 (.rehearsal iframe aspect-ratio)`, `apps/office/src/display.css:6 (.office-preview overrides of .or-bars-chart)` |
| powerpoint-addin-03: Live controls sit below the embed form and are reached by scrolling a pane that grows with deck length | low | The pane stacks: embed-code form, breadcrumb nav, 'Selected slide', then Session controls, then the full slide list. At 340x900 the Close/Reveal row of the live panel is at about y=860 and Hide results at about y=905. With a long question the heading takes 6 lines and pushes the buttons below the fold. A 30-slide deck makes the pane about 6000 px tall at 320 px, so scrolling is needed to reach Edi … | `audit/powerpoint-addin/a5-07-revealed.png`, `audit/powerpoint-addin/a7-06-end-confirm.png`, `apps/office/src/App.tsx:77-100`, `apps/office/src/App.tsx:25 (setNotice is only cleared by the next action)` |
| powerpoint-addin-07: Raw 'Failed to fetch' shown when Start does not reach the server | low | When the Start response is lost, the red alert reads 'Failed to fetch' (the browser's own message), followed by 'This presentation has a session reference. Resume...'. The alert does not say what happened or that a join code may already exist. The same pattern applies to every action because action() prints cause.message directly. | `audit/powerpoint-addin/a7-04-lost-start.png`, `apps/office/src/LivePanel.tsx:56-59`, `apps/office/src/api.ts:12 (fetch not wrapped in try/catch)` |
| powerpoint-addin-08: Tutor, student and lesson wording in the pane for a corporate group | low | The live panel heading is 'Teach from PowerPoint'. The api.ts error for mismatched contexts reads 'These decks are linked to different students or groups. Use decks with the same student or group for one session.' The slide-preview comment says 'live teaching'. The slide chooser says nothing about the participant group. | `apps/office/src/LivePanel.tsx:127`, `apps/office/src/api.ts:21`, `audit/powerpoint-addin/a2-06-bound.png` |
| powerpoint-addin-09: Slide picker is an unfiltered flat list with no thumbnails, PowerPoint slide number or search | low | A 30-slide deck is a 5978 px column of cards (about 150 px each at 320 px) that shows 'Slide n · Question' and the prompt. There is no search, no thumbnail, and 30 identical 'Use on selected slide' buttons that all announce the same name to a screen reader. The 'Selected slide' section never says which PowerPoint slide is selected (number or title). Two similar prompts are hard to tell apart. Bind … | `audit/powerpoint-addin/a7-03-30slides.png`, `apps/office/src/App.tsx:99-107` |
| powerpoint-addin-10: Terminology drift: 'Start session' in the pane, 'start participation' on the slide and in a lobby button | low | The pane button is 'Start session'. The embedded display says 'Open the OpenRoom pane to load this slide and start participation.' and the toolbar says 'Preview · Start participation in the OpenRoom pane'. LivePanel also has a lobby 'Start participation' button, but Start session went straight to live in every run (the lobby state was never shown). Also: 'Session ready', 'Live session', 'Show sele … | `apps/office/src/content.tsx:133 and :136`, `apps/office/src/LivePanel.tsx:139`, `audit/powerpoint-addin/a9-01-join-preview.png` |
| powerpoint-addin-11: Disabled primary buttons carry the live status at 2.7:1 contrast | low | 'Selected slide is live' is a disabled primary button (opacity .55, white on a light green), about 2.7:1. 'Start session' looks the same before a slide is bound. The pane's connection label ('Connected', 'Offline') is 10 px. The status 'is live' therefore reads as an unavailable control. | `audit/powerpoint-addin/a5-07-revealed.png`, `apps/office/src/LivePanel.tsx:144`, `apps/office/src/style.css:1 (button:disabled opacity .55)` |
| powerpoint-addin-12: Small touch and click targets and a heading outline with several h1 elements | low | .text-button has 2 px padding at 12 px type (Refresh, Remove OpenRoom slide, Sign out, End session, Keep session open), so targets are about 22 px tall on a phone-sized or touch-laptop pane. The pane renders an h1 for 'Choose a space', 'Choose a deck', the deck title and the rehearsal title, with h2/h3 for sections. 'Open companion controls' and 'Open audience display' open new tabs with only an a … | `apps/office/src/style.css:1`, `apps/office/src/App.tsx:92,96,102`, `audit/powerpoint-addin/a5-07-revealed.png` |
| powerpoint-addin-14: Pane lists 'Slide n · Title/Question' kinds but the 'Selected slide' section does not say which OpenRoom slide is bound | low | After binding, 'Selected slide' reads only 'OpenRoom slide selected.' with 'View source deck'. The presenter cannot tell which slide, deck or question this PowerPoint slide is bound to without opening the source deck, which matters when several decks are used across a presentation. 'Slide 2 · Question' for every poll type also hides whether it is a choice, scale, text or numeric question. | `audit/powerpoint-addin/a2-06-bound.png`, `apps/office/src/App.tsx:93` |

### Agent surface, MCP and CLI

Fix the code and tool text agents read. Add the deck-create body and the experience values to the openroom_api description. State in deck_start that no session.start follows. Document qna.stage and the ids in session_results. Make `openroom mcp` forward a bearer token from OPENROOM_TOKEN, and write .openroom.json with mode 0600 and a one-line notice. The validator reports every html sanitizer rejection at once, hints at quoting in flow mappings and skips the title warning when title equals prompt. Align the fit check with the editor or state that html is not measured. The shared tool and server wording follows D29.

Files: `packages/mcp/src/**`, `packages/cli/src/**`, `packages/schema/src/outline-fit.ts`, `packages/schema/src/outline-errors.ts`, `packages/schema/src/element-html.ts`

Verification: vitest in packages/mcp, packages/cli (token header, state file mode) and packages/schema (outline-fit, outline-errors, element-html); Run `echo tools/list | OPENROOM_ORIGIN=... OPENROOM_TOKEN=... node packages/cli/dist/cli.js mcp` against a local server; No UC journey needed. If a UC exists for the agent path, run it.

| Finding | Severity | Observed | Evidence |
| --- | --- | --- | --- |
| agent-plugin-01: run-a-session and AGENT.md tell agents to drive with interaction.open and session.advance, which leaves the stage on the current slide | medium | After deck_start, session_command interaction.open on 'mood' while the position was slide 1: phones showed the open question and live results, while the stage (and a presenter sharing it) kept showing the title slide. The skill's step 3 ('start, open a question, close it, reveal it, advance, end') and the AGENT.md happy path (`openroom session open <first-id>` / `session.advance`) never mention ou … | `audit/agent-plugin/10-stage-after.png`, `audit/agent-plugin/09-p1-open-on-title.png`, `plugin/skills/run-a-session/SKILL.md:44-52`, `docs/AGENT.md:101-112` |
| agent-plugin-03: An agent cannot find how to create a deck or a Training space from the skills, CLI or tool list | low | deck_save_version, deck_get and deck_start all need a deckId, but there is no deck_create tool or CLI command (CLI usage has deck get/save/draft/versions/start). port-a-deck ends 'Save, then launch'; it never says how the first deck is made. The route is one sentence inside the ~10k-character openroom_api description ('POST /api/decks creates a deck'). POST /api/decks with an empty body succeeded … | `audit/agent-plugin/tools.json`, `audit/agent-plugin/02-settings.png`, `packages/cli/src/run.ts:21-37 (USAGE)`, `packages/mcp/src/tools.ts:315-330` |
| agent-plugin-05: Validator and deck_save_version report no fit problem, but the editor flags the ported slide as not fitting | low | After I moved the html element box down to clear the W_ELEMENT_OVERLAP warning, outline_validate and deck_save_version returned no W_TEXT_FIT warning for the blank slide 'What counts as personal data?'. The editor shows 'Content that does not fit: Heading - Content exceeds its box; HTML - Content exceeds its box', a red '2 items do not fit on this slide.' and a 'Review overflow' button. On the sta … | `audit/agent-plugin/05-slide-diagram.png`, `audit/agent-plugin/11-stage-diagram.png`, `packages/schema/src/outline-fit.ts` |
| agent-plugin-06: `openroom mcp` cannot reach a hosted or local server with a token, and mcp.json is fixed to production | low | With OPENROOM_ORIGIN pointing at the local server, `openroom mcp` answers tools/list with {error:-32001 'unauthorized'}. proxyStdioToHttp sends no Authorization header and the CLI reads no token variable (the only env var is OPENROOM_ORIGIN). docs/AGENT.md says the stdio host works 'Same tools. No extra PAT'. plugin/mcp.json and .mcp.json hard-code https://openroom.app/api/mcp, and the README fix … | `packages/cli/src/mcp-proxy.ts:42-52`, `packages/cli/src/mcp-backend.ts:26-28`, `plugin/README.md:46-47`, `docs/AGENT.md (MCP endpoint paragraph: 'No extra PAT')` |
| agent-plugin-07: Session Q&A is not usable from the agent surface as documented: no read in status, qna.stage and Answered undocumented | low | qna.enabled worked and the crowd's 8 questions arrived. session_status omits Q&A completely (not even a count). session_results returns qna.questions. The session_command description names only qna.hide/unhide. qna.stage (list/spotlight/off) works and puts the question list on the stage, but it is documented only in docs/CONTRACTS.md, which also says 'CLI/MCP parity deliberately deferred'. The CLI … | `audit/agent-plugin/23-stage-qna-list.png`, `audit/agent-plugin/27-console-qna.png`, `docs/CONTRACTS.md:240,265`, `packages/cli/src/run.ts:21-62` |
| agent-plugin-13: Validation errors for common agent mistakes are hard to act on | low | A comma inside a YAML flow mapping ({id: m2, label: Busy, mind elsewhere}) returns path '/interactions/0/options/1/mind elsewhere' and '"mind elsewhere" is not a field here', with no hint to quote the label. The html sanitizer reports one rejected construct per call (<script>, then <style>, then event attributes, one round trip each), although the skill says to 'read the validator's error rather t … | `audit/agent-plugin/args/bad1.json`, `audit/agent-plugin/args/bad4.json`, `packages/schema/src/outline-errors.ts` |
| agent-plugin-14: CLI deck start writes the host and stage tokens to .openroom.json in the working directory | low | `openroom deck start` printed the join and stage URLs and wrote .openroom.json in the current directory with hostToken, stageToken, joinUrl and stageUrl in plain JSON. run-a-session says 'Treat the host token as a secret'. An agent working in a project folder can commit it. The output does not tell the user that the file was written, apart from a 'state' line naming it. This is the stated design f … | `audit/agent-plugin/cliwd/.openroom.json`, `packages/cli/src/state.ts:6` |

### Documentation, manual and skill text

Run after all code clusters merge. Correct start.md and live-session.md to name Copy join link and the Join slide, and update facilitation.md and questions.md for the settled Q&A path. Update the UC-01, UC-03, UC-30 and UC-31 surface tables and the status board. Add the group-name line to the CONTRACTS.md allowlist, fix the stale 'parity deferred' sentence, update the TERMINOLOGY.md End dialog body and any DESIGN.md exception from decisions D6 and D11. Rewrite run-a-session around outline.next and goto without restating commands, add the hidden-until-close pedagogy line, correct the AGENT.md tool count, skill list and 'No extra PAT', and add the plugin README token note.

Files: `apps/site/src/content/docs/**`, `docs/*.md`, `docs/manual/**`, `docs/journeys/*.md`, `plugin/README.md`, `plugin/skills/*/SKILL.md`, `plugin/plugin.json`, `plugin/.codex-plugin/plugin.json`, `apps/office/README.md`, `DESIGN.md`

Verification: Run the site docs build and the manual coverage check (docs/manual/coverage.md); grep the docs for the old strings: 'tutor' on participant pages, 'Session menu → Join page', 'Twelve focused tools'; New UC journey contracts: write docs/journeys markdown for any new UC spec that the code clusters added. Update docs/journeys/README.md status board.

| Finding | Severity | Observed | Evidence |
| --- | --- | --- | --- |
| live-console-04: Peer instruction: the host cannot see the round-one split, so the 30-70% rule in examples/peer-instruction.yaml cannot be applied | high | After Close answering on a peer-instruction question the stage and mirror show only '38 answers so far · results hidden'. No percentages exist anywhere in the host DOM (only the option labels). The deck notes tell the facilitator to look at the correct share and choose Second vote (30-70%) or explain (above 70%) or reteach (below 30%). The primary button is still 'Reveal the results', and 'Call ou … | `audit/live-console/36-pi-closed.png`, `audit/live-console/37-pi-revote.png`, `examples/peer-instruction.yaml:44-50`, `packages/domain/src/snapshots.ts:97-103` |
| agent-plugin-01: run-a-session and AGENT.md tell agents to drive with interaction.open and session.advance, which leaves the stage on the current slide | medium | After deck_start, session_command interaction.open on 'mood' while the position was slide 1: phones showed the open question and live results, while the stage (and a presenter sharing it) kept showing the title slide. The skill's step 3 ('start, open a question, close it, reveal it, advance, end') and the AGENT.md happy path (`openroom session open <first-id>` / `session.advance`) never mention ou … | `audit/agent-plugin/10-stage-after.png`, `audit/agent-plugin/09-p1-open-on-title.png`, `plugin/skills/run-a-session/SKILL.md:44-52`, `docs/AGENT.md:101-112` |
| groups-after-02: The presenter is never told that answers and the recap source are deleted 30 minutes after the end | medium | The participant phone tells people 'Answers are deleted 30 minutes after the session ends' (apps/participant/src/live/screen.tsx:239). The presenter's End dialog only says 'Participants are disconnected and results are final.' (EndSessionDialog.tsx:30). The recap page learns about it only through a 410 on load, with the error 'The session responses have been deleted...' (SessionRecapPage.tsx:33). … | `audit/groups-after/34-end-dialog.png`, `audit/groups-after/17-p1-joined.png`, `packages/editor/src/live/EndSessionDialog.tsx:30`, `apps/relay/src/session-do.ts:99-105,510` |
| groups-after-04: Group name is dropped from the recap, preview and saved report | medium | On stage each group answer is labelled with its group ('Table 1'). The ballots CSV also carries the group name. recapCandidates (session-recap.ts:27-29) keeps only the text and the question prompt for text entries. The recap page lists group answers as 'priorities data / What does your table recommend?' with no table name. The downloaded HTML repeats the question as an h3 above every answer (four … | `audit/groups-after/46-recap-full.png`, `audit/groups-after/40-saved.png`, `audit/groups-after/recap-download.html`, `apps/relay/src/session-recap.ts:27-29` |
| groups-after-10: Dissolve removes a group at once, and members and spokesperson are not shown to the participants | medium | 'Dissolve' deletes the group on the first click with no confirmation and no undo; its members drop back to 'Your facilitator will assign you to a group.' (GroupsPanel.tsx:80-84). A new group with the same name starts with a fresh answer. On the phone a non-spokesperson sees 'Discuss together. Your spokesperson sends the shared answer.' with no name of the spokesperson or of the table mates (28-p1- … | `audit/groups-after/32-dissolved.png`, `audit/groups-after/28-p1-after-handover.png`, `audit/groups-after/29-p2-after-handover.png`, `packages/editor/src/live/GroupsPanel.tsx:80-84` |
| live-console-06: Result state labels contradict each other after Close, Reveal and Hide | medium | Close answering on a hidden-until-close choice question puts the bars on the stage at once (the chip 'Results shown' lights), yet the primary still says 'Reveal the results'; it actually only adds the correct mark ('Call out the correct answer' in the ribbon). After H the ribbon still says '✓ Correct answer shown' and the footer still says 'results up' while the stage shows only a count. On scale … | `audit/live-console/12-choice-closed.png`, `audit/live-console/13-choice-revealed.png`, `audit/live-console/14-hidden-after-reveal.png`, `packages/editor/src/live/hostFlow.ts:41-46` |
| agent-plugin-06: `openroom mcp` cannot reach a hosted or local server with a token, and mcp.json is fixed to production | low | With OPENROOM_ORIGIN pointing at the local server, `openroom mcp` answers tools/list with {error:-32001 'unauthorized'}. proxyStdioToHttp sends no Authorization header and the CLI reads no token variable (the only env var is OPENROOM_ORIGIN). docs/AGENT.md says the stdio host works 'Same tools. No extra PAT'. plugin/mcp.json and .mcp.json hard-code https://openroom.app/api/mcp, and the README fix … | `packages/cli/src/mcp-proxy.ts:42-52`, `packages/cli/src/mcp-backend.ts:26-28`, `plugin/README.md:46-47`, `docs/AGENT.md (MCP endpoint paragraph: 'No extra PAT')` |
| agent-plugin-07: Session Q&A is not usable from the agent surface as documented: no read in status, qna.stage and Answered undocumented | low | qna.enabled worked and the crowd's 8 questions arrived. session_status omits Q&A completely (not even a count). session_results returns qna.questions. The session_command description names only qna.hide/unhide. qna.stage (list/spotlight/off) works and puts the question list on the stage, but it is documented only in docs/CONTRACTS.md, which also says 'CLI/MCP parity deliberately deferred'. The CLI … | `audit/agent-plugin/23-stage-qna-list.png`, `audit/agent-plugin/27-console-qna.png`, `docs/CONTRACTS.md:240,265`, `packages/cli/src/run.ts:21-62` |
| agent-plugin-11: Results are visible live by default, which contradicts the skill's 'close before revealing' advice | low | My outline set no resultVisibility, and the quiz question showed live bars with 52% on the correct option on the stage, and results on phones, while answers were still open. run-a-session warns that revealing during open answers 'tells the undecided half what to think', but the live percentages already do that. The skill's example YAML and the port-a-deck steps never say to set defaults.resultVisi … | `audit/agent-plugin/16-stage-phish.png`, `audit/agent-plugin/09-p1-open-on-title.png`, `plugin/skills/run-a-session/SKILL.md:46-50`, `examples/ranking.yaml:12` |
| agent-plugin-12: Docs and README disagree with the tool list and the returned handoff links | low | docs/AGENT.md says 'Twelve focused tools' and then lists 14 (it includes session_facilitate, session_recap, session_command and picture_search). plugin/README.md lists 14 tools but its directory tree and bullets show only two skills; the plugin has five. AGENT.md's 'done' list wants the stage URL, join code and 'preferably phone remote URL', but deck_start and session_create return only joinUrl an … | `docs/AGENT.md:151,174-189`, `plugin/README.md:18-34`, `audit/agent-plugin/start-out.json`, `plugin/skills/run-a-session/SKILL.md:47-48` |
| start-join-14: Manual says Session menu, Join page gives the participant address; that item only opens the join page | low | start.md:40 says 'Open Session menu → Join page to obtain the participant address. Share the join link, show the QR code, or give participants the eight-character code.' The menu item opens the participant page in a new tab. The copy action is 'Copy join link' (HostHeader.tsx:197) or the code chip. 'Show the QR code' does not say that the QR is on the Join slide or on question slides only (see sta … | `apps/site/src/content/docs/start.md:40`, `apps/site/src/content/docs/live-session.md:26`, `packages/editor/src/live/HostHeader.tsx:197-207`, `audit/start-join/07-session-menu.png` |

### Not placed by triage

| Finding | Severity | Observed | Files |
| --- | --- | --- | --- |
| qna-cofacilitation-11: Phone remote for a moderator is dead except a caption-size 'Open the Q&A desk'; the Questions button hides what it does | medium | At 390x844 bob's remote has End, Hide results, 'Questions 103', Back and Next all disabled (snapshot: disabled) and the only moderation entry is a 12 px text link 'Open the Q&A desk' under 'Open the console' (screenshot 22). For the presenter, the 'Questions 103' button toggles Q&A on the stage but has no on/off state, no aria-pressed, and its name does not say 'stage' (PresenterRemote.tsx:424-440 … | `packages/editor/src/live/PresenterRemote.tsx` |

## Open decisions

### D1: Where does a presenter switch on audience Q&A, and may the editor also set anonymous or handles?

Findings: training-setup-01, start-join-07, qna-cofacilitation-05, groups-after-14. Cluster: training-editor.

- **Q&A on/off in the Questions ribbon Session group, saved as qna.enabled**: Smallest change that removes the dead end. Identity mode stays in the outline or agent, so participants still never type identity.
- **Q&A and identity mode both in the Session group, saved as qna.enabled and defaults.identityMode**: Full control in the editor. More UI, and it duplicates outline fields that AGENTS.md routes through agents.
- **Ask on Start session and save as the deck default**: Adds a step to every start. Bends 'a deck is a file' if applied per session.
- **Keep agent and CLI only and state the route in the empty states and the manual**: No new control. A town-hall presenter still cannot enable Q&A without an agent.

Recommendation: Option 1. Q&A is a simple deck property. Leave identity mode to the outline for now. In every case change the dead-end text in SessionAside and QnaDesk to say where to switch it on. That copy edit belongs to the qna-groups cluster after this decision.

| Finding | Severity | Observed |
| --- | --- | --- |
| training-setup-01: Session Q&A and identity mode (anonymous vs handles) cannot be turned on from any UI; the Q&A tab is a dead end | medium | The Questions ribbon has a Session group whose only content is 'The join code appears when you start the session.' The live console has a Q&A tab that reads 'Audience Q&A is not on for this session.' with no action. The console Session menu has no Q&A or identity item, and Deck settings and Space se … |
| start-join-07: Console Q&A tab is a dead end: 'Audience Q&A is not on for this session.' with no control and no hint | low | Every live console shows a Session and Q&A switch. The Q&A tab on a session without Q&A says 'Audience Q&A is not on for this session.' and nothing else (54-console-qa-tab.png, SessionAside.tsx:315). Q&A can be turned on only through a typed outline or an agent; qna.* commands fail E_FORBIDDEN when … |
| qna-cofacilitation-05: Audience Q&A cannot be turned on from any UI; the empty states point to a control that does not exist | medium | Confirms the lead. No deck-editor or Library control sets qna.enabled (grep of packages/editor and apps/workspace finds none); the deck was created through POST /api/decks with a top-level qna block. The Library card says '4 slides · 2 ask the class' and ignores Q&A. In a session without it, the con … |
| groups-after-14: Q&A, groups and identity mode have no deck-editor control; the Groups tab appears only after a group question exists | low | The Training deck editor File tab has only 'Save a copy' (43-file-tab.png). The Questions tab offers Individual / One per group per question, but no Q&A on/off. The Groups tab in the console exists only because the deck contains a group question (LiveHost.tsx:1089-1090) or groups already exist. Q&A … |

### D2: How should a Training space be worded in the shared editor and workspace, given that experience may not change document tools?

Findings: training-setup-06, training-setup-07, start-join-10, groups-after-12, agent-plugin-15. Cluster: training-editor.

- **Neutral labels for all experiences, with Homework and Recap kept, and the Dictionary languages card shown only in Tutoring spaces**: Matches AGENTS.md:258 because the workspace may branch on experience and the editor does not. Tutoring users see a renamed 'Classroom' group. 'Students never see these notes' becomes 'Participants never see these notes' and 'Lesson estimate' becomes 'Planned duration'.
- **Add an EditorServices flag so Training hides Homework and relabels groups**: Cleanest result for Training. It adds a per-experience branch to editor labels and bends the stated rule.
- **Fix only the student, lesson and tutor strings**: Least work. 'Classroom', 'Homework & recap' and the dictionary card still leak.

Recommendation: Option 1. Name the Questions group 'Group activities'. Leave the 'Recap' deck page and 'Prepare recap' as they are and add one line on the recap page that says it is built from this session's results. Make the welcome-card title match the starter deck. The plain string fixes proceed whichever option is chosen.

| Finding | Severity | Observed |
| --- | --- | --- |
| training-setup-06: Training deck editor still shows Homework and Recap pages, 'Not linked to a student', and Classroom and Language groups | low | The editor has no notion of the space experience. In a Training deck the rail shows 'Homework & recap / Homework / Recap, Not written / Not slides - one page each, in the same file.' The Homework page says 'Not linked to a student.' and offers 'Add voice response', 'Add a quiz' and 'Reading, practic … |
| training-setup-07: Space settings in a Training space show tutoring dictionary fields | low | Space settings for a Training space show a 'Dictionary languages' card: 'Set the language you teach and the language used for meanings.', with fields 'Students' language' and 'Teaching'. The Training sidebar correctly hides the context section. The Training starter is titled 'Workshop · Make a decis … |
| start-join-10: Training experience keeps tutoring and classroom vocabulary in the editor | low | With the space set to Training, the editor still shows the rail group 'Homework & recap' with Homework 'Not written' (05-editor.png), and the Questions ribbon group is called 'Classroom' (41-questions-tab.png). The Insert catalog group is also 'Classroom'. The ribbon hint 'The join code appears when … |
| groups-after-12: Deck 'Recap' slot collides with 'Prepare recap'; Training decks show Homework and Recap | low | A Training deck shows 'Homework & recap: Homework (Not written), Recap (Not written)' in the editor rail (07-inserted.png) and 'Homework / Recap' rows in the Library inspector (39-inspector.png). These are pre-written Notes pages for students. The session menu has 'Prepare recap', a different thing … |
| agent-plugin-15: Training space editor and library still carry tutoring structure; the code-map leads are only partly confirmed | low | In the Training space the deck editor's rail still shows 'Homework & recap' with 'Not slides - one page each, in the same file', and the status bar reads '5 activities ask the class'. The library chip says '5 ask the class'. The live console shows a 'Second vote' control on a ranking question. Q&A a … |

### D3: How much of a question's settings may the editor show or change: scale and numeric kinds, time limit, result visibility, second vote, text display?

Findings: training-setup-02. Cluster: training-editor.

- **Add Scale and Numeric to the Ask dialog only**: Closes the missing kinds. Settings stay invisible in the editor.
- **Add a Question section to the Design pane with editable time limit, visibility, second vote and text display**: Full authoring in the editor. Large scope and overlaps the agent-authored outline.
- **Show the settings read-only in the pane, for example 'Timed 45 s, results hidden until close'**: Trainers see what the session will do. Editing stays in the agent or typed outline.
- **Leave authoring to the agent and document it**: No editor work. A template question runs a timer the editor never shows.

Recommendation: Options 1 and 3 together. Add Scale and Numeric, and show timing, visibility and second vote read-only. Defer editable controls until the read-only summary has been used.

| Finding | Severity | Observed |
| --- | --- | --- |
| training-setup-02: Several question types and settings that the sequences use have no authoring control: numeric, time limit, result visibility, peer instruction, word cloud | medium | The Ask dialog offers only Multiple choice, Ranking, Fill the gaps, Match and Open answer. Scale exists only as the 'Confidence' template. There is no template or control for a numeric question. A question's Design pane shows only Responses (Individual or One per group), Layout and Reveal. The 'Thin … |

### D4: What does the footer total mean for a planned 60-minute deck?

Findings: training-setup-09. Cluster: training-editor.

- **Store per-slide planned minutes when a sequence is inserted so the footer matches the gallery**: Gallery and footer agree. It adds stored timing data to slides.
- **Keep the footer and drop 'about N minutes' from the gallery cards**: No data change. The trainer gets no planned total.
- **Add a deck-level 'Planned duration' that the footer compares against**: One honest number. It is a plan figure, not scheduling.

Recommendation: Option 3, using the existing meta.durationMinutes. Rename 'Lesson estimate' to 'Planned duration' and keep 'Timed activities' as the footer's own label.

| Finding | Severity | Observed |
| --- | --- | --- |
| training-setup-09: Footer 'Timed activities' counts only timers and activities, so it contradicts the 'about N minutes' in the gallery | low | The six sequences are advertised as 5, 8, 10, 10, 8 and 5 minutes (46 minutes). After inserting all six the status bar read 'Timed activities 9 min', since it sums only Timer slides and Activity durations. There is no deck-level duration or agenda control to plan 60 minutes, except 'Lesson estimate' … |

### D5: How does a presenter get the join address to the room, and where may the address be printed? DESIGN.md currently says only the waiting board prints it.

Findings: start-join-01, start-join-04, stage-wall-07, agent-plugin-02. Cluster: stage.

- **Start into the lobby: Start session opens the waiting board with code, address, QR and joined count, and the first Next goes live**: Fits DESIGN.md and the existing lobby state. Presenters see the board by default. Content slides stay rail-free.
- **Insert a Join slide as slide 1 at start when the deck has none, without saving it into the deck**: Works with outline-driven decks. Adds hidden session-time structure.
- **Print the address in neutral ink on the Join step and on the rail, and amend DESIGN.md**: Online attendees always see where to type the code. Changes a written rule.
- **Add a Join slide to the Training and Classroom samples and document Copy join link**: No stage change. Presenters who skip the Join slide still project no join information.

Recommendation: Option 1 plus printing the address in neutral ink on the Join step only. Record the Join step as the second address-printing screen in DESIGN.md. The rail keeps code and QR without the address. Include a Join slide in the Training and Classroom samples. The PowerPoint pane's copy actions are decision D20.

| Finding | Severity | Observed |
| --- | --- | --- |
| start-join-01: Stage shows no join code, QR or address on content slides, and the lobby stage cannot be reached from the UI | medium | After Start session from the editor, the Library inspector or the Presenter, the Stage (1920x1080) on a title or statement slide shows only the slide. No code, no QR, no address and no joined count (08-stage-1080.png). The rail with code and QR appears only while a question or activity is open (16-s … |
| start-join-04: The join address is never shown on the live stage or Join slide, so online participants have nothing to type | low | The live rail (16-stage-q.png) and the live Join slide (46-stage-join-slide.png) show the code and a QR but not the address. The lobby stage does print it (48-stage-lobby.png, '127.0.0.1:55665' in blue). In an online session the presenter shares the stage in Teams or Zoom and participants are on lap … |
| stage-wall-07: Join step shows only a QR and code, no address to type | medium | The join outline step renders the QR and the code only (StepLayout.tsx:602-613). People on a screen-share cannot scan their own screen and have nothing to type. The rail and idle QR are fixed at 160px and 240px, small for a back-row scan. |
| agent-plugin-02: A ported deck has no join slide, and the stage shows no join code or QR on content slides | medium | port-a-deck says to add a `join` step only if the source deck had one, so a ported deck gets none. On the stage, the title, agenda, diagram and activity slides show no code, QR or address. The join rail appears only while a question is open. The rail shows the 8-character code and a QR but not the a … |

### D6: What should the stage show when a text or Q&A list holds more entries than fit the plate?

Findings: live-console-01, stage-wall-02, powerpoint-addin-05. Cluster: stage.

- **Show only the whole cards that fit, newest first (Q&A by votes), with '+N more' and the real total**: No clipped card and the caption matches the header. Older answers are off screen. Needs an answer sequence on text ballots.
- **Auto-page whole cards on a timer with a page indicator**: Everything gets seen over time. It adds motion and needs a reduced-motion static fallback.
- **Multi-column grid that shrinks type up to 24**: More answers at once, but smaller text from the back row.
- **Fix only the counts and add an 'N more' line**: Smallest change. The last card still clips.

Recommendation: Option 1. The caption count fix and the vote label are already in the stage cluster via qna-cofacilitation-03 and proceed regardless. Host spotlight stays as the existing Q&A control and no approval queue is added.

| Finding | Severity | Observed |
| --- | --- | --- |
| live-console-01: Text list and cards show 3 of 38 answers on the stage; the caption says '24 responses' and 'Most recent' names the oldest | high | With 38 text answers the list display (and cards, which draw the same single column) renders only the first 2-3 cards; the 4th is cut mid-card and the stage cannot scroll. The visible caption under the list reads '24 responses. Most recent: <first answer>' because the chart takes the first 24 non-hi … |
| stage-wall-02: Text list, cards and Q&A list show 3-4 of 24 items, clipped mid-card, and the caption count contradicts the rail | medium | list.tsx slices to maxItems (24 on stage) and summarises 'N responses' from the visible slice, so the caption reads '24 responses' while the rail says 56 or 124 answered (Q&A: '24 questions' with 41 asked). The container is overflow-y-auto with no scroll on a projector, so only 3-4 cards fit, the la … |
| powerpoint-addin-05: Text answers fill the embedded slide with no cap, scroll or hide control in the pane | low | With 37 text answers on the embedded display only three cards show and the fourth is cut off mid-card, with no '+34 more' indicator. The pane controls for a text question are Close answers, Reveal results, Reopen answers and Hide results; there is no per-answer hide or freeze (PRD STAGE-04 says the … |

### D7: How does the stage cope with 4:3 and small windows, where the fixed rail and lobby clip?

Findings: stage-wall-01. Cluster: stage.

- **Keep the rail (LD17) and fit the lobby plate to short windows with min() sizing**: The unambiguous lobby clipping is fixed. The plate still shrinks at 4:3.
- **Collapse the rail to a corner badge or top strip below about 1100 px**: Larger plate on shared screens. Late joiners lose the big code.
- **Constant slide width with the rail as an overlay**: Stable slide size. The overlay can hide content.
- **Build the LD12 container-unit type ramp for chart labels and keep the rail**: Fixes unreadable chart labels without a layout change.

Recommendation: Options 1 and 4. Fit the lobby now, and build the LD12 ramp for chart labels. Keep the rail under LD17.

| Finding | Severity | Observed |
| --- | --- | --- |
| stage-wall-01: Stage is illegible at 4:3 and 640x360: fixed 240px rail and 160px QR shrink the 16:9 plate | medium | The rail is a fixed 240px column with a fixed 160px QR and 15px counts. The 16:9 slide plate takes the remaining width and scales down. At 1024x768 the plate is about 716x400: option labels render near 7px while value labels stay about 13px. At 640x360 (video-call thumbnail) the bars are about 8px h … |

### D8: Should the stage state whether voting is open, closed or a second vote, and list the options while results are hidden?

Findings: stage-wall-04, stage-wall-05. Cluster: stage.

- **Add a plain text state to the rail counts line and list the options without counts while results are hidden**: The room knows when to stop voting and can read what it votes on. Costs some plate height.
- **Render the existing state chip for Closed and Second vote and record the exception to the no-kicker rule**: More visible. Breaks the no-kicker rule.
- **Change only the counter wording ('answers' once closed)**: Tiny change. Does not show round 2.
- **Leave as is and rely on the host and the phones (LD7)**: No change. Back-row and online audiences cannot read the choices.

Recommendation: Option 1, keeping the QR where it is, and shrink the duplicated large count.

| Finding | Severity | Observed |
| --- | --- | --- |
| stage-wall-04: The wall never says whether voting is open, closed or a second vote | medium | StageView computes state labels (Open, Second vote, Results, Discussion, Closed) but renders a chip only for 'Paused'. After close the rail QR and code stay. Peer round 2 open looks the same as round 1. The audience in the room cannot tell when to stop voting. |
| stage-wall-05: Hidden-results question shows no answer options, only the prompt and a count | medium | With results hidden the stage shows the prompt and a large '47 answers so far' but none of the options. The count duplicates the rail. At 640x360 the 'answers so far' label is about 7px. Back-row and online audiences cannot read the choices. |

### D9: Does a stage theme apply to the slide plate, or only to the frame and rail?

Findings: stage-wall-09. Cluster: stage.

- **Theme the plate and chart tokens too, with contrast checks per theme**: Real board look. Needs contrast work for every chart colour.
- **Keep frame-only and say so in the Theme menu item**: Honest and cheap.
- **Pin the stage to light unless the host picks dark**: OS dark mode no longer changes a projected stage.
- **Leave as is**: The surprise stays.

Recommendation: Option 2, plus a 'frame colour' label. DESIGN.md already describes the plate as paper.

| Finding | Severity | Observed |
| --- | --- | --- |
| stage-wall-09: Themes recolour only the frame and rail; the slide plate stays white | low | Chalkboard and projector themes change the border and rail, but the plate stays white with navy text and the fixed chart palette, so there is no board look or contrast gain. The corner clock pill is themed against the white plate and overlaps the plate edge slightly. The stage follows the OS dark mo … |

### D10: Which actor word do participant and stage strings use outside code-only paths?

Findings: stage-wall-14, groups-after-11, training-setup-05. Cluster: participant.

- **Keep 'tutor' on identified, personal-link and tutoring-feature strings and use 'the host' on code-only paths**: Matches the recorded D3, D4 and D17 direction. A training room only sees host wording on the paths it can reach.
- **Neutral wording on every participant and stage string, including Listening and identified**: One vocabulary everywhere. Changes recorded D17 copy and UC-44 assertions.
- **Keep tutor-first everywhere**: No change. Wrong-code errors in a training room say tutor.

Recommendation: Option 1. Wrong-code, not-started and gone screens use 'the host' per TERMINOLOGY.md:292. These strings are confirmed and sit in the participant cluster. 'Waiting for the student' stays on the stage because it only shows in identified mode.

| Finding | Severity | Observed |
| --- | --- | --- |
| stage-wall-14: Tutoring wording on the stage: 'Waiting for the student', 'Your tutor ...' | low | StageView.tsx:314 and :708 print 'Waiting for the student' in identified mode, which requires a student context. Listening.tsx:82 says 'Your tutor plays the recording' and the meaning card says 'Your tutor put this up'. In a corporate training or lecture the wording is wrong. Not rendered in the aud … |
| groups-after-11: Tutor wording shown to participants of a corporate session (confirmed in the running app) | low | Joining a session with an ended or wrong code shows 'This session has ended, or the code is wrong. Check it with your tutor.' (50-join-XKGK6D2Z.png). Other strings: join-error.ts:14 'Your tutor has not started the session yet.', join.tsx:158 'Waiting for your tutor to start' and :185-186 'ask your t … |
| training-setup-05: Tutor, student and lesson wording reaches participants and the stage in a group session | medium | The join error for a wrong or ended code shows 'Check it with your tutor.' (I saw this on a phone). The waiting screen says 'Waiting for your tutor to start', the no-code hint 'ask your tutor for the join code', and the ended screen 'Your personal link opens your lesson page.' join-error.ts also has … |

### D11: How is a numeric answer such as '1,200' read?

Findings: participant-answer-03. Cluster: participant.

- **Keep comma as decimal, strip spaces, show 'Enter a number, for example 1200 or 12.5.' and the parsed value before sending**: No ambiguous guessing. The participant sees what will be sent.
- **Heuristic: comma followed by exactly three digits is grouping**: Fewer surprises for '1,200'. Wrong for '1,500' meaning 1.5 in some locales.
- **Reject ambiguous input with a hint**: Safe and strict. More friction.
- **Take separators from meta.locale when set**: Correct per deck. Needs the locale authored.

Recommendation: Option 1. Always show the invalid-input hint and the parsed value. Revisit the locale option if the field proves ambiguous.

| Finding | Severity | Observed |
| --- | --- | --- |
| participant-answer-03: Numeric answer '1,200' is accepted as 1.2; '1 200' leaves Send disabled with no reason | medium | With a numeric question, typing '1,200' sent and the page showed 'Answered: 1.2 hours'. The comma is always taken as a decimal separator. Typing '1 200' disables Send and shows no message. In a corporate group (budgets, headcount, hours) thousands separators are normal, and a wrong value goes into t … |

### D12: How does a locked single-choice question protect against a mis-tap?

Findings: participant-answer-08. Cluster: participant.

- **Up-front 'One answer only. Your first choice is final.' line, and a Cancel button while changing an answer**: Keeps tap to send, which is fast. Warns before the tap.
- **For locked questions only, select first then press Send**: No accidental final answers. Adds a tap.
- **Keep tap to send and add only the Cancel button**: Smallest change. No warning.

Recommendation: Option 1.

| Finding | Severity | Observed |
| --- | --- | --- |
| participant-answer-08: Single-choice answers send on the first tap; on a locked question a mis-tap is final and unannounced | low | A choice option submits on tap. With allowAnswerChange false I tapped 'Don't know' and got 'Answer received. Answer locked for this question.' The lock is stated only after the answer is sent. Before it, the form shows no warning. On a phone in a crowded room this is easy to hit by accident. In edit … |

### D13: Which plain status messages do participants get for pause, session end and polling?

Findings: participant-qna-01, participant-end-15, participant-sdk-12. Cluster: participant.

- **All three: 'Questions are hidden while the session is paused' with no count, the existing 30-minute sentence on the ended view, and a 'Slow connection' notice when on polling**: Closes three silent states with copy only. The polling interval and the empty frozen projection are unchanged.
- **Only the paused-Q&A sentence**: Fixes the confirmed defect. Ended view and polling stay silent.
- **Also lower the idle polling interval to 3 s**: Smaller late-question delay. Changes the cost model in the PRD.
- **Send the frozen list read-only**: Breaks LIVE-08 and CONTRACTS.md:265, where freeze empties participant content.

Recommendation: Option 1. Reuse the existing sentence from screen.tsx:239 for the ended view. Do not change the interval or the frozen projection.

| Finding | Severity | Observed |
| --- | --- | --- |
| participant-qna-01: A pause empties the Q&A list and reads as if every question was deleted | low | On a session with 31 questions I froze it and opened Q&A. The tab said 'Q&A (0)'. The body showed 'Paused' and 'Questions (0)' with an empty list, plus a second 'Paused' banner above the tabs. The questions come back after unfreeze. The domain projection returns an empty list on purpose when frozen … |
| participant-end-15: Session ended view says only 'You can close this page' | low | On a participant at 320 px the ended view is 'Session ended / You can close this page.' The earlier notice said answers are deleted 30 minutes after the end, but the ended view does not repeat it, shows no own answers or results, and gives no pointer to where follow-up material comes from. The Q&A l … |
| participant-sdk-12: Behind a proxy that blocks WebSockets a new question reaches people up to 6 s late and nothing says they are on polling | low | With WebSocket blocked the app joined and followed the session through GET /state?afterRevision=N polls (304 until a change); status stays 'polling' and the participant UI shows no notice. The interval is 1.5 s only while a question is open, 6 s otherwise (client.ts:202,369-370) and 15 s in a hidden … |

### D14: What does 'Answered' mean on a Q&A question, and who sees it?

Findings: qna-cofacilitation-01. Cluster: qna-groups.

- **Shared answered flag. Participants see it marked 'Answered', it leaves the stage list and sorts below active on the desk**: Both facilitators and the asker see the same state, which survives tab close and rejoin. Needs a domain flag, a qna.answer and unanswer command, snapshot, export and recap changes.
- **Shared flag. The question leaves the participant list and the asker's card reads 'Answered'**: Asker is told. Others lose the question.
- **Host-only flag that affects console and desk sort and the stage list**: Smallest domain change. Participants cannot tell answered from hidden.

Recommendation: Option 1. Add qna.answer and qna.unanswer to the moderator commands, drop the sessionStorage marker, and keep hidden and answered as separate states with text labels. The recap filter edit lands in apps/relay/src/session-recap.ts, which the recap-results cluster owns, so merge qna-groups after recap-results.

| Finding | Severity | Observed |
| --- | --- | --- |
| qna-cofacilitation-01: 'Answered' is a per-tab mark plus a shared hide: co-facilitator and rejoined presenter see 'Hidden', asker sees 'Hidden', recap drops it | medium | Confirms the lead and it is worse. 'Answered' (LiveHost.tsx markQnaAnswered) stores the mark in sessionStorage and also sends qna.hide. Effects seen: (1) bob's console and desk show alice's answered question as 'Hidden from stage' / struck-through 'Unhide', identical to spam that was hidden; (2) aft … |

### D15: May a co-facilitator put Q&A on the stage?

Findings: qna-cofacilitation-06. Cluster: qna-groups.

- **Keep presenter-only staging. Disabled controls say why, the desk shows who is presenting, and the docs and UC-31 cover it**: UC-31 authority rule stays: moderators moderate and organise groups.
- **Add qna.stage to the moderator commands**: Moderator can feed the stage. Weakens single-presenter authority.
- **Presenter turns on 'moderator can stage Q&A'**: Flexible. Adds a setting.

Recommendation: Option 1. Do not import the moderator list into the editor, because packages/editor has no domain dependency.

| Finding | Severity | Observed |
| --- | --- | --- |
| qna-cofacilitation-06: Co-facilitator cannot spotlight or stage Q&A, and the UI gives no reason; docs and UC-31 do not cover it | low | MODERATOR_COMMANDS (packages/domain/src/facilitation.ts:20) allows only qna.hide/unhide, so for bob the 'Show on stage' buttons, 'Stage Q&A', desk 'Spotlight' and the footer 'Show Q&A on stage / Take Q&A off stage' are greyed and disabled with no text (screenshots 06, 11, 23). The desk has no presen … |

### D16: How are groups built for 30 to 200 participants?

Findings: groups-after-03. Cluster: qna-groups.

- **Show 'Not in a group: N' and a 'Not in a group' filter, keep manual assignment**: Small, no model change. Ticking is still manual.
- **Host-side 'Split into N groups' that creates groups with a first spokesperson in one command**: Fast for large rooms. Needs a new command. The host still assigns.
- **Participants pick a table on their phone**: Changes the 'explicitly assigned' rule in UC-30 and the outsider checks.
- **Show the handle large on the phone**: Helps the room read it out. No console change.

Recommendation: Option 1 now, and option 2 as a follow-up once the count is in use. Do not let participants type identity.

| Finding | Severity | Observed |
| --- | --- | --- |
| groups-after-03: Groups are built by hand-ticking system handles, with no way to split a crowd or to see who is left out | high | The only way to form groups is Groups > New group > tick each member in a list of random handles ('Lucid Pelican 5344') > Make spokesperson > Save group, repeated per group. For 30 people it took 4 form runs and 20 ticks; for 100-200 people it is dozens of ticks. The presenter cannot tell which hand … |

### D17: What should the blocklist do with context-dependent words?

Findings: live-console-05. Cluster: qna-groups.

- **Keep one English list and add a 'Held by filter' marker and count for the host**: Host sees why a row is hidden. Needs a hiddenBy field and bends the silent-filter text in STAGE-04.
- **Trim the global list to strong terms and leave context words (hell, crap, queer, rape, nazi, hoe, tit) to host Hide**: Training on diversity or harassment stops losing answers. Some mild words reach the stage until hidden.
- **Add global non-English lists**: Wider coverage. Open PRD question 10, maintenance cost.
- **Leave the list and rely on Hide and Freeze**: No change.

Recommendation: Option 2. Keep the filter silent per STAGE-04 and add no per-session settings. Take non-English lists to PRD open question 10.

| Finding | Severity | Observed |
| --- | --- | --- |
| live-console-05: Blocklist hides English words silently, blocks normal corporate vocabulary, and misses other languages | medium | applyBlocklist hides 'What the hell is this', 'that was crap', 'queer inclusion at work', 'a rape and harassment policy', 'hoe the garden', 'tit for tat' and 'Nazi history', and passes 'Scheisse', 'putain', 'la mierda' and 'idiot'. On the phone the participant sees 'Answer received · Answered: What … |

### D18: How does the presenter count joined people and people still to answer?

Findings: start-join-09, live-console-09. Cluster: console-run.

- **Leave as is**: Joined minus answered is still derivable.
- **Label 'joined in total' and show 'N of M answered' for the open question only**: Honest labels with no new infrastructure.
- **Add an online-now count from connections**: Real presence. Needs presence tracking in the session object.
- **Rejoin with the same handle reuses the seat**: Stops double counting. Changes the join model.

Recommendation: Option 2.

| Finding | Severity | Observed |
| --- | --- | --- |
| start-join-09: The joined count only grows, so a participant who leaves and rejoins counts twice | low | Leave session followed by Join on a phone raised the console and stage count from 1 to 2 for one person. Participants also count once connected and never drop when a tab closes. expectedAnswerCount (groups.ts:11) uses all participants, so the stage meter 'answered of joined' cannot reach 100 percent … |
| live-console-09: Joined only counts up and answered is a bare number, so the console cannot say who is still coming | low | The header reads '41 joined · 33 answered' for every question. Joined includes the idle phone and any participant who left; there is no connected-now figure, no 'still to answer' figure and no sign of which question the count belongs to once a question is closed. When the crowd stalls at 33-38 the h … |

### D19: Should an open question's countdown be controllable?

Findings: live-console-08. Cluster: console-run.

- **Leave as an advisory fixed countdown**: Matches liveClock.ts, where zero never closes answering.
- **Add pause, plus and minus 60 and restart commands for closesAt**: Presenter control. New commands and clock state.
- **Start the countdown only when the presenter presses Start**: No countdown while the question is read aloud. Changes the open flow.

Recommendation: Option 1. Say so in the footer text.

| Finding | Severity | Observed |
| --- | --- | --- |
| live-console-08: Per-question timer cannot be paused, extended or reset, and starts the moment the slide opens | low | Slide 3 has timerSec 60. The stage showed '55s' counting down and the footer 'question open · 55s left' as soon as the slide opened; the ribbon had no Clock group (Start, Pause, plus, minus, Reset exist only for timer steps). A presenter who is still reading the question aloud, or who wants 60 s mor … |

### D20: How is the Q&A desk or remote link protected, given it carries a host token?

Findings: qna-cofacilitation-10. Cluster: console-run.

- **Keep the token and warn at the point of copy ('Anyone with this link can run the session')**: Cheap and honest. The link still has presenter power.
- **Mint a moderator-scoped token limited to the moderator commands**: Safe delegation to people outside the space. Server and token work.
- **Remove the copy link and require space membership**: Safest. No outside co-moderator.

Recommendation: Option 1 now. Plan option 2 as a security follow-up.

| Finding | Severity | Observed |
| --- | --- | --- |
| qna-cofacilitation-10: 'Copy Q&A desk link' and 'Copy remote link' hand out a full host credential; no moderator-only link for a co-host outside the space | low | qnaShareUrl puts the host token in the URL (destinations.ts:163-173) and facilitation.md says to treat it as a host credential. The desk comment says it is for a comms person or TA. Anyone with that link can do everything the presenter can (stage, hide, and, via the same token on other routes, end t … |

### D21: Should recap selections survive a changing session?

Findings: groups-after-05. Cluster: recap-results.

- **Keep the contract and say on the page and in the manual that choices clear when the session changes**: No contract change. After the End-session route is fixed, the source stops moving.
- **Keep ticks whose ids still exist after Refresh**: Less rework. Needs a text-match check and amends CONTRACTS.md and UC-33.
- **Drop the whole-session revision check and validate each selected id server-side**: No 409 under load. Amends CONTRACTS.md and the stale-selection tests.

Recommendation: Option 1. The documented design stays and the post-End route removes the conflict.

| Finding | Severity | Observed |
| --- | --- | --- |
| groups-after-05: Review recap fails with 409 while the audience is still active, and Refresh clears every selection | low | Review sends the revision it loaded. Any join, answer or Q&A upvote changes the revision, so with a live crowd 'Review recap' answered 'The session changed. Refresh the available content and choose it again...' (my second session, crowd still upvoting). Refresh then resets resultIds, discussionIds a … |

### D22: What does the PowerPoint pane offer for getting the code to the audience?

Findings: powerpoint-addin-02. Cluster: office.

- **Copy join link and Copy code buttons, hidden in identified sessions, plus one line pointing to the Join slide**: Smallest fix. No product change.
- **Also show the join rail on non-question embedded slides**: Changes the stage model for the add-in only.
- **Offer 'Add join slide to deck' from the pane**: Edits the source deck from the add-in and bends its read-only role.
- **Docs and hint only**: No new buttons.

Recommendation: Option 1. Revisit after decision D5 settles the stage join display.

| Finding | Severity | Observed |
| --- | --- | --- |
| powerpoint-addin-02: Content and title slides show no join code or QR in the embedded display; the pane never mentions the Join slide | medium | With a live session, a bound title slide in Slide Show view renders only 'Welcome to onboarding' (no code, no QR). Question slides get a left rail with code and QR (about a quarter of the frame). The only way to put the code on screen on a non-question slide is to embed a Join slide, which the picke … |

### D23: How are repeated PowerPoint connections handled in Settings?

Findings: powerpoint-addin-06. Cluster: office.

- **Replace an existing connection for the same user, client and origin on re-approval**: No duplicate rows. Touches the OAuth connection insert.
- **Keep rows and add a distinguishing label that is not a timestamp**: Respects No-Ledger. Rows still pile up.
- **Keep behaviour, add a note that reloading needs reconnecting, and document it**: Credential design unchanged. Duplicates remain.

Recommendation: Option 1 plus the note, matching apps/office/README.md:143-145.

| Finding | Severity | Observed |
| --- | --- | --- |
| powerpoint-addin-06: Every pane reload needs a new consent and leaves duplicate, unlabelled connections in Settings | low | The pane keeps no credentials, so each reload shows the welcome screen and a fresh consent dialog; after reconnecting, the picker also returns to 'Choose a space'. Each approval creates a new connection: Settings > Connected applications lists two identical 'OpenRoom for PowerPoint / http://127.0.0. … |

### D24: How does the plugin guide a bitmap-only deck and corporate brand?

Findings: agent-plugin-04. Cluster: docs.

- **Keep the upload boundary and add a skill line: redraw as html or svg and tell the presenter to add their images in the editor. Carry brand through design.theme colours or a brand kit. Inline or link SCHOOL-DESIGN.md.**: No privacy change. Visuals are lost unless the presenter adds them.
- **Let the skill upload the presenter's slide images with approval**: Visuals kept. Changes a privacy boundary.
- **Add a base64 asset upload to MCP for pictures the presenter selected**: Visuals kept with a smaller surface. New tool.

Recommendation: Option 1.

| Finding | Severity | Observed |
| --- | --- | --- |
| agent-plugin-04: Porting a folder of slide PNGs cannot keep the visuals: the skill forbids uploading them and no tool can | low | port-a-deck says 'keep the visuals as freeform elements', 'do not drop a diagram because the deck's copy was a bitmap', and 'Do not upload ... slide images'. An image element needs a URL or assetId. openroom_api 'sends JSON bodies only, so it cannot upload picture or document bytes'; picture_search … |

### D25: Does the shared agent text become audience-neutral, and does corporate training get its own skill?

Findings: agent-plugin-09. Cluster: agent.

- **Neutral wording in server instructions, manifests, tool texts and warnings, plus a short run-a-workshop skill for pacing, check-ins, anonymous input, Q&A and recap**: Agents asked for a corporate session get guidance. Tutoring wording stays in the two tutoring skills.
- **Neutral wording only**: Less work. No training guidance.
- **Keep tutoring-first and state corporate training as out of scope**: No change.

Recommendation: Option 1. The skill file itself is written by the docs cluster.

| Finding | Severity | Observed |
| --- | --- | --- |
| agent-plugin-09: The agent surface speaks to tutors, students, lessons and schools; no skill fits corporate training | low | SERVER_INSTRUCTIONS: 'facilitated classroom interactions and tutor-delivered sessions'. plugin.json, .codex-plugin and README: 'tutor-led sessions', 'classroom', keywords 'tutoring, classroom'. port-a-deck: 'a tutor or dean has a deck to bring into class', school DESIGN.md. make-this-interactive: 'e … |

## Refuted

| Finding | Reason |
| --- | --- |
| training-setup-13: DESIGN.md type-token violations in the editor: raw text-sm, text-xs and text-[12px] | The raw text-sm, text-xs and text-[12px] uses exist (design.tsx:51, design-image.tsx:62-68, SlideOverflowNotice.tsx:6, SlideEmbedDialog.tsx:20-25, WorkshopShell avatar at WorkspaceShell.tsx:198). They are already tracked in docs/qa/2026-11-07-tutoring-ux-open-work.md as editor-authoring-15 ('Editor and host files use type sizes and weights outside the nine tokens'), editor-media-15 and review-next … |
| training-setup-15: One Escape press leaves the live console and drops the presenter into the editor | Reproduced, but it is documented, tested behaviour. LiveHost.tsx:430-449 says that only a bare Escape returns to the deck and that an armed tool, a chart menu or a lookup card takes the key first. The console hint lists 'Esc deck' (HostHeader.tsx:329). The session stays live and 'Rejoin' is one click, so nothing is ended or lost. This is a preference about a deliberate shortcut. |
| start-join-11: A participant who has joined sees the Join slide's QR and code on their own phone | screen.tsx:336 passes the join object to the participant StepView on purpose: the phone mirrors the slide the room sees, including the Join slide, so a participant can show the code to a neighbour. The participant is in the session and nothing is blocked. Taste, not a defect; replacing a mirrored slide with a status line is not clearly better. |
| live-console-03: Space, Reveal the results and H on an open question close answering for everyone, with no way to reopen | The mechanics reproduce: Space on open slide 4 (11 answers) closed answering, drew results, and disabled Close answering, and late answers were rejected. But 'no way to reopen' is false. Re-selecting the slide in the rail, or Back then Next, reopened it ('question open', Close answering enabled, 16 answers kept), because interaction.open reopens a closed or revealed question (interactions.ts:66-82 … |
| stage-wall-06: Correct-answer reveal is a 13px tag; bar colour does not change | The central claim is wrong. In revealed-hd.png the correct mark is a framed '✓ correct' tag at the label size (about 20px on a 1920 wall, bars.tsx:236 CorrectTag, tag-correct), beside the option label, with the correct figure also in the caption '(correct)'. That already meets DESIGN.md 'mark correctness with check plus the word correct, never colour alone'; recolouring the bar is taste. The only … |
| participant-timer-13: A paused step clock stays on the break slide as a 6 px '55s' pill, and Slide view on a phone is unreadable | Both parts are accepted behaviour. OutlineTimerStep.persist defaults to true on purpose (packages/schema/src/outline-types.ts:371-377: 'Keep the clock in the corner when the teacher moves on'), the presenter can turn it off, and step-view.tsx:90-91,133 shows the pill for that reason; a paused clock is one the presenter chose to pause. The small break text on a phone in Slide view is LD8 (docs/qa/2 … |
| qna-cofacilitation-14: Library inspector shows 'Homework · Not written' on a Training-space town hall deck | By design. ItemDetailPanel.tsx always lists Slides, Homework and Recap for a deck. AGENTS.md:154 and :212 define homework and the teaching loop as available in every workspace experience, and the 'Not written' line is a neutral description of the deck contents. Hiding it for Training is a product preference, not a defect. |
| groups-after-07: No way to send results onward: the recap is a file download only, and participants get nothing | The page already says the file is the route: SessionRecapPage.tsx says 'This recap is downloaded to your device; the text you write here is not saved in the space.' and 'The downloaded HTML opens in a browser and can be printed or saved as PDF.' docs/journeys/UC-33 and CONTRACTS.md state the non-goals explicitly: 'There is no automatic upload, public link, messaging, permanent recap record', so a … |
| groups-after-15: Desktop relay console has no Prepare recap | Deliberate and documented in code: HostHeader.tsx:129 and its comment say a server with no remote page for another device (the desktop relay) has no remote or recap page, and navigating there would replace the console with a page that cannot load the session, so the items are left out. The auditor could not open that console and judged from code only. The Desktop document window keeps its own ende … |
| powerpoint-addin-13: Companion and audience-display links put a stage and host token in a URL the pane opens in a new tab | The product already uses these links the same way. apps/workspace/src/destinations.ts:157 builds /sessions/<code>/remote?token=<hostToken> for its own console, and apps/workspace/src/api/sessions.ts:290 builds /stage/?session=<code>&token=<stageToken>. The add-in follows the existing capability-link pattern for a presenter who opens these tabs for themselves. The credential boundary covers orlnk_ … |
| agent-plugin-10: run-a-session never mentions session_recap, a co-facilitator or the Q&A tools | The tool list and descriptions already carry this. session_recap (tools.ts:512) says what it returns, that nothing is selected by default, that the facilitator chooses, and that the document is not saved or published. session_facilitate is in the tool list. AGENTS.md says skills must not restate the API surface and that missing facts go into the tool descriptions. The claim that the recap leaves o … |

## Deferred

| Finding | Reason |
| --- | --- |
| participant-clock-14 | Affects only devices with a wrong clock and needs a server-time offset in the snapshot or SDK wire. Rare, with a protocol change risk. Revisit if wrong-clock reports appear. |

## Not covered

- Native PowerPoint (webview communication, slideshow lifecycle, .pptx save and reopen); only the simulated Office adapter was driven.
- Real phones, real soft keyboards and hosted load; the crowd ran against a loopback runtime.
- Plan limits (the 50-participant cap, team, branding, keep); judged from code only.
- Desktop app, public site and manual as a whole (manual chapters were checked only where a scenario named them).

Gaps named by the coverage critic, not followed up in this pass:

| Gap | Priority | States | Why |
| --- | --- | --- | --- |
| network-loss-and-device-sleep-recovery | high | Real connection loss and slow links on every surface: participant phone on throttled 3G or Slow 4G through a CDP network profile (not Playwright setOffline, which never closed the existing socket); the participant offline banner; a phone locked or backgrounded for 1-5 minutes during an open question … | Hotel and office Wi-Fi with 100-200 people is the normal condition for corporate training. Three auditors tried to take the network down and failed, so the participant offline banner, the stage 'Reconnecting' notice and the presenter's behaviour when the console drops are untested. The participant h … |
| presenter-phone-remote-while-presenting | high | The presenter's own phone remote opened from 'Copy remote link' while the laptop shows the stage in a room or a video call: Next/Back, Reveal, Close answering, Freeze, Hide results, timer Start/Pause/+1 min, the Questions button and its state, the 'Open the Q&A desk' link, notes visibility, a second … | Walking around the room with a phone is the usual way to present to a crowd. Only a co-facilitator's moderator remote and a timer step on the remote were driven. The live-console auditor found Reveal and Freeze missing on a question slide while the console offered them, and did not investigate. The … |
| crowd-200-console-groups-and-qna-desk | high | The presenter's console, Groups pane, Q&A desk and Session notes with 150-200 joined and answering, on a 1280x720 laptop and a 1024x768 projector laptop: console responsiveness while answers stream in, joined and answered counts, Hide on a long text list, forming 10-20 groups from 200 handles, spoke … | The audited headline scale is 20-200, but the live console and Groups pane were only driven with 30-41 participants. The 200-person stage runs flapped under load and the blank frames were dropped as unreproducible. Groups are built by hand-ticking handles, which was already awkward at 40 and may not … |
| named-attendance-and-roster-join | medium | A corporate cohort where the presenter needs to know who attended: identified join, personal link or roster invite, 'Waiting for the presenter to start' before the session begins, the lobby of a session created through the API, a seat link that has expired or been revoked (gone screen), a participan … | Four auditors listed identified, roster, waiting-for-start and gone screens as not exercised, because group sessions started from the UI go live at once and identity mode has no UI control. All of that copy was judged from source only, and several of those strings are the ones that still say tutor a … |
| keyboard-and-screen-reader-live-session | medium | A presenter running the whole live session with the keyboard only: console shortcuts (Space, arrows, H, F), focus after Start session, after closing a dialog and after End session, Q&A desk cards and Hide/Answered buttons, the Groups pane, the Session menu. A participant with VoiceOver on iPhone and … | The setup audit walked the editor by keyboard and found the Present overlay trapping focus the wrong way, but the live console, the Q&A desk and the Groups pane were never traversed by keyboard (the co-facilitation auditor judged them from snapshots). Participant screen-reader behaviour was judged f … |
| repeat-session-edit-between-runs-and-recap-reach | medium | A training deck run for a second cohort: start again from the Library after a first session ended, results of both runs in Saved results, editing a slide (typo fix, reorder, delete a question) while a session is live and again between sessions, two sessions of the same deck live at once, and a sessi … | Every auditor ran a single session per deck, started in one place. The hand-offs between surfaces were not followed end to end: pane-started sessions into the console, Library and recap; a live session whose deck is edited; the second run of the same deck. Recap and Saved results were only checked a … |
