import type { LearnerCorrection, Outline, OutlineCardsStep } from '@openroom/schema';
import { insertTemplate } from './templates';
import { keepValid } from './blocks';

/** A deliberate teaching edit copies only the chosen wording and explanation. */
export function insertCorrection(outline: Outline, afterStepId: string | null, correction: LearnerCorrection): { outline: Outline; stepId: string } {
  const inserted = insertTemplate(outline, afterStepId, 'comparison');
  if (!inserted.stepId) return inserted;
  const content: OutlineCardsStep = {
    id: inserted.stepId, kind: 'cards', title: 'Compare the wording', layout: 'grid',
    design: { templateId: 'comparison' },
    items: [{ label: 'Original', text: correction.original }, { label: 'Try this', text: correction.replacement }, ...(correction.explanation ? [{ label: 'Why', text: correction.explanation }] : [])],
    reveal: [['header', 'cell-0'], ['cell-1'], ...(correction.explanation ? [['cell-2']] : [])],
  };
  const next = keepValid(outline, { ...inserted.outline, steps: inserted.outline.steps.map((step) => step.id === inserted.stepId ? content : step) });
  return { outline: next, stepId: next === outline ? '' : inserted.stepId };
}
