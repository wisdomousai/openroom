# UC-40 — One slide composition across displays

The authored slide retains its aspect ratio and proportional layout in the editor,
presenter control view, fullscreen stage and narrow learner browser. Phone width
does not silently select a different composition. Learners can explicitly choose
Reading when they want larger, reflowed text.

## Fixture and acceptance

Run `bun run verify:browser UC-40-slide-display-parity` after building the apps.
The fixture signs into the disposable local Worker, creates a space, uploads a
synthetic image and saves a deck through the API. Unlike UC-39, this isolates layout
behavior rather than testing first-use setup. Starting and advancing the deck use
the real editor and presenter controls.

Each of 16:9, 16:10 and 4:3 is tested with eight compositions: title, objectives,
text and image, cards, reading, group activity, split text and a media slide.

- New masters use an 8% slide-width content margin on every edge. Existing saved
  margins remain authoritative. Structured split/activity/media layouts honor it.
- Starter freeform objects have inset coordinates; authored freeform placement is
  preserved. Layout presets keep the same inset when arranging those objects.
- The editor must report no overflow. Content rectangles must stay within the
  default margin, allowing 0.2% slide-width rounding tolerance.
- The control view, 1920 × 1080 fullscreen stage and separate 390 × 844 learner
  browser must show matching content and aspect ratio. Each content part's bounds
  and font size are compared after normalization to slide width (0.9% tolerance).
- Images must finish loading successfully before comparison. Selected compositions
  are captured in all three displays for visual inspection.
- Mobile starts in Slide. UC-13 and UC-26 separately verify explicit Reading mode,
  including larger text and annotations after reflow.

The default learner engine is Chromium. Set `OPENROOM_E2E_LEARNER_ENGINE=webkit`
for Chromium tutor/stage and a separate WebKit learner process. See
[verification](../VERIFICATION.md) for installation and commands.

## Boundaries

The comparison concerns authored slide content. Presenter chrome and learner answer
controls remain appropriate to their role. It does not compare live result-chart
geometry, external embeds, video decoding or every possible authored text length.
Master backgrounds and decorative furniture may extend beyond the content margin.
Reading deliberately reflows content and is not a same-geometry view.

Evidence lives in `e2e/test-results/UC-40-*`; retained runs are copied to
`output/playwright/display-parity/`. See the
[first-use audit](../qa/2026-09-19-first-use.md) for final verification results.
