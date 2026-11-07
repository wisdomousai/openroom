/**
 * Advisory fit warnings for an Outline: what the validator can say about how
 * a valid deck will be drawn, before a learner sees it.
 *
 * Nothing here rejects a deck. A warning names a step that will probably be
 * clipped, a picture placement the slide redraws, or a box that runs past the
 * slide or over its furniture. Stored and imported decks keep validating; the
 * agent or the author decides what to change.
 *
 * The text estimate is arithmetic over the slide composition in
 * `packages/slides/src/deck-slide.css`: every size there is in cqw (percent of
 * the slide width), so a slide is 100 cqw wide and 100 / aspect cqw high, and
 * the content box is that less the master's safe area on each side. Text
 * widths use an average character width per em (body and heading faces
 * differ), which is calibrated on the measured clipping points of the
 * 2026-11-06 slide layout review. It is an estimate: it errs towards the
 * Arial metrics the slides are drawn with and keeps a small margin for wider
 * fallback fonts. The constants mirror the CSS by hand; when a size in
 * deck-slide.css changes, change it here too.
 */

import { deckAspectRatio, resolveSlideDesign, type ResolvedSlideDesign } from './deck-design.js';
import { layoutAllowedForKind, LAYOUTS_FOR_KIND, resolveMediaPlace, resolveMediaSize, stepElements, stepPicture } from './outline-parts.js';
import type {
  Outline,
  OutlineElementBox,
  OutlineLayout,
  OutlineStep,
  OutlineWarning,
} from './outline-types.js';

/* ------------------------------------------------------------------ */
/* Resolved layout                                                     */
/* ------------------------------------------------------------------ */

/** Layouts that draw their blocks one under the other, with no side region. */
const STACKED_LAYOUTS: ReadonlySet<OutlineLayout> = new Set(['title', 'text', 'grid']);

/**
 * The layout a step is drawn in: the authored one when the kind can fill it,
 * else the kind's default; a picture placed `left` or `right` on a stacked
 * layout is drawn as `split` when the kind allows it.
 *
 * Same rule as `effectiveLayout` in `packages/slides/src/layout.ts`, which
 * mirrors this package's tables rather than importing them.
 */
export function resolvedStepLayout(step: OutlineStep): OutlineLayout {
  const authored = step.layout;
  const layout =
    authored !== undefined && layoutAllowedForKind(step.kind, authored)
      ? authored
      : (LAYOUTS_FOR_KIND[step.kind][0] ?? 'text');
  const place = stepPicture(step)?.place;
  if ((place === 'left' || place === 'right') && STACKED_LAYOUTS.has(layout) && layoutAllowedForKind(step.kind, 'split')) {
    return 'split';
  }
  return layout;
}

/* ------------------------------------------------------------------ */
/* Slide geometry (cqw)                                                */
/* ------------------------------------------------------------------ */

/** `.slide-surface[data-slide-footer]`: bottom 1.6 + two 1.4cqw lines at 1.4 + 1.2 clearance. */
const FOOTER_BAND = 1.6 + 2 * 1.4 * 1.4 + 1.2;
/** `.slide-surface__logo`: top 2, right 3, 9 x 4 cqw. */
const LOGO = { top: 2, right: 3, width: 9, height: 4 } as const;
/** Gap between the two columns of split and activity. */
const COLUMN_GAP = 3;
/** Width of the second column when no picture sets it: split 42%, activity 38%. */
const SPLIT_SUPPORT = 0.42;
const ACTIVITY_SUPPORT = 0.38;
/** Root type size: `.outline-step { font-size: 2.6cqw }`; list gaps are 0.55em of it. */
const ROOT = 2.6;
const LIST_GAP = 0.55 * ROOT;

/** Average advance per character, in em. Headings are bold display type. */
const BODY_EM = 0.48;
const HEADING_EM = 0.55;
/** Monospace is wider than the proportional faces the averages are for. */
const MONO_FACTOR = 1.2;

interface Slide {
  /** Slide height in cqw. */
  height: number;
  /** Content box in cqw. */
  width: number;
  inner: number;
  /** The bottom margin under the content box. */
  margin: number;
  safe: number;
  bodyEm: number;
  headingEm: number;
}

function slideOf(design: ResolvedSlideDesign): Slide {
  const height = 100 / deckAspectRatio(design.aspectRatio);
  const safe = design.safeArea;
  const bottom = design.footer === undefined ? safe : Math.max(safe, FOOTER_BAND);
  return {
    height,
    width: 100 - 2 * safe,
    inner: height - safe - bottom,
    margin: bottom,
    safe,
    bodyEm: BODY_EM * (design.theme.fonts.body === 'mono' ? MONO_FACTOR : 1),
    headingEm: HEADING_EM * (design.theme.fonts.heading === 'mono' ? MONO_FACTOR : 1),
  };
}

/* ------------------------------------------------------------------ */
/* Text blocks                                                         */
/* ------------------------------------------------------------------ */

interface Face {
  size: number;
  leading: number;
  heading?: boolean;
}

function characters(text: string): number {
  return [...text].length;
}

/**
 * Slide text is ordinary HTML text: a newline in the source collapses to a
 * space like any other run of white space, so it does not start a line.
 */
function lines(text: string, face: Face, width: number, slide: Slide): number {
  const em = face.heading ? slide.headingEm : slide.bodyEm;
  const perLine = Math.max(1, Math.floor(width / (face.size * em)));
  return Math.max(1, Math.ceil(characters(text.trim().replace(/\s+/g, ' ')) / perLine));
}

function textHeight(text: string, face: Face, width: number, slide: Slide): number {
  return lines(text, face, width, slide) * face.size * face.leading;
}

/** Blocks stacked in one column with a fixed gap between those present. */
function stack(heights: readonly number[], gap: number): number {
  const present = heights.filter((height) => height > 0);
  if (present.length === 0) return 0;
  return present.reduce((sum, height) => sum + height, 0) + gap * (present.length - 1);
}

/** A list of items with the list gap between them. */
function list(items: readonly string[], face: Face, width: number, slide: Slide, gap = LIST_GAP): number {
  return stack(items.map((item) => textHeight(item, face, width, slide)), gap);
}

function present(text: string | undefined): text is string {
  return text !== undefined && text.trim() !== '';
}

/* Sizes per layout, from deck-slide.css. */
const TITLE_H1: Face = { size: 5.8, leading: 1.1, heading: true };
const TITLE_LEAD: Face = { size: 2.5, leading: 1.5 };
/** `.outline-step__stat, .outline-step__term`: 4.2em of the root. */
const BIG_WORD: Face = { size: 4.2 * ROOT, leading: 0.85, heading: true };
const EXAMPLE: Face = { size: 1.05 * ROOT, leading: 1.4 };
const TEXT_H1: Face = { size: 4, leading: 1.15, heading: true };
const TEXT_BODY: Face = { size: 2.5, leading: 1.55 };
const SPLIT_H1: Face = { size: 4.4, leading: 1.15, heading: true };
const SPLIT_STAT: Face = { size: 6.6, leading: 1.15, heading: true };
const SPLIT_BODY: Face = { size: 2.5, leading: 1.55 };
const BULLET: Face = { size: 1.05 * ROOT, leading: 1.3 };
const SEQUENCE: Face = { size: ROOT, leading: 1.4 };
const CARD: Face = { size: 0.95 * ROOT, leading: 1.4 };
const CARD_LABEL: Face = { size: 0.75 * 0.95 * ROOT, leading: 1.4, heading: true };
const GRID_H1: Face = { size: 3.6, leading: 1.15, heading: true };
const GRID_CELL: Face = { size: 2.2, leading: 1.45 };
const GRID_LABEL: Face = { size: 2.4, leading: 1.4, heading: true };
const ACTIVITY_H1: Face = { size: 4, leading: 1.15, heading: true };
const ACTIVITY_ITEM: Face = { size: 2.3, leading: 1.5 };
const MATERIALS_META: Face = { size: 1.5, leading: 1.4 };
const MATERIALS_ITEM: Face = { size: 2, leading: 1.35 };

/** `h1 { max-width: 20ch }` on layouts that keep it (title, blank). */
function headingCap(face: Face): number {
  return 20 * 0.556 * face.size;
}

/** What one column of a step needs, and what it has. */
interface Column {
  /** Height the column's words take, in cqw. */
  needs: number;
  /**
   * True where the words can run on into the bottom margin before the slide
   * edge cuts them (the title and text stacks, and a grid of one to three
   * items). A split or activity column, and a cell of a fuller grid, cuts at
   * its own box.
   */
  spills: boolean;
}

/** The words of one wired step, grouped by the region the renderer puts them in. */
interface Words {
  heading?: string;
  stat?: string;
  /** Prose under the heading: a body, a term's meaning. */
  body?: string;
  /** A term's example, drawn as a quotation. */
  example?: string;
  /** The term itself, drawn in the big headword face. */
  term?: string;
}

function wordsOf(step: OutlineStep): Words {
  switch (step.kind) {
    case 'title':
      return { heading: step.title, ...(step.body === undefined ? {} : { body: step.body }) };
    case 'statement':
      return {
        ...(step.title === undefined ? {} : { heading: step.title }),
        ...(step.stat === undefined ? {} : { stat: step.stat }),
        body: step.body,
      };
    case 'term':
      return { term: step.term, body: step.meaning, ...(step.example === undefined ? {} : { example: step.example }) };
    case 'break':
      return { heading: step.title, ...(step.body === undefined ? {} : { body: step.body }) };
    default:
      return {};
  }
}

/** title, statement, term and break on the title layout: one centred stack. */
function titleStack(words: Words, slide: Slide): Column[] {
  const width = slide.width;
  const needs = stack(
    [
      present(words.stat) ? textHeight(words.stat, BIG_WORD, width, slide) : 0,
      present(words.term) ? textHeight(words.term, BIG_WORD, width, slide) : 0,
      present(words.heading) ? textHeight(words.heading, TITLE_H1, Math.min(width, headingCap(TITLE_H1)), slide) : 0,
      present(words.body) ? textHeight(words.body, TITLE_LEAD, Math.min(width, 50), slide) : 0,
      present(words.example) ? textHeight(words.example, EXAMPLE, Math.min(width, 42 * 0.556 * EXAMPLE.size), slide) : 0,
    ],
    1.25,
  );
  return [{ needs, spills: true }];
}

/** The text layout: heading over a rule, then prose or a list at 60cqw. */
function textStack(words: Words, items: Lines | null, slide: Slide): Column[] {
  const width = slide.width;
  const prose = Math.min(width, 60);
  const heading = words.heading ?? words.term;
  const blocks = [
    present(words.stat) ? textHeight(words.stat, BIG_WORD, width, slide) : 0,
    present(heading) ? textHeight(heading, TEXT_H1, width, slide) + 1.6 : 0,
    present(words.body) ? textHeight(words.body, TEXT_BODY, prose, slide) : 0,
    present(words.example) ? textHeight(words.example, EXAMPLE, Math.min(prose, 42 * 0.556 * EXAMPLE.size), slide) : 0,
  ];
  if (items !== null) {
    // Bullets indent 1.2em; a numbered sequence gives 2.4em to its badge.
    const indent = (items.numbered ? 2.4 : 1.2) * TEXT_BODY.size;
    blocks.push(list(items.lines, TEXT_BODY, prose - indent, slide));
    if (items.materials !== undefined) blocks.push(materialsHeight(items.materials, prose, slide));
  }
  return [{ needs: stack(blocks, 1.6), spills: true }];
}

interface Lines {
  lines: readonly string[];
  numbered: boolean;
  /** Cards draw each item as a bordered card with an optional label. */
  cards?: readonly { label?: string; text: string }[];
  materials?: readonly string[];
}

function materialsHeight(materials: readonly string[], width: number, slide: Slide): number {
  return stack(
    [
      MATERIALS_META.size * MATERIALS_META.leading,
      list(materials, MATERIALS_ITEM, width, slide, 0.45),
    ],
    0.45,
  );
}

/** A list in a column of the given width, with the base list faces. */
function columnList(items: Lines, width: number, slide: Slide): number {
  if (items.cards !== undefined) {
    // `.outline-step__cards`: auto-fit columns at least 9em wide, 0.7em apart.
    const gap = 0.7 * ROOT;
    const columns = Math.max(1, Math.floor((width + gap) / (9 * ROOT + gap)));
    const cardWidth = (width - gap * (columns - 1)) / columns;
    const inner = cardWidth - 2 * 0.8 * CARD.size;
    const heights = items.cards.map(
      (card) =>
        2 * 0.8 * CARD.size +
        (present(card.label) ? textHeight(card.label, CARD_LABEL, inner, slide) + 0.4 * CARD_LABEL.size : 0) +
        textHeight(card.text, CARD, inner, slide),
    );
    const rows: number[] = [];
    for (let index = 0; index < heights.length; index += columns) {
      rows.push(Math.max(...heights.slice(index, index + columns)));
    }
    return stack(rows, gap);
  }
  if (items.numbered) return list(items.lines, SEQUENCE, width - 2.4 * SEQUENCE.size, slide);
  return list(items.lines, BULLET, width - 1.2 * BULLET.size, slide);
}

/** Split: a heading side and a supporting side, each its own column. */
function splitColumns(step: OutlineStep, words: Words, items: Lines | null, slide: Slide): Column[] {
  const picture = stepPicture(step);
  const pictureShare = picture === undefined ? null : resolveMediaSize(picture, resolveMediaPlace(picture, 'split')) / 100;
  const support = slide.width * (pictureShare ?? SPLIT_SUPPORT);
  const lede = Math.max(0, slide.width - COLUMN_GAP - support);
  const head = [
    present(words.stat) ? textHeight(words.stat, SPLIT_STAT, lede, slide) : 0,
    present(words.term) ? textHeight(words.term, SPLIT_H1, lede, slide) : 0,
    present(words.heading) ? textHeight(words.heading, SPLIT_H1, lede, slide) : 0,
  ];
  const prose = [
    present(words.body) ? textHeight(words.body, SPLIT_BODY, pictureShare === null ? support : lede, slide) : 0,
    present(words.example) ? textHeight(words.example, EXAMPLE, pictureShare === null ? support : lede, slide) : 0,
  ];
  const listIn = (width: number): number[] =>
    items === null
      ? []
      : [columnList(items, width, slide), items.materials === undefined ? 0 : materialsHeight(items.materials, width, slide)];
  if (pictureShare !== null) {
    // The picture has the supporting side; every word is in the heading side.
    return [{ needs: stack([...head, ...prose, ...listIn(lede)], 1.25), spills: false }];
  }
  return [
    { needs: stack(head, 1.25), spills: false },
    { needs: stack([...prose, ...listIn(support)], 1.25), spills: false },
  ];
}

/** Grid: heading on top, peer cells two to a row below it. */
function gridColumns(heading: string, items: Lines, slide: Slide): Column[] {
  const width = slide.width;
  const head = present(heading) ? textHeight(heading, GRID_H1, width, slide) + 1.6 : 0;
  const room = slide.inner - head;
  const count = items.cards?.length ?? items.lines.length;
  const rows = Math.ceil(count / 2);
  const gridGap = 1.1;
  const cell = (width - gridGap) / 2;
  const inner = cell - 2 * 1.25;
  const pad = 2 * 1.1;
  const heights = (items.cards ?? items.lines.map((text) => ({ text }))).map((item) => {
    const label = 'label' in item && present(item.label) ? textHeight(item.label, GRID_LABEL, inner, slide) + 0.4 * GRID_LABEL.size : 0;
    const textWidth = items.numbered ? inner - 2.4 * ROOT : inner;
    return label + textHeight(item.text, GRID_CELL, textWidth, slide);
  });
  if (count <= 3) {
    // One to three items: rows as tall as their content.
    const rowHeights: number[] = [];
    for (let index = 0; index < heights.length; index += 2) {
      rowHeights.push(Math.max(...heights.slice(index, index + 2)) + pad);
    }
    return [{ needs: head + stack(rowHeights, gridGap), spills: true }];
  }
  // Four or more: equal rows share the room; the fullest cell decides.
  const row = (room - (rows - 1) * gridGap) / rows;
  const fullest = Math.max(...heights) + pad;
  return [{ needs: slide.inner + Math.max(0, fullest - row), spills: false }];
}

/** Activity: instructions beside materials (or a picture), 38% for the second column. */
function activityColumns(step: OutlineStep, items: Lines, slide: Slide, heading: string): Column[] {
  const picture = stepPicture(step);
  const materials = items.materials;
  const twoColumns = picture !== undefined || materials !== undefined;
  const support = twoColumns ? slide.width * ACTIVITY_SUPPORT : 0;
  const lede = twoColumns ? slide.width - COLUMN_GAP - support : slide.width;
  const instructions = list(items.lines, ACTIVITY_ITEM, lede - 1.2 * ACTIVITY_ITEM.size, slide);
  const head = present(heading) ? textHeight(heading, ACTIVITY_H1, lede, slide) : 0;
  const columns: Column[] = [];
  if (picture !== undefined) {
    // The picture takes the second column; the materials drop under the instructions.
    columns.push({
      needs: stack([head, instructions, materials === undefined ? 0 : materialsHeight(materials, lede, slide)], 1.25),
      spills: false,
    });
  } else {
    columns.push({ needs: stack([head, instructions], 1.25), spills: false });
    if (materials !== undefined) columns.push({ needs: materialsHeight(materials, support, slide), spills: false });
  }
  return columns;
}

function linesOf(step: OutlineStep): { heading: string; items: Lines } | null {
  switch (step.kind) {
    case 'cards':
      return { heading: step.title, items: { lines: step.items.map((card) => card.text), numbered: false, cards: step.items } };
    case 'steps':
      return { heading: step.title, items: { lines: step.items, numbered: true } };
    case 'debrief':
      return { heading: step.title, items: { lines: step.prompts, numbered: false } };
    case 'activity':
      return {
        heading: step.title,
        items: {
          lines: step.instructions,
          numbered: false,
          ...(step.materials !== undefined && step.materials.length > 0 ? { materials: step.materials } : {}),
        },
      };
    default:
      return null;
  }
}

/** Each column a step's words fill on its layout, or null where text is not estimated. */
function stepColumns(step: OutlineStep, layout: OutlineLayout, slide: Slide): Column[] | null {
  const listed = linesOf(step);
  if (listed !== null) {
    if (layout === 'grid') return gridColumns(listed.heading, listed.items, slide);
    if (layout === 'activity') return activityColumns(step, listed.items, slide, listed.heading);
    if (layout === 'split') return splitColumns(step, { heading: listed.heading }, listed.items, slide);
    if (layout === 'text') return textStack({ heading: listed.heading }, listed.items, slide);
    return null;
  }
  if (step.kind !== 'title' && step.kind !== 'statement' && step.kind !== 'term' && step.kind !== 'break') return null;
  const words = wordsOf(step);
  if (layout === 'title') return titleStack(words, slide);
  if (layout === 'text') return textStack(words, null, slide);
  if (layout === 'split') return splitColumns(step, words, null, slide);
  return null;
}

/* ------------------------------------------------------------------ */
/* Warnings                                                            */
/* ------------------------------------------------------------------ */

/** A picture column on split wider than this leaves too little for the words (LD4). */
const SPLIT_PICTURE_MAX = 60;
/** Spans smaller than this are hard to read on a phone (LD14). */
const SPAN_SIZE_LEGIBLE = 60;

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function where(design: ResolvedSlideDesign): string {
  return `${design.aspectRatio} with safeArea ${String(design.safeArea)}`;
}

/** Overruns smaller than this are rounding, not a lost line. */
const FIT_TOLERANCE = 0.25;

function textFitWarning(step: OutlineStep, index: number, design: ResolvedSlideDesign): OutlineWarning | null {
  const layout = resolvedStepLayout(step);
  const slide = slideOf(design);
  const columns = stepColumns(step, layout, slide);
  if (columns === null) return null;
  const over = columns.filter((column) => column.needs > slide.inner + FIT_TOLERANCE);
  if (over.length === 0) return null;
  const needs = Math.max(...over.map((column) => column.needs));
  const cut = over.some((column) => !column.spills || column.needs > slide.inner + slide.margin);
  return {
    code: 'W_TEXT_FIT',
    path: `/steps/${String(index)}`,
    layout,
    message:
      `step "${step.id}" (${step.kind} on ${layout}) needs about ${String(round(needs))} cqw of height but the slide has about ` +
      `${String(round(slide.inner))} at ${where(design)}, so ${cut ? 'its last lines will be cut' : 'its last lines run into the bottom margin'}: ` +
      'shorten the text, use fewer items, or split it over two steps',
  };
}

function mediaWarnings(step: OutlineStep, index: number, slide: Slide): OutlineWarning[] {
  const picture = stepPicture(step);
  if (picture === undefined) return [];
  const warnings: OutlineWarning[] = [];
  const authored = step.layout !== undefined && layoutAllowedForKind(step.kind, step.layout) ? step.layout : (LAYOUTS_FOR_KIND[step.kind][0] ?? 'text');
  const layout = resolvedStepLayout(step);
  const place = picture.place;
  const path = `/steps/${String(index)}/media`;
  if ((place === 'left' || place === 'right') && layout !== authored) {
    warnings.push({
      code: 'W_MEDIA_PLACE',
      path: `${path}/place`,
      layout,
      message: `place "${place}" has no side on the ${authored} layout, so step "${step.id}" is drawn as split`,
    });
  }
  if ((place === 'top' || place === 'bottom') && layout === 'split') {
    warnings.push({
      code: 'W_MEDIA_PLACE',
      path: `${path}/place`,
      layout,
      message: `split draws the picture of step "${step.id}" on the right whatever place says; top and bottom stack only on the title, text and grid layouts`,
    });
  }
  if (place === 'fill' && layout !== 'media') {
    warnings.push({
      code: 'W_MEDIA_PLACE',
      path: `${path}/place`,
      layout,
      message:
        layout === 'split'
          ? `fill on split gives the picture of step "${step.id}" the whole width and leaves no column for the words; use place left or right with a size, or the media layout`
          : `fill fills the slide only on the media layout; on ${layout} the picture of step "${step.id}" is drawn under the words at up to their full height`,
    });
  }
  if (layout === 'split' && place !== 'fill') {
    const size = resolveMediaSize(picture, resolveMediaPlace(picture, 'split'));
    if (size > SPLIT_PICTURE_MAX) {
      const column = Math.max(0, slide.width - COLUMN_GAP - (slide.width * size) / 100);
      warnings.push({
        code: 'W_MEDIA_SIZE',
        path: `${path}/size`,
        layout,
        message: `size ${String(size)} on split leaves the words of step "${step.id}" a column about ${String(round(column))} cqw wide; keep size at ${String(SPLIT_PICTURE_MAX)} or less`,
      });
    }
  }
  return warnings;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** An element box (percent of width and height) in cqw. */
function boxRect(box: OutlineElementBox, slide: Slide): Rect {
  return {
    left: box.x,
    right: box.x + box.w,
    top: (box.y * slide.height) / 100,
    bottom: ((box.y + box.h) * slide.height) / 100,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function elementWarnings(step: OutlineStep, index: number, design: ResolvedSlideDesign, slide: Slide): OutlineWarning[] {
  const elements = stepElements(step);
  if (elements.length === 0) return [];
  const warnings: OutlineWarning[] = [];
  const logo: Rect | null =
    design.logo === undefined
      ? null
      : { left: 100 - LOGO.right - LOGO.width, right: 100 - LOGO.right, top: LOGO.top, bottom: LOGO.top + LOGO.height };
  const footer: Rect | null =
    design.footer === undefined
      ? null
      : { left: slide.safe, right: slide.safe + 80, top: slide.height - FOOTER_BAND + 1.2, bottom: slide.height - 1.6 };
  // A blank step's title is drawn from the top margin, over the boxes' layer.
  const title =
    step.kind === 'blank' && present(step.title)
      ? (() => {
          const face: Face = { size: 2.6 * ROOT, leading: 0.98, heading: true };
          const cap = Math.min(slide.width, headingCap(face));
          const width = Math.min(cap, characters(step.title) * face.size * slide.headingEm);
          return {
            left: slide.safe,
            right: slide.safe + width,
            top: slide.safe,
            bottom: slide.safe + textHeight(step.title, face, cap, slide),
          };
        })()
      : null;
  elements.forEach((element, elementIndex) => {
    const path = `/steps/${String(index)}/elements/${String(elementIndex)}/box`;
    const { box } = element;
    if (box.x + box.w > 100 || box.y + box.h > 100) {
      const edges = [
        ...(box.x + box.w > 100 ? [`x + w is ${String(box.x + box.w)}`] : []),
        ...(box.y + box.h > 100 ? [`y + h is ${String(box.y + box.h)}`] : []),
      ];
      warnings.push({
        code: 'W_ELEMENT_BOUNDS',
        path,
        message: `element "${element.id}" on step "${step.id}" runs past the slide edge (${edges.join(', ')}; at most 100), and the part beyond the edge is cut`,
      });
    }
    const rect = boxRect(box, slide);
    if (title !== null && overlaps(rect, title)) {
      warnings.push({
        code: 'W_ELEMENT_OVERLAP',
        path,
        message: `element "${element.id}" on step "${step.id}" covers the step title, which is drawn in the top ${String(round(((title.bottom) * 100) / slide.height))}% of the slide; move the box down or drop the title`,
      });
    }
    if (logo !== null && overlaps(rect, logo)) {
      warnings.push({
        code: 'W_ELEMENT_OVERLAP',
        path,
        message: `element "${element.id}" on step "${step.id}" lies under the master logo in the top-right corner`,
      });
    }
    if (footer !== null && overlaps(rect, footer)) {
      warnings.push({
        code: 'W_ELEMENT_OVERLAP',
        path,
        message: `element "${element.id}" on step "${step.id}" reaches into the footer band at the bottom of the slide`,
      });
    }
  });
  return warnings;
}

/** Every span list in a value, with its JSON pointer: `spans`, `*Spans` and span rows. */
function spanLists(value: unknown, path: string, found: { path: string; spans: unknown[] }[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => spanLists(item, `${path}/${String(index)}`, found));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
    if ((key === 'spans' || key.endsWith('Spans')) && Array.isArray(child)) {
      if (child.some((entry) => Array.isArray(entry) || entry === null)) {
        child.forEach((row, rowIndex) => {
          if (Array.isArray(row)) found.push({ path: `${childPath}/${String(rowIndex)}`, spans: row });
        });
      } else {
        found.push({ path: childPath, spans: child });
      }
      continue;
    }
    spanLists(child, childPath, found);
  }
}

function spanWarnings(outline: Outline): OutlineWarning[] {
  const found: { path: string; spans: unknown[] }[] = [];
  spanLists(outline.steps, '/steps', found);
  spanLists(outline.interactions, '/interactions', found);
  const warnings: OutlineWarning[] = [];
  for (const { path, spans } of found) {
    spans.forEach((span, index) => {
      const size = (span as { size?: unknown } | null)?.size;
      if (typeof size === 'number' && size < SPAN_SIZE_LEGIBLE) {
        warnings.push({
          code: 'W_SPAN_SIZE',
          path: `${path}/${String(index)}/size`,
          message: `span size ${String(size)} draws at about ${String(round((size / 100) * ROOT))} cqw, too small to read on a phone or from the back of a room; use ${String(SPAN_SIZE_LEGIBLE)} or more`,
        });
      }
    });
  }
  return warnings;
}

function interactionWarning(step: OutlineStep, index: number): OutlineWarning | null {
  if (step.kind !== 'interaction') return null;
  // `poll` is the layout the wall draws, so naming it ignores nothing.
  const fields = [
    ...(step.title !== undefined ? ['title'] : []),
    ...(step.body !== undefined ? ['body'] : []),
    ...(step.media !== undefined ? ['media'] : []),
    ...(step.layout !== undefined && resolvedStepLayout(step) !== 'poll' ? ['layout'] : []),
  ];
  if (fields.length === 0) return null;
  return {
    code: 'W_INTERACTION_FIELDS',
    path: `/steps/${String(index)}`,
    message:
      `the live wall draws step "${step.id}" from its question alone (prompt and answer count, then the results chart) and ignores its ${fields.join(', ')}; ` +
      'the editor, Presenter and deck_preview do draw them, so put what students must see into the question prompt',
  };
}

/** Every advisory warning for a valid outline, in step order. */
export function outlineWarnings(outline: Outline): OutlineWarning[] {
  const warnings: OutlineWarning[] = [];
  outline.steps.forEach((step, index) => {
    const design = resolveSlideDesign(outline.design, step.design);
    const slide = slideOf(design);
    const fit = textFitWarning(step, index, design);
    if (fit !== null) warnings.push(fit);
    warnings.push(...mediaWarnings(step, index, slide));
    warnings.push(...elementWarnings(step, index, design, slide));
    const interaction = interactionWarning(step, index);
    if (interaction !== null) warnings.push(interaction);
  });
  warnings.push(...spanWarnings(outline));
  return warnings;
}
