import { MAX_OPTIONS, MAX_RANKING_OPTIONS, MAX_SCALE_SPAN, MIN_SCALE_SPAN, type Interaction, type Outline, type OutlineStep } from '@openroom/schema';

/** The question kinds PowerPoint can create in place. The labels match the deck editor. */
export type QuestionKind = 'choice' | 'word-cloud' | 'text' | 'scale' | 'numeric' | 'ranking' | 'qna';
export const QUESTION_KINDS: { kind: QuestionKind; label: string }[] = [
  { kind: 'choice', label: 'Multiple choice' },
  { kind: 'word-cloud', label: 'Word cloud' },
  { kind: 'text', label: 'Open text' },
  { kind: 'scale', label: 'Scale' },
  { kind: 'numeric', label: 'Number' },
  { kind: 'ranking', label: 'Ranking' },
  { kind: 'qna', label: 'Q&A' },
];

export interface OptionDraft { id?: string; label: string; correct: boolean }
export interface QuestionDraft {
  kind: QuestionKind;
  prompt: string;
  options: OptionDraft[];
  multiple: boolean;
  min: number;
  max: number;
  minLabel: string;
  maxLabel: string;
  unit: string;
}

export const usesOptions = (kind: QuestionKind) => kind === 'choice' || kind === 'ranking';
export const maxOptions = (kind: QuestionKind) => kind === 'ranking' ? MAX_RANKING_OPTIONS : MAX_OPTIONS;

export function emptyDraft(kind: QuestionKind = 'choice', from?: QuestionDraft): QuestionDraft {
  const options = from && usesOptions(from.kind) ? from.options.slice(0, maxOptions(kind)) : [];
  while (options.length < 3) options.push({ label: '', correct: false });
  return {
    kind, prompt: from?.prompt ?? '', options: kind === 'ranking' ? options.map((option) => ({ ...option, correct: false })) : options,
    multiple: false, min: 1, max: 5, minLabel: '', maxLabel: '', unit: '',
  };
}

/** Only questions this form can write back are edited in place; others open in OpenRoom. */
export function draftFromInteraction(interaction: Interaction): QuestionDraft | null {
  const base = emptyDraft();
  switch (interaction.type) {
    case 'choice':
      if (interaction.options.some((option) => option.labelSpans)) return null;
      return { ...base, kind: 'choice', prompt: interaction.prompt, multiple: interaction.multiple === true, options: interaction.options.map((option) => ({ id: option.id, label: option.label, correct: option.correct === true })) };
    case 'ranking':
      if (interaction.correctOrder || interaction.options.some((option) => option.labelSpans)) return null;
      return { ...base, kind: 'ranking', prompt: interaction.prompt, options: interaction.options.map((option) => ({ id: option.id, label: option.label, correct: false })) };
    case 'text':
      if (interaction.correctAnswers?.length) return null;
      return { ...base, kind: interaction.display === 'word-cloud' || interaction.display === 'wordcloud' ? 'word-cloud' : 'text', prompt: interaction.prompt };
    case 'scale':
      return { ...base, kind: 'scale', prompt: interaction.prompt, min: interaction.min, max: interaction.max, minLabel: interaction.minLabel ?? '', maxLabel: interaction.maxLabel ?? '' };
    case 'numeric':
      if (interaction.correct !== undefined) return null;
      return { ...base, kind: 'numeric', prompt: interaction.prompt, unit: interaction.unit ?? '' };
    case 'qna':
      return { ...base, kind: 'qna', prompt: interaction.prompt };
    default:
      return null;
  }
}

/** A message for the first thing the presenter still has to fill in, or null when the draft is complete. */
export function draftProblem(draft: QuestionDraft): string | null {
  if (!draft.prompt.trim()) return 'Write the question.';
  if (usesOptions(draft.kind)) {
    const filled = draft.options.filter((option) => option.label.trim());
    if (filled.length < 2) return 'Add at least two options.';
    if (new Set(filled.map((option) => option.label.trim())).size !== filled.length) return 'Give each option a different text.';
  }
  if (draft.kind === 'scale' && !(Number.isInteger(draft.min) && Number.isInteger(draft.max) && draft.max - draft.min >= MIN_SCALE_SPAN && draft.max - draft.min <= MAX_SCALE_SPAN)) return `Use whole numbers for the scale. The last number must be ${MIN_SCALE_SPAN} to ${MAX_SCALE_SPAN} more than the first.`;
  return null;
}

const shortId = () => crypto.randomUUID().replaceAll('-', '').slice(0, 10);

export function interactionFromDraft(draft: QuestionDraft, id: string, previous?: Interaction): Interaction {
  const prompt = draft.prompt.trim();
  // Keep settings chosen in the deck editor (display, timer, notes, result visibility)
  // when the kind is unchanged. Styled prompt spans no longer match an edited prompt.
  const carried: Record<string, unknown> = previous && draftFromInteraction(previous)?.kind === draft.kind ? { ...previous } : {};
  if (carried.prompt !== prompt) delete carried.promptSpans;
  const previousOptions = new Map((previous && 'options' in previous && Array.isArray(previous.options) ? previous.options as { id: string }[] : []).map((option) => [option.id, option]));
  const used = new Set<string>();
  const options = draft.options.filter((option) => option.label.trim()).map((option) => {
    let optionId = option.id && !used.has(option.id) ? option.id : `o-${shortId()}`;
    while (used.has(optionId)) optionId = `o-${shortId()}`;
    used.add(optionId);
    return { ...previousOptions.get(optionId), id: optionId, label: option.label.trim(), correct: option.correct };
  });
  const base = { ...carried, id, prompt };
  switch (draft.kind) {
    case 'choice': {
      const { peerInstruction, multiple: _multiple, ...rest } = base as Record<string, unknown>;
      return { ...rest, type: 'choice', ...(draft.multiple ? { multiple: true } : peerInstruction ? { peerInstruction } : {}), options: options.map(({ correct, ...option }) => correct ? { ...option, correct: true } : option) } as Interaction;
    }
    case 'ranking':
      return { ...base, type: 'ranking', options: options.map(({ id: optionId, label }) => ({ id: optionId, label })) } as Interaction;
    case 'word-cloud':
      return { maxLength: 40, ...base, type: 'text', display: 'word-cloud' } as Interaction;
    case 'text':
      return { maxLength: 200, ...base, type: 'text' } as Interaction;
    case 'scale': {
      const { minLabel: _minLabel, maxLabel: _maxLabel, ...rest } = base as Record<string, unknown>;
      return { ...rest, type: 'scale', min: draft.min, max: draft.max, ...(draft.minLabel.trim() ? { minLabel: draft.minLabel.trim() } : {}), ...(draft.maxLabel.trim() ? { maxLabel: draft.maxLabel.trim() } : {}) } as Interaction;
    }
    case 'numeric': {
      const { unit: _unit, ...rest } = base as Record<string, unknown>;
      return { ...rest, type: 'numeric', ...(draft.unit.trim() ? { unit: draft.unit.trim() } : {}) } as Interaction;
    }
    case 'qna':
      return { ...base, type: 'qna' } as Interaction;
  }
}

export function newOutline(title: string): Outline {
  return { version: 1, meta: { title }, steps: [], interactions: [] };
}

/** Append a question slide. Returns the new outline and its step ID. */
export function addQuestion(outline: Outline, draft: QuestionDraft): { outline: Outline; stepId: string } {
  const taken = new Set([...outline.steps.map((step) => step.id), ...outline.interactions.map((item) => item.id)]);
  let stepId = `s-${shortId()}`, interactionId = `q-${shortId()}`;
  while (taken.has(stepId)) stepId = `s-${shortId()}`;
  while (taken.has(interactionId)) interactionId = `q-${shortId()}`;
  const step = { id: stepId, kind: 'interaction', layout: 'poll', interactionId } as OutlineStep;
  return { stepId, outline: { ...outline, steps: [...outline.steps, step], interactions: [...outline.interactions, interactionFromDraft(draft, interactionId)] } };
}

/** Replace the question behind one step, keeping its ID so live results and bindings still match. */
export function replaceQuestion(outline: Outline, stepId: string, draft: QuestionDraft): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (!step || step.kind !== 'interaction') throw new Error('This slide is no longer a question. Choose it again.');
  const previous = outline.interactions.find((item) => item.id === step.interactionId);
  return { ...outline, interactions: outline.interactions.map((item) => item.id === step.interactionId ? interactionFromDraft(draft, item.id, previous) : item) };
}

export function questionForStep(outline: Outline | null | undefined, stepId: string): Interaction | null {
  const step = outline?.steps.find((item) => item.id === stepId);
  return step?.kind === 'interaction' ? outline!.interactions.find((item) => item.id === step.interactionId) ?? null : null;
}
