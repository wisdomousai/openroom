# UC-61 — Workspace pages at phone and laptop widths

Status: green on local Chromium when added (not re-run since).

Purpose: Add student, Space settings, Sample lessons, a session's Notes and
Review learner work fit a 390 px window with no sideways scroll. The Library
keeps its 980 px minimum and says so in one line. From 980 px its tree, list and
inspector sit side by side. A student's own space opens as that student's view
with a quiet Notes group.

Fixture: demo account bob (cookie re-added without `Secure`). A tutoring
student "Noor {stamp}" with two decks of the same title "Au café {stamp}", each
with a session and a saved record.

Surfaces: five workspace pages at 390 × 844, then the Library at 390 and at
1000 × 800:

- Add student: `/host/#/tutor/contexts/new?experience=tutoring`
- Space settings: `/host/#/space/{spaceId}/edit`
- Sample lessons: `/host/#/space/{spaceId}/samples?contextId={id}`
- Notes: `/host/#/sessions/{sessionId}/record`
- Review learner work: `/host/#/tutor/contexts/{id}/work`
- Library: `/host/#/space/{spaceId}`

Lifecycle: create the student and two decks with records → visit each page at
390 wide → open the Library at 390 → widen to 1000 → select the first deck.

Acceptance:

- On each of the five pages at 390 wide a level 1 heading in `main` is visible,
  the notice is not shown, and the page does not scroll sideways (scroll width
  at most the client width plus 1).
- The Library at 390 shows the notice "This page is made for windows at least
  980 px wide. Widen the window to see all of it." and the notice is in the
  viewport.
- At 1000 × 800 the student's space opens as the student's view: the URL has
  `contextId={id}`, the level 1 heading is the student's name, and the notice is
  hidden.
- The region "Notes" lists two links, in order: "Au café {stamp}" and "Au café
  {stamp} · 2". The second title is told apart by its ordinal.
- After selecting the first deck, the inspector "{title} details" is visible.
  The tree (navigation "Folder tree") ends at or before the list, the list ends
  at or before the inspector, and the inspector starts above the bottom of the
  list.

Visual notes: the spec saves screenshots to the test output without comparing
them.

Playwright: `e2e/journeys/UC-61-workspace-widths.spec.ts`.
