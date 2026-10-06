/**
 * Outline layout, part keys, and reveal order.
 *
 * Everything here is a *typed enum or a derived structure*. There is no CSS, no
 * coordinate, and no arbitrary presentation code anywhere in this contract:
 * OpenRoom still chooses the pixels for each step (PRODUCT.md §Positioning,
 * docs/TUTORING.md §Outline contract). A `layout` names which typed arrangement
 * of regions a step gets; a part key names one of the step's own content blocks.
 */

import type { Interaction } from './types.js';
import type {
  OutlineElement,
  OutlineLayout,
  OutlineMedia,
  OutlineMediaPlace,
  OutlineStep,
  OutlineStepKind,
} from './outline-types.js';
import {
  FREEFORM_STEP_KINDS,
  MEDIA_SIZE_DEFAULT,
  MEDIA_SIZE_MAX,
  MEDIA_SIZE_MIN,
} from './outline-types.js';

export const OUTLINE_LAYOUTS = [
  'title',
  'text',
  'split',
  'grid',
  'media',
  'poll',
  'activity',
  'timer',
  'join',
  'blank',
] as const satisfies readonly OutlineLayout[];

/**
 * Which layouts each step kind may claim.
 *
 * The rule: a kind may claim a layout only when the kind's own shape can fill
 * that layout's regions. Nothing here is about taste — it is about whether the
 * content exists.
 *
 *   title     one dominant heading block, little else
 *   text      a heading plus prose
 *   split     a heading plus exactly one secondary block
 *   grid      two or more repeated peer items (cards / list items / prompts)
 *   media     an image or video region              -> only `media` has one
 *                                                      as its primary region.
 *                                                      Other kinds may carry an
 *                                                      optional picture inside
 *                                                      `split` / `text`.
 *   poll      a live aggregate region               -> only `interaction` has one
 *   activity  an instruction list (+ materials)     -> only `activity` has one
 *   timer     a countdown region                    -> `timer`, and `break` which
 *                                                      carries `minutes`
 *   join      a full-slide join QR                  -> `join` only
 *   blank     no regions at all — a freeform canvas -> `blank` only
 *
 * So `poll` on a `term` step and `timer` on a `cards` step are both rejected:
 * neither step has anything to put in the region the layout is made of.
 */
export const LAYOUTS_FOR_KIND: Record<OutlineStepKind, readonly OutlineLayout[]> = {
  title: ['title', 'text', 'split'],
  statement: ['title', 'text', 'split'],
  cards: ['grid', 'split'],
  steps: ['grid', 'text', 'split'],
  term: ['title', 'text', 'split'],
  activity: ['activity', 'text', 'split'],
  timer: ['timer', 'title'],
  // Full-bleed, side-by-side title+picture, or title stacked above the picture
  // (the last is the natural home for a portrait video on a landscape slide).
  media: ['media', 'split', 'text'],
  debrief: ['text', 'grid', 'split'],
  break: ['title', 'text', 'timer'],
  join: ['join'],
  blank: ['blank'],
  interaction: ['poll', 'split', 'text'],
};

/** True when `layout` is one the step's kind can actually fill. */
export function layoutAllowedForKind(kind: OutlineStepKind, layout: OutlineLayout): boolean {
  return LAYOUTS_FOR_KIND[kind].includes(layout);
}

/**
 * Kinds that may carry an optional picture on *this* slide. `media` is the
 * picture; timer / break / join have no region that can hold one.
 */
const OPTIONAL_PICTURE_KINDS = new Set<OutlineStepKind>([
  'title',
  'statement',
  'cards',
  'steps',
  'term',
  'activity',
  'debrief',
  'interaction',
]);

/** True when this kind can hold a picture without becoming a new slide. */
export function kindCanCarryPicture(kind: OutlineStepKind): boolean {
  return kind === 'media' || OPTIONAL_PICTURE_KINDS.has(kind);
}

const FREEFORM_KIND_SET = new Set<OutlineStepKind>(FREEFORM_STEP_KINDS);

/** Title, statement, media, and blank may carry extra boxed objects. */
export function kindCanCarryElements(kind: OutlineStepKind): boolean {
  return FREEFORM_KIND_SET.has(kind);
}

export function stepElements(step: OutlineStep): readonly OutlineElement[] {
  if (!kindCanCarryElements(step.kind)) return [];
  if (
    step.kind === 'title' ||
    step.kind === 'statement' ||
    step.kind === 'media' ||
    step.kind === 'blank'
  ) {
    return step.elements ?? [];
  }
  return [];
}

/**
 * The picture this step carries, if any. A media step always has one; the
 * optional-picture kinds have one only when the author put it there.
 */
export function stepPicture(step: OutlineStep): OutlineMedia | undefined {
  if (step.kind === 'media') return step.media;
  if (OPTIONAL_PICTURE_KINDS.has(step.kind) && 'media' in step) return step.media;
  return undefined;
}

export function clampMediaSize(size: number): number {
  return Math.min(MEDIA_SIZE_MAX, Math.max(MEDIA_SIZE_MIN, Math.round(size)));
}

/**
 * Where the picture sits when the author named no `place`.
 * Split → right, full-frame media → fill, everything else → bottom.
 */
export function defaultMediaPlace(layout: OutlineLayout): OutlineMediaPlace {
  if (layout === 'split') return 'right';
  if (layout === 'media') return 'fill';
  return 'bottom';
}

export function resolveMediaPlace(
  media: OutlineMedia,
  layout: OutlineLayout,
): OutlineMediaPlace {
  return media.place ?? defaultMediaPlace(layout);
}

export function resolveMediaSize(media: OutlineMedia, place: OutlineMediaPlace): number {
  if (place === 'fill') return MEDIA_SIZE_MAX;
  if (media.size === undefined) return MEDIA_SIZE_DEFAULT;
  return clampMediaSize(media.size);
}

/** The layout a kind should take so `place` has a region to fill. */
export function layoutForMediaPlace(
  kind: OutlineStepKind,
  place: OutlineMediaPlace,
): OutlineLayout {
  if (place === 'left' || place === 'right') {
    return LAYOUTS_FOR_KIND[kind].includes('split') ? 'split' : LAYOUTS_FOR_KIND[kind][0] ?? 'text';
  }
  if (place === 'fill' && LAYOUTS_FOR_KIND[kind].includes('media')) return 'media';
  if (LAYOUTS_FOR_KIND[kind].includes('text')) return 'text';
  return LAYOUTS_FOR_KIND[kind][0] ?? 'text';
}

/**
 * The repeated part keys of an interaction step, after its `header` / `body`.
 *
 * `option-N` covers every interaction whose parts are a list of authored items
 * — choice and ranking options, and a match's left column. A fill-the-gaps's blanks are
 * a different thing (they sit inside the prompt, not beside it), so they get
 * their own `gap-N` prefix rather than pretending to be options.
 */
function interactionPartKeys(
  step: OutlineStep,
  interactions: readonly Interaction[] | undefined,
): string[] {
  if (step.kind !== 'interaction' || interactions === undefined) return [];
  const interaction = interactions.find((candidate) => candidate.id === step.interactionId);
  if (interaction === undefined) return [];
  if (interaction.type === 'choice' || interaction.type === 'ranking') {
    return interaction.options.map((_option, index) => `option-${String(index)}`);
  }
  if (interaction.type === 'match') {
    return interaction.left.map((_item, index) => `option-${String(index)}`);
  }
  if (interaction.type === 'fill-the-gaps') {
    return interaction.gaps.map((_gap, index) => `gap-${String(index)}`);
  }
  return [];
}

/**
 * The ordered part keys of one step, derived from the step's own shape.
 *
 * The key vocabulary is closed:
 *   `header`     the step's heading — omitted on `statement`, `timer` and
 *                `media` when no title is authored, since the stage draws none
 *   `stat`       a statement's headline number, drawn above its title
 *   `body`       the step's prose block, when it has one
 *   `option-N`   an interaction's authored item list, in order: a choice /
 *                ranking option, or a match's left column
 *   `gap-N`      a fill-the-gaps blank, in the order the gaps are authored
 *   `cell-N`     a repeated peer item: a card, a list item, a debrief prompt —
 *                and a `term`'s optional example, which is a second peer block
 *                beside its meaning
 *   `materials`  an activity's materials list (the whole list is one part)
 *   `image`      the media region of a media step, and of any other step that
 *                carries an optional picture on this slide
 *
 * The deck editor UI imports this so the authoring surface and the validator can never
 * disagree about what a step's parts are.
 */
export function partKeysForStep(
  step: OutlineStep,
  interactions?: readonly Interaction[],
): string[] {
  // These three draw their heading only when a title is authored. Emitting
  // `header` regardless would hand the reveal editor a part that gates nothing
  // — a reveal step that advances and shows an empty screen. An `interaction`
  // keeps its header unconditionally: the prompt comes from the interaction, so
  // there is always something there even when the step overrides no title.
  const headed =
    step.kind === 'join'
      ? false
      : step.kind === 'statement' || step.kind === 'timer' || step.kind === 'media' || step.kind === 'blank'
        ? step.title !== undefined
        : true;
  const keys: string[] = headed ? ['header'] : [];
  switch (step.kind) {
    case 'title':
      if (step.body !== undefined) keys.push('body');
      break;
    case 'statement':
      // The stage draws the stat as its own block above the title, so it is a
      // part in its own right — "here is the claim … here is the number" is the
      // whole reason to sequence a statement.
      if (step.stat !== undefined) keys.push('stat');
      keys.push('body');
      break;
    case 'cards':
      step.items.forEach((_item, index) => keys.push(`cell-${String(index)}`));
      break;
    case 'steps':
      step.items.forEach((_item, index) => keys.push(`cell-${String(index)}`));
      break;
    case 'term':
      keys.push('body');
      if (step.example !== undefined) keys.push('cell-0');
      break;
    case 'activity':
      step.instructions.forEach((_item, index) => keys.push(`cell-${String(index)}`));
      if (step.materials !== undefined) keys.push('materials');
      break;
    case 'timer':
      if (step.body !== undefined) keys.push('body');
      break;
    case 'media':
      keys.push('image');
      break;
    case 'debrief':
      step.prompts.forEach((_prompt, index) => keys.push(`cell-${String(index)}`));
      break;
    case 'break':
      if (step.body !== undefined) keys.push('body');
      break;
    case 'join':
      // The QR is session state, not a part. Nothing to reveal or hang a breakout on.
      break;
    case 'blank':
      // Only the optional header and the `el-` keys appended below.
      break;
    case 'interaction': {
      if (step.body !== undefined) keys.push('body');
      keys.push(...interactionPartKeys(step, interactions));
      break;
    }
    default: {
      const never: never = step;
      throw new Error(`unknown outline step kind: ${JSON.stringify(never)}`);
    }
  }
  // A picture is its own part whenever this step carries one, so it can be
  // revealed, selected, resized and replaced by the same controls. Media
  // steps already listed `image` above — they *are* the picture.
  if (step.kind !== 'media' && stepPicture(step) !== undefined) keys.push('image');
  for (const element of stepElements(step)) keys.push(`el-${element.id}`);
  return keys;
}

/** Index carried by a `cell-N` / `option-N` key, or -1 when `key` is not one. */
function indexOf(key: string, prefix: string): number {
  if (!key.startsWith(prefix)) return -1;
  const index = Number(key.slice(prefix.length));
  return Number.isInteger(index) && index >= 0 ? index : -1;
}

/**
 * The display text behind one part key — the same text the stage draws.
 *
 * `undefined` means *this step has no such part*: either the key is not one of
 * `partKeysForStep`, or its index is past the end of the list it indexes. An
 * empty string means the part exists and is currently blank. Callers that only
 * want something to show can `?? ''`; callers deciding whether a part is
 * editable must keep the two apart.
 *
 * Read-only on purpose. Writing a part back is app-side work — the schema
 * package describes the contract, it does not mutate documents. Keeping the
 * read here is what stops the authoring surface from growing a second, drifting
 * derivation of what a part *is* beside `partKeysForStep`.
 */
export function partValue(
  step: OutlineStep,
  key: string,
  interactions?: readonly Interaction[],
): string | undefined {
  const interaction =
    step.kind === 'interaction'
      ? interactions?.find((candidate) => candidate.id === step.interactionId)
      : undefined;

  if (key === 'header') {
    // Each kind's heading is a different field: a term *is* its term, an
    // interaction falls back to the interaction's own prompt, and the rest
    // carry a title. `statement` / `timer` / `media` only have the part at all
    // when a title is authored, which is why an absent title is `undefined`.
    if (step.kind === 'term') return step.term;
    if (step.kind === 'interaction') return step.title ?? interaction?.prompt;
    return 'title' in step ? step.title : undefined;
  }
  if (key === 'stat') return step.kind === 'statement' ? step.stat : undefined;
  if (key === 'body') {
    if (step.kind === 'term') return step.meaning;
    return 'body' in step ? step.body : undefined;
  }
  if (key === 'materials') {
    // One part, one value: the whole list joined by newlines, which is also how
    // an editor round-trips it (one thing per line).
    return step.kind === 'activity' ? step.materials?.join('\n') : undefined;
  }
  if (key === 'image') return stepPicture(step)?.alt;
  if (key.startsWith('el-')) {
    const element = stepElements(step).find((item) => item.id === key.slice(3));
    if (element === undefined) return undefined;
    if (element.type === 'text') return element.text;
    if (element.type === 'image') return element.alt;
    // Reading material has words of its own. Hand-written html does not — its
    // markup is not something a text surface should ever show.
    if (element.type === 'html' && element.markdown !== undefined) return element.markdown;
    return '';
  }

  const option = indexOf(key, 'option-');
  if (option !== -1) {
    if (interaction === undefined) return undefined;
    if (interaction.type === 'match') return interaction.left[option]?.label;
    if (interaction.type !== 'choice' && interaction.type !== 'ranking') return undefined;
    return interaction.options[option]?.label;
  }

  const gap = indexOf(key, 'gap-');
  if (gap !== -1) {
    if (interaction === undefined || interaction.type !== 'fill-the-gaps') return undefined;
    const entry = interaction.gaps[gap];
    if (entry === undefined) return undefined;
    // The blank's value is its answer key: that is the text the stage draws
    // once the gap is revealed, and the only human-readable name it has.
    return entry.answers[0] ?? entry.id;
  }

  const cell = indexOf(key, 'cell-');
  if (cell !== -1) {
    switch (step.kind) {
      case 'cards':
        return step.items[cell]?.text;
      case 'steps':
        return step.items[cell];
      // A term's example is its single peer block beside the meaning, so it is
      // `cell-0` and nothing else.
      case 'term':
        return cell === 0 ? step.example : undefined;
      case 'activity':
        return step.instructions[cell];
      case 'debrief':
        return step.prompts[cell];
      default:
        return undefined;
    }
  }

  return undefined;
}

/**
 * One text field of a step and the styled-span list that mirrors it.
 *
 * Spans on a *fixed slot* are the wired-kind counterpart of `spans` on a text
 * element: the plain field stays authoritative for anything that reads text,
 * and the span list carries the styling over exactly those characters.
 */
export interface SlotSpansTarget {
  textField: string;
  spansField: string;
}

const TITLE_SPANS: SlotSpansTarget = { textField: 'title', spansField: 'titleSpans' };
const BODY_SPANS: SlotSpansTarget = { textField: 'body', spansField: 'bodySpans' };
const STAT_SPANS: SlotSpansTarget = { textField: 'stat', spansField: 'statSpans' };
const TERM_SPANS: SlotSpansTarget = { textField: 'term', spansField: 'termSpans' };
const MEANING_SPANS: SlotSpansTarget = { textField: 'meaning', spansField: 'meaningSpans' };
const EXAMPLE_SPANS: SlotSpansTarget = { textField: 'example', spansField: 'exampleSpans' };

/**
 * Every singular text slot each kind can style, in declaration order.
 *
 * Repeated peer text — card items, list entries, options, materials — styles
 * through its own mirrors (`textSpans` on a card, `SpanRows` beside a string
 * list, `labelSpans` on an option), validated separately. `timer` is absent as
 * a whole because its title and body carry `{timer-minutes}` tokens, so the
 * stored string is not the drawn string. `join` has no authored text at all.
 */
export const SLOT_SPANS_FOR_KIND: Record<OutlineStepKind, readonly SlotSpansTarget[]> = {
  title: [TITLE_SPANS, BODY_SPANS],
  statement: [TITLE_SPANS, BODY_SPANS, STAT_SPANS],
  cards: [TITLE_SPANS],
  steps: [TITLE_SPANS],
  term: [TERM_SPANS, MEANING_SPANS, EXAMPLE_SPANS],
  activity: [TITLE_SPANS],
  timer: [],
  media: [TITLE_SPANS],
  debrief: [TITLE_SPANS],
  break: [TITLE_SPANS, BODY_SPANS],
  join: [],
  blank: [TITLE_SPANS],
  interaction: [TITLE_SPANS, BODY_SPANS],
};

/**
 * The string-list fields each kind styles with a parallel `SpanRows` mirror.
 * Card items are absent: their spans ride the card object itself.
 */
export const LIST_SPANS_FOR_KIND: Partial<
  Record<OutlineStepKind, readonly { listField: string; spansField: string }[]>
> = {
  steps: [{ listField: 'items', spansField: 'itemsSpans' }],
  activity: [
    { listField: 'instructions', spansField: 'instructionsSpans' },
    { listField: 'materials', spansField: 'materialsSpans' },
  ],
  debrief: [{ listField: 'prompts', spansField: 'promptsSpans' }],
};

/**
 * Which pair of fields one span-capable part key writes to, or `null` when this
 * part cannot carry styling on this step.
 *
 * An interaction header that the step does not override is `null` here: the
 * text belongs to the interaction's own `prompt`, so the editor routes it to
 * `promptSpans` on the interaction instead.
 */
export function partSpansTarget(
  step: OutlineStep,
  key: 'header' | 'body' | 'stat',
): SlotSpansTarget | null {
  if (step.kind === 'timer' || step.kind === 'join') return null;
  const slots = SLOT_SPANS_FOR_KIND[step.kind];
  if (key === 'stat') return step.kind === 'statement' ? STAT_SPANS : null;
  if (key === 'header') {
    if (step.kind === 'term') return TERM_SPANS;
    if (step.kind === 'interaction' && step.title === undefined) return null;
    return slots.includes(TITLE_SPANS) ? TITLE_SPANS : null;
  }
  if (step.kind === 'term') return MEANING_SPANS;
  return slots.includes(BODY_SPANS) ? BODY_SPANS : null;
}

export interface RevealIssue {
  /** Index into the authored reveal array, or -1 when the whole value is wrong. */
  group: number;
  message: string;
}

/**
 * Structural checks on an authored `reveal`. Missing keys are *not* an issue —
 * `resolveRevealOrder` appends them (see below).
 */
export function revealIssues(
  step: OutlineStep,
  interactions?: readonly Interaction[],
): RevealIssue[] {
  const reveal = step.reveal;
  if (reveal === undefined || reveal === 'together') return [];

  const valid = new Set(partKeysForStep(step, interactions));
  const issues: RevealIssue[] = [];
  const seen = new Set<string>();

  reveal.forEach((group, index) => {
    if (group.length === 0) {
      issues.push({ group: index, message: 'reveal group is empty' });
      return;
    }
    for (const key of group) {
      if (!valid.has(key)) {
        issues.push({
          group: index,
          message: `reveal references part "${key}", which step "${step.id}" does not have (parts: ${[
            ...valid,
          ].join(', ')})`,
        });
        continue;
      }
      if (seen.has(key)) {
        issues.push({
          group: index,
          message: `reveal lists part "${key}" more than once`,
        });
        continue;
      }
      seen.add(key);
    }
  });

  return issues;
}

/**
 * The reveal order actually played: an ordered list of groups covering every
 * part of the step exactly once.
 *
 * `undefined` and `'together'` both mean one group with everything in it.
 * A partial authored order is honoured as written, and every part the author did
 * not place is appended as its own trailing group — partial authoring is safe,
 * and adding an option to an interaction never invalidates an existing reveal.
 */
export function resolveRevealOrder(
  step: OutlineStep,
  interactions?: readonly Interaction[],
): string[][] {
  const all = partKeysForStep(step, interactions);
  // A step can have no revealable parts at all — a bare countdown is just the
  // clock. Return no groups rather than one empty group, so a caller stepping
  // through the order never lands on a group that shows nothing.
  if (all.length === 0) return [];
  const reveal = step.reveal;
  if (reveal === undefined || reveal === 'together') return [all];

  const known = new Set(all);
  const placed = new Set<string>();
  const groups: string[][] = [];

  for (const group of reveal) {
    const kept = group.filter((key) => known.has(key) && !placed.has(key));
    for (const key of kept) placed.add(key);
    if (kept.length > 0) groups.push(kept);
  }

  for (const key of all) {
    if (!placed.has(key)) groups.push([key]);
  }

  return groups;
}
