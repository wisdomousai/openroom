/**
 * Where a presenter is inside a deck: which step, and how much of it is out.
 *
 * The whole of Present's navigation is here, as data — a step index plus a
 * count of revealed groups — so the overlay component is only a renderer and a
 * keymap. `counts[i]` is the number of resolved reveal groups of step `i`
 * (`resolveRevealOrder(...).length`): 1 for a step that lands whole, 0 for a
 * step with nothing to reveal (a bare countdown), n for a sequenced one.
 *
 * Landing on a step always shows its first group — a step that arrived blank
 * and needed a keypress to show anything would read as a dropped frame, not as
 * a reveal.
 */
export interface PresentCursor {
  /** Index into the presentable steps (breakouts already excluded). */
  step: number;
  /** How many reveal groups of that step are showing. */
  shown: number;
}

function clampStep(counts: readonly number[], step: number): number {
  if (counts.length === 0) return 0;
  return Math.min(Math.max(step, 0), counts.length - 1);
}

/** Groups showing when a step is entered going forward: the first one. */
function entered(counts: readonly number[], step: number): number {
  return Math.min(1, counts[step] ?? 0);
}

/** Every group of the step: how a step is shown when it is arrived at backwards. */
function whole(counts: readonly number[], step: number): number {
  return counts[step] ?? 0;
}

/** Open at `step`, showing its first reveal group. Out-of-range clamps. */
export function openCursor(counts: readonly number[], step: number): PresentCursor {
  const at = clampStep(counts, step);
  return { step: at, shown: entered(counts, at) };
}

/**
 * `→` / `Space`: the next reveal group, and once the step is fully out, the
 * next step. At the end of the deck it stands still rather than closing — the
 * tutor decides when the session stops looking at the last slide.
 */
export function advance(counts: readonly number[], cursor: PresentCursor): PresentCursor {
  const at = clampStep(counts, cursor.step);
  if (cursor.shown < whole(counts, at)) return { step: at, shown: cursor.shown + 1 };
  if (at + 1 >= counts.length) return { step: at, shown: whole(counts, at) };
  return { step: at + 1, shown: entered(counts, at + 1) };
}

/**
 * `←`: hide the last revealed group, then return to the previous step shown whole.
 */
export function retreat(counts: readonly number[], cursor: PresentCursor): PresentCursor {
  const at = clampStep(counts, cursor.step);
  if (cursor.shown > 1) return { step: at, shown: cursor.shown - 1 };
  if (at === 0) return { step: at, shown: cursor.shown };
  const to = at - 1;
  return { step: to, shown: whole(counts, to) };
}

export function atStart(counts: readonly number[], cursor: PresentCursor): boolean {
  return clampStep(counts, cursor.step) === 0 && cursor.shown <= 1;
}

/** True when `advance` would change nothing: last step, everything showing. */
export function atEnd(counts: readonly number[], cursor: PresentCursor): boolean {
  const at = clampStep(counts, cursor.step);
  return at + 1 >= counts.length && cursor.shown >= whole(counts, at);
}
