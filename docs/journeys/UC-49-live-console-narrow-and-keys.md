# UC-49 — Live console at portrait widths, from the keyboard, and long charts on the Stage

Status: green on local Chromium.

Purpose: the host console keeps a readable slide on a portrait tablet and a
usable header on a phone, every live control answers the keyboard, long chart
labels stay inside the Stage plate, and a failing notes screen offers a way
back.

Fixture: demo account bob for the signed-in tests, otherwise sessions made
through the admin API. Eight tests:

- "Keyboard lesson": a text statement "Ein Plan" ("Am Samstag wollte Léa das
  Museum besuchen.") and a choice "Ready?" (Yes, Not yet), presented from the
  deck editor.
- "Long charts": a match with six long pairs, and a pie and a radial choice
  with eight long labels, answered by four participants.
- "Pickup lesson": an identified tutoring session for "Noor {stamp}", ended,
  with a 12-sentence Next session note, then a second deck presented.
- "Counter": a choice with `resultVisibility` hidden-until-close.
- "Short lesson": one title slide, with `/api/sessions/*/student` stubbed to 500.
- "Keys lesson": a statement "Anfang", a choice "Bist du bereit?" (Ja, Noch
  nicht) and a statement "Danach".
- A session titled "A rather long lesson title for a narrow header".
- An identified tutoring session for "Lina {stamp}", deck "Place lesson".

Surfaces: Presenter dialog and its stage mirror, host console at
`/host/#/sessions/{code}?token=…`, phone remote at `…/remote?token=…`, Stage.

Lifecycle: per test, create and start a session or present a deck, then drive
it through keyboard presses, viewport changes and host commands.

Acceptance:

Portrait tablet and keyboard (Presenter):

- At 768 × 1024 and 820 × 1180 the slide in the stage mirror is over 150 px
  tall and over 300 px wide.
- On the "Draw" tab, "Look up a word" turns into "Picking word…". Escape
  restores "Look up a word" and keeps "End session" visible.
- Clicking the slide does not focus the ink overlay. ArrowRight then shows
  "Ready?" and ArrowLeft returns to "Ein Plan".
- With the overlay focused, ArrowRight announces "Ein" in its live region, End
  announces a word matching "besuchen", and the slide stays on "Ein Plan".
- Shift+F10 opens a menu with "Look up" and the focused word. Escape closes it
  and keeps the console open.
- With "Underline" chosen, Enter marks the focused word (1 underline), and
  ArrowRight then Enter adds a second.
- "Clear" removes both marks. "Undo" brings back 2, then takes back to 1.
- After Clear and a new mark, "Undo" removes only the newer mark and then
  "Undo" is disabled.
- The "Slides" group has one tab stop. ArrowDown then Enter goes to "Ready?",
  and the current slide holds the tab stop.
- On the "Home" tab the button starting "Drawn as " opens the menu "Chart
  type" with focus on the checked item. ArrowDown moves focus to another
  `menuitem*`. Escape closes the menu and returns focus to the opener.
- With nothing armed or open, Escape closes the Presenter.

Stage plate:

- At 1280 × 720 and 1920 × 1080 the match shows "Match each word to its
  meaning." with 6 `.or-pairs-chart__row` rows inside `.plate`.
- The pie and the radial show their prompts ("Which one?", "Which one
  again?"), the chart `[data-or-chart]`, and `.or-polar-chart--side` with the
  plot and the legend items inside the plate. The legend sits to the right of
  the plot and the plot is taller than 25 percent of the viewport height.

Next session note in the Presenter at 1280 × 800:

- The banner "Next session · Start with the dative…" is at most two lines tall.
  "Show all" has `aria-expanded` false.
- After "Show all", "Show less" has `aria-expanded` true and the banner is taller
  than two lines. The stage mirror stays visible.
- "Hide" removes the banner.

Hidden-results counter:

- In the console mirror at 1440 × 900 and on the wall at 1920 × 1080,
  `.pending__label` reads "answers so far", the value and label lie inside
  `.plate__body`, and the label does not overflow.

Notes that cannot open:

- After "End session" and the dialog's "End" button, the page shows "Notes could
  not open. Your private notes are kept on this device." with "Retry" and "Back
  to library".

Keys lesson at 1440 × 900:

- The Slides rail names the untitled question "Bist du bereit?".
- "Hide results" has `aria-pressed` false and `aria-keyshortcuts` "H". Pressing
  h sets `aria-pressed` true and shows "Results hidden". Clicking it again sets
  it back to false.
- After "Next" to the statement "Danach": no "Results shown", no text matching
  "question open" or "results up", and "Hide results" and "Close answering" are
  disabled.
- The phone remote (390 × 844) shows "Danach", has "Hide results" disabled and
  no "Results shown".
- "Back" returns to the question and keeps focus. Space on the focused Back
  goes to "Anfang". ArrowRight on it returns to "Bist du bereit?" and "question
  open" shows.
- The tablist "Session aside" has "Session" selected. ArrowRight selects and
  focuses the "Q&A" tab, the slide stays and "Private notes" stays visible.
  ArrowLeft selects "Session" again.
- Insert has no "From library" button. "Term" opens "Insert term"; "der
  Himmel" and "the sky" with "Insert on stage" show "der Himmel" on the mirror.
  "Statement" opens "Insert statement"; "Pause" and "Kurz durchatmen." show
  "Pause".
- "Change" opens "Change statement" filled with "Pause" and "Kurz durchatmen."
  Saving "Kurze Pause" shows it and removes the heading "Pause".
- "Question" opens "Insert question". With "Welche Farbe hat der Himmel?",
  "Option A" Grün and "Option B" Blau, "Mark correct, option B" has
  `aria-pressed` true. "Insert on stage" shows the question, selects the "Home"
  tab, and shows "Call out the correct answer" within 15 seconds.

Console header on a phone (390 and 320 wide, height 844):

- "Session menu" ends inside the viewport and the header does not overflow
  horizontally.
- The menu has "End session", "Copy join link" and text starting "Keys: ". At 320,
  "Copy join link" puts a link containing `code={join code}` on the clipboard.

Student place from the console menu (1280 × 800):

- In an identified tutoring header the student's name "Lina {stamp}" appears
  once, with the deck title "Place lesson".
- The "Session menu" has no "Copy join link". "Library" goes to a URL with
  `studentId={id}`.

Visual notes: the spec saves screenshots to the test output without comparing
them. Geometry checks are the assertions above.

Playwright: `e2e/journeys/UC-49-live-console-narrow-and-keys.spec.ts`. The spec
header names this path as its contract.
