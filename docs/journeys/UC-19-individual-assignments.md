# UC-19 — Shared and individual homework

A tutor teaches a group, shares common outcomes and reading, and gives each learner
the practice, writing or voice task they need. The Notes page edits this session's
published assignments. The reusable deck contains no learner identities.

## Acceptance

- Every task defaults to everyone in the context. Selected learners requires at least
  one named learner from that context; no first person is selected automatically.
- The choice survives reopening Notes. Tutors can revise instructions and recipients.
- A learner's Lesson and Practice include only shared tasks and their own assignments.
  Other learners, recipient lists, tutor notes and private next steps are never exposed.
- Filtering applies before practice grading, writing submission and voice upload.
- Changes to instructions or recipients advance the assignment revision. Stale writes
  conflict; earlier responses keep the original task snapshot.
- A notes-only API update preserves individual recipients. Invalid stored restrictions
  fail closed. Recipient IDs stay out of the reusable deck.
- Switching personal links in one tab clears the previous learner's data and form state.

## Fixture and lifecycle

A French conversation deck has shared reading, a writing prompt, voice prompt and
short-answer practice. Start it, create Léa and Noor's links, then publish through
Notes. Complete Léa's writing, switch to Noor, reopen Notes and revise an assignment.
Host Notes and the isolated 390px learner view are the observed surfaces.

## Visual notes

Each task groups its instructions and recipients. Named choices have full-width labels
and touch targets. Learner work remains in Lesson, Practice and Feedback without host
navigation. Screenshots cover the recipient editor and phone lesson.

## Evidence and status

Green in Chromium on 2026-09-18 (4.9 seconds):
`e2e/journeys/UC-19-individual-assignments.spec.ts`.
Worker context-link/tutoring/workspace suites passed 62 tests. Two audience schema
tests cover filtering, validation, canonicalization and fail-closed behavior.
Host/Worker typechecks and schema/MCP/host/asset builds passed. No deployment implied.
