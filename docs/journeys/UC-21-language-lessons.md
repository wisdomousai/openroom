# UC-21 — Complete French and German lessons

A tutor opens the current folder, chooses a French or German sample at A1–B2,
and gets an ordinary editable deck in that folder. A sample has usable activities,
private teaching guidance and self-contained homework, rather than placeholder text.

## Acceptance

- The gallery offers all eight lessons and filters by language and level.
- Location and optional context come from the URL. The displayed folder path, reload,
  return link and created deck agree. No default learner is invented.
- Opening a sample creates a copy and enters the full-bleed deck editor. It carries
  its design, masters, questions, answer keys, private notes and homework.
- Source samples remain unchanged when a tutor edits their copy.
- Reading homework contains its source passage; learners need no access to the deck.
- French and German lesson slides fit the editor, with readable previews in the gallery.
- A presenter-only member cannot add a sample; service authorization remains authoritative.

## Fixture and lifecycle

`examples/tutoring/*.yaml` supplies eight decks. The browser journey uses a tutoring
context with a child folder, filters the gallery, opens a lesson, checks the saved
file, publishes its homework and opens a personal learner link.

## Visual notes

The catalog shows actual title-slide previews, language/level, lesson purpose and aims.
There are no activity dates, usage counters or delivery-status labels. The document
has saved color and master backgrounds; application chrome retains its own appearance.

## Evidence and status

Green in Chromium on 2026-09-18. Both journeys in
`e2e/journeys/UC-21-language-lessons.spec.ts` pass: French B1 and German B2,
including all twelve slides in each editor, preserved folder/context, publication
and self-contained phone homework. Gallery, French reading and German discussion
screenshots inspected. On 19 September, [UC-39](UC-39-first-tutoring-lesson.md)
extended this to all eight lessons: all 96 editor/live slides, all 16 submitted
questions, revealed results and saving Notes. The learner results fit 320 and 390
pixel browser viewports. Physical-device and real-class teaching remain separate
acceptance work.

Eight source/answer-key tests, locale negotiation and route contracts pass (17 tests).
Host typecheck/build and Worker asset build pass. The gallery loads its lesson
catalog only when opened. No live deployment or classroom trial is implied.
The final run also passed UC-12 and both UC-21 journeys after separating the authored
lesson estimate from activity timers (three tests, 26.2 seconds).
