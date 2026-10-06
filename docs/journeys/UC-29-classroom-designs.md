# UC-29 — Classroom templates across themes and slide sizes

Status: green on local Chromium for all 432 combinations.

Purpose: the supplied templates should remain readable when a teacher chooses a
different design family or an authored slide size.

Fixture: every entry in the 24-template catalog, inserted through the shared
template operation into one deck per family. Clean, Paper, Board, Contrast,
Color and Business each run at 16:9, 16:10 and 4:3.

Surface: the full-bleed browser deck editor and its shared slide renderer.

Lifecycle: create fixture → open editor → choose slide size → select every slide
→ wait for fonts/layout → measure visible text → capture representative images.

Acceptance:

- Each saved design family is actually applied to the rendered slide.
- Every authored aspect is reflected in the slide surface.
- Visible text parts fit their own boxes and the slide bounds.
- Title, cards, French reading and choice slides produce reviewable screenshots.
- The six built-in palettes separately pass 4.5:1 for normal/secondary text and
  3:1 for chart marks against both slide and card backgrounds.

Visual notes: Paper uses serif headings, the dark families use light text, and
question letters sit inside clear, aligned markers. The screenshots include
editor affordances such as Add option; audience cleanup is covered by UC-28.

Playwright: `e2e/journeys/UC-29-classroom-designs.spec.ts`.
Palette checks: `apps/workspace/src/lib/slide-contrast.test.ts`.

The final run was interrupted after Clean/Paper/Board when Wrangler's local
ProxyWorker exited with `Network connection lost`. Contrast/Color/Business
passed unchanged after restarting the same local database. Representative
screenshots from all families were inspected.

Limits: default template text and default safe areas are covered. This does not
prove arbitrary user content fits, arbitrary custom colors are accessible, or
every live result chart and physical projector is ready. The editor's overflow
notice remains necessary for authored content.
