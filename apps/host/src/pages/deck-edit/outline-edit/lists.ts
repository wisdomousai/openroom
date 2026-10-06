import {
  MAX_FILL_THE_GAPS_GAPS,
  MAX_OPTIONS,
  MAX_RANKING_OPTIONS,
  MIN_OPTIONS,
  MIN_RANKING_OPTIONS,
  commitFillTheGapsPrompt,
  fillTheGapsPlaceholderIds,
  gapsForFillTheGapsPrompt,
  insertFillTheGapsRange,
  partKeysForStep,
  validateOutline,
  type FillTheGapsInteraction,
  type Interaction,
  type Outline,
  type OutlineStep,
  type SpanRows,
} from '@openroom/schema';
import { keepValid, replaceStep, uniqueId, usedIds } from './blocks';
import { type ListTarget } from './catalog';
import { replaceAt } from './parts';
import { insertSpansRow, removeSpansRow } from './slot-spans';
import { syncedFillTheGaps } from './interaction';

/**
 * Structural edits on a parsed `Outline` — lists a block can grow or shrink:
 * options, cards, materials, instructions, prompts and gaps, plus gap answers,
 * distractors and word banks.
 */


/** How many entries each list may hold — mirrors the outline / deck contract. */
const LIST_BOUNDS: Record<ListTarget, { min: number; max: number }> = {
  // Choice default. Ranking is tighter — see `listBounds`.
  option: { min: MIN_OPTIONS, max: MAX_OPTIONS },
  card: { min: 2, max: 8 },
  // Materials are optional: the last one can go, taking the list with it.
  material: { min: 0, max: 12 },
  instruction: { min: 1, max: 12 },
  prompt: { min: 1, max: 12 },
  gap: { min: 0, max: MAX_FILL_THE_GAPS_GAPS },
};

/** Choice and ranking share the option list but not the same ceiling. */
function listBounds(
  outline: Outline,
  step: OutlineStep,
  target: ListTarget,
): { min: number; max: number } | null {
  if (target !== 'option') return LIST_BOUNDS[target];
  if (step.kind !== 'interaction') return null;
  const interaction = outline.interactions.find((item) => item.id === step.interactionId);
  if (interaction === undefined) return null;
  if (interaction.type === 'choice') return { min: MIN_OPTIONS, max: MAX_OPTIONS };
  if (interaction.type === 'ranking') return { min: MIN_RANKING_OPTIONS, max: MAX_RANKING_OPTIONS };
  return null;
}

/** What a new entry says before the author has said anything. */
const LIST_STARTER: Record<ListTarget, string> = {
  option: '', card: '', material: '', instruction: '', prompt: '', gap: '',
};

/** The list a target names on this step, or null when the step has no such list. */
function listLength(
  outline: Outline,
  step: OutlineStep,
  target: ListTarget,
): number | null {
  switch (target) {
    case 'option': {
      if (step.kind !== 'interaction') return null;
      const interaction = outline.interactions.find((item) => item.id === step.interactionId);
      if (interaction === undefined) return null;
      if (interaction.type !== 'choice' && interaction.type !== 'ranking') return null;
      return interaction.options.length;
    }
    case 'card':
      return step.kind === 'cards' ? step.items.length : step.kind === 'steps' ? step.items.length : null;
    case 'material':
      return step.kind === 'activity' ? (step.materials?.length ?? 0) : null;
    case 'instruction':
      return step.kind === 'activity' ? step.instructions.length : null;
    case 'prompt':
      return step.kind === 'debrief' ? step.prompts.length : null;
    case 'gap': {
      if (step.kind !== 'interaction') return null;
      const interaction = outline.interactions.find((item) => item.id === step.interactionId);
      return interaction?.type === 'fill-the-gaps' ? interaction.gaps.length : null;
    }
  }
}

/** True when one more entry of this kind would still be a legal document. */
export function canAddListItem(outline: Outline, step: OutlineStep, target: ListTarget): boolean {
  const length = listLength(outline, step, target);
  const bounds = listBounds(outline, step, target);
  return length !== null && bounds !== null && length < bounds.max;
}

/** True when one fewer entry of this kind would still be a legal document. */
export function canRemoveListItem(outline: Outline, step: OutlineStep, target: ListTarget): boolean {
  const length = listLength(outline, step, target);
  const bounds = listBounds(outline, step, target);
  return length !== null && bounds !== null && length > bounds.min;
}

function insertInto<T>(list: readonly T[], index: number | undefined, value: T): T[] {
  const next = [...list];
  next.splice(insertPosition(list.length, index), 0, value);
  return next;
}

/** Where `insertInto` puts the new entry: after `index`, clamped to the list. */
function insertPosition(length: number, index: number | undefined): number {
  return index === undefined ? length : Math.min(Math.max(index + 1, 0), length);
}

/**
 * Keep a `SpanRows` styling mirror aligned when its list grows or shrinks.
 * A list edit that moves lines without moving their styling shears the mirror
 * onto the wrong lines — worse than losing the styling outright.
 */
function withGrownRows<T extends OutlineStep>(step: T, spansField: string, at: number): T {
  return withRows(step, spansField, (rows) => insertSpansRow(rows, at));
}

function withShrunkRows<T extends OutlineStep>(step: T, spansField: string, at: number): T {
  return withRows(step, spansField, (rows) => removeSpansRow(rows, at));
}

function withRows<T extends OutlineStep>(
  step: T,
  spansField: string,
  change: (rows: SpanRows | undefined) => SpanRows | undefined,
): T {
  const fields = step as unknown as Record<string, unknown>;
  const rows = Array.isArray(fields[spansField]) ? (fields[spansField] as SpanRows) : undefined;
  const next = change(rows);
  if (next === rows) return step;
  const out = { ...(fields as object) } as Record<string, unknown>;
  if (next === undefined) delete out[spansField];
  else out[spansField] = next;
  return out as T;
}

/**
 * Add one entry to a list, after `index` (or at the end).
 *
 * Options live on the interaction the step references, not on the step, so this
 * is the one list edit that writes somewhere else — which is precisely why it
 * belongs here rather than in a component.
 */
export function addListItem(
  outline: Outline,
  stepId: string,
  target: ListTarget,
  index?: number,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  if (!canAddListItem(outline, step, target)) return outline;
  const text = LIST_STARTER[target];

  if (target === 'option') {
    if (step.kind !== 'interaction') return outline;
    const used = usedIds(outline);
    return keepValid(outline, {
      ...outline,
      interactions: outline.interactions.map((item) => {
        if (item.id !== step.interactionId) return item;
        if (item.type !== 'choice' && item.type !== 'ranking') return item;
        for (const option of item.options) used.add(option.id);
        const id = uniqueId(`${item.id}-option`, used);
        return { ...item, options: insertInto(item.options, index, { id, label: text }) };
      }) as Interaction[],
    });
  }
  if (target === 'card') {
    if (step.kind === 'cards') {
      return replaceStep(outline, stepId, { ...step, items: insertInto(step.items, index, { text }) });
    }
    if (step.kind === 'steps') {
      return replaceStep(outline, stepId, withGrownRows({
        ...step,
        items: insertInto(step.items, index, text),
      }, 'itemsSpans', insertPosition(step.items.length, index)));
    }
    return outline;
  }
  if (target === 'material' && step.kind === 'activity') {
    const materials = step.materials ?? [];
    return replaceStep(outline, stepId, withGrownRows({
      ...step,
      materials: insertInto(materials, index, text),
    }, 'materialsSpans', insertPosition(materials.length, index)));
  }
  if (target === 'instruction' && step.kind === 'activity') {
    return replaceStep(outline, stepId, withGrownRows({
      ...step,
      instructions: insertInto(step.instructions, index, text),
    }, 'instructionsSpans', insertPosition(step.instructions.length, index)));
  }
  if (target === 'prompt' && step.kind === 'debrief') {
    return replaceStep(outline, stepId, withGrownRows({
      ...step,
      prompts: insertInto(step.prompts, index, text),
    }, 'promptsSpans', insertPosition(step.prompts.length, index)));
  }
  if (target === 'gap') {
    if (step.kind !== 'interaction') return outline;
    const interaction = outline.interactions.find((item) => item.id === step.interactionId);
    if (interaction === undefined || interaction.type !== 'fill-the-gaps') return outline;
    const used = new Set(interaction.gaps.map((gap) => gap.id));
    let n = interaction.gaps.length + 1;
    while (used.has(`g${String(n)}`)) n += 1;
    const id = `g${String(n)}`;
    const token = `{{${id}}}`;
    const prompt = interaction.prompt.includes(token)
      ? interaction.prompt
      : `${interaction.prompt.trimEnd()} ${token}`.trim();
    const at = index === undefined ? interaction.gaps.length : Math.min(Math.max(index + 1, 0), interaction.gaps.length);
    const gaps = [...interaction.gaps];
    gaps.splice(at, 0, { id, answers: [text] });
    const next: Outline = {
      ...outline,
      interactions: outline.interactions.map((item) =>
        item.id === interaction.id && item.type === 'fill-the-gaps' ? { ...item, prompt, gaps } : item,
      ) as Interaction[],
    };
    return keepValid(outline, next);
  }
  return outline;
}

function without<T>(list: readonly T[], index: number): T[] {
  return list.filter((_item, at) => at !== index);
}

/**
 * Remove one entry from a list.
 *
 * Refused when it would take the list under what the kind needs — two options,
 * two boxes, one instruction. Materials are the exception: the last one may go,
 * and the field goes with it rather than being left as an empty list the
 * validator would reject.
 */
export function removeListItem(
  outline: Outline,
  stepId: string,
  target: ListTarget,
  index: number,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  if (!canRemoveListItem(outline, step, target)) return outline;

  if (target === 'option') {
    if (step.kind !== 'interaction') return outline;
    const next: Outline = {
      ...outline,
      interactions: outline.interactions.map((item) => {
        if (item.id !== step.interactionId) return item;
        if (item.type !== 'choice' && item.type !== 'ranking') return item;
        if (item.options[index] === undefined) return item;
        return { ...item, options: without(item.options, index) };
      }) as Interaction[],
    };
    return keepValid(outline, pruneReveal(next, stepId));
  }
  if (target === 'card') {
    if (step.kind === 'cards') {
      if (step.items[index] === undefined) return outline;
      return replaceStep(outline, stepId, { ...step, items: without(step.items, index) });
    }
    if (step.kind === 'steps') {
      if (step.items[index] === undefined) return outline;
      return replaceStep(
        outline,
        stepId,
        withShrunkRows({ ...step, items: without(step.items, index) }, 'itemsSpans', index),
      );
    }
    return outline;
  }
  if (target === 'material' && step.kind === 'activity') {
    const materials = step.materials ?? [];
    if (materials[index] === undefined) return outline;
    const next = without(materials, index);
    const replacement = withShrunkRows({ ...step }, 'materialsSpans', index);
    if (next.length === 0) {
      delete replacement.materials;
      delete replacement.materialsSpans;
    } else replacement.materials = next;
    return replaceStep(outline, stepId, replacement);
  }
  if (target === 'instruction' && step.kind === 'activity') {
    if (step.instructions[index] === undefined) return outline;
    return replaceStep(
      outline,
      stepId,
      withShrunkRows({ ...step, instructions: without(step.instructions, index) }, 'instructionsSpans', index),
    );
  }
  if (target === 'prompt' && step.kind === 'debrief') {
    if (step.prompts[index] === undefined) return outline;
    return replaceStep(
      outline,
      stepId,
      withShrunkRows({ ...step, prompts: without(step.prompts, index) }, 'promptsSpans', index),
    );
  }
  if (target === 'gap') {
    if (step.kind !== 'interaction') return outline;
    const interaction = outline.interactions.find((item) => item.id === step.interactionId);
    if (interaction === undefined || interaction.type !== 'fill-the-gaps') return outline;
    const gap = interaction.gaps[index];
    if (gap === undefined) return outline;
    const token = new RegExp(`\\s*\\{\\{${gap.id}\\}\\}`, 'g');
    const prompt = interaction.prompt.replace(token, '').replace(/\s+/g, ' ').trim();
    const nextInteraction = syncedFillTheGaps({
      ...interaction,
      prompt,
      gaps: without(interaction.gaps, index),
    });
    if (nextInteraction === null) return outline;
    const next: Outline = {
      ...outline,
      interactions: outline.interactions.map((item) =>
        item.id === interaction.id ? nextInteraction : item,
      ),
    };
    return keepValid(outline, pruneReveal(next, stepId));
  }
  return outline;
}

function replaceFillTheGaps(
  outline: Outline,
  stepId: string,
  next: FillTheGapsInteraction,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || step.kind !== 'interaction') return outline;
  const synced = syncedFillTheGaps(next);
  if (synced === null) return outline;
  return keepValid(outline, {
    ...outline,
    interactions: outline.interactions.map((item) =>
      item.id === step.interactionId ? synced : item,
    ),
  });
}

/** Replace a gap's accepted spellings. The first entry is the canvas part. */
export function setGapAnswers(
  outline: Outline,
  stepId: string,
  gapIndex: number,
  answers: readonly string[],
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || step.kind !== 'interaction') return outline;
  const interaction = outline.interactions.find((item) => item.id === step.interactionId);
  if (interaction === undefined || interaction.type !== 'fill-the-gaps') return outline;
  const gap = interaction.gaps[gapIndex];
  if (gap === undefined) return outline;
  const nextAnswers = answers.map((word) => word.trim()).filter((word) => word !== '');
  if (nextAnswers.length === 0) return outline;
  return replaceFillTheGaps(outline, stepId, {
    ...interaction,
    gaps: replaceAt(interaction.gaps, gapIndex, { ...gap, answers: nextAnswers }),
  });
}

/** Wrong options for the per-gap picker. Empty drops the field. */
export function setGapDistractors(
  outline: Outline,
  stepId: string,
  gapIndex: number,
  distractors: readonly string[],
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || step.kind !== 'interaction') return outline;
  const interaction = outline.interactions.find((item) => item.id === step.interactionId);
  if (interaction === undefined || interaction.type !== 'fill-the-gaps') return outline;
  const gap = interaction.gaps[gapIndex];
  if (gap === undefined) return outline;
  const next = distractors.map((word) => word.trim()).filter((word) => word !== '');
  const { distractors: _dropped, ...rest } = gap;
  return replaceFillTheGaps(outline, stepId, {
    ...interaction,
    gaps: replaceAt(interaction.gaps, gapIndex, {
      ...rest,
      ...(next.length > 0 ? { distractors: next } : {}),
    }),
  });
}

/** Extra wrong words for the shared bank. Empty drops the field. */
export function setFillTheGapsBank(
  outline: Outline,
  stepId: string,
  bank: readonly string[],
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || step.kind !== 'interaction') return outline;
  const interaction = outline.interactions.find((item) => item.id === step.interactionId);
  if (interaction === undefined || interaction.type !== 'fill-the-gaps') return outline;
  const next = bank.map((word) => word.trim()).filter((word) => word !== '');
  const { bank: _dropped, ...rest } = interaction;
  return replaceFillTheGaps(outline, stepId, {
    ...rest,
    ...(next.length > 0 ? { bank: next } : {}),
  });
}

/**
 * Turn the current text selection in the stored prompt into the next gap.
 * Empty or overlapping-marker ranges are refused; no-selection callers should
 * fall back to `addListItem(..., 'gap')`.
 */
export function insertGapAtRange(
  outline: Outline,
  stepId: string,
  start: number,
  end: number,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || step.kind !== 'interaction') return outline;
  const interaction = outline.interactions.find((item) => item.id === step.interactionId);
  if (interaction === undefined || interaction.type !== 'fill-the-gaps') return outline;
  const inserted = insertFillTheGapsRange(interaction.prompt, interaction.gaps, start, end);
  if (inserted === null) return outline;
  return replaceFillTheGaps(outline, stepId, {
    ...interaction,
    prompt: inserted.prompt,
    gaps: inserted.gaps,
  });
}

/**
 * After a list shrinks, drop reveal keys that no longer name a part. Missing
 * keys are fine (they are appended at play time) but a leftover `gap-1` after
 * the last gap went is `E_REVEAL`.
 */
function pruneReveal(outline: Outline, stepId: string): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || step.reveal === undefined || step.reveal === 'together') return outline;
  const valid = new Set(partKeysForStep(step, outline.interactions));
  const groups = step.reveal
    .map((group) => group.filter((key) => valid.has(key)))
    .filter((group) => group.length > 0);
  if (groups.length === step.reveal.length && groups.every((group, at) => group.length === step.reveal![at]!.length)) {
    return outline;
  }
  return replaceStep(
    outline,
    stepId,
    groups.length <= 1 ? { ...step, reveal: 'together' } : { ...step, reveal: groups },
  );
}

/**
 * Mark one option of a choice as the correct answer, or unmark it.
 *
 * Single-correct: marking one clears the rest, and marking the marked one
 * clears it — so the field says either "this one" or "no answer is being
 * scored", and never "these three, one of which the author forgot to unset".
 * `correct` never reaches a learner: `projectInteraction` in `@openroom/schema`
 * rebuilds each option as `{ id, label }`.
 */
export function setOptionCorrect(outline: Outline, stepId: string, optionIndex: number): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || step.kind !== 'interaction') return outline;
  return {
    ...outline,
    interactions: outline.interactions.map((item) => {
      if (item.id !== step.interactionId) return item;
      if (item.type !== 'choice') return item;
      const target = item.options[optionIndex];
      if (target === undefined) return item;
      const turningOff = target.correct === true;
      return {
        ...item,
        options: item.options.map((option, at) => {
          const next = { ...option };
          delete next.correct;
          if (at === optionIndex && !turningOff) next.correct = true;
          return next;
        }),
      };
    }) as Interaction[],
  };
}

/** True when this option of a choice is currently the marked answer. */
export function optionCorrect(outline: Outline, step: OutlineStep, optionIndex: number): boolean {
  if (step.kind !== 'interaction') return false;
  const interaction = outline.interactions.find((item) => item.id === step.interactionId);
  if (interaction?.type !== 'choice') return false;
  return interaction.options[optionIndex]?.correct === true;
}
