import { defaultDeckDesign, type SlideMaster } from './deck-design.js';
import type { Outline, OutlineStep } from './outline-types.js';
import { compileOutline } from './outline.js';

/** Public file references. These never grant access to their source decks. */
export interface PresentationActivity { slideId: string; spaceId: string; deckId: string; stepId: string }
export interface ComposedActivity extends PresentationActivity { deckVersion: number; sessionStepId: string }
export interface PresentationComposition { id: string; activities: ComposedActivity[] }
export interface ActivitySource extends PresentationActivity { deckVersion: number; outline: Outline }

/** Every authored slide can be embedded; repeated questions have independent answers. */
export function composePresentation(sources: ActivitySource[]): { outline: Outline; activities: ComposedActivity[] } {
  const first = sources[0];
  if (!first || sources.length > 200 || new Set(sources.map((source) => source.slideId)).size !== sources.length) throw new Error('invalid-presentation-activities');
  const firstDesign = first.outline.design ?? defaultDeckDesign();
  const outline: Outline = {
    version: 1, meta: { ...structuredClone(first.outline.meta), title: `${first.outline.meta.title.slice(0, 180)} · PowerPoint` },
    defaults: structuredClone(first.outline.defaults ?? {}),
    ...(first.outline.qna ? { qna: structuredClone(first.outline.qna) } : {}),
    design: { ...structuredClone(firstDesign), masters: [], defaultMasterId: '' }, steps: [], interactions: [],
  };
  const masters = new Map<string, string>();
  const activities: ComposedActivity[] = [];
  for (const [index, source] of sources.entries()) {
    if (source.spaceId !== first.spaceId) throw new Error('presentation-space-mismatch');
    if ((source.outline.defaults?.identityMode ?? 'pseudonymous') !== (first.outline.defaults?.identityMode ?? 'pseudonymous')) throw new Error('presentation-identity-mismatch');
    const parent = source.outline.steps.find((step) => step.id === source.stepId);
    if (!parent) throw new Error('activity-not-found');
    const selected = [parent, ...source.outline.steps.filter((step) => step.breakoutOf?.stepId === parent.id)];
    const ids = new Map(selected.map((step, at) => [step.id, `activity-${index + 1}-step-${at + 1}`]));
    const questions = new Map<string, string>();
    const design = source.outline.design ?? defaultDeckDesign();
    for (const original of selected) {
      const step: OutlineStep = structuredClone(original);
      step.id = ids.get(original.id)!;
      if (original.id === parent.id) delete step.breakoutOf;
      else if (step.breakoutOf) step.breakoutOf.stepId = ids.get(step.breakoutOf.stepId)!;
      if (step.kind === 'interaction') {
        let id = questions.get(step.interactionId);
        if (!id) {
          const question = source.outline.interactions.find((item) => item.id === step.interactionId);
          if (!question) throw new Error('activity-not-found');
          id = `activity-${index + 1}-question-${questions.size + 1}`;
          questions.set(question.id, id);
          outline.interactions.push({ ...structuredClone(question), id,
            resultVisibility: question.resultVisibility ?? source.outline.defaults?.resultVisibility ?? 'live',
            allowAnswerChange: question.allowAnswerChange ?? source.outline.defaults?.allowAnswerChange ?? true,
          });
        }
        step.interactionId = id;
      }
      const master = design.masters.find((item) => item.id === (step.design?.masterId ?? design.defaultMasterId))!;
      const saved: Omit<SlideMaster, 'id'> = { ...structuredClone(master), theme: structuredClone(master.theme ?? design.theme) };
      const key = JSON.stringify(saved);
      let masterId = masters.get(key);
      if (!masterId) {
        masterId = `source-master-${masters.size + 1}`; masters.set(key, masterId);
        outline.design!.masters.push({ ...saved, id: masterId });
      }
      step.design = { ...step.design, masterId };
      outline.steps.push(step);
    }
    const { outline: _outline, ...reference } = source;
    activities.push({ ...reference, sessionStepId: ids.get(parent.id)! });
  }
  outline.design!.defaultMasterId = outline.design!.masters[0]!.id;
  const validated = compileOutline(outline);
  if (!validated.ok) throw new Error('invalid-presentation-content');
  return { outline: validated.outline, activities };
}
