# 1:1 tutoring UX build — open work

The audit and layout reports are docs/qa/2026-11-06-tutoring-ux.md and docs/qa/2026-11-06-slide-layout.md; the resolved decisions are in docs/qa/2026-11-07-tutoring-decisions.md. On 9 November 2026 every deferred finding was checked against the code. All are fixed, except the items below.

## Decisions made on 9 November 2026

- learner-page-07: a writing or voice task the tutor changed refreshes in place and keeps the student's unsaved work.
- learner-page-08: practice buttons read Next, Show this again later, Change my answer and Show the answer.
- notes-homework-07: Notes for a student with no access link warn above Save and link to creating one; Save still works.
- AT-F12 / GP-F08: positioned boxes are drawn clamped inside the slide. Overlap with the title, logo or footer stays a warning and is not moved.
- review-next-15: one-person wording for a single student, group wording only for groups.
- review-next-10: the person-view button that opens the members page is named Members.

## Still open

- Voice task changed: the 409 path on a voice task (notice, kept recording, send with the new revision) has no e2e or component test. UC-17 covers writing only.
- UC-15 spec: the test is still named for group learners and creates a group student. The contract describes the steps without the group framing.
- review-next-15: Learner work cards repeat the student's name as the heading.
- GP-F06: the two overflow-detector false negatives in the layout report were not re-checked after the false positives were fixed.
- Relay unit tests (hibernation, participant names, retention) and the editor's outline-fuzz and template walks time out when the machine also runs browser journeys. They pass on their own.
- Withdrawing shared feedback (review-next-02) is a separate feature request, not built.
