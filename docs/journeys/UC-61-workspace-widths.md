# UC-61 — Workspace pages at phone and laptop widths

Status: green on local Chromium when added (not re-run since).

Purpose: Add student, Space settings, Sample lessons, a session's Notes and
Review learner work fit a 390 px window with no sideways scroll. The Library
keeps its 980 px minimum and says so in one line. From 980 px its tree, list and
inspector sit side by side. A student's own space opens as that student's view
with a quiet Notes group. The deck editor keeps its three panes at 1280 px,
collapses the task pane to an overlay at 900 px, and at 600 px shows a notice
while Present and Start session still work.

Fixture: demo account bob (cookie re-added without `Secure`). A tutoring
student "Noor {stamp}" with two decks of the same title "Au café {stamp}", each
with a session and a saved record. A second test creates a two-slide deck,
"Widths {stamp}", with no student.

Surfaces: five workspace pages at 390 × 844, then the Library at 390 and at
1000 × 800:

- Add student: `/host/#/tutor/students/new?experience=tutoring`
- Space settings: `/host/#/space/{spaceId}/edit`
- Sample lessons: `/host/#/space/{spaceId}/samples?studentId={id}`
- Notes: `/host/#/sessions/{sessionId}/record`
- Review learner work: `/host/#/tutor/students/{id}/work`
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
  `studentId={id}`, the level 1 heading is the student's name, and the notice is
  hidden.
- The region "Notes" lists two links, in order: "Au café {stamp}" and "Au café
  {stamp} · 2". The second title is told apart by its ordinal.
- After selecting the first deck, the inspector "{title} details" is visible.
  The tree (navigation "Folder tree") ends at or before the list, the list ends
  at or before the inspector, and the inspector starts above the bottom of the
  list.

Deck editor (`/host/#/decks/{id}/edit`, 1280 × 800, then 900 × 800, then
600 × 800):

- At 1280 the rail ("Slides" list) ends at or before the slide canvas, the
  canvas ends at or before the task pane, "Close task pane" is in the viewport,
  there is no "Slide pane" button, and the page does not scroll sideways.
- At 900 the task pane is closed, "Slide pane" has `aria-expanded="false"`, the
  rail and canvas are visible, and the page does not scroll sideways. "Slide
  pane" opens the pane (`aria-expanded="true"`) and the pane starts left of the
  canvas's right edge. The second rail row can still be selected. Escape from
  "Close task pane" closes the pane.
- At 600 the line "Open this deck on a larger screen to edit it." is in the
  viewport, the slide canvas is gone, the page does not scroll sideways, and
  Present and Start session are in the viewport. Present opens the dialog
  "Presenter". After a reload, Start session sends `POST …/launch` with 201 and
  the presenter shows "End session".

Visual notes: the spec saves screenshots to the test output without comparing
them.

Playwright: `e2e/journeys/UC-61-workspace-widths.spec.ts`.
