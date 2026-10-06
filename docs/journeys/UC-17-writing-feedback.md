# UC-17 — Private drafts, published feedback and resubmission

Status: green on local Chromium, tutor desktop and learner phone.

Purpose: the tutor can review exactly what was submitted, prepare feedback privately,
then share corrections with the right learner without changing previous responses.

Fixture: a group with Léa and Noor, a French writing prompt and an agreement correction.

Surfaces: Library → writing collection → dedicated review page; learner Lesson,
Practice and Feedback tabs.

Lifecycle: write → switch tabs → submit → save tutor draft → publish → edit the
draft again → learner resubmits → open latest response → inspect original response.

Acceptance:

- Unsaved writing survives switching learner tabs.
- A tutor draft is absent from the learner's response and UI.
- Published feedback and structured corrections appear only for their learner.
- Editing the draft after publication preserves the previously shared feedback.
- Returning to writing refreshes the collection and opens the latest response.
- A resubmission retains the earlier body, task and feedback.
- Switching the learner tab to Noor shows none of Léa's feedback.
- The tutor selects a published correction from the deck editor's Notes pane and
  inserts an editable comparison slide. Its words, explanation and reveal order
  persist; the learner name, original full response and private draft are absent.
- Worker tests separately exercise idempotent submission IDs, correction ownership,
  optimistic feedback concurrency and stale assignment rejection.

Visual notes: task and response sit beside feedback on desktop. The phone shows
feedback, quoted words, suggested wording and an explanation without host chrome.
Collections carry no delivery timestamps, version stamps or activity tally.

Playwright: `e2e/journeys/UC-17-writing-feedback.spec.ts`.

Limits: this journey covers writing. Voice feedback and per-person assignment
audiences remain separate work.
