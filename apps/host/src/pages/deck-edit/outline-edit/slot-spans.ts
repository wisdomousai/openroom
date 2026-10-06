import {
  partSpansTarget,
  stepElements,
  type Interaction,
  type Outline,
  type OutlineStep,
  type SpanFontFamily,
  type SpanRows,
  type SlotSpansTarget,
  type TextSpan,
} from '@openroom/schema';
import { keepValid, replaceStep } from './blocks';
import { clearElementStyling, styleElementRange } from './media-elements';
import {
  clampSpanSize,
  clearStyleRange,
  pruneSpans,
  retargetSpans,
  styleRange,
  type SpanFormat,
} from '../spans';

/**
 * Structural edits on a parsed `Outline` — styled spans on a step's *fixed
 * slots*: the heading, the body, a statement's headline number, a question's
 * prompt.
 *
 * A wired kind's geometry belongs to the skin, but the words inside one slot
 * are the author's, so they carry the same span algebra a freeform text element
 * does. Which field a part key writes to is `partSpansTarget`'s answer in
 * `@openroom/schema` — the validator reads the same table, so the editor and
 * the contract cannot disagree about what is styleable.
 *
 * Alignment is deliberately absent: a fixed slot's alignment is the skin's.
 */

/** Where one span-capable part key stores its text and its styling. */
type SlotRoute =
  | { on: 'step'; target: SlotSpansTarget; text: string }
  /** An interaction header the step does not override: the words are the prompt's. */
  | { on: 'interaction'; interaction: Interaction; text: string }
  /** A card's text: spans ride the card object itself. */
  | { on: 'card'; index: number; text: string }
  /** One line of a string list: spans live in the step's parallel `SpanRows`. */
  | { on: 'rows'; listField: string; spansField: string; index: number; text: string }
  /** An answer option's label, on the interaction the step references. */
  | { on: 'option'; interaction: Interaction; field: 'options' | 'left'; index: number; text: string };

/** The string-list route behind a part key, per kind. `material-N` is materials. */
function rowsRouteOf(
  step: OutlineStep,
  key: string,
): { listField: string; spansField: string; index: number } | null {
  if (key.startsWith('material-')) {
    if (step.kind !== 'activity') return null;
    return { listField: 'materials', spansField: 'materialsSpans', index: Number(key.slice(9)) };
  }
  if (!key.startsWith('cell-')) return null;
  const index = Number(key.slice(5));
  if (step.kind === 'steps') return { listField: 'items', spansField: 'itemsSpans', index };
  if (step.kind === 'activity') return { listField: 'instructions', spansField: 'instructionsSpans', index };
  if (step.kind === 'debrief') return { listField: 'prompts', spansField: 'promptsSpans', index };
  return null;
}

function slotRoute(outline: Outline, step: OutlineStep, key: string): SlotRoute | null {
  if (key === 'header' && step.kind === 'interaction' && step.title === undefined) {
    const interaction = outline.interactions.find((item) => item.id === step.interactionId);
    // A fill-the-gaps prompt holds `{{id}}` placeholders: the stored string is
    // not the string anything draws, so it cannot carry spans. Its one style is
    // `promptFont` — see `partFontOnly` / `setPartFont`.
    if (interaction === undefined || interaction.type === 'fill-the-gaps') return null;
    return { on: 'interaction', interaction, text: interaction.prompt };
  }
  if (key === 'header' || key === 'body' || key === 'stat') {
    const target = partSpansTarget(step, key);
    if (target === null) return null;
    const text = (step as unknown as Record<string, unknown>)[target.textField];
    if (typeof text !== 'string') return null;
    return { on: 'step', target, text };
  }
  if (key === 'cell-0' && step.kind === 'term') {
    if (step.example === undefined) return null;
    return {
      on: 'step',
      target: { textField: 'example', spansField: 'exampleSpans' },
      text: step.example,
    };
  }
  if (key.startsWith('cell-') && step.kind === 'cards') {
    const index = Number(key.slice(5));
    const card = step.items[index];
    if (card === undefined) return null;
    return { on: 'card', index, text: card.text };
  }
  const rows = rowsRouteOf(step, key);
  if (rows !== null) {
    const list = (step as unknown as Record<string, unknown>)[rows.listField];
    const text = Array.isArray(list) ? (list as string[])[rows.index] : undefined;
    if (typeof text !== 'string') return null;
    return { on: 'rows', ...rows, text };
  }
  if (key.startsWith('option-') && step.kind === 'interaction') {
    const index = Number(key.slice(7));
    const interaction = outline.interactions.find((item) => item.id === step.interactionId);
    if (interaction === undefined) return null;
    // A match's `option-N` is its left column — the list the canvas draws.
    const field = interaction.type === 'match' ? ('left' as const) : ('options' as const);
    if (interaction.type !== 'choice' && interaction.type !== 'ranking' && interaction.type !== 'match') {
      return null;
    }
    const option = (interaction as unknown as Record<'options' | 'left', { label: string }[]>)[field][index];
    if (option === undefined) return null;
    return { on: 'option', interaction, field, index, text: option.label };
  }
  return null;
}

/** One row of a `SpanRows` mirror, or undefined when that line is unstyled. */
function rowSpans(rows: unknown, index: number): TextSpan[] | undefined {
  if (!Array.isArray(rows)) return undefined;
  const entry = (rows as SpanRows)[index];
  return entry === null || entry === undefined ? undefined : entry;
}

/**
 * A `SpanRows` with one row replaced, normalized: trailing empty rows trimmed,
 * an all-empty mirror dropped entirely.
 */
export function withRowSpans(
  rows: SpanRows | undefined,
  index: number,
  spans: TextSpan[] | undefined,
): SpanRows | undefined {
  const next: SpanRows = [...(rows ?? [])];
  while (next.length <= index) next.push(null);
  next[index] = spans ?? null;
  while (next.length > 0 && next[next.length - 1] === null) next.pop();
  return next.length === 0 ? undefined : next;
}

/** A `SpanRows` tracking a list that grew at `index` (the new line is unstyled). */
export function insertSpansRow(rows: SpanRows | undefined, index: number): SpanRows | undefined {
  if (rows === undefined || index >= rows.length) return rows;
  const next = [...rows];
  next.splice(Math.max(0, index), 0, null);
  return next;
}

/** A `SpanRows` tracking a list that lost its `index` line. */
export function removeSpansRow(rows: SpanRows | undefined, index: number): SpanRows | undefined {
  if (rows === undefined || index >= rows.length) return rows;
  const next = [...rows];
  next.splice(index, 1);
  while (next.length > 0 && next[next.length - 1] === null) next.pop();
  return next.length === 0 ? undefined : next;
}

/** True when this part accepts styling — the editor's toolbar mounts on nothing else. */
export function partSpanCapable(outline: Outline, step: OutlineStep, key: string): boolean {
  if (key.startsWith('el-')) {
    const element = stepElements(step).find((item) => item.id === key.slice(3));
    return element?.type === 'text';
  }
  return slotRoute(outline, step, key) !== null;
}

/** The fill-the-gaps interaction behind a part key, when that part is its prompt. */
function fontOnlyInteraction(
  outline: Outline,
  step: OutlineStep,
  key: string,
): Extract<Interaction, { type: 'fill-the-gaps' }> | null {
  if (key !== 'header' || step.kind !== 'interaction' || step.title !== undefined) return null;
  const interaction = outline.interactions.find((item) => item.id === step.interactionId);
  return interaction?.type === 'fill-the-gaps' ? interaction : null;
}

/**
 * True when this part can only take a whole-slot font: a fill-the-gaps prompt,
 * whose stored string holds `{{id}}` placeholders no character range can
 * describe. The toolbar shows the family control alone.
 */
export function partFontOnly(outline: Outline, step: OutlineStep, key: string): boolean {
  return fontOnlyInteraction(outline, step, key) !== null;
}

/** The whole-prompt font a font-only part carries, `undefined` for the theme's. */
export function partFont(outline: Outline, step: OutlineStep, key: string): SpanFontFamily | undefined {
  return fontOnlyInteraction(outline, step, key)?.promptFont;
}

/** Set or clear a font-only part's family. Ranges do not apply: the slot is whole. */
export function setPartFont(
  outline: Outline,
  stepId: string,
  key: string,
  family: SpanFontFamily | undefined,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const interaction = fontOnlyInteraction(outline, step, key);
  if (interaction === null) return outline;
  const interactions = outline.interactions.map((item) => {
    if (item.id !== interaction.id || item.type !== 'fill-the-gaps') return item;
    const next = { ...item };
    if (family === undefined || family === 'default') delete next.promptFont;
    else next.promptFont = family;
    return next;
  });
  return keepValid(outline, { ...outline, interactions });
}

/** The spans a part currently stores, or `undefined` when it is plain text. */
export function partSpans(outline: Outline, step: OutlineStep, key: string): TextSpan[] | undefined {
  if (key.startsWith('el-')) {
    const element = stepElements(step).find((item) => item.id === key.slice(3));
    return element?.type === 'text' ? element.spans : undefined;
  }
  const route = slotRoute(outline, step, key);
  if (route === null) return undefined;
  if (route.on === 'interaction') return route.interaction.promptSpans;
  if (route.on === 'card') {
    return step.kind === 'cards' ? step.items[route.index]?.textSpans : undefined;
  }
  if (route.on === 'rows') {
    return rowSpans((step as unknown as Record<string, unknown>)[route.spansField], route.index);
  }
  if (route.on === 'option') {
    const list = (route.interaction as unknown as Record<'options' | 'left', { labelSpans?: TextSpan[] }[]>)[
      route.field
    ];
    return list[route.index]?.labelSpans;
  }
  const spans = (step as unknown as Record<string, unknown>)[route.target.spansField];
  return Array.isArray(spans) ? (spans as TextSpan[]) : undefined;
}

function writeSlotSpans(
  outline: Outline,
  step: OutlineStep,
  route: SlotRoute,
  spans: TextSpan[] | undefined,
): Outline {
  if (route.on === 'interaction') {
    const interactions = outline.interactions.map((item) => {
      if (item.id !== route.interaction.id) return item;
      const next = { ...item };
      if (spans === undefined) delete next.promptSpans;
      else next.promptSpans = spans;
      return next;
    });
    return keepValid(outline, { ...outline, interactions });
  }
  if (route.on === 'card') {
    if (step.kind !== 'cards') return outline;
    const card = step.items[route.index];
    if (card === undefined) return outline;
    const next = { ...card };
    if (spans === undefined) delete next.textSpans;
    else next.textSpans = spans;
    const items = step.items.map((item, at) => (at === route.index ? next : item));
    return keepValid(outline, replaceStep(outline, step.id, { ...step, items }));
  }
  if (route.on === 'rows') {
    const fields = step as unknown as Record<string, unknown>;
    const rows = withRowSpans(
      Array.isArray(fields[route.spansField]) ? (fields[route.spansField] as SpanRows) : undefined,
      route.index,
      spans,
    );
    const next = { ...step } as OutlineStep & Record<string, unknown>;
    if (rows === undefined) delete next[route.spansField];
    else next[route.spansField] = rows;
    return keepValid(outline, replaceStep(outline, step.id, next));
  }
  if (route.on === 'option') {
    const interactions = outline.interactions.map((item) => {
      if (item.id !== route.interaction.id) return item;
      const record = item as unknown as Record<string, { labelSpans?: TextSpan[] }[]> & Interaction;
      const list = record[route.field];
      const entry = Array.isArray(list) ? list[route.index] : undefined;
      if (list === undefined || entry === undefined) return item;
      const option = { ...entry };
      if (spans === undefined) delete option.labelSpans;
      else option.labelSpans = spans;
      return {
        ...item,
        [route.field]: list.map((entry, at) => (at === route.index ? option : entry)),
      } as Interaction;
    });
    return keepValid(outline, { ...outline, interactions });
  }
  const next = { ...step } as OutlineStep & Record<string, unknown>;
  if (spans === undefined) delete next[route.target.spansField];
  else next[route.target.spansField] = spans;
  return keepValid(outline, replaceStep(outline, step.id, next));
}

/**
 * Apply a style patch to `[start, end)` of one part's characters.
 *
 * `el-` keys are the freeform elements' own path; everything else is a fixed
 * slot. Both end with a normalized span list whose text mirror is unchanged, and
 * a slot that ends up carrying no styling drops its span field entirely rather
 * than storing `[{ text }]`.
 */
export function stylePartRange(
  outline: Outline,
  stepId: string,
  key: string,
  start: number,
  end: number,
  patch: Partial<SpanFormat>,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  if (key.startsWith('el-')) {
    return styleElementRange(outline, stepId, key.slice(3), start, end, patch);
  }
  const route = slotRoute(outline, step, key);
  if (route === null) return outline;
  const clamped: Partial<SpanFormat> =
    patch.size === undefined ? patch : { ...patch, size: clampSpanSize(patch.size) };
  const current = partSpans(outline, step, key) ?? [{ text: route.text }];
  const styled = styleRange(current, start, Math.min(end, route.text.length), clamped);
  return writeSlotSpans(outline, step, route, pruneSpans(styled));
}

/** Strip every style property from a part — a range of it, or all of it. */
export function clearPartStyling(
  outline: Outline,
  stepId: string,
  key: string,
  start?: number,
  end?: number,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  if (key.startsWith('el-')) {
    return clearElementStyling(outline, stepId, key.slice(3), start, end);
  }
  const route = slotRoute(outline, step, key);
  if (route === null) return outline;
  const current = partSpans(outline, step, key);
  if (current === undefined) return outline;
  if (start === undefined || end === undefined || end <= start) {
    return writeSlotSpans(outline, step, route, undefined);
  }
  const cleared = clearStyleRange(current, start, Math.min(end, route.text.length));
  return writeSlotSpans(outline, step, route, pruneSpans(cleared));
}

/**
 * Spans for a slot whose text has just been committed: the untouched prefix and
 * suffix keep their styling, the edited middle inherits the format it had.
 *
 * Exported for `writePartText`, which is where every text commit lands.
 */
export function retargetSlotSpans(
  oldText: string,
  spans: TextSpan[] | undefined,
  newText: string,
): TextSpan[] | undefined {
  if (spans === undefined) return undefined;
  return pruneSpans(retargetSpans(oldText, spans, newText));
}
