# UC-56 — Text at the documented budgets fits the wall and the phone

Status: green on local Chromium (wall at 1920 × 1080, phone Slide at 390 × 844).

Spec: `e2e/journeys/UC-56-slide-capacity.spec.ts`. Helpers:
`e2e/fixtures/slide-geometry.ts`.

The outline_validate description states text budgets at 16:9 with the default
margin of 8 (`packages/mcp/src/tools.ts`). This journey draws each budget on
the live wall and on a phone in Slide view and measures whether any part is cut.

## Fixture and acceptance

Run `bun run verify:browser journeys/UC-56-slide-capacity.spec.ts` after
building the apps. One session per aspect ratio (16:9, 16:10, 4:3) is made
through the admin API, so no demo account is used.

Each deck has two masters, margin 8 and margin 12, and draws every budget on
both:

- a title slide heading of 100 characters;
- a statement body of 300 characters under a short heading;
- 4 cards of 140 characters and 6 cards of 70;
- 6 and 3 steps, activity instructions and debrief prompts of 40 and 80
  characters.

A part is cut when its text overflows its box, an ancestor column clips it, or
its box reaches into the master's margin (the editor's overflow detector plus
the W_TEXT_FIT margin rule).

- Margin 8, every aspect: no part is cut on the wall or the phone, and the
  estimator gives no W_TEXT_FIT for the step.
- Margin 12: wherever the wall or the phone cuts a part, the estimator gives
  W_TEXT_FIT for that step. No step is cut without a warning.
