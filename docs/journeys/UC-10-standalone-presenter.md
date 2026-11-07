# UC-10 — Standalone presenter

Status: green on local Chromium.

Purpose: a presenter makes a blank deck without a student or class, presents
it with a live session, goes back to editing, saves a copy and finds the deck
in the library.

Fixture: demo account alice (cookie re-added without `Secure`). A new blank
deck, renamed "Presentation {stamp}". A draft is written through
`PUT /api/decks/{id}/draft` with two slides: a title slide "Opening" and a
steps slide "Three rules" with items "First rule", "Second rule", "Third rule"
and four reveal groups (header, cell-0, cell-1, cell-2).

Surfaces: deck editor at `/host/#/decks/new`, Presenter dialog with its stage
mirror, the editor File tab, the library.

Lifecycle: open `#/decks/new` → rename → write the draft over the API and
reload → Present → ArrowRight twice → Start session → advance in the stage
mirror → Edit deck → File tab, Save a copy → Back to the library.

Acceptance:

- Opening `#/decks/new` redirects to `#/decks/{id}/edit`. The "Slides" list
  has one button. The deck's `studentId` is null.
- After "Rename deck" and Enter on "Deck title", the draft status is `saved`.
- The draft write returns 200.
- Present opens the dialog "Presenter". Two ArrowRight presses show "reveal 2/4".
- "Start session" turns into "End session". In the stage mirror cell-0 is
  visible and cell-1 is absent.
- After clicking the mirror and pressing ArrowRight, cell-1 is visible.
- In cell-0 the phrase text does not overflow its box by more than 2 px, in
  width or height.
- "Edit deck" closes the dialog and the canvas header contains "Three rules".
- On the File tab, "Save a copy" downloads an `.openroom` package whose source
  contains "Second rule" and the deck title.
- The "Back" link returns to the navigation "Workspace", and the library lists
  the deck by its title.

Visual notes: the spec saves screenshots `live-presenter.png` and
`library.png` to the test output without comparing them.

Playwright: `e2e/journeys/UC-10-standalone-presenter.spec.ts`.
