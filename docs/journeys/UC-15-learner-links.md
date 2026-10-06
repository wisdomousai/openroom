# UC-15 — Private group work and replaceable access links

Status: green on local Chromium, including a 390px learner viewport.

Purpose: each member of a tutoring group keeps their own work even when a tutor
replaces a lost link. A link grants no workspace role or learner account.

Fixture: one group, one taught deck, a writing task and a choice exercise; Léa and
Noor have separate tutor-authored identities and credentials.

Surfaces: dedicated link creation, Library access-link disclosure, learner page.

Lifecycle: create both links → Léa writes and practices → switch the same tab to
Noor → mint a replacement for Léa → revoke the old link → reopen with the new link.

Acceptance:

- Noor sees neither Léa's writing nor her practice progress.
- Same-tab hash navigation clears the previous learner's cache and form state.
- Revocation denies the old link; replacement retains Léa's work and practice.
- The learner page has no host navigation, account gate or tutor-private notes.
- The phone page fits without horizontal scrolling.
- Worker tests separately prove stable live-seat identity, context isolation,
  cookie/PAT separation and current credential denial.

Visual notes: Lesson, Practice and Feedback use quiet mobile chrome with readable
text and touch targets. Link expiry/revocation remains in the credential card.

Playwright: `e2e/journeys/UC-15-learner-links.spec.ts`.
