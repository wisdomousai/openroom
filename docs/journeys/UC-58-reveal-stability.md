# UC-58 — Revealing a part does not move the parts already shown

Status: green on local Chromium (wall at 1920 × 1080).

Spec: `e2e/journeys/UC-58-reveal-stability.spec.ts`. Helpers:
`e2e/fixtures/slide-geometry.ts`.

Hidden parts are not rendered (`packages/slides/src/parts.ts`), so a layout
that sizes or centres by what is rendered moves the parts already shown when
the next one appears (LG-09, LD6).

## Fixture and acceptance

Run `bun run verify:browser journeys/UC-58-reveal-stability.spec.ts` after
building the apps. Sessions are made through the admin API, one deck per aspect
ratio (16:9, 16:10, 4:3) and per group below. Each step reveals one part at a
time with `outline.reveal`.

At every reveal, every part shown at the previous reveal keeps its box within
0.2% of the slide width, and no part is cut.

Grid and split lists:

- 4 cards and 6 cards on the grid, one card at a time;
- 12 steps on the grid;
- 3 steps on split with the picture revealed last;
- 3 cards on split with the picture revealed first.

Title and statement stacks. A title, statement or media step with a reveal
carries `data-has-reveal` on its root and starts at the top instead of
centring (LD6); a statement's stat comes first in its reveal order, as it does
on the slide:

- a statement with a stat, revealed stat, heading, body (the order they are
  drawn in);
- a title slide with a body;
- a statement with a picture at the bottom revealed last.
