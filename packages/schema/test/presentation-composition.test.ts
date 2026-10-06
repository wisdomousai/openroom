import { describe, expect, it } from 'vitest';
import { composePresentation, defaultDeckDesign, resolveSlideDesign, validateOutline, type ActivitySource, type Outline, type OutlineStep } from '../src/index.js';

const outline = (family: 'clean' | 'board'): Outline => ({
  version: 1, meta: { title: family }, design: defaultDeckDesign(family), defaults: { resultVisibility: family === 'board' ? 'hidden-until-close' : 'live', allowAnswerChange: family === 'clean' },
  steps: [{ id: 'question', kind: 'interaction', interactionId: 'answer', tutorNotes: 'Facilitator guidance' }, { id: 'detail', kind: 'statement', body: 'Explain', breakoutOf: { stepId: 'question', afterKey: 'header' } }, { id: 'unselected', kind: 'interaction', interactionId: 'extra' }],
  interactions: [{ id: 'answer', type: 'choice', prompt: 'What next?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }, { id: 'extra', type: 'text', prompt: 'Unselected' }],
  homework: { body: 'Homework stays in the source deck' },
});
const source = (deckId: string, slideId: string, family: 'clean' | 'board' = 'clean'): ActivitySource => ({ deckId, slideId, spaceId: 'space', stepId: 'question', deckVersion: 1, outline: outline(family) });

describe('PowerPoint activity composition', () => {
  it('embeds every slide kind and independently selected details, including a deck with no questions', () => {
    const steps: OutlineStep[] = [
      { id: 'title', kind: 'title', title: 'Welcome' },
      { id: 'statement', kind: 'statement', body: 'Make room for each voice.' },
      { id: 'cards', kind: 'cards', title: 'Ideas', items: [{ text: 'Listen' }, { text: 'Explain' }] },
      { id: 'steps', kind: 'steps', title: 'Process', items: ['Listen', 'Respond'] },
      { id: 'term', kind: 'term', term: 'Empathy', meaning: 'Understand another perspective' },
      { id: 'activity', kind: 'activity', title: 'Practice', instructions: ['Work in pairs'] },
      { id: 'timer', kind: 'timer', seconds: 30 },
      { id: 'media', kind: 'media', media: { type: 'image', url: 'https://example.com/image.png', alt: 'A scene' } },
      { id: 'debrief', kind: 'debrief', title: 'Reflect', prompts: ['What changed?'] },
      { id: 'break', kind: 'break', title: 'Pause' },
      { id: 'join', kind: 'join' },
      { id: 'blank', kind: 'blank', elements: [{ id: 'text', type: 'text', text: 'A freeform slide', box: { x: 10, y: 10, w: 80, h: 60 } }] },
      { id: 'detail', kind: 'statement', body: 'More detail', breakoutOf: { stepId: 'title', afterKey: 'header' } },
    ];
    const content: Outline = { version: 1, meta: { title: 'Every slide' }, steps, interactions: [] };
    const result = composePresentation(steps.map((step, index) => ({ ...source('deck', String(index)), stepId: step.id, outline: content })));
    for (const [index, reference] of result.activities.entries()) {
      const embedded = result.outline.steps.find((step) => step.id === reference.sessionStepId)!;
      expect(embedded.kind).toBe(steps[index]!.kind);
      expect(embedded.breakoutOf).toBeUndefined();
      const { id: _id, design: _design, breakoutOf: _breakout, ...authored } = steps[index]!;
      expect(embedded).toMatchObject(authored);
    }
    expect(result.outline.interactions).toEqual([]);
    expect(validateOutline(result.outline).ok).toBe(true);
  });
  it('allows content from a draft deck but rejects an unfinished question selected for participation', () => {
    const draft = source('deck', '42');
    draft.outline.interactions[0]!.prompt = '';
    expect(() => composePresentation([draft])).toThrow('invalid-presentation-content');
    draft.stepId = 'detail';
    expect(composePresentation([draft]).outline.interactions).toEqual([]);
  });
  it('isolates repeated IDs and copied questions, keeps attached details and preserves each source design and answer policy', () => {
    const inputs = [source('one', '42'), source('two', '88', 'board'), source('one', '99')];
    const before = structuredClone(inputs);
    const result = composePresentation(inputs);
    expect(result.activities.map((activity) => activity.slideId)).toEqual(['42', '88', '99']);
    expect(result.outline.steps).toHaveLength(6);
    expect(new Set(result.outline.interactions.map((question) => question.id)).size).toBe(3);
    expect(result.outline.steps[3]!.breakoutOf?.stepId).toBe(result.activities[1]!.sessionStepId);
    expect(result.outline.interactions[1]).toMatchObject({ resultVisibility: 'hidden-until-close', allowAnswerChange: false });
    expect(result.outline.interactions[0]).toMatchObject({ resultVisibility: 'live', allowAnswerChange: true });
    for (let index = 0; index < inputs.length; index++) {
      expect(resolveSlideDesign(result.outline.design, result.outline.steps[index * 2]!.design)).toEqual(resolveSlideDesign(inputs[index]!.outline.design, inputs[index]!.outline.steps[0]!.design));
    }
    expect(result.outline.design!.masters).toHaveLength(2);
    expect(result.outline.homework).toBeUndefined();
    expect(validateOutline(result.outline).ok).toBe(true);
    expect(inputs).toEqual(before);
  });
  it('rejects ambiguous slide identities, missing questions and mixed sharing or identity boundaries', () => {
    expect(() => composePresentation([source('one', '42'), source('two', '42')])).toThrow('invalid-presentation-activities');
    expect(() => composePresentation([{ ...source('one', '42'), stepId: 'missing' }])).toThrow('activity-not-found');
    expect(() => composePresentation([source('one', '42'), { ...source('two', '88'), spaceId: 'other' }])).toThrow('presentation-space-mismatch');
    const identified = source('two', '88'); identified.outline.defaults = { identityMode: 'identified' };
    expect(() => composePresentation([source('one', '42'), identified])).toThrow('presentation-identity-mismatch');
  });
});
