# UC-60 — Rejoin a running lesson

Status: green on local Chromium when added (not re-run since).

Purpose: while a session of a deck and its student is live, the Library
inspector, the editor top bar and the Presenter offer Rejoin beside Start
session, so the host does not start a second session by accident.

Fixture: demo account bob (cookie re-added without `Secure`), window 1280 × 800.
A tutoring student "Léa {stamp}" and a deck "Au café {stamp}" linked to that
student, with one title slide. The session is started from the Library
inspector. At the end the spec ends the session through the `facilitate`
endpoint and `session.end`.

Surfaces: Library inspector at
`/host/#/space/{spaceId}?contextId={id}&itemId={deckId}`, deck editor top bar,
Presenter dialog.

Lifecycle: open the inspector with nothing live → Start session → return to the
Library → Start session again and choose Rejoin → open the editor → Start
session and Cancel → Present → Start session and Escape → end the session.

Acceptance:

- With nothing live, the inspector ("{title} details") shows "Start session"
  and no "Live now".
- Start session goes to `#/sessions/{code}`.
- Back in the Library, the inspector shows "Live now" and a "Rejoin" button.
- "Start session" opens the dialog "This deck is live now" with "A session of
  this deck with {student} is still running." "Rejoin" in the dialog goes to
  `#/sessions/{code}`, and the deck's live sessions are still only that one.
- The editor top bar shows the student's name in `[data-deck-student]`, and
  `[data-deck-live-now]` contains "Live now" and a "Rejoin" button.
- In the editor, "Start session" opens the same dialog and "Cancel" closes it.
- The Presenter shows "Rejoin" in its Live now area. "Start session" opens the
  dialog, and Escape closes the dialog and keeps the Presenter open.
- The deck still has exactly one live session after all of this.

Playwright: `e2e/journeys/UC-60-live-rejoin.spec.ts`.
