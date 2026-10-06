# UC-08 — Edit and present a deck

The teacher inserts a question, changes its layout, writes directly on the slide,
adds a reveal sequence and attaches a breakout. Reloading retains those edits.

The fixture uses the full-bleed browser editor and the real local Worker. It
checks the authored document through visible slides and the saved draft state.

Acceptance:

- Inserting a question selects it and leaves the existing slides intact.
- Changing layout preserves the question and its options.
- Adding/removing options and editing the prompt update the canvas and thumbnails.
- Playing a reveal exposes the parts in their authored order.
- A breakout can be opened from its parent and returned from.
- Reload restores the saved edits and layout.
- View → Start from here opens the shared presenter on the selected slide.
- Edit deck returns to that same slide.

Playwright: `e2e/journeys/UC-08-deck-editor.spec.ts`.

Passed locally in Chromium on 19 September 2026. This journey covers browser
authoring and presentation; native file handling and live participation have
separate journeys.
