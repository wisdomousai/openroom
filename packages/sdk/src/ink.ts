/**
 * Tutor ink colours.
 *
 * The wire carries the *name*, never a hex value: a mark is authored on the
 * host console and painted on the projector and on every phone, and a closed
 * enum is what keeps those three surfaces drawing the same thing (the same
 * discipline the outline schema uses for layouts and kinds).
 *
 * The hex values are the light theme's own palette (`@openroom/ui` themes:
 * `destructive`, `chart-3`, `chart-2`) rather than invented colours — the
 * yellow is that palette's ochre, which is the only yellow that stays legible
 * on the plate's white ground.
 */
export const INK_COLORS = ['red', 'yellow', 'green'] as const;

export type InkColor = (typeof INK_COLORS)[number];

export const INK_HEX: Record<InkColor, string> = {
  red: '#c81e1e',
  yellow: '#b45309',
  green: '#047857',
};

/** Marks stored before ink had a colour are red — the tutor's first pen. */
export function inkHex(color: string | undefined): string {
  return INK_HEX[(color ?? 'red') as InkColor] ?? INK_HEX.red;
}

/**
 * Shapes a tutor can put over a word or a span of words. Each is anchored to a
 * part and a token — never to pixels — so the same mark lands on the same word
 * on the projector, the console mirror, and every phone.
 */
export const MARK_SHAPES = [
  'circle',
  'rectangle',
  'underline',
  'strikethrough',
  'highlight',
] as const;

export type MarkShape = (typeof MARK_SHAPES)[number];

/** What the tutor's tools are called in the console. */
export const MARK_SHAPE_LABELS: Record<MarkShape, string> = {
  circle: 'Circle',
  rectangle: 'Box',
  underline: 'Underline',
  strikethrough: 'Strike',
  highlight: 'Highlight',
};

export function isMarkShape(value: string): value is MarkShape {
  return (MARK_SHAPES as readonly string[]).includes(value);
}
