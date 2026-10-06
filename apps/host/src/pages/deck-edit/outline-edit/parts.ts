import {
  commitFillTheGapsPrompt,
  partKeysForStep,
  partValue,
  renderMarkdownToHtml,
  stepElements,
  stepPicture,
  validateOutline,
  type Interaction,
  type Outline,
  type OutlineStep,
  type TextSpan,
} from '@openroom/schema';
import { commitTimerText } from '@openroom/slides';
import { keepValid, replaceStep } from './blocks';
import { sameFillTheGapsGaps, syncedFillTheGaps } from './interaction';
import { setElementText } from './media-elements';
import { retargetSlotSpans, withRowSpans } from './slot-spans';
import { removeListItem } from './lists';
import type { SpanRows } from '@openroom/schema';

/**
 * Structural edits on a parsed `Outline` — named parts: read and write the
 * editable text of a step's parts (term, statement body, card items,
 * materials…), plus option/prompt helpers.
 *
 * Nothing here derives part keys — `partKeysForStep` in `@openroom/schema`
 * owns that, so the editor and the validator cannot disagree about what a step
 * is made of.
 */


/** Tutor-private notes. Stripped from learner and stage projections by the schema. */
export function setTutorNotes(outline: Outline, stepId: string, text: string): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const next = { ...step };
  if (text.trim() === '') delete next.tutorNotes;
  else next.tutorNotes = text;
  return replaceStep(outline, stepId, next);
}

/**
 * What a part currently says, for a surface that only needs something to show.
 *
 * The mapping itself lives in `@openroom/schema` (`partValue`) beside
 * `partKeysForStep`, so the authoring surface cannot disagree with the
 * validator about what a part is. This wrapper only flattens "no such part" and
 * "blank" into the empty string; callers that need to tell them apart —
 * deciding whether a part is editable — should read `partValue` directly.
 */
export function partText(outline: Outline, step: OutlineStep, key: string): string {
  return partValue(step, key, outline.interactions) ?? '';
}

/** True when this part has text of its own that the author may edit here. */
export function partEditable(outline: Outline, step: OutlineStep, key: string): boolean {
  return partValue(step, key, outline.interactions) !== undefined;
}

/**
 * The index behind a `material-N` sub-key, or null when `key` is not one.
 *
 * Materials are one *part* (the whole list) but many lines, and the canvas puts
 * a caret on each line. The sub-key is confined to this file and the renderer;
 * it is never a part key, so `partKeysForStep` stays the only vocabulary.
 */
export function materialIndex(key: string): number | null {
  if (!key.startsWith('material-')) return null;
  const index = Number(key.slice('material-'.length));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/** Human wording for a part key, used in the breadcrumb and the preview. */
export function partLabel(step: OutlineStep, key: string): string {
  const material = materialIndex(key);
  if (material !== null) return `Material ${String(material + 1)}`;
  if (key === 'header') return step.kind === 'term' ? 'Term' : 'Heading';
  if (key === 'stat') return 'Headline number';
  if (key === 'body') return step.kind === 'term' ? 'Meaning' : 'Body';
  if (key === 'materials') return 'Materials';
  if (key === 'image') return 'Image';
  if (key.startsWith('el-')) {
    const element = stepElements(step).find((item) => item.id === key.slice(3));
    if (element?.type === 'text') return element.role === 'heading' ? 'Text' : 'Text box';
    if (element?.type === 'image') return 'Picture';
    if (element?.type === 'html') return element.markdown === undefined ? 'HTML' : 'Reading';
    if (element?.type === 'iframe') return 'Web page';
    if (element?.type === 'pdf') return 'PDF';
    return 'Object';
  }
  if (key.startsWith('option-')) return `Answer ${String(Number(key.slice(7)) + 1)}`;
  if (key.startsWith('gap-')) return `Gap ${String(Number(key.slice(4)) + 1)}`;
  if (key.startsWith('cell-')) {
    const n = String(Number(key.slice(5)) + 1);
    if (step.kind === 'term') return 'Example';
    if (step.kind === 'activity') return `Instruction ${n}`;
    if (step.kind === 'debrief') return `Prompt ${n}`;
    return `Item ${n}`;
  }
  return key;
}

/**
 * The step with one slot's stored spans re-aimed at its new text.
 *
 * A commit writes plain text; the styling beside it has to follow, or the two
 * representations of one string drift apart and the validator rejects the
 * document. Prefix and suffix that survived the edit keep their formatting.
 */
function withSlotSpans<T extends OutlineStep>(
  step: T,
  spansField: string,
  oldText: string,
  newText: string,
): T {
  const fields = step as unknown as Record<string, unknown>;
  const spans = fields[spansField];
  if (!Array.isArray(spans)) return step;
  const next = retargetSlotSpans(oldText, spans as TextSpan[], newText);
  const out = { ...(fields as object) } as Record<string, unknown>;
  if (next === undefined) delete out[spansField];
  else out[spansField] = next;
  return out as T;
}

export function replaceAt<T>(list: readonly T[], index: number, value: T): T[] {
  return list.map((item, i) => (i === index ? value : item));
}

/**
 * A `SpanRows` mirror with row `index` re-aimed at its line's new text — the
 * list-shaped counterpart of `withSlotSpans`.
 */
function retargetRowSpans(
  rows: SpanRows | undefined,
  index: number,
  oldText: string,
  newText: string,
): SpanRows | undefined {
  const entry = rows?.[index];
  if (entry === null || entry === undefined) return rows;
  return withRowSpans(rows, index, retargetSlotSpans(oldText, entry, newText));
}

/** Write a part's text back into the outline. Unknown parts are left alone. */
export function setPartText(
  outline: Outline,
  stepId: string,
  key: string,
  text: string,
): Outline {
  return keepValid(outline, writePartText(outline, stepId, key, text));
}

function writePartText(
  outline: Outline,
  stepId: string,
  key: string,
  text: string,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;

  if (key === 'header') {
    // A term's heading is its term — it has no `title` to write to.
    if (step.kind === 'term') {
      return replaceStep(
        outline,
        stepId,
        withSlotSpans({ ...step, term: text }, 'termSpans', step.term, text),
      );
    }
    if (step.kind === 'interaction' && step.title === undefined) {
      const interactions = outline.interactions.map((item) => {
        if (item.id !== step.interactionId) return item;
        if (item.type !== 'fill-the-gaps') {
          if (item.prompt === text) return item;
          const next: Interaction = { ...item, prompt: text };
          const spans =
            item.promptSpans === undefined
              ? undefined
              : retargetSlotSpans(item.prompt, item.promptSpans, text);
          if (spans === undefined) delete next.promptSpans;
          else next.promptSpans = spans;
          return next;
        }
        const prompt = text.trim() === '' || item.gaps.length === 0 ? text : commitFillTheGapsPrompt(item.prompt, text, item.gaps);
        const synced = syncedFillTheGaps({ ...item, prompt });
        if (synced === null) return item;
        if (synced.prompt === item.prompt && sameFillTheGapsGaps(synced.gaps, item.gaps)) return item;
        return synced;
      });
      if (interactions.every((item, at) => item === outline.interactions[at])) return outline;
      return keepValid(outline, { ...outline, interactions });
    }
    if (step.kind === 'timer') {
      // Canvas shows expanded tokens; commit keeps tokens when the display was unchanged.
      const title = commitTimerText(step.title, text, step.seconds);
      return replaceStep(outline, stepId, { ...step, title });
    }
    if (!('title' in step)) return outline;
    const retitled = withSlotSpans({ ...step, title: text }, 'titleSpans', step.title ?? '', text);
    return keepValid(outline, replaceStep(outline, stepId, retitled));
  }
  if (key === 'stat' && step.kind === 'statement') {
    return replaceStep(
      outline,
      stepId,
      withSlotSpans({ ...step, stat: text }, 'statSpans', step.stat ?? '', text),
    );
  }
  if (key === 'body') {
    if (step.kind === 'term') {
      return replaceStep(
        outline,
        stepId,
        withSlotSpans({ ...step, meaning: text }, 'meaningSpans', step.meaning, text),
      );
    }
    if (step.kind === 'timer') {
      const body = commitTimerText(step.body, text, step.seconds);
      return replaceStep(outline, stepId, { ...step, body });
    }
    if (!('body' in step)) return outline;
    return replaceStep(
      outline,
      stepId,
      withSlotSpans({ ...step, body: text }, 'bodySpans', step.body ?? '', text),
    );
  }
  if (key === 'materials' && step.kind === 'activity') {
    // Rebuilding the whole list from free text loses the line↔row pairing, so
    // the styling mirror cannot follow; formatting on materials is per-line.
    const materials = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
    const next = { ...step, materials };
    delete next.materialsSpans;
    return replaceStep(outline, stepId, next);
  }
  if (key === 'image') {
    // The image part's text is its alt text — the only words a picture has.
    const media = stepPicture(step);
    if (media === undefined) return outline;
    return replaceStep(outline, stepId, { ...step, media: { ...media, alt: text } } as OutlineStep);
  }
  if (key.startsWith('el-')) {
    return setElementText(outline, stepId, key.slice(3), text);
  }

  // `material-N` is one line of the `materials` part, not a part of its own —
  // see the sub-key note in `@openroom/slides`. Blanking a line removes it,
  // which is what a caret deleting the last word of a list entry means.
  const material = materialIndex(key);
  if (material !== null && step.kind === 'activity') {
    const materials = step.materials ?? [];
    const line = materials[material];
    if (line === undefined) return outline;
    if (text.trim() === '') return removeListItem(outline, stepId, 'material', material);
    const materialsSpans = retargetRowSpans(step.materialsSpans, material, line, text);
    const next = { ...step, materials: replaceAt(materials, material, text) };
    if (materialsSpans === undefined) delete next.materialsSpans;
    else next.materialsSpans = materialsSpans;
    return replaceStep(outline, stepId, next);
  }

  if (key.startsWith('gap-') && step.kind === 'interaction') {
    const index = Number(key.slice('gap-'.length));
    return keepValid(outline, {
      ...outline,
      interactions: outline.interactions.map((item) => {
        if (item.id !== step.interactionId || item.type !== 'fill-the-gaps') return item;
        const gap = item.gaps[index];
        if (gap === undefined) return item;
        const answer = text.trim();
        const rest = gap.answers.slice(1).filter((entry) => entry !== answer);
        return { ...item, gaps: replaceAt(item.gaps, index, { ...gap, answers: [answer, ...rest] }) };
      }) as Interaction[],
    });
  }

  if (key.startsWith('option-') && step.kind === 'interaction') {
    const index = Number(key.slice('option-'.length));
    return keepValid(outline, {
      ...outline,
      interactions: outline.interactions.map((item) => {
        if (item.id !== step.interactionId) return item;
        // A match's `option-N` is its left column — the list the canvas draws.
        if (item.type === 'match') {
          const left = item.left[index];
          if (left === undefined) return item;
          return { ...item, left: replaceAt(item.left, index, relabeled(left, text)) };
        }
        if (item.type !== 'choice' && item.type !== 'ranking') return item;
        const option = item.options[index];
        if (option === undefined) return item;
        return { ...item, options: replaceAt(item.options, index, relabeled(option, text)) };
      }) as Interaction[],
    });
  }

  if (key.startsWith('cell-')) {
    const index = Number(key.slice('cell-'.length));
    if (step.kind === 'cards') {
      const card = step.items[index];
      if (card === undefined) return outline;
      const next = { ...card, text };
      const textSpans =
        card.textSpans === undefined ? undefined : retargetSlotSpans(card.text, card.textSpans, text);
      if (textSpans === undefined) delete next.textSpans;
      else next.textSpans = textSpans;
      return replaceStep(outline, stepId, { ...step, items: replaceAt(step.items, index, next) });
    }
    if (step.kind === 'steps') {
      const line = step.items[index];
      if (line === undefined) return outline;
      const itemsSpans = retargetRowSpans(step.itemsSpans, index, line, text);
      const next = { ...step, items: replaceAt(step.items, index, text) };
      if (itemsSpans === undefined) delete next.itemsSpans;
      else next.itemsSpans = itemsSpans;
      return replaceStep(outline, stepId, next);
    }
    if (step.kind === 'term') {
      return replaceStep(
        outline,
        stepId,
        withSlotSpans({ ...step, example: text }, 'exampleSpans', step.example ?? '', text),
      );
    }
    if (step.kind === 'activity') {
      const line = step.instructions[index];
      if (line === undefined) return outline;
      const instructionsSpans = retargetRowSpans(step.instructionsSpans, index, line, text);
      const next = { ...step, instructions: replaceAt(step.instructions, index, text) };
      if (instructionsSpans === undefined) delete next.instructionsSpans;
      else next.instructionsSpans = instructionsSpans;
      return replaceStep(outline, stepId, next);
    }
    if (step.kind === 'debrief') {
      const line = step.prompts[index];
      if (line === undefined) return outline;
      const promptsSpans = retargetRowSpans(step.promptsSpans, index, line, text);
      const next = { ...step, prompts: replaceAt(step.prompts, index, text) };
      if (promptsSpans === undefined) delete next.promptsSpans;
      else next.promptsSpans = promptsSpans;
      return replaceStep(outline, stepId, next);
    }
  }
  return outline;
}

/** An option/match item with new label text and its styling re-aimed at it. */
function relabeled<T extends { label: string; labelSpans?: TextSpan[] }>(item: T, text: string): T {
  const next = { ...item, label: text };
  const spans = item.labelSpans === undefined ? undefined : retargetSlotSpans(item.label, item.labelSpans, text);
  if (spans === undefined) delete next.labelSpans;
  else next.labelSpans = spans;
  return next;
}

/**
 * The options of a step's interaction, in authored order.
 *
 * Exported because the canvas and the present preview both draw the same step
 * with the same renderer; two local copies of "which options does this step
 * have" is exactly how a preview starts disagreeing with the editor.
 */
export function optionsFor(
  outline: Outline,
  step: OutlineStep,
): { id: string; label: string; labelSpans?: TextSpan[] }[] {
  if (step.kind !== 'interaction') return [];
  const interaction = outline.interactions.find((item) => item.id === step.interactionId);
  if (interaction === undefined) return [];
  if (interaction.type === 'match') {
    return interaction.left.map((item) => styledOption(item));
  }
  if (interaction.type !== 'choice' && interaction.type !== 'ranking') return [];
  return interaction.options.map((option) => styledOption(option));
}

function styledOption(item: { id: string; label: string; labelSpans?: TextSpan[] }): {
  id: string;
  label: string;
  labelSpans?: TextSpan[];
} {
  return {
    id: item.id,
    label: item.label,
    ...(item.labelSpans === undefined ? {} : { labelSpans: item.labelSpans }),
  };
}

/** The interaction's own prompt, used as the heading when the step overrides none. */
export function promptFor(outline: Outline, step: OutlineStep): string | undefined {
  if (step.kind !== 'interaction') return undefined;
  return outline.interactions.find((item) => item.id === step.interactionId)?.prompt;
}

/** Styled spans over that prompt, when the author has styled it. */
export function promptSpansFor(outline: Outline, step: OutlineStep): TextSpan[] | undefined {
  if (step.kind !== 'interaction') return undefined;
  const interaction = outline.interactions.find((item) => item.id === step.interactionId);
  if (interaction === undefined || interaction.type === 'fill-the-gaps') return undefined;
  return interaction.promptSpans;
}

/** A fill-the-gaps prompt's whole-prompt family, its one piece of styling. */
export function promptFontFor(
  outline: Outline,
  step: OutlineStep,
): 'default' | 'display' | 'serif' | 'mono' | undefined {
  if (step.kind !== 'interaction') return undefined;
  const interaction = outline.interactions.find((item) => item.id === step.interactionId);
  return interaction?.type === 'fill-the-gaps' ? interaction.promptFont : undefined;
}
