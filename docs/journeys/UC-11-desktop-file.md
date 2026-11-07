# UC-11 — Desktop local file

Status: green on the macOS development build.

Purpose: a local `.openroom` file opens in the shared editor, presents on a
separate audience screen, keeps its presentation position on return, and saves
changes to the file.

Fixture: skipped unless `RUN_DESKTOP_JOURNEY=1`. It needs the built desktop
application and a native display. The spec writes `presentation.openroom` to a
temporary directory with a deck "Desktop presentation": a title slide "Opening"
and a steps slide "Two points" with items "First point" and "Second point" and
three reveal groups. `launchDesktop` starts the app with a fresh profile and
that file.

Surfaces: desktop editor window, Presenter dialog, audience window.

Lifecycle: open the file → Theme tab: paper, 4:3 → Present → ArrowRight twice
→ Audience screen → step forward and back from the audience window → Edit
deck → rename → File tab, Save → reload.

Acceptance:

- The deck title element reads "Desktop presentation". The only window title is
  "presentation.openroom", and the deck bar shows "presentation.openroom ·
  Local file".
- Present opens "Presenter". Two ArrowRight presses show "reveal 2/3".
- "Audience screen" opens a second window. It shows "First point", its slide
  surface has `data-slide-theme="paper"`, and the surface is about 4:3.
  "Second point" is absent.
- ArrowRight in the audience window moves the presenter to "reveal 3/3".
  ArrowLeft returns it to "reveal 2/3" with "Second point" hidden, and again to
  "reveal 1/3" with "First point" hidden. Two ArrowRight presses show "Second
  point" again.
- "Edit deck" closes the Presenter and the canvas header contains "Two points".
- After renaming to "Renamed desktop deck" and pressing Save on the File tab,
  the draft status is `saved`. After a reload the title is still "Renamed
  desktop deck" and the canvas surface keeps `data-slide-theme="paper"` and
  `data-slide-aspect="4:3"`.

Visual notes: the spec saves screenshots and a trace to the test output
without comparing them.

Playwright: `e2e/journeys/UC-11-desktop-file.spec.ts`.
