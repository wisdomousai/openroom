# UC-12 — Workspace experiences

Status: green on local Chromium.

Purpose: a host creates a space as tutoring, classroom or training, opens its
sample deck, returns to the same place, and switches the experience without
changing the deck.

Fixture: demo account alice (cookie re-added without `Secure`). The spec runs
the same steps for `tutoring`, `classroom` and `training`, each with a new
space named "{experience} {stamp}".

Surfaces: `/host/#/space/new`, the library shell, the sample deck editor, Space
settings.

Lifecycle: fill "Space name" → choose the experience radio → "Create space" →
reload → "Open sample deck" → "Back" → "Switch space" menu, "Space settings" →
choose the other experience → "Save experience" → reload.

Acceptance:

- After "Create space" the URL is `#/space/{id}` and the shell has
  `data-workspace-experience` equal to the chosen experience. "Switch space"
  shows the space name. The attribute is the same after a reload.
- Navigation "Workspace" shows the link "Add student or group" for tutoring and
  "Add class" for classroom. For training it shows no "Add student" or "Add
  class" link.
- "Open sample deck" goes to `#/decks/{id}/edit`. The deck belongs to the space,
  its `studentId` is null and its content has 5 steps.
- "Back" returns to the same experience and the library lists the sample deck.
- Space settings shows the heading "Space settings". Choosing another
  experience (tutoring for a training space, otherwise training) and "Save
  experience" changes the shell attribute, and it stays after a reload.
- The deck content is unchanged after the experience change.

Visual notes: the spec saves a library screenshot per experience to the test
output without comparing it.

Playwright: `e2e/journeys/UC-12-workspace-experiences.spec.ts`.
