import { defaultDeckDesign, type DeckDesign, type Outline, type SlideDesign } from '@openroom/schema';

export function setDeckDesign(outline: Outline, design: DeckDesign): Outline {
  const masters = new Set(design.masters.map((master) => master.id));
  return {
    ...outline, design: structuredClone(design),
    steps: outline.steps.map((step) => step.design?.masterId && !masters.has(step.design.masterId)
      ? { ...step, design: { ...step.design, masterId: design.defaultMasterId } } : step),
  };
}

export function setSlideDesign(outline: Outline, stepId: string, design: SlideDesign): Outline {
  return {
    ...outline, design: outline.design ?? defaultDeckDesign(),
    steps: outline.steps.map((step) => step.id === stepId ? { ...step, design: structuredClone(design) } : step),
  };
}

/** Explicitly apply a shared kit to every slide while retaining template composition. */
export function applyBrandKit(outline: Outline, design: DeckDesign): Outline {
  const next = setDeckDesign(outline, design);
  return { ...next, steps: next.steps.map((step) => {
    const { design: previous, ...content } = step;
    return previous?.templateId ? { ...content, design: { templateId: previous.templateId } } : content;
  }) };
}
