# UC-06 — Library: find a deck and act on it

Status: green on local Chromium.

Purpose: a tutor finds one deck among many, renames it, moves it between
folders and takes its primary action, all on one screen without a route
change.

Fixture: demo account alice. The spec logs in through
`/api/auth/demo/login` and re-adds the session cookie without the `Secure`
flag so it works over plain http. Through the API it makes two folders (Week A
and Week B, stamped with the time) in the first space and one deck "Passé
composé {stamp}" in Week A.

Surfaces: the library at `/host/#/space/{spaceId}`: folder tree rail, deck
list, details panel.

Lifecycle: open the space → select Week A in the tree → select the deck →
rename it in the panel → move it to Week B with "Move to another folder…" →
drag it back onto Week A in the rail → select it again and read the primary
action.

Acceptance:

- The navigation "Folder tree" is visible. Selecting Week A puts
  `folderId={Week A id}` in the URL.
- The deck row (an option named after the deck) is visible. Selecting it opens
  the complementary region "… details" and puts `itemId=` in the URL.
- "Rename {title}" opens a "Rename" field. Filling it and pressing Enter
  changes the button to "Rename {title} revised". No "Save" button remains.
- "Move to another folder…" opens a "Filter folders" field. Filtering to Week B
  and choosing it removes the deck from Week A's list.
- Selecting Week B in the rail puts `folderId={Week B id}` in the URL and lists
  the renamed deck.
- Dragging the row onto Week A in the rail removes it from Week B, and it
  appears in Week A.
- The first link in the details panel reads "Open".

Playwright: `e2e/journeys/UC-06-library.spec.ts`.
