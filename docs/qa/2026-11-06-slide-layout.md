# Slide layout flow for generated tutoring lessons

Scope: how an Outline v1 step becomes pixels on each surface, what an agent is told, what is validated, and what silently renders badly. Sources are four code maps, six stress batches (talking pages, lists and grids, questions, aspects and themes, surfaces parity, generation path) and the verifier verdicts.

## Conventions used below

- Finding ids repeat across batches (two separate F01..F17 series). In this report the aspects-themes series is written AT-Fnn and the generation-path series GP-Fnn. TP, LG, Q and SP ids are unique.
- MAP-nn ids are observations from the code maps that the stress batches did not verify. They are marked "map only".
- Sizes are cqw, percent of slide width. A 16:9 slide is 56.25 cqw high, 16:10 is 62.5, 4:3 is 75. Type size is identical in all three, so aspect changes only the vertical room.
- Where a verifier narrowed or refuted part of a finding, the corrected claim is the one used here (see "Claims corrected by verification").
- Measurements come from headless Chromium, Arial fallback (Inter is never shipped), clean family, safeArea 8, unless stated.

## Layout flow

1. Authoring. An agent or editor writes Outline v1. Wired kinds (cards, steps, term, activity, timer, debrief, break, join, interaction) carry typed text; title, statement, media and blank may also carry boxed `elements` (max 12, integer percent boxes, x,y 0-100, w,h 8-100). Optional closed keys: `layout` (10 values), `reveal` (groups of part keys), `breakoutOf`, `media.place|size|focal|aspect`. JSON Schema: `packages/schema/schema/outline.schema.json` (layout enum :505-509, elementBox :355-366, media :862-882). Text caps are storage caps (title 300, statement 5000, card text 1500 x 8, steps 12 x 1000, prompt 500, bank 24), not capacity.
2. Validation. `validateOutline` runs Ajv, then `semanticErrors` (`packages/schema/src/outline.ts:53-264`), then `pruneStepUnionErrors`. Semantic checks: layout against kind (`E_LAYOUT_MISMATCH`, table `outline-parts.ts:66-82`), reveal keys and groups (`E_REVEAL`), elements only on freeform kinds, html/css safety, iframe/pdf URLs, one-level breakouts, duplicate ids. The result is `{ok:true,...}` or `{ok:false,errors}`. There is no warnings tier and no resolved layout in the response.
3. Layout resolution. `effectiveLayout(step)` (`packages/slides/src/layout.ts:106-110`, table :66-82, mirrored from the schema and pinned by `layout.test.ts`). An authored layout wins only if the kind allows it; otherwise the first entry for the kind is used (statement/title/term/break to title, cards/steps to grid, debrief to text, interaction to poll). It reads only `kind` and `layout`: never text length, item count or media.
4. Picture resolution. `picturePlaceOf` / `pictureSizeOf` (`picture.tsx:31-44`): place defaults split to right, media to fill, everything else to bottom; size defaults 42, clamped 20-100, fill forces 100. `pictureRootProps` (:142-153) writes `data-picture-place` and `--picture-size` on the root. Schema twins (`defaultMediaPlace`, `resolveMediaSize`, `outline-parts.ts:147-164`) have no parity test. Aspect: `resolveMediaAspect` (`aspect.ts:50-66`); focal: `focalStyle` (`focal.ts:53-58`, switches the fit to cover).
5. Design. `resolveSlideDesign` (`deck-design.ts:92-105`) picks master, palette family (six saved families, separate from the five app themes), safeArea 3-12, logo, footer, decoration, background and overlay. `SlideSurface.tsx:11-30` writes them as CSS variables; fonts are `Inter, Arial, sans-serif` / Georgia / Courier New with no `@font-face`.
6. DOM. `StepLayout` -> `StepContent` (`StepLayout.tsx:151-694`) builds one branch per kind. Root class `outline-step--layout-<layout>`. `region()` (:142-145) adds lede/support wrappers only for split, activity and media. `show(key)` (:180) returns null for hidden reveal parts, so nothing is reserved. `hasText()` (:181) keeps empty slots only when editable. Interaction returns null unless `renderInteraction` is set (:628).
7. Geometry. `deck-slide.css`: `.slide-surface` is `container-type:inline-size` with `aspect-ratio`; `.outline-step` is a flex column, `justify-content:center`, `overflow:hidden`, root 2.6cqw (:20-33). Every per-layout size is a fixed cqw value (title h1 5.8, text 4, split 4.4, grid 3.6 with cell text 2.2, activity bullets 2.3, poll options 2.5). The last rule `.slide-surface > .outline-step{padding:var(--slide-safe-area,8cqw)}` (:1273-1279, :1290-1300) overrides every per-layout padding, so the per-layout paddings at :685, :705, :839, :1032 are dead.
8. Fitting. There is none. No autofit, no line clamp, no ellipsis. Overflow is clipped by `.outline-step`, regions, grid cells, text elements and `HtmlHost`. In centred stacks (title, poll, timer, join, split regions, `.outline-step` default) the clip falls equally above and below, so the heading and the start of the text are lost; in flex-start layouts (text, grid) only the tail is lost.
9. Elements. `elementsLayer` (`picture.tsx:46-140`) draws absolute percent boxes (`inset:0`, z-index 1) with `overflow:hidden`, over the flow content, ignoring the safe area, the step heading and master furniture (logo z-index 2 at top 2 / right 3 / 9x4 cqw; footer bottom 1.6).
10. Surfaces. Editor canvas, thumbnail rail, Presenter, console mirror, stage, phone, Desktop audience window and MCP preview all call the same `StepLayout`. They differ in frame, chrome, interaction rendering and which checks run (see next section). Export stores outline plus design only; every consumer re-lays out.
11. Only runtime check: the editor measures the open slide (`slide-overflow.ts:34-56`, 2 px tolerance) and shows `SlideOverflowNotice`. Nothing equivalent runs on the wall, phone, Presenter, Desktop, thumbnails, MCP preview or in tool results.

### Decision points

| # | Where | Decides | Inputs | Fallback or gap |
|---|---|---|---|---|
| 1 | `outline.ts:89-98`, `outline-parts.ts:66-82` | Accept or reject a layout | kind, layout | Error with allowed list; place, size and box not related to layout |
| 2 | `layout.ts:106-110` | Layout drawn | kind, layout | Kind default; content-blind; silent fallback |
| 3 | `StepLayout.tsx:142-145` | Whether lede/support regions exist | layout | Flat DOM for stacking layouts |
| 4 | `StepLayout.tsx:203-695` | Which block lands in which region | kind, picture, hidden parts | Cards, steps, debrief, interaction put the picture in the lede and the list in support |
| 5 | `StepLayout.tsx:180` | Part exists in DOM | reveal | No reserved space |
| 6 | `picture.tsx:31-44,142-153` | place and size attributes | media, layout | Invalid place ignored in slides, passed through in schema |
| 7 | `deck-slide.css:728-759` | How place/size move geometry | attributes, layout class | Rules exist only for split+left, top/bottom max-height/order, region sizing; all else inert |
| 8 | `aspect.ts`, `picture.tsx:178-283` | Media frame | type, aspect, Shorts URL | Video 16:9 (9:16 for Shorts); still without aspect is an unboxed cover image |
| 9 | `picture.tsx:46-140` | Element position | box | No clamp, no collision, overflow hidden |
| 10 | `deck-design.ts:92-109`, `SlideSurface.tsx` | Aspect, palette, safe area, furniture | design | Master default safeArea 8; no contrast check |
| 11 | `deck-slide.css:1273-1296` | Final padding | `--slide-safe-area` | Overrides layout paddings; furniture not reserved |
| 12 | `slide-overflow.ts:34-56` | Overflow notice | DOM scroll sizes | Editor only, one slide |
| 13 | `media-elements.ts:156-171` | Layout switch on picture place | kind, place | Editor only; agent writes bypass it |
| 14 | `StageView.tsx:392-402,549-640` | StepLayout or Question plate | kind | Interaction title, body, media, layout, reveal ignored on the wall |
| 15 | `step-view.tsx:47,64`, `styles.css:1391-1412` | Slide or Reading | learner toggle | Slide default; Reading flattens geometry |

## Surface differences

| Surface | Frame and scale | What differs for the same slide |
|---|---|---|
| Editor canvas | width min(100cqw, 100cqh x aspect, 1000px); `fit` off; overflow notice shrinks the canvas while measuring | `min-height:1em` on every contenteditable part lets flex items shrink below content, so parts overprint where the wall clips (TP-05, SP-03). Empty-slot placeholders and watermarks; 'Material N' watermark on filled lines (LG-11). Renders interaction as the poll skeleton. Notice has false positives (AT-F16, GP-F06) |
| Thumbnail rail | about 56-58 px wide, `fit` | Drops html, svg, iframe, pdf elements and non-image media; ignores hidden parts; blank slides labelled 'Empty slide' (TP-18, SP-15) |
| Presenter (non-live) | 820 px cap, `renderInteraction` skeleton | Shows interaction title, body, options as authored; no tutor notes; no overflow signal |
| Console mirror | stage app embedded, 820 px, `hideRail` | Viewport-unit counter text clipped in a small mirror (SP-07); chart text in rem/vw, not slide-proportional |
| Stage wall | `fit`, 28 px outer padding; 240 px rail on question steps | Question plate replaces StepLayout for interactions (prompt and chart only); slide 19-27 percent smaller on question steps (AT-F14); no overflow signal; true clip behaviour |
| Phone Slide | same composition at about 342 px | Body 7.5-9.75 px, footer 5.5 px, 6 px at 320 wide (SP-12, LG-13) |
| Phone Reading | one column, rem type | Elements stacked by array order, term and heading flattened to body size (SP-14); page cannot scroll below 640 px width (SP-01) |
| Learner page | flow document | No slide geometry |
| Desktop audience | Presenter framing, live uses stage | Same as Presenter or stage |
| MCP preview | fixed 16:10 box, no Tailwind preflight | Letterboxed for other aspects; images and headings lose preflight resets (unverified) |
| Office, export | outline only | Office hides captions and adds a toolbar overlay; export has no geometry |

## Generation path

What an agent is told:
- `SERVER_INSTRUCTIONS` (`packages/mcp/src/server.ts:35-56`) and the `outline_validate` description (`tools.ts:123-174`) cover the schema resource, typed layout, reveal and part keys, html sanitising, iframe/pdf and `picture_search`. They do not list the ten layouts, the kind-to-layout table, which `media.place` each layout honours, any text or item budget, that px/vw in html do not scale, that boxed text is cut mid-line, or that elements overlay a blank step's heading.
- Schema descriptions are wrong in three places: the box is "percent of the 16:10 slide" (default is 16:9), `media.size` is "width for left/right, height for top/bottom" (false in split, TP-12), `media.place` says only "default follows the step layout".
- `docs/AGENT.md:250` omits join and blank from the layout list; `docs/TUTORING.md` size text repeats the split error and its part-key list omits stat, gap-N and el-id.
- The Desktop BYOK host reads neither `SERVER_INSTRUCTIONS` nor the schema resource; its `add-image` profile omits place, size and layout (map only, MAP-01). Prepare-pane agents cannot call `deck_preview`.
- The only exemplars are the eight lessons in `examples/tutoring/*.yaml`. They are not served to agents. They use no term, media, elements, layout or reveal; statement bodies are 47-305 chars, cards 2-3 items, activity 2-4 instructions. The skill `prepare-a-language-outline` tells agents to author term steps with staged reveal and grammar breakouts, which the samples do not do (MAP-02, map only).

What validation catches:
- Unknown kind, layout not allowed for the kind (lists allowed layouts), bad reveal keys (lists the step's keys), elements on wired kinds, duplicate ids, bad breakoutOf, html markup, iframe/pdf URLs, option counts.
- Error quality problems: unknown enum values do not list the allowed values; a cards step with one item returns an extra "items/0 must be string" (LG-15); statement over 5000 chars reports both 3000 and 5000 caps; unquoted YAML colons give raw yaml messages (GP-F09).
- Contract bug: `gap-N` is documented and generated by `partKeysForStep` but rejected by the `partKey` pattern (GP-F10).

What silently renders badly (validates with no signal):
- Any text over capacity (all 14 generation-path outlines and all 164 list-corpus steps validated; 31 and 64 of them clip).
- `media.place` or `media.size` combinations a layout cannot hold, including split with size 100 or place fill.
- Element boxes with x+w or y+h above 100, overlapping boxes, boxes over the heading, logo or footer, 25 percent spans.
- Palettes and image overlays with contrast near 1:1.
- Interaction title, body, media and layout that the wall never draws.

## Failure catalogue

Grouped by root cause. Severity is the verified value. "Decision" refers to the product decisions section.

### RC1. Fixed type scale with no capacity model and clipped regions

Conditions: any wired kind above a modest amount of text, default layout. Aspect only moves the threshold (16:9 worst, 4:3 forgiving). Root cause: `deck-slide.css` per-layout cqw sizes and `overflow:hidden` (:20-33, :682-700, :836-885, :1080-1190), `layoutForKind` content-blind (`layout.ts:106`), schema caps far above capacity.

| Id | Measured | Fix |
|---|---|---|
| TP-03 (medium), AT-F02 (high), GP-F02 (medium) | Statement body: 250 fits, 350 clips at 16:9, 480 French chars clips 7.1 cqw top and 6.5 bottom (heading shows only its last word), 600 chars root +184 px, 1200 +699, 5000 +4121. Title heading 150 chars clips at 16:9/16:10, 220/300 chars root +153/+465 px. Term 200 chars +815 px. Verified: the editor overprint in TP-03 is editor-only, and the 43-char term flag is a detector artifact | Safe centring in CSS (heading kept, tail still lost); capacity policy: D1 |
| LG-05 (high), AT-F04 (high) | Cell height depends only on count: 2 cards 34.5, 3-4 cards 16.7, 6 cards 10.95, 8 cards 7.94 cqw. 6 cards of 55 chars clip 6 lines at 16:9, FR/DE 80-95 chars clip 11, 140-char cards clip at 3 cards, 8 cards clip at 40 chars. Forcing 3 columns for 6 cards only cut the clip from 3.91 to 1.16 cqw. Cut falls mid-line | D1 |
| LG-06 (medium) | Steps grid rows 34.5 (2), 10.8 (6), 6.1 (9), 4.9 (12) cqw. Badge (1.8em) cut at 12 items. Text layout holds about 6 one-line items. 2 items become two 34.5 cqw boxes with one line each | Badge follows row height (no decision); capacity D1 |
| LG-07 (high) | Activity lede 49 cqw, support column 32 cqw rendered empty (38 percent of slide blank); 6 medium instructions lose 3 lines, 12 short lose 4. Widening alone does not fit 9 short instructions | Widen lede from authored presence of materials or picture (not `show('materials')`); rest D1 |
| AT-F08 (high) | 5 instructions plus materials: 13.7 cqw clipped at 16:9, 7.4 at 16:10, 3.7 at safeArea 3, 0 at 4:3 | D1 |
| SP-09 (medium) | Debrief 5 prompts of 80-100 chars: 97 px over on the 1280 wall, 143 FR/DE, last prompt on the footer | D1 |
| LG-14 (low) | 3 cards leave a half-width orphan cell | D1 (count tiers) |
| LG-12 (low) | Text-layout lists run to 54.2 cqw against a 48.25 limit (inside the bottom margin) before clipping | Clip in-flow content at the content box, not the whole step (elements layer must stay unclipped) |

Fix per group: no content-blind default can be right for all inputs, so the real fix is the capacity policy (D1) plus feedback (D2). No-regret renderer changes are listed in cluster C1.

### RC2. Centred overflow loses the start of content

Conditions: any over-full column with `justify-content:center` (title default, poll, split lede/support, `.outline-step`) or `flex-end` (activity support). Root cause: `deck-slide.css:27` and split regions :761-770; materials support :1096-1103.

- AT-F02 / GP-F02 / TP-03 wall: heading top clipped.
- SP-04 (medium): German activity split loses the heading's first line and 14 tokens; verified that `flex-start` only moves the cut and `safe center` is the right change; the picture-crop claim is refuted (`media.aspect` already prevents it).
- LG-08 (medium): 12 materials show items 3-12, losing the caption and the first items.
- Q06 (medium): question skeleton in Presenter and editor cuts the prompt's first line (up to 114 px) and draws the 24-word bank as a vertical list with no CSS (`outline-step__word-bank` appears in no stylesheet).
- Verified: `justify-content:safe center` keeps the heading but raises the body clip (21.5 cqw), so it changes which text is lost; it must ship together with D1.

### RC3. Editor-only `min-height:1em` makes the editor disagree with every other surface

Conditions: any over-full flow column in the editor. Root cause: `deck-slide.css:1267-1269` `.slide-surface [contenteditable][data-placeholder]{min-height:1em}` replaces the flex automatic minimum, so non-empty editable parts shrink below content. Verified by injecting `min-height:auto` or `flex-shrink:0`: the editor then matches the wall.

- TP-05 (medium), LG-10 (medium), AT-F03 (high), SP-03 (medium): same bug seen four ways. st-def-right-50 header visible 0.845 editor vs 0.422 wall, root +87 vs +213 px; 6 of 164 slides overprint in the editor only; the notice names the squeezed heading and not the real culprit.
- AT-F16 (low) and GP-F06 (confirmed, narrowed): the notice also fires on correct term, stat and blank headings because scrollHeight exceeds clientHeight by more than 2 px with line-height .85/.98 (46 of 55 decks for 'la correspondance'). Fix: measure text range rects against clipping ancestors, skip overflow-visible parts. The 12-item grid notice is correct (badge cut).
- LG-11 (medium), GP-F15 (low): placeholder watermark 'Material N' on filled lines because `partValue` has no `material-N` branch. Fix in `SlideCanvas.tsx` empty check, not in `partValue` or `PropertiesPanel.tsx`.
- Order of work: ship the CSS fix first, then re-baseline `slide-overflow.ts`; the notice will start naming the real tight items.

### RC4. Picture place and size are defined only for split and media

Conditions: agent-authored `media` with place left/right/fill outside split, top/bottom in split, or size at the ends. The editor avoids these through `layoutForNewPicture` / `layoutForMediaPlace`; agent and BYOK writes do not. Root cause: `deck-slide.css:735-759` rules, `StepLayout.tsx` puts the picture in flow after the heading for non-split layouts, `outline.ts` has no place/size/layout relation.

| Id | Condition | Measured | Fix |
|---|---|---|---|
| TP-01 (high), F06 AT (AT-F06, high) | statement/title/term default layout or text layout, place left/right/fill | Picture 84 x 47 cqw natural size; header y -0.9, body squeezed to 2.5 cqw; wall header only 42 percent visible; layout text + place left on a portrait picture is 84 x 112 cqw; place top size 40 gives an 84 x 16 strip above the heading. Only top/bottom size 20-50 fits | Cap in-flow picture height (no contract change); then D3 |
| LG-03 (high), GP-F03 (high) | cards grid or steps text with place right/fill or default | 84 x 42 cqw picture, all 9 text lines hidden (34 words on the wall); size ignored; default 'bottom' draws the picture above the list; place top draws it above the heading | Same cap; D3 |
| TP-02 (high), LG-04 (medium), AT-F05 (high) | split with size 100 or place fill | Text column width 0, 62 of 62 lines hidden; size 80 leaves 13.8 cqw column ('Bonjo/ur a/tous'); same at all aspects except size 80 at 4:3 | Clamp split picture column (about 60-65 percent), fill on split falls back; D4. Verified: `overflow-wrap:break-word` does not help |
| TP-12 (medium) | split with place top/bottom | Identical to right; size acts as column width, contradicting the documented height meaning | D4 |
| TP-16 (low) | term headword 4.2em in split without picture or narrow column | 'la / boulange / rie'; meaning clips | Give term and stat the split heading size in split layouts (no decision) |
| LG-01 (high) | split cards, steps, debrief | Picture is in the lede (left by default, place right default); place left puts it on the right; size is the list width, so raising size shrinks the picture (cs-default 45.7 cqw picture vs 35.3 list) | Renderer-only: stamp which region holds the picture and size/order that region (no decision) |
| LG-02 (high) | same, portrait or square picture | 1:2 portrait 45.7 x 91.4 cqw at y -14.8, heading at -20.4, 44 percent visible; fails at 4:3 and 16:10 too | Box the lede picture to the region, safe centring (no decision) |

### RC5. Media layout gives the picture the leftovers

- TP-10 (medium): caption and lede are `flex:none` with no cap, so a 1000-char caption makes the picture height 0 at 16:9 and 16:10; 320 chars gives 16.5 cqw; 280-char title 14.3 cqw. Fix: cap caption and lede height, minimum picture height (no decision).
- TP-09 (low), AT-F07 (medium), SP-05 (medium): picture box is 84 x 33.5 cqw, cover crop shows 71 percent of a 16:9 photo, 30 percent of a portrait, 15 percent of a tall image; with long text 16-19 percent. Verified: the box is about 50 percent of the slide, the 8 cqw inset is deliberate, and cover with `media.focal` is the documented crop model; the long-title squeeze is only part of the cause. The default fit is a policy question: D10.

### RC6. Hidden reveal parts are not rendered, so everything reflows

- LG-09 (medium), SP-11 (medium): cards resize 34.5 to 16.7 cqw as they appear (4:3 53.3 first card); steps pass through six sizes; split items move 12.3 cqw upward over three reveals; revealing the picture last moves the heading 12.1 cqw. Text and activity layouts are stable. Verified correction: do not use `visibility:hidden` placeholders with real text (`parts.ts` requires hidden parts not rendered). Derive the grid row template from the authored item count via a root custom property, start-align the split support column, and reserve an empty picture box.
- TP-13 (medium): centred title/statement/media stacks re-centre: statement header 24.9 to 18.7 to 10.0 cqw; with a stat the heading moves down 5.3 cqw when the stat appears, because the DOM order is stat then header. Blank-step element reveals are stable. D6.

### RC7. No fit, contrast or bounds signal reaches the agent

- GP-F01 (high), AT-F09 (medium), Q14 (medium), LG-15 (medium): validation returns ok for everything that clips; `OutlineValidateResult` has no warnings channel; limits are storage limits. Budgets depend on aspect, safeArea and font (AT-F13), so numbers in tool text must be scaled. D1, D2.
- TP-07 (medium), AT-F12 (low), GP-F08 (confirmed, narrowed), SP-02 (medium): `{x:90,y:90,w:50,h:30}` validates and renders 6.6 percent visible (root +111 px editor, +205 wall, +39 phone); text boxes lose 3 of 10 lines (SP-02: 4/11 fr, 6/13 de); source line at y 88-96 sits on the footer; the 16:10 text is stale. Verified: overlap of elements with flow text on talking kinds is allowed by contract and span size 25 is the documented minimum. D5 and the description fix.
- TP-19 (low), GP-F13 (low): agent text omits layout table, place table, budgets, px/vw note, heading zone note.
- GP-F09 (low), LG-15: enum errors do not list allowed values; union-branch noise; YAML colon hint missing. GP-F10 (medium): `gap-N` pattern bug. GP-F14 (low): design needs a full palette; family alone fails (the error already lists the required keys); D19.

### RC8. Furniture, fonts, html and span sizing

- TP-04 (high, confirmed, no decision): html px/vw are not slide-proportional (40 px text is 4.1 cqw editor, 2.2 cqw wall, 11.7 cqw phone; 4vw is 6.5 cqw editor vs 4.2 wall) and `position:fixed` escapes the box on the wall. `contain:paint` on `.outline-step__element--html` confines it (verified). Tool text should say to author in em, percent or svg viewBox.
- AT-F11 (medium): safeArea 3 lets headings run under the 9x4 cqw logo and last lines into the footer; safeArea 12 removes 20 percent of the height (corrected from 17). GP-F12 (low): footer collides with grid cells at safeArea 3; reserving footer height in the bottom padding is unambiguous. Logo reservation is D16.
- AT-F13 (medium): `Inter, Arial, sans-serif` resolves to Arial everywhere tested; Verdana raises flagged steps 8 to 12 of 63; an author with Inter installed sees different wrapping from a school PC. D15.
- TP-15 (low): span 25 percent is 0.65 cqw (2.4 px on a phone); `role: heading` text is 2.6 cqw, same as body. D14.

### RC9. Participant phone

- Q01 (high), SP-01 (high), SP-13 (medium): `.page{height:100dvh;overflow:hidden}` with `.learner-slide{flex:none}` below 640 px and `.page__body{display:contents}`: nothing scrolls. Reading cannot reach the last line (patterns last line at 1183 px in an 844 px viewport); answer forms lose options and Send (match-6-long Send at y 1217 of 844; choice with 4 short options at 320x568 loses option D). One rule `@media (max-width:639px){.page{overflow-y:auto}}` fixed all three at 390x844, 320x640 and 320x568 (verified); 768 and wider is already fine. Check slide view and ink overlay after the change.
- SP-14 (low): `.outline-step p{font-size:1rem}` (0,4,1) beats the term and stat rules; term 37.3 px in Slide, 17 px in Reading.
- SP-12 (medium), LG-13 (low), GP-F11 (low): Slide text 7.5-9.75 px at 390, 6 px at 320, materials caption 5 px, eleven different list sizes between 1.5 and 2.73 cqw. D8, and Reading must scroll first.

### RC10. Question plate and charts on the wall

All from `apps/stage/src/stage-ui.css` and `packages/charts`.
- Q02 (high): ranking labels cut to one letter (band-axis ticks with `margin.left` 8). Draw HTML `.barrow` labels like the choice chart.
- Q03 (high): choice labels shrink to `min(3.2cqw,row*0.26)`: 5.4 px at 1920 for 8 long options, 0.9 px at 1280, 2.5 px at safeArea 12. The body is only about 230 px after prompt, caption and 8 cqw padding, so a label floor alone fails. D11 then D12.
- Q04 (high): fill-the-gaps shows 3 of 8 gaps, bank chips 8.8 px.
- Q05 (high): 6 long match pairs show 1 pair at 1280x720; n=5 at 1920 clips 42 elements. Two-column pair grid.
- Q07 (medium): visible results caption repeats the chart (108 px at 8 options); it is deliberate for PRD STAGE-06 and the UC-01 comment contradicts the CSS. D11.
- Q08 (medium): block padding uses the safe area in cqw (about 134 px above and 164 px below at 1920x1080). `cqh` cannot be used because `.slide-surface` is inline-size only. D11.
- Q09 (medium): column labels overprint (13 overlaps at 1920). Q10 (medium): pie/donut/radial legend crowds out the plot. Q11 (medium): scale end labels overprint ticks. Q15 (medium): histogram omits the correct answer and prints '1 answers'.
- Q12 (medium): prompt fixed at 4cqw whatever the length; 200 chars gives 6.5 px labels. D11.
- Q13 (medium): display values such as `cards`, `tally`, `emoji`, `number`, `dots`, `sentence`, `rank` draw the default display; `wordcloud` alias not handled. D13.
- Q16 (low): secondary text 14-16 px. D12. SP-07 (confirmed): `.pending__value` and `.pending__label` use viewport units, so the 820 px mirror clips the label (fix in cqw). AT-F14 (low): question slide is 19-27 percent smaller because of the documented 240 px rail. D17. AT-F17 (low): English chrome on French and German lessons. D18.
- SP-06 (medium), GP-F05 (medium): the wall draws prompt and counter only; step title, body, media and options that the editor, Presenter, Desktop and MCP preview show are absent. D7. The editor poll skeleton also collides with long prompts (editor defect, fix in RC2).

### RC11. Authoring surfaces

- TP-18 (low), SP-15 (low): thumbnails drop html/svg elements; blank is labelled 'Empty slide' in the editor and 'Slide' in the live rail (two title helpers: `blocks.ts:467` and `live/utils.ts`). `STEP_KIND_WORDS` is classified in `outline-fuzz.ts`; update it with the change.
- GP-F07 (medium): fixing overflow takes up to about 21 actions to split a 10-item steps slide; panel copy says 'resize its box' for wired steps. Add a split operation to `outline-edit.ts`, classified in `outline-fuzz.ts`.

### RC12. Contrast

TP-06 (medium), AT-F01 (high), GP-F04 (medium): the editor hard-codes new image overlays to white 0.8 (`properties/deck-design.tsx:33`) whatever the family. Board family text is 1.0-1.4:1 on it; clean muted body 4.08-4.19:1; palette #8A8A8A on #F4F4F4 is 3.1:1. Brand kits are checked (`brandPaletteIssues`); deck design and overlays are not. Text elements over pictures and explicit span colours are author choices and not a render defect. D9.

### Claims corrected by verification

- TP-03: the 150-char title overprint is editor-only; the term 'clip' flag is a detector artifact; the stat case is tight, not overprinted.
- TP-09: picture box is about 50 percent of the slide, not 35; 'full-bleed' is a stale code comment.
- TP-16, SP-04: proposed `overflow-wrap:break-word` or `flex-start` fixes are wrong.
- LG-09: hidden placeholders must not carry text.
- LG-12: clipping the whole step at the content box would break the elements layer.
- LG-04, GP-F03: a schema cap of 70 contradicts the documented 20-100 range (MEDIA_SIZE_MAX 100).
- SP-05: the long title is not the main cause; a short title still shows 25.8 percent of a portrait.
- AT-F11: safeArea 12 is -20 percent, not -17. SP-07 and AT-F14: the narrower question plate is documented design; only the mirror clip is a defect. Q10: radial has 1 overlap at 1920, not 15.
- GP-F13: the access-link point is already documented in `run-a-session` and `prepare-a-tutoring-outline`. GP-F14: the error already lists required keys.
- AT-F17: strings live in `viz/index.tsx` and `StageView.tsx`; there is no localisation layer.

## What works well and must be kept

- One renderer and cqw scaling: part boxes agree within 1.0 cqw across Presenter, mirror, stage at 1024/1280/1920, phone Slide, Desktop and (apart from RC3) the editor. This is the UC-40 guarantee.
- Closed enums: no case needed coordinates or CSS; all findings are fixable in product CSS, chart code or contract text. `E_LAYOUT_MISMATCH`, `E_REVEAL`, `E_UNKNOWN_KIND`, html and reference errors are actionable.
- Focal points (all nine words) work on split pictures, media pictures and element images; aspect frames contain without distortion; portrait video is centred and undistorted.
- Elements on blank steps are slide-proportional and do not reflow on reveal; svg with viewBox scales everywhere; sanitised html clips to its box (only `position:fixed` escapes).
- Short and medium content fits at all aspects: titles to 60 chars, statements to 250, cards 2-4 at 100 chars, steps 2-6 short, activity 1-6 short, debrief 2-6 in text. Split with size 20-50 left/right is well behaved. German compounds wrap with no horizontal clip.
- 4:3 and 16:10 give strictly more vertical room at identical type size.
- Reading on the phone reflows everything without clipping once it can scroll; Reading at 768 reaches every line.
- Reveal part keys gate exactly the intended parts; hidden parts leave no ghost boxes; breakouts render like normal steps and Next skips them.
- Deck palettes pass contrast on plain backgrounds (11.35-18.5 foreground, 5.14 or more muted); app themes keep chrome at 4.5:1 or better and the slide keeps its own palette inside every theme; letterboxing is clean.
- Choice charts with 2-4 short options, n=1 handling and the wall prompt at 4cqw for 60-100 chars are legible from the back row.
- The editor overflow notice agrees with measured clipping for most real clipping (39 of about 41 clipped slides in the generation corpus).
- Reduced motion is honoured (stage tween, CSS durations zeroed, marquee stops).

## Test gaps

Pinned today: layout table mirror (`layout.test.ts`), SSR markup and part keys per kind and layout (`StepLayout.test.tsx`), aspect tokens, schema layout/reveal/element rejections, edit validity and YAML round trip (`outline-fuzz.test.ts`), UC-40 proportional parity for 6 templates plus a split statement and a media step, UC-41 editor-only overflow detection with synthetic content, UC-14/21/29/30/39 shipped content fits.

Not pinned, with the sharp test that would pin it (each asserts a measured property, not that a constant equals itself):

1. Capacity of wired kinds at agent-shaped content. A browser spec (next free journey number, UC-44 today, plus `docs/journeys`) renders cards 4x100, steps 6x60, activity 5x55, debrief 5x80, statement 350 and 480, term, choice 8 options at the documented budgets on 16:9, 16:10, 4:3, safeArea 8 and 12, on the stage wall and phone Slide, and asserts zero clipped text lines. If a budget table or estimator ships (D1, D2), a second case asserts the estimator flags budget+1 and passes budget on the same matrix, so the table cannot drift from CSS.
2. Place by size matrix. For every kind x allowed layout x place x size in {20, 50, 80, 100}, with landscape, portrait and square pictures: heading and every text part keep width above a floor and visible fraction 1, picture box inside the content box. This covers TP-01, TP-02, TP-12, LG-01..04, AT-F05, AT-F06.
3. Editor to wall geometry on an overflowing step. One statement at 480 chars: header box height equal editor vs stage within 0.1 cqw and no text-on-text overlap in the editor (RC3). Plus: no `[data-slide-overflow]` on a plain term, stat and blank heading (AT-F16).
4. Reveal stability. For grid, split, text and activity, each previously shown part keeps position and size within 0.1 cqw at every reveal stage; title stacks per D6.
5. Phone reach. At 360x640, 390x844, 320x568: Reading reaches the last line of a 6-item steps slide; a 10-option choice and match-6 expose Send; Reading term font larger than body font. UC-40 explicitly excludes Reading and answer geometry.
6. html element containment. A `position:fixed` child paints no pixel outside its box on the stage; px and vw sizes documented (no equality assertion between surfaces).
7. Contrast. For each of the six families, the default overlay colour blended over the palette background keeps foreground contrast at 4.5:1 or better using the existing `colorContrast` (pure unit test); deck design and overlay checks if D9 adds warnings.
8. Wall detector. Run the existing overflow measure logic against the stage wall for the corpus (QA only), so wall-only clipping has a test; today only the editor is measured.
9. Contract unit tests: every key from `partKeysForStep` for every kind matches the `partKey` pattern (catches `gap-N`); `picturePlaceOf`/`pictureSizeOf` equal `defaultMediaPlace`/`resolveMediaSize` over valid and invalid places and sizes; a one-item cards step returns exactly one error; unknown enum errors list allowed values; element box x+w and y+h cases follow D5.
10. Editor writes. A table test that every `layoutForMediaPlace` and `setMediaSize` result is a place and size pair the renderer honours (pure function), added as a fuzz invariant in `outline-fuzz.ts` beside validity; `SlideCanvas` test that a filled material line has no `data-empty`; thumbnail test that html and svg elements draw a placeholder; label tests for blank slides in both rails.
11. Charts. Ranking labels are full text in the DOM with width above one character at 1280 and 1920; match-6 shows all pairs; scale end labels do not intersect ticks; histogram marks the correct value; label font floor once D12 is decided. The Question plate with prompts of 200 and 500 chars at 1280 and 1920.
12. Not covered anywhere: Desktop audience window beyond non-live en-169, MCP preview without preflight, Office embed, lane filtering against reveal keys (`cell-N` renumbering), Safari and Electron on Windows, real touch devices, dark app themes on question slides, non-Latin and RTL text, Inter installed vs Arial.

## Fix clusters

Clusters are file-disjoint. Decision-gated work is listed in the decisions and extends the owning cluster once decided; the cluster `findingIds` hold only work that needs no decision, except where noted as partial.

## Product decisions

See the structured decisions. Recommended order: D1 and D2 first (they unblock most gated findings), then D3 and D4 (picture), then D11 and D12 (question plate), then the rest.
