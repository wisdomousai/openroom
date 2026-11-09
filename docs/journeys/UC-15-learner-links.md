# UC-15 — Learner links: private work and replacement

Status: green on local Chromium, including a 390px learner viewport.

Purpose: a tutor gives each learner of a student their own access link. Each
learner keeps their own writing and practice, also when the tutor replaces a
lost link. A link grants no workspace role or learner account.

Fixture: one student (kind group) with one
taught session, a writing task and a choice exercise in its record; Léa and Noor
are two learners of that student, each with a link created by the tutor.

Surfaces: dedicated link creation page, access links list with Revoke, learner
page (Lesson, Practice, Feedback).

Lifecycle: create a link for Léa and one for Noor → Léa writes, saves and
practices → switch the same tab to Noor's link → create a replacement link for
Léa → revoke her old link → open the old link, then the replacement → force a
failed load, a failed lesson tab, a rate limit, a refused save and a link
refused while the page is open.

Acceptance:

- Noor sees neither Léa's writing nor her practice progress.
- Same-tab hash navigation clears the previous learner's cache and form state.
- Revocation denies the old link; replacement retains Léa's work and practice.
- The learner page has no host navigation, account gate or tutor-private notes.
- The phone page fits without horizontal scrolling.
- Only a refused link (401) shows "This link no longer works", also when a
  later request is refused while the page is open. A network failure or server
  error on first load shows "Your page could not be loaded" with Try again; a
  failed Lesson or Feedback tab shows its own sentence with Try again; a rate
  limit on a tab says to wait a minute.
- A refusal after the page has loaded, from a tab or from a save, practice
  answer, recording send or recording removal, shows the dead-link sentence
  above the tasks. The tasks stay on screen with saving and sending off, so
  unsaved text can still be copied and an unsent recording downloaded.
- Worker tests separately prove stable live-seat identity, student isolation,
  cookie/PAT separation and current credential denial.

Visual notes: Lesson, Practice and Feedback use quiet mobile chrome with readable
text and touch targets. Link expiry/revocation remains in the credential card.

Playwright: `e2e/journeys/UC-15-learner-links.spec.ts`.
