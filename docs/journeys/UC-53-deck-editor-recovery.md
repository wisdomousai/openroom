# UC-53 — The deck editor recovers instead of dead-ending

Status: green on local Chromium.

Purpose: when something goes wrong in the deck editor, the host gets a plain
message and a next step. History reopens any version, a stale tab offers a
choice, a reload during a lesson shows the live session, a missing deck says so,
the picture dialog checks input before Insert, the dictionary offers the
language pair and a retry, and the homework page names its student.

Fixture: demo account bob. Decks are made through `/api/decks`. Seven tests:

- "Recovery deck", with a title slide that has the text "First version", then a
  stamped v2 "Second version".
- "Recovery deck" opened in a tab, then stamped elsewhere ("Stamped
  elsewhere", then "Third version").
- "Live lesson", a one-slide deck.
- A deck id that does not exist.
- "Pictures", with `https://pictures.test/cat.png` stubbed to return a PNG and
  every other address in that host stubbed to return 404.
- "Bonjour Paris", with `/api/tutoring/dictionary` stubbed first to 422
  `languages-not-configured`, then aborted as offline.
- A tutoring student "Camille" and a deck "Homework deck" with a fill-the-gaps
  question, a ranking without a correct order, and a homework quiz task whose
  question is empty; and a deck "Match deck" with a match "Match the animals"
  (chat/cat, chien/dog).

Surfaces: deck editor at `/host/#/decks/{id}/edit`: canvas, History, Notes,
Insert and Theme tabs, Presenter dialog, picture dialog, dictionary menu,
homework pane, status footer.

Lifecycle: per test, create the deck, open it, and drive the editor; the stamp
steps use `POST /api/decks/{id}/versions`.

Acceptance:

History:

- With v2 open, its row says "latest · open" and has no "Restore" button.
- "Restore" on v1 shows "First version" on the canvas and v1 says "open".
- "Restore" on v2 shows "Second version" again and v2 says "latest · open".
- After typing a note on the Notes tab, the page shows "Saved with the deck.
  Students never see these notes." Restore on v1 then opens the group "Restore
  v1" with "Replace the open draft with v1? Your unsaved edits are not kept."
  "Replace draft" shows "First version".

Stale tab:

- After another tab stamps a version and the host edits notes, an alert shows
  "This deck was changed somewhere else since you opened it."
- "Use saved version" removes the alert and shows "Stamped elsewhere". The
  stored draft has `baseVersion` 2.
- With nothing unsaved, stamping v3 and returning to the tab (visibilitychange)
  shows "Third version" without a banner.

Live session after a reload:

- "Start session" launches (201) and opens "Presenter". After a reload,
  `[data-deck-live-now]` contains "Live now".
- A second "Start session" opens the dialog "This deck is live now" with "A
  session of this deck is still running." "Cancel" closes it.
- "Rejoin" in Live now goes to `#/sessions/{code}`.

Missing deck:

- `#/decks/does-not-exist/edit` shows the heading "This deck is not available"
  and a "Library" link, and does not show "Loading…".

Picture dialog (Insert tab, "Picture", dialog "Choose a picture"):

- On "From a link", "hello world" in "Picture address" shows the alert "Enter a
  full address that starts with https://." and "Insert" stays disabled.
- `https://pictures.test/broken.png` shows "This address does not return a
  picture." and "Insert" stays disabled.
- `https://pictures.test/cat.png` shows the link preview and enables "Insert".
  The note reads "This picture stays online. Upload it into this space before
  you use Save a copy."
- On "Upload", a text file named notes.png shows "This file type cannot be
  uploaded here." and "Insert" stays disabled.
- A real cat.png shows "cat.png", "Uploaded to this space." and a "Replace"
  button, and enables "Insert". After Insert the canvas shows an image.

Dictionary:

- Right-click "Bonjour" and "Look up “Bonjour”" with no language pair shows
  "Choose the language you teach and the one your students speak." and
  "Save and look up" is disabled.
- Looking up "Paris" while offline shows the alert "OpenRoom could not be
  reached." within 3 seconds, with "Try again". Switching to the "Theme" tab
  removes the alert.

Homework:

- The readiness note contains "Complete the homework quiz before starting".
  "Show the question" opens the region "Homework document" with the recipient
  line "For Camille · shared when you save Notes after the lesson" and focus on
  "Quiz question". The footer contains "Homework · one task". The pane shows
  "These tools work on slides. Select a slide in the rail to use them."
- The "A question in this deck" combobox lists the option "Je ____ le train."
  and lists "Rank the trips (needs a correct order)" with `aria-disabled` true.

Match pairs:

- The pane field "Answer paired with chat" has the value "cat". Selecting the
  first option part shows no "Mark correct" or "Correct" button.
- Entering "kitten" saves the draft (status `saved`). The stored draft has the
  right item r1 labelled "kitten", r2 still "dog", and the correct map
  unchanged.

Visual notes: the spec saves screenshots of each state to the test output
without comparing them.

Playwright: `e2e/journeys/UC-53-deck-editor-recovery.spec.ts`.
