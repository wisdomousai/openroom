# UC-23 — Selected practice in the next lesson

## Purpose and fixture

A tutor chooses what to teach again from original learner responses. Copying an
exercise preserves its format and answer key, while the learner's identity and answer
stay in the private preparation view.

The fixture has Léa's French choice exercise (`choice`) with the second option correct,
her German gaps (`gap`) with accepted variants, and Noor's open answer (`opinion`).
The tutor edits the published French prompt after Léa answers, then opens a new deck.

## Surfaces and lifecycle

Use the deck editor's Notes pane, its rendered slide, the live presenter, session Notes
and an isolated learner browser. A failed pickup request exposes retry. Expand selected
exercises, add a slide and two homework tasks, and inspect the saved draft. Start the
next deck, present its question, write a private live note, end and publish homework.

## Acceptance

- The preparation view shows the original question, answer and complete key.
- Each exercise is selected explicitly for a slide or homework; no bulk import.
- Slides use the appropriate template; their question remains visible as the heading.
- Copies retain type, options, keys, gaps, accepted variants and text-matching rules.
- Copies have distinct IDs, can be edited independently, and survive YAML saves.
- Names, learner IDs, response text and original session IDs do not enter the deck.
- Starting promotes the current draft; the next session uses the chosen exercises.
- Ending the browser presenter opens Notes, preserving private scratchpad text.
- Publishing Notes sends the new tasks and keys to learners without private notes.
- Editor write fuzz classifies and walks both insertion paths; focused tests cover
  every supported practice type and open answers with no invented key.

## Visual notes and Playwright map

The permanent task pane owns the private learner context. Expandable exercise previews
show the answer and key before the two copy actions. They remain keyboard reachable;
success and load failure have accessible status text. Copied slides use saved deck design.

`e2e/journeys/UC-23-practice-next-lesson.spec.ts`.

Status: green in local Chromium on 2026-09-18 (6.8 seconds). The complete journey
includes pickup retry, deliberate selection, saved keys, current-draft promotion,
presentation, private scratchpad handoff and published homework. The final editor
screenshot was inspected: the original question leads, with the task title beneath it.

The journey exposed a real presenter handoff defect: the return-to-editor callback
suppressed Notes navigation after ending. That callback now serves explicit editor
return while normal ended-session routing uses the existing browser/Desktop exit policy.
UC-10 passed normal presenter/editor return after the fix. UC-17 and UC-22 passed with
the new pickup contract. Two early journey failures were test selector/route assumptions;
another run correctly caught a stale pre-rebuild slide heading.

Six focused practice-copy tests cover all five formats plus open answers, independent
copies and YAML saves. Four editor fuzz tests and ten exit-policy tests passed. Worker
context-link suite: 36 passed. Host/Worker/MCP typechecks and host/MCP/asset builds passed.
The fuzz suite first hit a five-second default under concurrent local load, then passed
unchanged in 2.7 seconds; its coverage and timeout were not reduced. No deployment or
native Desktop acceptance is implied.
