/**
 * Which typed arrangement of regions a step is drawn in.
 *
 * `layout` is authored on the step (`OutlineStepBase.layout` in
 * `@openroom/schema`), and it is optional: most outlines never name one. This
 * module is the single place that answers "so what does this step actually get
 * drawn as?", so the deck editor canvas, the projector, and the reveal editor can
 * never disagree.
 *
 * The vocabulary and the kind→layout table are *mirrored* from
 * `@openroom/schema`'s `outline-parts.ts` rather than imported: this package is
 * source-shipped structure with no runtime dependencies, and the projector
 * bundle should not pull the schema package (and its Ajv validators) in to draw
 * a slide. `layout.test.ts` imports the schema as a devDependency and asserts
 * the two tables are identical, so the mirror cannot drift silently.
 */

/** A typed arrangement of regions. Never CSS — the skins own the pixels. */
export type SlideLayout =
  | 'title'
  | 'text'
  | 'split'
  | 'grid'
  | 'media'
  | 'poll'
  | 'activity'
  | 'timer'
  | 'join'
  | 'blank';

export const SLIDE_LAYOUTS = [
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
] as const satisfies readonly SlideLayout[];

export type SlideStepKind =
  | 'title'
  | 'statement'
  | 'cards'
  | 'steps'
  | 'term'
  | 'activity'
  | 'timer'
  | 'media'
  | 'debrief'
  | 'break'
  | 'join'
  | 'blank'
  | 'interaction';

/**
 * Which layouts each kind may claim, first entry first.
 *
 * Mirror of `LAYOUTS_FOR_KIND` in `@openroom/schema`. The *order* is load
 * bearing here in a way it is not there: entry zero is the layout a step of
 * that kind is drawn in when the author named none.
 */
export const LAYOUTS_FOR_KIND: Record<SlideStepKind, readonly SlideLayout[]> = {
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

/** The layout a step of this kind is drawn in when the author named none. */
export function defaultLayoutForKind(kind: SlideStepKind): SlideLayout {
  const [first] = LAYOUTS_FOR_KIND[kind];
  // Every kind has at least one allowed layout; the fallback is only here so
  // the function is total without a non-null assertion.
  return first ?? 'text';
}

/** True when `layout` is one this kind can actually fill. */
export function layoutAllowedForKind(kind: SlideStepKind, layout: SlideLayout): boolean {
  return LAYOUTS_FOR_KIND[kind].includes(layout);
}

/**
 * The layout a step is drawn in.
 *
 * An authored layout wins, but only when the kind can fill it: a `term` step
 * carrying `layout: 'poll'` has no aggregate region to put anywhere, and
 * drawing it as a poll would produce an empty slide rather than a wrong one.
 * Such a step falls back to its kind's default, which is also what the
 * validator will flag in the deck editor.
 */
export function effectiveLayout(step: { kind: SlideStepKind; layout?: SlideLayout }): SlideLayout {
  const authored = step.layout;
  if (authored !== undefined && layoutAllowedForKind(step.kind, authored)) return authored;
  return defaultLayoutForKind(step.kind);
}
