# UC-54 — Insert dialogs, pictures and the task pane in the deck editor

Status: green on local Chromium.

Purpose: the deck editor's insert dialogs fit their dialog, pictures can be
added and described, words on the slide can be looked up and formatted, the
task pane and rail answer the keyboard, and a list slide that does not fit can
move its hidden items to a new slide.

Fixture: demo account alice. Each test makes a deck "Insert deck" through
`/api/decks` and opens it in the editor. Tests use a title slide "Dialogs" or
"Pictures"; a title slide "Je rate le train" with `/api/tutoring/dictionary`
stubbed to return "to miss" for "rate"; a steps slide "Plan" (Read, Write,
Speak) with three reveal groups; a room-audio slide "Listen"; a steps slide
"Reading routine" with 12 items "Read paragraph N aloud"; an activity slide
"Build the tallest tower" with materials Worksheet A, Pencil, Dictionary; and
three slides (title "Opening", a blank slide with an html element, title
"Closing").

Surfaces: deck editor: ribbon tabs Home, Insert, Slide and Theme, canvas,
"Ask" and "Choose a picture" dialogs, task pane (`.deck-editor-properties`),
slide rail.

Lifecycle: per test, open the deck, drive the editor, and read the saved draft
over `GET /api/decks/{id}/draft` where the test checks a saved value.

Acceptance:

Dialogs (1280 × 720, then 390 × 844):

- On the Home tab, "Ask" opens the dialog "New question". Its "Insert" button
  and the text starting "Lands as one slide" lie inside the dialog.
- On the Insert tab, "Picture" opens "Choose a picture". "Insert" lies inside
  the dialog.
- The tablist "Where the picture comes from" starts with "Stock photos"
  selected. ArrowRight selects "This space".
- At 390 wide, "Insert" and "Cancel" are still inside the dialog, each source
  tab is at most 34 px tall, and the label "Credit the photographer on the
  slide" is at most 24 px tall.

Image + text:

- On the Slide tab, "Image + text" opens "Choose a picture". Cancel leaves an
  empty frame with an "Add picture" button.
- "Add picture" opens the dialog. Uploading cat.png on the "Upload" tab shows
  "Uploaded to this space." and "Insert" closes the dialog. The frame then
  shows an image and no "Add picture".
- The pane has "Alt text" with an empty value and a label that contains "Alt
  text". After entering "A grey cat on a chair" and choosing "top" in the group
  "Crop focus", the saved draft has an image element `pic` with that alt text
  and `focal` "top".

Words on the slide:

- Right-click on "rate" and "Look up “rate”" show "to miss" in the task pane.
- Selecting "train" in the heading shows a "Bold" button. Ctrl or Cmd+B and a
  click away save `titleSpans` that include "train" with `bold` true.

Task pane:

- The tablist "Ribbon" is visible. The tablist "Task pane" has "Design"
  selected. ArrowRight selects "Theme" and ArrowLeft selects "Design".
- The pane has buttons "Merge step 2 with step 3", "Show Item 1 as its own
  step", "Move Item 3 earlier" and "Move Item 3 later".
- "Close task pane" removes the pane.

Listening mode:

- In the group "Listening mode", "Room audio" has `aria-pressed` true. Its
  background colour differs from "Individual listening". "Room audio" has one
  icon and "Individual listening" none.
- After choosing "Individual listening" it has `aria-pressed` true and one
  icon.

Overflow:

- "Review overflow" opens the region "Slide overflow", which contains "move the
  items that do not fit to a new slide" and not "resize its box".
- The button "Move Item N and the rest to a new slide" (N above 1) leaves two
  slides in the "Slides" list and no `[data-slide-overflow]` marker.
- The saved draft has two steps titled "Reading routine" with item counts N-1
  and 12-(N-1).

Material lines:

- The first material line reads "Worksheet A" and no line has
  `data-empty="true"`.

Rail and Slide tab at 1440 × 900:

- The second row contains "Drawing" and draws one `.outline-step__element--html`.
- With the first row selected, ArrowDown focuses the second row and sets
  `aria-current` true. ArrowUp returns to the first.
- On the Slide tab the buttons "Match", "Break" and "Breakout" end within 1440 px.
- On the Theme tab the pane has one heading starting "Logo · " and one
  starting "Background · ".

Visual notes: the spec saves screenshots to the test output without comparing
them. Geometry checks are the assertions above.

Playwright: `e2e/journeys/UC-54-editor-insert-and-panes.spec.ts`.
