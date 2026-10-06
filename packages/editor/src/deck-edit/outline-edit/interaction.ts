import {
  fillTheGapsPlaceholderIds,
  gapsForFillTheGapsPrompt,
  MAX_FILL_THE_GAPS_GAPS,
  type FillTheGapsInteraction,
  type Interaction,
  type Outline,
} from '@openroom/schema';
import { keepValid } from './blocks';

/**
 * Structural edits on a parsed `Outline` — replacing an interaction definition.
 *
 * A fill-the-gaps interaction's gaps are derived from its prompt: the prompt is
 * the source of truth, and a write that would leave them out of sync is refused
 * rather than silently repaired here.
 */


/**
 * Replace the interaction definition owned by an interaction step.
 * Keeps `step.interactionId` in sync if the editor renames the interaction id.
 */
export function setInteraction(
  outline: Outline,
  stepId: string,
  next: Interaction,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || step.kind !== 'interaction') return outline;
  const oldId = step.interactionId;
  const interaction = next.type === 'fill-the-gaps' ? syncedFillTheGaps(next) : next;
  if (interaction === null) return outline;
  const interactions = outline.interactions
    .filter((item) => item.id !== oldId)
    .concat(interaction);
  const steps =
    oldId === interaction.id
      ? outline.steps
      : outline.steps.map((item) =>
          item.kind === 'interaction' && item.interactionId === oldId
            ? { ...item, interactionId: interaction.id }
            : item,
        );
  return keepValid(outline, { ...outline, steps, interactions });
}

export function sameFillTheGapsGaps(
  left: FillTheGapsInteraction['gaps'],
  right: FillTheGapsInteraction['gaps'],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((gap, at) => {
    const other = right[at];
    return (
      other !== undefined &&
      gap.id === other.id &&
      gap.answers.length === other.answers.length &&
      gap.answers.every((answer, i) => answer === other.answers[i]) &&
      sameWords(gap.distractors, other.distractors)
    );
  });
}

function sameWords(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  const a = left ?? [];
  const b = right ?? [];
  return a.length === b.length && a.every((word, at) => word === b[at]);
}

/** Prompt is the source of truth; refuse a fill-the-gaps that cannot carry a legal one. */
export function syncedFillTheGaps(interaction: FillTheGapsInteraction): FillTheGapsInteraction | null {
  const gaps = gapsForFillTheGapsPrompt(interaction.prompt, interaction.gaps);
  if (gaps.length > MAX_FILL_THE_GAPS_GAPS) return null;
  const placeholders = fillTheGapsPlaceholderIds(interaction.prompt);
  if (placeholders.length !== gaps.length) return null;
  return { ...interaction, gaps };
}
