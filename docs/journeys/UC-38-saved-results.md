# UC-38 — Saved result files

An owner pays for retention and individual-response exports. An invited presenter
starts and ends the workshop without a personal subscription. The captured file
stays reachable from its deck after the owner downgrades; removing the presenter
from the space revokes their access.

1. Create disposable local owner/presenter accounts and a training space; accept
   the real space invitation.
2. Start a saved deck and submit choice/text responses, including one hidden entry
   and one answer that looks like executable HTML.
3. Enter private notes in the presenter's live console and end the session. The
   deck has no student context: verify its Notes destination and scratchpad survive
   a reload, then return to the selected deck. Capture real local R2 results before
   removing the owner's paid flags.
   Presenters see their local scratchpad and saved shared content without a shared
   edit form. Download the local text and verify no record was silently uploaded.
   Promote to editor, change the notes, demote during editing and attempt a save:
   the server refuses the write and the local draft survives reload. Restore editor
   access and save directly. A subsequent presenter view reads the saved notes.
4. Open the Library deck inspector and its saved results file.
5. Reload the document directly. Check captured labels and visible answers, with
   no hidden entry, automatic participant identity or teaching guidance.
6. Download the HTML report, inspect its rendered content, and verify submitted
   HTML remains text. Capture desktop and phone layouts without horizontal overflow.
7. Inject one CSV download failure, retry successfully, and verify the individual
   export includes its retained responses behind a review-before-sharing notice.
8. Return to the Library with the original deck selected.
9. Open the file as the presenter, remove that membership, then reload and verify
   the file and its download actions are unavailable.

## Evidence and boundaries

`e2e/journeys/UC-38-saved-results.spec.ts` passed in Chromium against the local
Worker with isolated browser contexts and real D1, R2 and live session objects.
Only the one transient CSV failure is intercepted. Entitlements are disposable
local fixture grants, not a real Paddle purchase. Fixture accounts, captured
objects and related records are removed by cleanup.

The journey captures `saved-results-desktop.png`, `saved-results-mobile.png` and
`downloaded-report.png`, plus `presenter-notes.png`. These were visually inspected. Focused Worker tests also
cover all eight interaction types, hidden-content projection, all account clients,
pagination, expiry, concurrent capture and failed-pointer recovery. The standalone
deck-start regression also checks the host-only Notes destination before and after
ending, and distinguishes temporary sessions with no durable row.

This verifies local browser and service behavior. Native Desktop/PowerPoint and
real Paddle sandbox lifecycle acceptance remain separate release gates.

## Run

Start the built Worker with a disposable local persistence directory, then:

```bash
cd e2e
OPENROOM_E2E_PERSIST_TO=/tmp/openroom-practice-20260918 \
  bunx playwright test journeys/UC-38-saved-results.spec.ts
```

The persistence directory must match the running local Worker. Never point this
fixture at a hosted database.
