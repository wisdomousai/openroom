# UC-36 — PowerPoint rehearsal and embedded results

Status: **green in isolated Chromium with the Office adapter fixture**. Screenshots
were inspected at 340 pixels for the pane and 960 × 540 for the embedded display.

## Journey

1. Connect an existing saved question to a PowerPoint slide through real account
   consent and the simulated Office adapter.
2. Rehearse the activity. Add three sample answers, reveal their 67%/33% split and
   reset. Observe no API writes during rehearsal.
3. Return to the pane and start a real local session.
4. Open the separate content add-in surface with the same presentation references.
   Connect its selected slide; save only the defined public activity reference.
5. Join a participant and answer. Inspect the actual broadcast publication: it
   contains a stage projection with no unrevealed aggregate, private notes or tokens.
6. Reveal from the pane. The embedded display shows the released 100% result. Hide
   results and see the audience counter return without losing the answer.
7. Copy the slide without reconnecting. The embedded display blanks the original
   activity and asks for reconnection. It makes no account or live API requests.

## Supporting checks

- Local domain commands exercise all eight supported question types and group
  response mode. A reopened timed question gets a fresh deadline.
- The shared wire projection controls answer-key release for real sessions and
  rehearsal. Domain privacy and Worker reveal tests exercise those boundaries.
- The content manifest has a distinct ID, deployment-relative source URL and
  disabled Office snapshots. Audience responses are not saved as a document image.
- The embedded chart retains its accessible text summary without drawing duplicate
  prose over the chart. The narrow preview's labels, bars and counts fit its frame.

## Limits

Only Office APIs are simulated; account consent, token exchange, D1 and session
state are real and local. A browser broadcast channel is not proof of communication
between native Office webviews. Native insertion, `.pptx` saves, slideshow lifecycle,
closed-pane behavior, Mac/Windows/web and full-file copy remain release gates.

Implementation: `e2e/journeys/UC-36-powerpoint-display.spec.ts`.

The headless journey also edits a content slide, copies its embed code from the
OpenRoom editor, and pastes it into the content add-in's picker. It verifies the
saved source, rendered preview, public-only document settings, and starting a
composed session on the content slide. Selecting a question in edit view leaves
participation alone; the simulated content runtime entering slideshow view opens
responses. Native Office is simulated here and is not launched by this journey.
