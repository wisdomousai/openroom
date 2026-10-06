# UC-13 — Saved design across presentation surfaces

Status: green on local Chromium.

Purpose: a teacher chooses a visual identity once and gets the same deck in the
editor, live presentation and participant view.

Fixture: a new deck with a content slide and a choice interaction. The journey
authors a 16:10 deck, a gradient master and saved typography/color settings.

Surfaces: full-bleed editor, local presenter, live question, 390px participant phone,
and 1280×720 participant browser with the rejoin notice still visible.

Lifecycle: create deck → edit Theme → save draft → reload → present/start →
navigate to question. A second case opens French/German content on a phone.

Acceptance:

- Authored aspect ratio, master and background survive reload.
- Content and live questions use the same saved master.
- A phone opens a readable reflow view and can switch to the authored slide.
- French/German content remains complete and legible at the tested viewport.
- The desktop slide retains its aspect ratio and usable height before the
  participant dismisses the rejoin notice.

Visual notes: deck backgrounds are authored content. Application controls remain
separate; slide composition comes from the shared renderer.

Playwright: `e2e/journeys/UC-13-deck-design.spec.ts`.

Limits: this is not a six-family/by-three-ratio visual matrix, and does not prove
offline design assets or every standalone stage annotation coordinate.
