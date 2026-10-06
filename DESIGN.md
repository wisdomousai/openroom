---
name: OpenRoom
description: Three-surface classroom tool — paper on a desk, two hues, two shadows
colors:
  paper: "#FFFFFF"
  canvas: "#FAF9F8"
  chrome: "#F3F2F1"
  desk: "#E8E6E4"
  ink: "#242424"
  body-ink: "#424242"
  muted-ink: "#616161"
  tertiary: "#8A8886"
  disabled-ink: "#A19F9D"
  border: "#E1DFDD"
  hairline: "#EDEBE9"
  input: "#D2D0CE"
  action-blue: "#0F6CBD"
  action-blue-hover: "#115EA3"
  action-tint: "#EBF3FC"
  action-tint-border: "#CFE4FA"
  live-orange: "#CA5010"
  live-orange-hover: "#9C3D0B"
  live-tint: "#FDF1E8"
  live-tint-border: "#E8B694"
  destructive: "#A4262C"
  destructive-tint: "#FDF3F4"
  chart-1: "#0F6CBD"
  chart-2: "#107C41"
  chart-3: "#B88217"
  chart-4: "#B4009E"
  chart-5: "#5C2E91"
  correct: "#0E6B39"
typography:
  display:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "2px"
  md: "4px"
  lg: "6px"
  xl: "8px"
  pill: "999px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
  button-live:
    backgroundColor: "{colors.live-orange}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
---

# Design System: OpenRoom

## Overview

OpenRoom is a classroom file the teacher opens, edits, and starts. The visual
system is **Fluent-flavoured Office grammar**: a page on a desk, a connected
ribbon, three fills that are never the same colour next to each other, and
exactly two meaningful hues.

The palette below is the **default** light table. Five theme identities —
default, chalkboard, paper, projector, sherbet — each in light and dark, must
stay visibly distinct while re-colouring the same roles. `projector` keeps
radius 0 and maximum contrast. `sherbet` keeps its 1rem identity. `paper` and
`chalkboard` keep their serif display faces.

**Key characteristics:**
- Structure comes from **fill**, not from a 1px box around every region.
- Blue = you can act. Orange = the class is in it.
- Weights are 400 and 600 only. Nothing is heavier than semibold.
- Two shadows are allowed; gradients, blur, and glow stay banned.

## The three surfaces

No two adjacent surfaces share a fill. The page is the only pure white with a
shadow.

| Role | Hex | Token | Where |
| --- | --- | --- | --- |
| Paper | `#FFFFFF` | `--card` / `--background` on the page | The slide, task panes, dialogs, menus, list cards |
| Canvas | `#FAF9F8` | `--background` | Thumbnail rail, pane sub-regions, dialog footers, the second column of a split slide |
| Chrome | `#F3F2F1` | `--chrome` / `--secondary` / `--muted` | Title bar, ribbon tab strip, status bar, left nav, control tracks |
| Desk | `#E8E6E4` | `--desk` | The field the slide floats on. The only place `--shadow-page` is allowed |

`--secondary` and `--muted` are both `#F3F2F1` on purpose.

## Neutrals

| Role | Hex | Token | Use |
| --- | --- | --- | --- |
| Ink | `#242424` | `--foreground` | Titles, row names, values |
| Body ink | `#424242` | (compose) | Long-form body copy |
| Secondary | `#616161` | `--muted-foreground` | Help text, captions |
| Tertiary | `#8A8886` | (compose, captions) | Group labels, meta lines |
| Disabled | `#A19F9D` | (compose) | Disabled text, abstention bars |
| Border | `#E1DFDD` | `--border` | Pane and card edges |
| Hairline | `#EDEBE9` | `--hairline` | Dividers inside a pane or list |
| Input | `#D2D0CE` | `--input` | Control borders |

A field is signalled by its **fill and its focus bottom-border**, not by a
heavier stroke. A focused text field takes `border-bottom: 2px solid` in the
accent.

## The two meaningful hues

| Role | Rest | Hover | Tint | Tint border | On-tint text |
| --- | --- | --- | --- | --- | --- |
| **Action blue** — *you can act* | `#0F6CBD` (`--primary`) | `#115EA3` | `#EBF3FC` (`--accent`) | `#CFE4FA` | `#115EA3` (`--accent-foreground`) |
| **Live orange** — *the class is in it* | `#CA5010` (`--live`) | `#9C3D0B` (`--live-hover`) | `#FDF1E8` (`--live-tint`) | `#E8B694` | `#9C3D0B` (`--live-tint-foreground`) |

Blue: primary buttons, the selected slide, the active pane tab, links, focus
rings, selection, the "you can act" half of any toggle.

Orange: **Start session**, the join code, interactive-block markers, the live
dot, a running clock, the last-ten-seconds fill, the Q&A-on-the-wall action,
and **every primary button in the participant app**. Blue never appears on a
button a student presses.

Nothing else is coloured. A third hue means a third meaning, and there isn't
one.

## Results palette

Only inside a chart, a tally, or a bar. Fixed order.

| Slot | Hex |
| --- | --- |
| `--chart-1` | `#0F6CBD` |
| `--chart-2` | `#107C41` |
| `--chart-3` | `#B88217` |
| `--chart-4` | `#B4009E` |
| `--chart-5` | `#5C2E91` |

Abstention (`I don't know yet`) bars are `#A19F9D`. A correct-answer call-out
is `#0E6B39` text with a `✓` and the word "correct".

## Destructive

`--destructive` `#A4262C`. Destructive tint `#FDF3F4`. Foreground on the solid
fill is white.

## Typography

```
'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system,
'Helvetica Neue', Arial, sans-serif
```

Segoe first because most teachers are on Windows and it is what Office uses.
`paper` / `chalkboard` keep their serif display face; `projector` keeps its
condensed face.

Weights are **400 and 600 only**.

Console type scale (`apps/workspace/src/index.css`). Six reading steps:

| Token | Size / weight | Job |
| --- | --- | --- |
| `text-page-title` | 28 / 600, lh 1.2, ls −0.01em | The one `<h1>` a page gets |
| `text-screen-title` | 20 / 600, lh 1.3 | A screen or major region |
| `text-section` | 16 / 600, lh 1.4 | A heading inside a panel |
| `text-row-title` | 14 / 600, lh 1.45 | The name on a list row |
| `text-secondary` | 14 / 400, lh 1.5 | Body copy and help text |
| `text-caption` | 12 / 400, lh 1.45 | Ribbon group captions, pane section labels, row meta. Sentence case. |

Three role steps for the places the console is not read at desk distance:

| Token | Size / weight | Job |
| --- | --- | --- |
| `text-option` | 17 / 400, lh 1.4 | A phone-sized option or action row — presenter remote, live ribbon |
| `text-title-bar` | 15 / 600, lh 1.35 | The app or session name in a title bar |
| `text-rail` | 13 / 600, lh 1.4 | A dense rail or side-list row |

Every step carries its documented weight. A call site that wants the other
weight at the same size says so — `text-rail font-normal` for dense meta beside
a rail row, `text-option font-semibold` for a full-width touch action. Nothing
outside these nine steps: `text-[13px]` and friends are a defect.

`text-label` is **deleted**. Do not revive uppercase tracked caps.

Counts, codes, timers and tallies keep `font-variant-numeric: tabular-nums`.

## Radius ramp

`--radius` is the theme's *base control* radius (`0.25rem` on default). The
ramp is meaning, not decoration:

| Token | Value | Where |
| --- | --- | --- |
| `--radius-sm` | `2px` | Hairline chips, progress bars, bar-chart fills |
| `--radius-md` | `4px` | Buttons, inputs, tabs, small toggles, menu items, gallery thumbs |
| `--radius-lg` | `6px` | Slide thumbnails, list rows, the slide on the desk, segmented tracks |
| `--radius-xl` | `8px` | Task panes, cards, dialogs, the page, boards |
| pill | `999px` | Status, join code, chips, the corner timer |

`projector` overrides the whole ramp to 0. `sherbet` scales it up.

## Elevation

Two shadows, and only these two:

| Token | Value | Only on |
| --- | --- | --- |
| `--shadow-page` | `0 1px 2px rgba(0,0,0,0.12), 0 6px 20px rgba(0,0,0,0.10)` | A page or slide floating on the desk |
| `--shadow-overlay` | `0 8px 32px rgba(0,0,0,0.26)` | Dialogs, menus, and anything over a scrim |

`projector` sets both to `none`: it fills the viewport, so there is no desk to
float above and nothing to cast onto.

Everything else stays flat. No gradients, no blur, no `backdrop-filter`, no
glow — including SVG and the stage's WebGL ambient layer. Focus is still an
`outline` in `--ring`, offset 2px.

Dialog scrim: `rgba(32,31,30,0.38)` (`--scrim`). The page behind a dialog
stays legible.

## Named rules

**The Chrome-vs-Paper Rule.** No two adjacent surfaces share a fill. Chrome is
never white; the page is the only pure white with a shadow.

**The Two-Hue Rule.** Blue = you can act. Orange = the class is in it. A third
meaning needs a word, not a colour.

**The Pane-or-Dialog Rule.** The pane holds what you adjust while looking at
the slide. A dialog holds what needs its own session — a search box, an upload, a
preview, a list of answers. If a control would make the pane scroll to reach a
Done button, it belongs in a dialog.

**The Colour-Plus-Word Rule.** A colour never carries meaning alone. Live
orange always sits next to a word ("Live", "Asks the class", "on the wall").
Correctness is `✓` + the word "correct", never colour alone.

**The No-Whisper Rule.** Borders and secondary text never drop below
AA-relevant presence. `#E1DFDD` on `#FFFFFF` is deliberately quiet because
**fill** now carries structure — the border is an edge, not the skeleton. An
8%-alpha gray border is still a defect.

**The Theme-Role Rule.** Components reference token roles (`--primary`,
`--live`, `--desk`, `--shadow-page`), never hex values. All five themes
re-colour the same roles.

**The No-Kicker Rule.** No eyebrow or kicker labels above headings. Headings
carry their own weight.

**The No-Ledger Rule.** Teacher-facing UI never renders a timestamp or
relative time, a usage tally ("Times taught", session counts), a delivery status
word as row or tile data (`draft` / `scheduled` / `completed`), or a version
stamp — anywhere outside three sanctioned homes: (1) the **History tab** of
the deck editor's task pane, (2) the two **admin tables** (Settings API
tokens, Space members) and the context-link lifecycle card (credential expiry
is security, not delivery), (3) a **live session's own live counts**
(joined / answered / votes / countdown). A row states what is *in* the file.
Sorting by recency silently is fine; exposing the sort as visible metadata is
not. `Live now` on Home is a state of *now*, not history — allowed with its
word.

The Kind Legend is **retired**. A row says what it is in words, or the
thumbnail says it. There is no colour swatch per row type.

## Layout

Console: three-column live layout (rail / detail / aside) collapsing to two at
`md` and one on narrow. Participant: single column, one-thumb reach, 44px
minimum touch targets. Stage: full-viewport composition. Tight groups,
generous separation; more space above a heading than below it.

Observed rhythm: `2 / 4 / 6 / 8 / 10 / 12 / 14 / 16 / 20 / 24 / 28 / 32 / 44 / 56`.

### Stage geometry tokens (`apps/stage/src/stage-ui.css` on `.stage`)

| Token | Role |
| --- | --- |
| `--stage-pad` | Outer page inset around the grid (0 in LiveHost — chrome `GUTTER` owns it) |
| `--stage-gap` | Rail ↔ plate |
| `--stage-rail` | Join-column width (question board: 240px) |
| `--panel-pad` | Inset inside bordered rail / plate |
| `--panel-gap` | Prompt ↔ chart inside the plate |
| `--stack-gap` | Tight stacks (rail blocks, legends) |
| `--chart-frame` | On `.plate__body`: `min(100cqmin, 100%)` so viz fills the body cell |

Do not add rem/vh caps on individual charts. A content slide has **no rail**.
The waiting board is the only screen that prints the join address; resolve it
with `resolveJoinUrl` / `localJoinUrl` — never hardcode.

## Components

### Buttons
- Base radius `--radius-md` (4px). Base type is a scale token, never raw `text-sm`.
- **Primary:** solid `--primary`. Names the outcome.
- **Live:** solid `--live`. Used for **Start session** and every student press.
- **Subtle:** no border at rest; hover fills `--chrome`. This is the default
  ribbon control.
- **Secondary:** `--secondary` fill.
- Footer buttons are `flex: none; white-space: nowrap`.

### Tabs (connected ribbon)
Active tab shares the body fill (`--card`), radius `6px 6px 0 0`. Inactive
tabs sit on chrome. No seam between the selected tab and the ribbon body.

### Cards / containers
Radius `--radius-xl` (8px). One `--border` edge. No nested cards.

### Inputs
Fill + focus bottom-border. `--input` is only slightly darker than `--border`.

### Dialogs
Radius 8, `--shadow-overlay`, scrim `rgba(32,31,30,0.38)`. Footer is canvas
fill with a hairline top, a 12/400 note on the left, buttons on the right.
The primary names the outcome — never "OK". Escape cancels. A presenting-safe
dialog is a pick list only: no authoring controls.

### Stage chart frame
A paper plate. Solid `--chart-*` fills via `@openroom/charts`. The
`figcaption` is computed from the raw aggregate, never the animated value.
Don't-know is its own bar in the abstention token, counted in the total, and
named in the written summary.

## Do's and Don'ts

### Do
- **Do** let fill carry structure; borders mark real edges.
- **Do** theme browser surfaces: `::selection`, `caret-color`, scrollbars,
  focus rings, `tabular-nums`.
- **Do** keep all five themes distinct by re-colouring token roles only.
- **Do** honor `prefers-reduced-motion` by making every animation an instant
  set. A timer must tick without animating.
- **Do** mark correctness with ✓ + the word "correct", never colour alone.
- **Do** state what is *in* a file on a row (`6 slides · 2 ask the class`).

### Don't
- **Don't** put a shadow anywhere except `--shadow-page` on the desk and
  `--shadow-overlay` on a dialog or menu.
- **Don't** use gradients, blur, backdrop-filter, or glow — anywhere, in any
  theme, including WebGL.
- **Don't** add kickers above headings, nested cards, or icon+heading+text
  card grids as page structure.
- **Don't** reference literal hex in app code; token roles only.
- **Don't** put a third hue on a control.
- **Don't** render dates, taught-counts, delivery status, or version stamps
  on teacher surfaces outside the three sanctioned homes.
- **Don't** add an opacity/blur knob to the stage's ambient recipe table.
