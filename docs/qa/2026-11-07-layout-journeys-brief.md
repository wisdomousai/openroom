# Build brief: layout-journeys — Slide capacity and display parity journeys

Depends on (already merged into tutoring-ux before you start): slides-renderer, participant, live-console, deck-editor, agent-surface

Journey numbers reserved for this cluster (use only these for new UC files): UC-56, UC-57, UC-58

Decisions that apply: LD1, LD3, LD4, LD6, LD8, LD11 (full text in decisions.md next to this file)

## Cluster summary from triage

New and extended journeys, owned only by this cluster: a capacity matrix (next free number, UC-44 at time of writing) over wired kinds at documented budgets on three aspects and two safe areas on the stage wall and phone Slide; place by size matrix with portrait, square and landscape pictures; editor to wall geometry on an overflowing step; reveal stability; phone reach and Reading hierarchy; html containment; question plate with 200 and 500 char prompts. Extends UC-40 and UC-41 only by adding cases, not by loosening them. The harness under the scratchpad (layout/map/fitting render*.tsx, measure2.mjs; stress/*/measure) shows how to measure cheaply; port the detector logic from slide-overflow.ts.

## Verification named by triage

["Each new case fails on current main for its target defect and passes after the owning cluster lands", "No echo assertions: every case measures rendered geometry or reachability", "Run at 16:9, 16:10 and 4:3 and at 1920x1080, 1280x720, 390x844, 320x568"]

## Owned files

- docs/journeys/UC-44-slide-capacity.md
- e2e/journeys/UC-40-slide-display-parity.spec.ts
- e2e/journeys/UC-41-editor-overflow.spec.ts
- e2e/journeys/UC-44-slide-capacity.spec.ts

## Chunks

- chunk 1: Q01, SP-01, TP-05, TP-04, LG-09

## Findings (full records from the audit; verdict and verdictReason are the skeptic's; needs-decision items are now settled by decisions.md)

```json
{
 "id": "Q01",
 "title": "Phone answer controls beyond the viewport cannot be reached",
 "stepKinds": [
  "choice",
  "ranking",
  "match",
  "text",
  "fill-the-gaps"
 ],
 "surfaces": [
  "participant phone"
 ],
 "conditions": "Viewport width below 640px; choice with 8+ long options, ranking of 6, match of 6, 500-char prompts; also first-join name notice present",
 "kind": "clipping",
 "severity": "high",
 "observed": "Page does not scroll, so lower options and the Send button are off-screen and untappable. A touch swipe and wheel scroll left the page unchanged.",
 "expected": "Every option and the Send button reachable on a 360x640 to 430x932 phone.",
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/layout/stress/questions/data/phone-reach.json",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/layout/stress/questions/shots/A2-ch8-long-fr-open0-p390.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/layout/stress/questions/shots/A7-match-6-long-open0-p390.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/layout/stress/questions/shots/probe-swipe-after.png"
 ],
 "rootCause": "apps/participant/src/styles.css .page { height:100dvh; overflow:hidden } with .page__body { display:contents } (phone). Nothing between the page and the options scrolls. The first-join name notice (about 140px) makes it worse. The cause is correct as cited.",
 "files": [
  "apps/participant/src/styles.css",
  "apps/participant/src/live/screen.tsx"
 ],
 "fix": "Make the answer region (question, options, Send) the scroll container on widths below 640px and keep Send reachable (sticky or last in the scroll flow). The fix is plain CSS and needs no contract change. Option 3 (reject long inputs at validation) is not a substitute, because a normal 6-option list plus the name notice already overflows.",
 "needsDecision": true,
 "options": [
  "Answer region scrolls inside .page, Send sticky",
  "Page scrolls when body is taller than 100dvh on widths below 640px",
  "Cap options and gaps per question and reject longer ones at validation"
 ],
 "measurements": "Unreachable controls: ch10-long-fr 6/10 at 360x640, 3/10 at 390x844, 2/10 at 430x932; ch8-long-fr 4/8 at 360 and 1/8 at 390; match-6-long 6/13 at 390x844 with Send at y=1217 of 844; rank-6-long-fr 7/13 at 360 and Send at y=1068 of 640; ch4-prompt500 4/4 at 360x640. 768x1024: 0 unreachable in all cases.",
 "batch": "questions",
 "verdict": "confirmed",
 "verdictReason": "Reproduced in my own instance with touch emulation. At 360x640, ch10-long-fr has 7 of 12 controls below the viewport. At 390x844, ch8-long-fr has 3 of 10 below. A wheel scroll leaves scrollY at 0 and the last control stays at y=1070 or 866. At 360x640, ch4-short (4 short options) fits. main.page is overflow:hidden with scrollHeight 2602 vs clientHeight 640, and no descendant is a scroll container."
}
```

```json
{
 "id": "SP-01",
 "title": "Phone Reading view cannot scroll below the first screen on phones narrower than 640px",
 "stepKinds": [
  "steps",
  "cards",
  "blank",
  "statement",
  "debrief"
 ],
 "surfaces": [
  "participant phone Reading"
 ],
 "conditions": "Viewport < 640px (320x568, 320x640, 360x740, 390x844), banner dismissed or not, Reading toggle on, any slide taller than the viewport: en goals/compare/patterns/talk; de goals/compare/patterns/talk",
 "kind": "clipping",
 "severity": "high",
 "observed": "Reading reflows to a 1rem document, but the page cannot be scrolled. Wheel scroll leaves the last line where it was (patterns: last line bottom 1166px in an 844px viewport, 1272 in 740, 1430 in 568; compare 972/1051/746; goals 901/954/1059). The only scrollable element is .page (overflow:hidden, scrollHeight 1303 vs client 844) and no ancestor of the slide scrolls. Reading is the only fallback for the 6-9px Slide text, so the learner loses the lower half of six-item or four-card slides.",
 "expected": "Reading view scrolls, so every line is reachable; at 768 it already is (reach true on all 12).",
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/layout/stress/surfaces-parity/dismissed.json",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/layout/stress/surfaces-parity/phone-en-169-390.json",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/layout/stress/surfaces-parity/shots/phone-en-169-390-05-patterns-reading.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/layout/stress/surfaces-parity/shots/dbg-phone-reading-scrolled.png"
 ],
 "measurements": "390x844 en-169: reach false for goals (1007>844), compare (1068), patterns (1183), talk (1006); 320x640 false on 10 of 12 slides; dismissed banner 390x844 still false for goals 901, compare 972, patterns 1166, talk 999. 768x1024 true for all.",
 "rootCause": "apps/participant/src/styles.css: .page is overflow:hidden with a definite height, while the max-width:639px block sets .learner-slide{flex:none} (its own comment says 'narrow scrolling page'). Nothing in the chain can scroll.",
 "files": [
  "apps/participant/src/styles.css"
 ],
 "fix": "Either make the narrow page the scroller, or give Reading a bounded box. Tested: `@media (max-width:639px){.page{overflow-y:auto}}` makes the last Reading line reachable at 390x844, 320x640 and 320x568 and also fixes SP-13. Alternative tested: `.learner-slide[data-reading='true']{flex:1 1 auto;min-height:0}` also works, but the scroller is only 241px tall at 320x568. No contract change.",
 "needsDecision": false,
 "options": [],
 "batch": "surfaces-parity",
 "verdict": "confirmed",
 "verdictReason": "Reproduced at 390x844 and 320x640/568: in Reading, goals, compare, patterns and talk cannot be scrolled to the last line (last line bottom 1183px in an 844px viewport). .learner-slide is flex:none with overflow-y:auto at max-width 639px, so it grows to content height (976 of 976), and .page (height 100dvh, overflow:hidden, scrollHeight 1303 vs 844) clips it. At 768 it is reachable."
}
```

```json
{
 "id": "TP-05",
 "title": "The wall and phone clip more than the editor shows; no wall, phone or preview detector exists",
 "stepKinds": [
  "title",
  "statement",
  "term",
  "blank",
  "media"
 ],
 "surfaces": [
  "stage wall",
  "phone slide",
  "editor canvas"
 ],
 "conditions": "Any overflowing flow step compared at the same cqw on the editor canvas and the 1920x1080 stage.",
 "kind": "parity",
 "severity": "medium",
 "observed": "The same overflowing step has a different shrink distribution: st-def-right-50 header y -0.9 / visible 0.845 / root +87px in the editor vs y -3.69 / visible 0.422 / root +213px on the wall (header box 6.38cqw vs 5.8, body 7.5 vs 2.5); st-text-left-50 image visible 0.815 editor vs 0.657 wall, root +164px vs +441px; s-body-600 header visible 0.108 on the wall; lt-split-400 header visible 0.141 on the wall. Nothing is reported on the wall or phone; only the editor shows 'N items do not fit', and that notice resizes the canvas while measuring.",
 "expected": "What the editor measures equals what the wall shows, and fit is reported to whoever authored the step including agents.",
 "evidence": [
  "measure/surf-02-picture-matrix-16x9-clean-base.json",
  "measure/surf-01-headings-16x9-clean-base.json",
  "shots/surf-01-headings-16x9-clean-base/s-body-600-stage.png"
 ],
 "rootCause": "deck-slide.css:1267 .slide-surface [contenteditable][data-placeholder]{min-height:1em} applies to every editable part, not only empty ones. It overrides flex min-height:auto, so the editor shrinks parts that the wall leaves at content size. Computed styles were not otherwise identical, since the earlier cs.mjs check missed this.",
 "files": [
  "packages/editor/src/deck-edit/slide-overflow.ts",
  "apps/stage/src/StageView.tsx",
  "packages/slides/src/deck-slide.css"
 ],
 "fix": "Scope the min-height to empty placeholders only (e.g. :is(:empty,[data-empty='true'])), so non-empty parts keep min-height:auto in the editor. The overflow notice still works because it measures scroll overflow. Add a UC-40-style parity assertion on one overflowing step. Treat exposing fit to agents (deck_preview/outline_validate warnings) as a separate decision under TP-03.",
 "needsDecision": true,
 "options": [
  "Add measured fit warnings to deck_preview/outline_validate output",
  "Keep editor-only detection and add wall-side clip logging for QA",
  "Make the renderer identical on all surfaces first, then rely on the editor notice"
 ],
 "measurements": "st-def-right-50 header visibleFrac 0.845 editor / 0.422 wall / 0.423 phone; rootOver 87 / 213 / 40 px. st-text-left-50 rootOver 164 / 441 / 84 px.",
 "batch": "talking-pages",
 "verdict": "confirmed",
 "verdictReason": "Reproduced (st-def-right-50: header visible 0.845 editor vs 0.422 wall; root +87px editor vs +213px wall; st-text-left-50 image 0.815 vs 0.657). I isolated the cause. deck-slide.css:1267-1269 sets min-height:1em on [contenteditable][data-placeholder] slide parts. Only the editor has contenteditable, so there flex items lose their min-height:auto and shrink; wall and phone keep content height and overflow centred. Computed minHeight is 24.5px on the editor body vs 'auto' on the stage. Injecting min-height:auto in the editor makes it match the wall: s-body-600 header visible 0.108 as on the stage, t-150 root +46px (4.7cqw, same as the wall's 86px/1820). So the editor currently hides how bad overflow is on the wall. The 'expose fit to agents' part is a separate feature choice, not a bug."
}
```

```json
{
 "id": "TP-04",
 "title": "html elements sized in px/vw are not slide-proportional (4-5x drift between editor, wall and phone) and position:fixed escapes the box",
 "stepKinds": [
  "blank",
  "title",
  "statement",
  "media"
 ],
 "surfaces": [
  "editor canvas",
  "stage wall",
  "phone slide"
 ],
 "conditions": "html element with font-size in px or vw, a table with px padding/borders, or position:fixed content (all pass the sanitiser); editor canvas 980px wide, stage slide 1820px, phone slide 342px.",
 "kind": "parity",
 "severity": "high",
 "observed": "Same slide e-html-mix: the 40px 'Forty px text in a box' is 4.1cqw in the editor, 2.2cqw (tiny) on the wall and 11.7cqw on the phone, where it is cropped to the single word 'Forty'; the px table is readable in the editor, microscopic on the wall and clipped to 2 rows on the phone. 4vw text is 6.5cqw in the editor (1600px viewport) but about 4cqw on the wall. Inline svg with viewBox scales correctly. position:fixed (accepted) paints a red badge at the slide's top-left corner on the stage, outside its x8 y55 box (visible fragment 'xed'); the editor clips it.",
 "expected": "Every surface shows the same composition (UC-40 parity) and an html element cannot paint outside its box.",
 "evidence": [
  "sheet-html.png (stage / phone / editor)",
  "sheet-fixed.png",
  "shots/surf-04-elements-16x9-clean-base/e-html-mix-stage.png",
  "shots/surf-04-elements-16x9-clean-base/e-html-mix-phone.png",
  "shots/surf-04-elements-16x9-clean-base/e-html-units-stage.png",
  "measure/surf-04-elements-16x9-clean-base.json"
 ],
 "rootCause": "Confirmed. The fixed escape comes from fixed descendants of an overflow:hidden host not being clipped when the host is not their containing block. contain:paint (or transform) on the html element host fixes it, verified in the browser.",
 "files": [
  "packages/slides/src/HtmlHost.tsx",
  "packages/schema/src/element-html.ts",
  "packages/slides/src/deck-slide.css"
 ],
 "fix": "Add contain:paint to .outline-step__element--html (or the HtmlHost :host rule) so position:fixed is confined and clipped to the box. Optionally reject position:fixed/sticky in cssLooksUnsafe. State in the outline_validate description that px/vw/vh in html css do not scale with the slide and that authors should use em, percent or svg viewBox. A stronger option (a scale transform or rejecting px) is a separate contract choice.",
 "needsDecision": false,
 "options": [],
 "measurements": "e-html-mix 'Forty px': editor 4.1cqw, wall 2.2cqw (1820px), phone 11.7cqw (342px). e-html-units 4vw: editor 6.5cqw vs wall about 4cqw. fixed badge visible on the wall at (0,0).",
 "batch": "talking-pages",
 "verdict": "confirmed",
 "verdictReason": "Reproduced. e-html-units on the stage: a red position:fixed badge ('xed') paints at the slide's top-left corner, outside its x8 y55 box; the editor clips it. With contain:paint injected on .outline-step__element--html the badge stays inside its box on the stage, so the escape is a CSS bug with a mechanical fix. 4vw text is 6.5cqw in the editor (1600px viewport) and about 4.2cqw on the wall. px sizes (40px text = 4.1cqw editor, 2.2cqw wall, 11.7cqw phone) follow arithmetically from px not scaling with the slide. Neither element-html.ts nor HtmlHost.tsx rejects or scales px, vw or position:fixed, and the host mounts a closed shadow root with host overflow:hidden. Inline svg with viewBox is unaffected. The px/vw part needs no contract change: say in the tool description that px and vw do not scale and to author in em/percent/viewBox. The rules allow that."
}
```

```json
{
 "id": "LG-09",
 "title": "Revealing list items resizes and moves the items already shown; the slide jumps on every reveal",
 "stepKinds": [
  "cards",
  "steps",
  "activity",
  "debrief"
 ],
 "surfaces": [
  "presenter",
  "stage-wall",
  "editor-canvas",
  "participant-phone"
 ],
 "conditions": "reveal groups per item (cell-N), grid/text/split layouts, picture revealed late; all aspects",
 "kind": "other",
 "severity": "medium",
 "observed": "Hidden parts are not rendered, so nothing is reserved. Cards grid, 4 cards revealed one at a time: card 1 first appears 41.45 x 34.51cqw (half the slide), cards 1-2 stay at that height, at the 4th reveal all shrink to 16.71cqw (maxResize 17.8cqw) and card 3 lands under them. 6 cards: sizes 34.51, 16.71, then 10.77cqw (cell-2 moves 5.9cqw). Steps with 12 items go through 6 sizes: 34.51, 16.71, 10.77, 7.8, 6.02, 4.84cqw. At 4:3 the same first card is 53.3cqw tall. Split steps (list in the centred support column): previously shown item 1 moves from y=22.67 to 16.5 to 10.33 (12.3cqw upward in 3 reveals). Revealing the picture last moves the heading 12.1cqw (header y 25.59 to 13.54; 4:3 34.97 to 22.92). Picture-first cards: card 1 ends at y=2.92, inside the safe margin, and 2 text lines are clipped at the last stage. Text and activity layouts (flex-start) are stable: maxMove 0.",
 "expected": "Revealing the next item does not change the position or size of items already shown.",
 "evidence": [
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/layout/stress/lists-and-grids/shots/reveal-16-9-clean/r-cards-4__r2.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/layout/stress/lists-and-grids/shots/reveal-16-9-clean/r-steps-split-3__r5.png",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/layout/stress/lists-and-grids/results/reveal-09-reveal-16-9-clean.json",
  "/private/tmp/claude-501/-Users-uti-Desktop-openroom/be4cdb41-cb1f-4f1f-bc35-860bc387267c/scratchpad/layout/stress/lists-and-grids/results/reveal-09-reveal-4-3-paper.json"
 ],
 "measurements": "r-cards-4 maxResize 17.8cqw (4:3: 27.2), r-cards-6 maxMove 5.9cqw (4:3: 9.1), r-steps-12 maxMove 5.9, r-steps-split-3 header 12.12cqw move, r-cards-split-img-first header 12.06 move; text/activity/debrief layouts 0.",
 "rootCause": "Confirmed. Hidden parts are not rendered (parts.ts: they are not rendered), so rows and centring follow the revealed count.",
 "files": [
  "packages/slides/src/StepLayout.tsx",
  "packages/slides/src/parts.ts",
  "packages/slides/src/deck-slide.css"
 ],
 "fix": "Renderer-only, but the proposed fix needs correction. Do not render hidden cells as visibility:hidden placeholders: parts.ts states hidden parts are not rendered, partKeysForStep must match rendered parts, and hidden text would sit in the DOM. Instead derive the grid row template from the authored item count via a root custom property (the final layout is unchanged, only intermediate stages), use start alignment in the split support column, and reserve the picture's box (empty, no text) or top-align the lede so the heading does not move when the picture is revealed.",
 "needsDecision": false,
 "batch": "lists-and-grids",
 "verdict": "confirmed",
 "verdictReason": "Reproduced on the live wall with outline.reveal. r-cards-4: cell-0 is 41.45x34.51 at stages 2 and 3, then 16.71 tall at stage 4. r-steps-split-3: cell-0 moves y 22.67, 16.49, 10.32. Revealing the picture moves the header from y 25.59 to 13.54. r-cards-split-img-first: cell-0 ends at y=3.11 (inside the safe margin). r-steps-text-6 is stable. Numbers match the report."
}
```

Unresolved ids (not in either result set): F09-coverage