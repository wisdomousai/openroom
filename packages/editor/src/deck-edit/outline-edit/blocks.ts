import {
  LAYOUTS_FOR_KIND,
  partKeysForStep,
  stepElements,
  validateOutline,
  type Interaction,
  type Outline,
  type OutlineElement,
  type OutlineLayout,
  type OutlineStep,
  type OutlineTimerPlacement,
  type OutlineTimerStyle,
} from '@openroom/schema';
import { commitTimerText, expandTimerText } from '@openroom/slides';
import { insertIdBase, starterStep, type InsertKind } from './catalog';

/**
 * Structural edits on a parsed `Outline` — blocks and ordering: block list,
 * minutes/timers, insert/duplicate/remove/move, reveal, layout.
 *
 * `keepValid`, `replaceStep` and `uniqueId` are shared plumbing for the other
 * edit modules; they are exported for them, not part of the public surface
 * (the barrel does not re-export them).
 */

/**
 * Last line of defence for a structured edit: if the result would fail the
 * outline contract, keep the previous document. The deck editor canvas re-parses on
 * every apply, so an invalid write is not "a warning" — it replaces the
 * editor with the repair screen.
 */
export function keepValid(previous: Outline, next: Outline): Outline {
  if (previous === next) return previous;
  return validateOutline(next).ok ? next : previous;
}

/** A top-level block with the breakouts hanging off it, in display order. */
export interface Block {
  step: OutlineStep;
  /** 1-based position among top-level blocks. Breakouts are not numbered. */
  number: number;
  breakouts: OutlineStep[];
}

export function uniqueId(base: string, used: Set<string>): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'block';
  if (!used.has(slug)) return slug;
  let n = 2;
  while (used.has(`${slug}-${String(n)}`)) n += 1;
  return `${slug}-${String(n)}`;
}

export function usedIds(outline: Outline): Set<string> {
  return new Set([
    ...outline.steps.map((step) => step.id),
    ...outline.interactions.map((interaction) => interaction.id),
  ]);
}

/** Top-level blocks in authored order, each carrying its breakout children. */
export function orderedBlocks(outline: Outline): Block[] {
  const blocks: Block[] = [];
  for (const step of outline.steps) {
    if (step.breakoutOf !== undefined) continue;
    blocks.push({ step, number: blocks.length + 1, breakouts: [] });
  }
  const byId = new Map(blocks.map((block) => [block.step.id, block]));
  for (const step of outline.steps) {
    if (step.breakoutOf === undefined) continue;
    // An orphaned breakout would be a validation error, not something to hide.
    byId.get(step.breakoutOf.stepId)?.breakouts.push(step);
  }
  return blocks;
}

/** Flatten display order back into the `steps` array: parent, then its breakouts. */
function flatten(blocks: Block[]): OutlineStep[] {
  return blocks.flatMap((block) => [block.step, ...block.breakouts]);
}

/** The step's own duration in whole minutes, when its kind carries one. */
export function stepMinutes(step: OutlineStep): number | null {
  if (step.kind === 'timer') return Math.max(1, Math.round(step.seconds / 60));
  if (step.kind === 'break') return step.minutes ?? null;
  if (step.kind === 'activity') {
    return step.durationSec === undefined ? null : Math.max(1, Math.round(step.durationSec / 60));
  }
  return null;
}

/** True when `+`/`−` minutes means anything for this kind. */
export function hasMinutes(step: OutlineStep): boolean {
  return step.kind === 'timer' || step.kind === 'break' || step.kind === 'activity';
}

export function totalMinutes(outline: Outline): number {
  return outline.steps.reduce((sum, step) => sum + (stepMinutes(step) ?? 0), 0);
}

/** The line the block list shows under the kind. */
export function stepTitle(outline: Outline, step: OutlineStep): string {
  if (step.kind === 'term') return step.term;
  if (step.kind === 'interaction') {
    if (step.title !== undefined && step.title !== '') return step.title;
    const interaction = outline.interactions.find((item) => item.id === step.interactionId);
    return interaction?.prompt ?? step.interactionId;
  }
  if (step.kind === 'timer' && step.title !== undefined && step.title !== '') {
    // Expand duration tokens so the rail matches the slide, not the raw plan.
    return expandTimerText(step.title, step.seconds);
  }
  if (step.kind === 'join') return 'Join the session';
  if ('title' in step && step.title !== undefined && step.title !== '') return step.title;
  if (step.kind === 'blank') {
    // A freeform slide has no title slot, so its name is what it says: the
    // heading box if the author placed one, otherwise the first text box.
    const texts = stepElements(step).filter(
      (element): element is Extract<OutlineElement, { type: 'text' }> => element.type === 'text',
    );
    const named = texts.find((element) => element.role === 'heading') ?? texts[0];
    const line = named?.text.trim();
    return line === undefined || line === '' ? 'Empty slide' : line;
  }
  return step.id;
}

export function replaceStep(outline: Outline, stepId: string, next: OutlineStep): Outline {
  return { ...outline, steps: outline.steps.map((step) => (step.id === stepId ? next : step)) };
}

export function setMinutes(outline: Outline, stepId: string, delta: number): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || !hasMinutes(step)) return outline;
  const current = stepMinutes(step) ?? 5;
  const minutes = Math.min(120, Math.max(1, current + delta));
  if (step.kind === 'timer') return replaceStep(outline, stepId, { ...step, seconds: minutes * 60 });
  if (step.kind === 'break') return replaceStep(outline, stepId, { ...step, minutes });
  if (step.kind === 'activity') return replaceStep(outline, stepId, { ...step, durationSec: minutes * 60 });
  return outline;
}

/**
 * Set an absolute duration in whole seconds for timer / activity / break.
 * Clamped 1s–2h so a countdown always has something to do.
 */
export function setDurationSeconds(outline: Outline, stepId: string, seconds: number): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || !hasMinutes(step)) return outline;
  const sec = Math.min(7200, Math.max(1, Math.round(seconds)));
  if (step.kind === 'timer') return replaceStep(outline, stepId, { ...step, seconds: sec });
  if (step.kind === 'break') {
    return replaceStep(outline, stepId, { ...step, minutes: Math.max(1, Math.round(sec / 60)) });
  }
  if (step.kind === 'activity') return replaceStep(outline, stepId, { ...step, durationSec: sec });
  return outline;
}

/** Whole seconds for a timed step (timer / activity), or minutes×60 for break. */
export function stepSeconds(step: OutlineStep): number | null {
  if (step.kind === 'timer') return Math.max(1, Math.floor(step.seconds));
  if (step.kind === 'activity') {
    return step.durationSec === undefined ? null : Math.max(1, Math.floor(step.durationSec));
  }
  if (step.kind === 'break') {
    return step.minutes === undefined ? null : Math.max(60, step.minutes * 60);
  }
  return null;
}

/**
 * How the timer is drawn on the slide. Passing the default (`countdown`) clears
 * the field so the plan file stays quiet for the common case.
 */
export function setTimerStyle(
  outline: Outline,
  stepId: string,
  style: OutlineTimerStyle,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || step.kind !== 'timer') return outline;
  if (style === 'countdown') {
    if (step.style === undefined) return outline;
    const next = { ...step };
    delete next.style;
    return replaceStep(outline, stepId, next);
  }
  if (step.style === style) return outline;
  return replaceStep(outline, stepId, { ...step, style });
}

/**
 * Where the clock is drawn. Passing the default (`slide`) clears the field so
 * a plain file never mentions placement.
 */
export function setTimerPlacement(
  outline: Outline,
  stepId: string,
  placement: OutlineTimerPlacement,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || step.kind !== 'timer') return outline;
  if (placement === 'slide') {
    if (step.placement === undefined) return outline;
    const next = { ...step };
    delete next.placement;
    return replaceStep(outline, stepId, next);
  }
  if (step.placement === placement) return outline;
  return replaceStep(outline, stepId, { ...step, placement });
}

/**
 * Keep the clock in the corner when the teacher moves on. Default is true, so
 * passing true clears the field.
 */
export function setTimerPersist(
  outline: Outline,
  stepId: string,
  persist: boolean,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || step.kind !== 'timer') return outline;
  if (persist) {
    if (step.persist === undefined) return outline;
    const next = { ...step };
    delete next.persist;
    return replaceStep(outline, stepId, next);
  }
  if (step.persist === false) return outline;
  return replaceStep(outline, stepId, { ...step, persist: false });
}

/** True when this step collects answers from the class. */
export function asksTheClass(step: OutlineStep): boolean {
  return step.kind === 'interaction';
}

/** How many top-level slides ask the class. */
export function askTheClassCount(outline: Outline): number {
  return outline.steps.filter((step) => step.breakoutOf === undefined && asksTheClass(step)).length;
}

export interface InsertOptions {
  /**
   * Part of the parent this breakout hangs off. Defaults to the parent's first
   * part when inserting as a breakout.
   */
  afterKey?: string;
  /**
   * File as a breakout of the selected block: same content kinds, opens from a
   * part and returns to the parent (one level only — not on a breakout).
   */
  asBreakout?: boolean;
}

/**
 * Insert a typed block after `afterStepId` (or at the end when it is null).
 *
 * With `asBreakout: true`, the new step attaches to a part of the selected
 * block instead of taking a place of its own in the running order — so a cards
 * list can progressively reveal while each term opens a poll and returns.
 */
/** Assign alternating pair-work lanes on a cards block. */
export function splitForPairWork(outline: Outline, stepId: string): Outline {
  const steps = outline.steps.map((step) => {
    if (step.id !== stepId || step.kind !== 'cards') return step;
    return {
      ...step,
      items: step.items.map((item, index) => ({ ...item, lane: (index % 2) as 0 | 1 })),
    };
  });
  return { ...outline, steps };
}

/**
 * Undo the split: every card on this block goes back to being shared.
 *
 * `lane` is deleted rather than set to a neutral value — an absent lane is what
 * "everyone sees this card" means in the outline contract.
 */
export function clearPairWork(outline: Outline, stepId: string): Outline {
  const steps = outline.steps.map((step) => {
    if (step.id !== stepId || step.kind !== 'cards') return step;
    return {
      ...step,
      items: step.items.map(({ lane: _shared, ...item }) => item),
    };
  });
  return { ...outline, steps };
}

export function insertAfter(
  outline: Outline,
  afterStepId: string | null,
  kind: InsertKind,
  options: InsertOptions = {},
): { outline: Outline; stepId: string } {
  const { afterKey, asBreakout = false } = options;
  const used = usedIds(outline);
  const id = uniqueId(insertIdBase(kind), used);
  used.add(id);

  let step = starterStep(kind, id);
  let interactions = outline.interactions;

  if (kind === 'question' || kind === 'fill-the-gaps' || kind === 'match') {
    const interactionId = uniqueId(`${id}-question`, used);
    step = { id, kind: 'interaction', interactionId };
    const interaction: Interaction =
      kind === 'fill-the-gaps'
        ? {
            id: interactionId,
            type: 'fill-the-gaps',
            prompt: '',
            gaps: [],
          }
        : kind === 'match'
          ? {
              id: interactionId,
              type: 'match',
              prompt: '',
              left: [
                { id: 'left-1', label: '' },
                { id: 'left-2', label: '' },
              ],
              right: [
                { id: 'right-1', label: '' },
                { id: 'right-2', label: '' },
              ],
              correct: { 'left-1': 'right-1', 'left-2': 'right-2' },
            }
          : {
              id: interactionId,
              type: 'choice',
              prompt: '',
              options: [
                { id: 'option-1', label: '' },
                { id: 'option-2', label: '' },
                { id: 'option-3', label: '' },
              ],
            };
    interactions = [...outline.interactions, interaction];
  }

  const parent = outline.steps.find((item) => item.id === afterStepId);

  if (asBreakout) {
    // One level only: a breakout cannot itself carry one.
    if (parent === undefined || parent.breakoutOf !== undefined) return { outline, stepId: '' };
    const key = afterKey ?? partKeysForStep(parent, interactions)[0];
    if (key === undefined) return { outline, stepId: '' };
    step = { ...step, breakoutOf: { stepId: parent.id, afterKey: key } };
    const blocks = orderedBlocks({ ...outline, interactions });
    const host = blocks.find((block) => block.step.id === parent.id);
    host?.breakouts.push(step);
    return { outline: { ...outline, interactions, steps: flatten(blocks) }, stepId: id };
  }

  // A selected breakout inserts after the block it belongs to, not inside it.
  const blocks = orderedBlocks({ ...outline, interactions });
  const anchorId = parent?.breakoutOf?.stepId ?? afterStepId;
  const at = blocks.findIndex((block) => block.step.id === anchorId);
  const insertAt = at === -1 ? blocks.length : at + 1;
  blocks.splice(insertAt, 0, { step, number: 0, breakouts: [] });
  return { outline: { ...outline, interactions, steps: flatten(blocks) }, stepId: id };
}

export function duplicateStep(outline: Outline, stepId: string): { outline: Outline; stepId: string } {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return { outline, stepId };
  const used = usedIds(outline);
  const id = uniqueId(`${step.id}-copy`, used);
  used.add(id);

  let copy: OutlineStep = { ...structuredClone(step), id };
  let interactions = outline.interactions;
  if (step.kind === 'interaction') {
    const source = outline.interactions.find((item) => item.id === step.interactionId);
    if (source !== undefined) {
      const interactionId = uniqueId(`${source.id}-copy`, used);
      interactions = [...outline.interactions, { ...structuredClone(source), id: interactionId }];
      copy = { ...structuredClone(step), id, interactionId };
    }
  }

  const blocks = orderedBlocks({ ...outline, interactions });
  if (copy.breakoutOf !== undefined) {
    const host = blocks.find((block) => block.step.id === copy.breakoutOf!.stepId);
    host?.breakouts.push(copy);
  } else {
    const at = blocks.findIndex((block) => block.step.id === stepId);
    blocks.splice(at + 1, 0, { step: copy, number: 0, breakouts: [] });
  }
  return { outline: { ...outline, interactions, steps: flatten(blocks) }, stepId: id };
}

/** Remove a block, its breakouts, and any interaction only it used. */
export function removeStep(outline: Outline, stepId: string): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const doomed = new Set([stepId]);
  for (const candidate of outline.steps) {
    if (candidate.breakoutOf?.stepId === stepId) doomed.add(candidate.id);
  }
  const steps = outline.steps.filter((item) => !doomed.has(item.id));
  // Only the interactions the removed steps owned go with them. An interaction
  // no step references may have been authored ahead of its block; dropping it
  // because something else was deleted would be silent data loss.
  const orphaned = new Set(
    outline.steps.flatMap((item) =>
      doomed.has(item.id) && item.kind === 'interaction' ? [item.interactionId] : [],
    ),
  );
  for (const item of steps) {
    if (item.kind === 'interaction') orphaned.delete(item.interactionId);
  }
  const interactions = outline.interactions.filter((item) => !orphaned.has(item.id));
  return { ...outline, steps, interactions };
}

/** Move a top-level block (with its breakouts) to a new position among blocks. */
export function moveBlock(outline: Outline, stepId: string, toIndex: number): Outline {
  const blocks = orderedBlocks(outline);
  const from = blocks.findIndex((block) => block.step.id === stepId);
  if (from === -1) return outline;
  const clamped = Math.min(Math.max(toIndex, 0), blocks.length - 1);
  if (clamped === from) return outline;
  const [moved] = blocks.splice(from, 1);
  blocks.splice(clamped, 0, moved!);
  return { ...outline, steps: flatten(blocks) };
}

/**
 * Write an authored reveal back onto a step. One group (or none) is `together`,
 * which keeps the YAML honest about what the author actually chose.
 */
export function setReveal(outline: Outline, stepId: string, groups: string[][]): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const next: OutlineStep =
    groups.length <= 1 ? { ...step, reveal: 'together' } : { ...step, reveal: groups };
  return replaceStep(outline, stepId, next);
}

export function setLayout(outline: Outline, stepId: string, layout: OutlineStep['layout']): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const next = { ...step };
  if (layout === undefined) delete next.layout;
  else next.layout = layout;
  return replaceStep(outline, stepId, next);
}

/** Wording for a step kind, in the block list and the properties panel. */
export const STEP_KIND_WORDS: Record<OutlineStep['kind'], string> = {
  title: 'Title',
  statement: 'Statement',
  cards: 'Cards',
  steps: 'Steps',
  term: 'Term',
  activity: 'Activity',
  timer: 'Timer',
  media: 'Media',
  debrief: 'Debrief',
  break: 'Break',
  join: 'Join the session',
  blank: 'Empty slide',
  interaction: 'Question',
};
