# UC-22 — Practice through retries and assignment changes

## Purpose and fixture

A learner answers French and German exercises on a phone while the tutor revises
homework. Failed network responses and changes must not reinterpret or duplicate work.
The fixture starts a deck with a learner context and publishes a keyed text exercise
(`practice`). Later tasks exercise withdrawal and continuation (`removed`, `remaining`).

## Surfaces and lifecycle

Use a signed-in tutor API client and a separate 390px learner browser. Start the deck,
publish homework, create a personal link and answer in Practice. Let the server save an
attempt but drop its response. Revise the assignment, retry, then answer the next version.
Revise again during an answer, refresh the practice query through tab navigation, and
deliberately load the updated exercise. Finally withdraw an exercise and continue.

## Acceptance

- A lost response leaves the answer visible. Retry sends the same attempt ID and payload.
- An accepted retry succeeds after the tutor edits the assignment; it saves only once.
- Tutor pickup still shows the original question and original answer.
- Background refresh preserves the question and answer currently displayed.
- A stale write conflicts without saving; explicit refresh resets to the current exercise.
- Failed refresh keeps its retry action. An unavailable exercise allows continuation.
- Completed current exercises remain completed after reload; no horizontal phone overflow.
- Worker tests separately prove transactional revision/state races, immutable snapshots,
  recipient and credential boundaries, content-change resets and permanent purge.

## Visual notes and evidence

The existing Lesson / Practice / Feedback frame stays intact. Exercise controls retain
44px touch targets; revision copy sits beside the retained answer and explicit refresh.
The phone revision screenshot was inspected without clipping or horizontal overflow.

Green in Chromium on 2026-09-18:
`e2e/journeys/UC-22-practice-revisions.spec.ts` (3.4 seconds).
UC-16, UC-19 and both UC-20 journeys also passed in the same run (five tests total).
Worker context-link suite: 36 passed, including deliberate write interleavings and purge.
The broader Worker context-link/tutoring/workspace run passed 64 before those final
three tests were added. Host suite: 345 passed. Focused schema/package tests: 22 passed.
Host/Worker typechecks, schema/host build and Worker asset collection passed.
This is local Chromium evidence; no deployment or other-browser claim is implied.
