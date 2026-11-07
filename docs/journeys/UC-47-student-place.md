# UC-47 — A student's place in the Library

Status: green on local Chromium.

Purpose: a tutor opens one student's place and works there without detours.
Stale addresses land in the Library, a missing student says so, Live now names
the student, list rows have context menus reachable from the keyboard, folders
rename in place, trashing a folder takes its decks along, the purge page names
what it deletes, and a student can be moved to Trash and restored.

Fixture: demo account alice (cookie re-added without `Secure`). Test 1 makes a
student "Mara {stamp}" with a folder "Verbs" holding the deck "Le passé
composé", a second folder "New folder", and a launched, started deck "Au
marché". Test 2 runs at 1280 × 720. It makes a group "Noor and Léa {stamp}"
with no decks, and a student "Inès {stamp}" with goals and notes, eight decks
"Leçon 1" to "Leçon 8", and a Next session note of about 1,500 characters
saved to the first session's record.

Surfaces: Library at `/host/#/space/{spaceId}?contextId={id}`: Live now, folder
tree rail, Library list, row menus, deck toolbar, student header, Edit student,
Trash dialogs, the purge confirmation page.

Lifecycle: test 1 opens stale addresses, then the place, then renames and
trashes a folder and purges it. Test 2 opens the group, then the student,
searches, edits the name, trashes the student and restores it.

Acceptance:

Test 1, addresses, menus, rename, folder trash and purge:

- `/host/#/nonsense` leaves the nonsense address and shows the Library list or
  the "Sample deck" heading, never "Page not found".
- `/host/#/decks/{id}` redirects to `#/decks/{id}/edit`.
- An unknown `contextId` shows the heading "This student is not available" and
  no "Retry" button.
- Live now shows the button "Rejoin {student}, Au marché".
- Right-click on the deck row opens a menu with Open, Start session, Duplicate,
  Move to trash. Escape closes it.
- Shift+F10 on a focused folder row opens a menu with Open, Rename, Duplicate,
  Move to trash.
- F2 on a folder opens the field "Rename Verbs" with focus. Entering "Verbes"
  renames it and focus returns to the row.
- The menu's Rename keeps the field "Rename Verbes" focused, also 300 ms after
  the menu closes. Entering "Irregular verbs" renames it and focus returns to
  the row.
- In the folder tree, F2 on "Irregular verbs" opens "Rename folder" with focus,
  and Escape returns focus to the rail row.
- The rail's "New folder" create button proposes the name "New folder 2".
- Move to trash on the folder opens the dialog "Move folder to trash", which
  contains "the folders inside it and their decks to Trash". Confirming removes
  the row, and the space no longer lists the folder's deck.
- The permanent-deletion confirmation page shows "The decks in them that are in
  Trash, with those decks’ sessions, Notes and learner work". "Permanently
  delete" shows "Permanently deleted." and the link "Return to Trash". The deck
  then returns 404.

Test 2, laptop sizes:

- A group place shows its whole name as the level 2 heading, the heading
  "Sample deck", and no "No decks in this folder".
- A student place shows the student's name as the level 1 heading, the heading
  "Access links" and "No access link yet."
- A long Next session note (`#next-session-note`) is under 60 px tall. "Show
  all" makes it more than three times taller, and "Show less" closes it.
- The Library list shows 8 rows at their full height (list height is at least
  eight row heights minus 2 px), and the last row scrolls into view with the
  page.
- At 1024 × 768 the student's name and the "Share" link do not overlap.
- "New deck" appears once in the main area, on the same row as "Sample
  lessons" (tops within 2 px).
- Searching "Search decks for {student}" for "zzz-no-such-deck" shows "No decks
  match" and not "No decks in this folder". "Clear search" empties the box,
  focuses it and restores 8 rows.
- Searching the top box "Search decks" for "Leçon 3" and choosing the result
  "Leçon 3 … {student}" opens the student's place (URL has `contextId`) and
  clears the top search.
- "Edit" opens the heading "Edit {student}". An empty "Name" with Enter shows
  the alert "Enter a name.", focuses the field and sets `aria-invalid` true.
- "Move to trash" opens the dialog "Move {student} to trash", which contains
  "decks, access links and learner work".
- After trashing, the place shows "{student} is in Trash." There is no "New deck"
  in the main area. The sidebar's single "New deck" link does not point at the
  student. There is no "Access links" heading and no "Edit" button. The
  navigation "Workspace" has no link for the student.
- "Restore" brings back "Access links", removes the Trash text and lists the
  student in the navigation again.

Playwright: `e2e/journeys/UC-47-student-place.spec.ts`.
