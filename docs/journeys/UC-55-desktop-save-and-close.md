# UC-55 — Desktop: save from the menu, close with unsaved changes, damaged files, signed out

Status: green on the macOS development build.

Purpose: a tutor keeps one `.openroom` file per student. File > Save writes the
file, closing a window with unsaved changes asks first, a recovery copy is
offered when that file opens again, a file that cannot be opened says why, and a
signed-out window offers Sign in instead of an error.

Fixture: skipped unless `RUN_DESKTOP_JOURNEY=1`. It needs the built desktop
application and a native display. `launchDesktop` starts the app with a fresh
profile and one file. Native message boxes are replaced in the test: each one
records its message and detail and returns a chosen button index (0 Save, 1
Don't Save, 2 Cancel). Two tests:

- `maya.openroom`, deck "Maya, lesson 4" with a title slide "Au café".
- `lesson.openroom`, deck "Signed-out lesson" with a title slide "Bonjour", and
  `broken.openroom`, whose content is the text "not a deck". The window is set
  to 1280 × 800 and later 980 × 680. No sign-in and no live server are set.

Surfaces: the desktop File menu, the editor window, native message boxes, the
recovery folder in the profile, the deck bar, the "Save to workspace" dialog,
the Agent pane.

Lifecycle: test 1: open the file → rename → File > Save → File > Present → File
> New → rename → close (Cancel, then Save) → reopen, rename, destroy the window
as a crash → open the file again → dismiss the notice → rename, close with
Don't Save. Test 2: File > Open… on the damaged file → the signed-out bar →
Live server… → Save to workspace… → open and close the Agent pane → shrink the
window.

Acceptance:

File menu and Save:

- The File menu has "Save" (CmdOrCtrl+S), "Save As…" (Shift+CmdOrCtrl+S) and
  "Present" (Alt+CmdOrCtrl+P). The spec checks these items and accelerators. It
  does not run "Save As…".
- After renaming, the draft status is `dirty`. On macOS the window is marked as
  edited.
- File > Save sets the draft status to `saved`, the package on disk has the
  new title "Maya, lesson 4 (menu save)", and on macOS the window is no longer
  marked as edited.
- File > Present opens the dialog "Presenter". "Edit deck" returns to the
  editor.
- File > New opens a second file window.

Close with unsaved changes:

- Closing a window after a rename shows one message box containing "Do you want
  to save the changes to maya.openroom?"
- Answering Cancel keeps both windows open.
- Answering Save closes the window (one file window remains) and the package on
  disk has the title "Maya, lesson 4 (saved on close)".
- Opening the file again with a clean state shows no message box.
- Don't Save closes the window (one file window remains) and deletes the
  recovery copy `{fileId}.json` from the profile's `recovery` folder.

Recovery copy:

- After a rename, the recovery folder holds `{fileId}.json`.
- After the window is destroyed without saving, opening the file shows one
  message box containing "maya.openroom has changes that were not saved to the
  file."
- The reopened window shows the title "Maya, lesson 4 (crashed)" and a status
  note "Recovered changes that had not been saved to the file." "Dismiss"
  removes the note.

Damaged file:

- File > Open… on `broken.openroom` shows exactly the message "broken.openroom
  could not be opened. The file is damaged or is not an OpenRoom deck." and the
  open window stays (one file window).

Signed out:

- The status note "Live sessions need a sign-in or a live server." shows the
  buttons "Sign in" and "Live server…". "Start session" is disabled.
- There is no "Back" link for a local file.
- "Live server…" opens a dialog, and Escape closes it.
- On the File tab, "Save to workspace…" opens the dialog "Save to workspace",
  which shows "Sign in to save this file to a workspace." and a "Sign in"
  button. It does not show "Online place" and has no alert. "Cancel" closes it.

Agent pane:

- With the pane closed there is no "Agent" heading. The "Agent" button opens it
  and the heading "Agent" shows. "Close Agent pane" closes it again.
- With the pane closed and the window at 980 × 680, the slide canvas frame is
  wider than 300 px.

Visual notes: the spec saves screenshots to the test output and records the
canvas width at 980 px as a test annotation. It does not compare images.

Playwright: `e2e/journeys/UC-55-desktop-save-and-close.spec.ts`.
