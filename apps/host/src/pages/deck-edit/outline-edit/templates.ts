import { LAYOUTS_FOR_KIND, SLIDE_TEMPLATES, WORKSHOP_SEQUENCES, type Outline, type OutlineStep } from '@openroom/schema';
import { keepValid, orderedBlocks, uniqueId, usedIds } from './blocks';

export function insertWorkshop(outline: Outline, afterStepId: string | null, sequenceId: string): { outline: Outline; stepId: string } {
  const sequence = WORKSHOP_SEQUENCES.find((item) => item.id === sequenceId);
  if (!sequence) return { outline, stepId: '' };
  const used = usedIds(outline);
  const claim = (id: string) => { const next = uniqueId(`${sequence.id}-${id}`, used); used.add(next); return next; };
  const interactionIds = new Map(sequence.interactions.map((item) => [item.id, claim(item.id)]));
  const interactions = sequence.interactions.map((item) => ({ ...structuredClone(item), id: interactionIds.get(item.id)! }));
  const steps = sequence.steps.map((original): OutlineStep => {
    const step = { ...structuredClone(original), id: claim(original.id) };
    return step.kind === 'interaction' ? { ...step, interactionId: interactionIds.get(step.interactionId)! } : step;
  });
  const blocks = orderedBlocks(outline);
  const previous = blocks.findIndex((block) => block.step.id === afterStepId || block.breakouts.some((child) => child.id === afterStepId));
  blocks.splice(previous < 0 ? blocks.length : previous + 1, 0, ...steps.map((step) => ({ step, number: 0, breakouts: [] })));
  const next = keepValid(outline, { ...outline, steps: blocks.flatMap((block) => [block.step, ...block.breakouts]), interactions: [...outline.interactions, ...interactions] });
  return { outline: next, stepId: next === outline ? '' : steps[0]!.id };
}

export function insertTemplate(outline: Outline, afterStepId: string | null, templateId: string): { outline: Outline; stepId: string } {
  const template = SLIDE_TEMPLATES.find((item) => item.id === templateId);
  if (!template) return { outline, stepId: '' };
  const used = usedIds(outline);
  const stepId = uniqueId(template.id, used);
  used.add(stepId);
  const step = structuredClone(template.step);
  step.id = stepId;
  step.design = { templateId: template.id };
  const interaction = template.interaction ? structuredClone(template.interaction) : undefined;
  if (interaction && step.kind === 'interaction') {
    interaction.id = uniqueId(`${stepId}-question`, used);
    step.interactionId = interaction.id;
  }
  const blocks = orderedBlocks(outline);
  const previous = blocks.findIndex((block) => block.step.id === afterStepId || block.breakouts.some((child) => child.id === afterStepId));
  const index = previous < 0 ? blocks.length : previous + 1;
  blocks.splice(index, 0, { step, number: 0, breakouts: [] });
  const next = keepValid(outline, { ...outline, steps: blocks.flatMap((block) => [block.step, ...block.breakouts]), interactions: interaction ? [...outline.interactions, interaction] : outline.interactions });
  return { outline: next, stepId: next === outline ? '' : stepId };
}

/** Reset presentation formatting while retaining words, answers, IDs and reveals. */
export function resetTemplateFormatting(outline: Outline, stepId: string): Outline {
  const current = outline.steps.find((step) => step.id === stepId);
  const template = SLIDE_TEMPLATES.find((item) => item.id === current?.design?.templateId);
  if (!current || !template || current.kind !== template.step.kind) return outline;
  const step = Object.fromEntries(Object.entries(current).filter(([key]) => !key.endsWith('Spans'))) as unknown as OutlineStep;
  step.layout = template.step.layout ?? LAYOUTS_FOR_KIND[step.kind][0];
  step.design = { templateId: template.id };
  if (step.kind === 'cards') step.items = step.items.map(({ textSpans: _spans, ...item }) => item);
  if ('elements' in step && step.elements && 'elements' in template.step) {
    const originals = template.step.elements ?? [];
    step.elements = step.elements.map((element) => {
      const original = originals.find((item) => item.id === element.id && item.type === element.type);
      if (!original) return element;
      if (element.type !== 'text' || original.type !== 'text') return { ...element, box: { ...original.box } };
      const { spans: _spans, ...plain } = element;
      return { ...plain, box: { ...original.box }, align: original.align, role: original.role };
    });
  }
  return keepValid(outline, { ...outline, steps: outline.steps.map((item) => item.id === stepId ? step : item) });
}
