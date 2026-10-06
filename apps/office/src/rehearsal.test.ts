import { describe, expect, it } from 'vitest';
import type { Interaction, Outline } from '@openroom/schema';
import { addRehearsalAnswers, rehearse, rehearsalCommand, rehearsalSnapshot } from './rehearsal';
import { displayMatches, displayIsCurrent } from './display-channel';

const questions: Interaction[] = [
  { id: 'choice', type: 'choice', prompt: 'Choose', notes: 'Private facilitator note', options: [{ id: 'a', label: 'A', correct: true }, { id: 'b', label: 'B' }] },
  { id: 'scale', type: 'scale', prompt: 'Confidence', min: 1, max: 5 },
  { id: 'numeric', type: 'numeric', prompt: 'Estimate', correct: 15 },
  { id: 'text', type: 'text', prompt: 'Reflect', maxLength: 5 },
  { id: 'qna', type: 'qna', prompt: 'Questions' },
  { id: 'ranking', type: 'ranking', prompt: 'Prioritize', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
  { id: 'gaps', type: 'fill-the-gaps', prompt: 'Je {{g}} ici.', gaps: [{ id: 'g', answers: ['travaille'] }] },
  { id: 'match', type: 'match', prompt: 'Match', left: [{ id: 'a', label: 'Bonjour' }, { id: 'b', label: 'Merci' }], right: [{ id: 'c', label: 'Hello' }, { id: 'd', label: 'Thank you' }], correct: { a: 'c', b: 'd' } },
];
const outline: Outline = { version: 1, meta: { title: 'Rehearsal' }, defaults: { resultVisibility: 'hidden-until-close' }, steps: questions.map((item) => ({ id: item.id, kind: 'interaction', interactionId: item.id, tutorNotes: 'Private slide note' })), interactions: questions };

describe('local rehearsal and audience projection', () => {
  it('previews content, freeform media and detail slides without a question or private notes', () => {
    const content: Outline = { version: 1, meta: { title: 'Content' }, interactions: [], steps: [
      { id: 'welcome', kind: 'title', title: 'Welcome', tutorNotes: 'Private note' },
      { id: 'detail', kind: 'blank', breakoutOf: { stepId: 'welcome', afterKey: 'header' }, elements: [{ id: 'reading', type: 'html', html: '<p>Read this</p>', box: { x: 10, y: 10, w: 80, h: 60 } }] },
      { id: 'timer', kind: 'timer', seconds: 30 },
    ] };
    for (const step of content.steps) {
      const state = rehearse(content, step.id, 1000);
      expect(state.activeInteractionId).toBeNull();
      expect(rehearsalSnapshot(state).outline?.currentStep?.id).toBe(step.id);
      expect(rehearsalSnapshot(state).outline?.currentStep).not.toHaveProperty('tutorNotes');
      expect(addRehearsalAnswers(state)).toBe(state);
    }
    expect(content.steps[1]!.breakoutOf).toBeDefined();
  });
  it.each(questions.map((item) => [item.type, item.id]))('previews %s answers without changing the authored deck', (_type, id) => {
    const before = structuredClone(outline);
    const initial = rehearse(outline, id!);
    const answered = addRehearsalAnswers(initial);
    expect(rehearsalSnapshot(answered).answeredCount).toBe(3);
    expect(rehearsalSnapshot(initial).answeredCount).toBe(0);
    const revealed = rehearsalCommand(answered, { command: 'interaction.reveal', interactionId: id! });
    expect(rehearsalSnapshot(revealed).interactionStatus).toBe('revealed');
    expect(outline).toEqual(before);
  });
  it('keeps answer keys, notes and unrevealed responses out of the display and supports shared group questions', () => {
    const grouped: Outline = { ...outline, interactions: [{ ...questions[0]!, responseMode: 'group' }] };
    const state = addRehearsalAnswers(rehearse(grouped, 'choice'));
    const audience = rehearsalSnapshot(state);
    expect(audience.answeredCount).toBe(3);
    expect(audience.aggregate).toBeNull();
    expect(audience.interaction).not.toHaveProperty('notes');
    expect(audience.outline?.currentStep).not.toHaveProperty('tutorNotes');
    expect(audience.interaction && 'options' in audience.interaction ? audience.interaction.options?.[0] : null).not.toHaveProperty('correct');
    expect(rehearsalSnapshot(rehearsalCommand(state, { command: 'interaction.reveal', interactionId: 'choice' })).aggregate).not.toBeNull();
  });
  it('accepts display state only for the same presentation, bound source activity and explicitly resumed session', () => {
    const presentationId = crypto.randomUUID(), sessionId = crypto.randomUUID();
    const binding = { version: 1 as const, presentationId, slideId: '42', deckId: 'deck', spaceId: 'space', stepId: 'choice' };
    const session = { version: 1 as const, presentationId, sessionId };
    const presentation = { id: presentationId, activities: [{ slideId: '42', spaceId: 'space', deckId: 'deck', stepId: 'choice', sessionStepId: 'activity-1-step-1', deckVersion: 1 }] };
    const publication = { type: 'openroom.display' as const, version: 1 as const, presentationId, sessionId, presentation, snapshot: rehearsalSnapshot(rehearse(outline, 'choice')), status: 'live' as const };
    expect(displayMatches(publication, binding, session)).toBe(true);
    for (const altered of [{ ...publication, presentation: { ...presentation, activities: [{ ...presentation.activities[0]!, deckId: 'other' }] } }, { ...publication, presentation: { ...publication.presentation, activities: [] } }, { ...publication, sessionId: crypto.randomUUID() }, { ...publication, presentationId: crypto.randomUUID() }, { ...publication, snapshot: { ...publication.snapshot, role: 'host' } }]) expect(displayMatches(altered, binding, session)).toBe(false);
    expect(displayMatches(publication, binding, null)).toBe(false);
    const current = { ...publication.snapshot.outline!.currentStep, id: 'activity-1-step-1' };
    const withStep = (step: typeof current) => ({ ...publication, snapshot: { ...publication.snapshot, outline: { ...publication.snapshot.outline!, currentStep: step } } });
    expect(displayIsCurrent(withStep(current), binding)).toBe(true);
    expect(displayIsCurrent(withStep({ ...current, id: 'detail', breakoutOf: { stepId: current.id, afterKey: 'header' } }), binding)).toBe(true);
    expect(displayIsCurrent(withStep({ ...current, id: 'another-copy', breakoutOf: { stepId: 'activity-2-step-1', afterKey: 'header' } }), binding)).toBe(false);
  });
  it('starts and reopens a timed rehearsal with a fresh deadline', () => {
    const timed: Outline = { ...outline, interactions: [{ ...questions[0]!, timerSec: 30 }] };
    const start = rehearse(timed, 'choice', 1000);
    expect(rehearsalSnapshot(start).closesAt).toBe(31000);
    const closed = rehearsalCommand(start, { command: 'interaction.close', interactionId: 'choice' }, 31000);
    const reopened = rehearsalCommand(closed, { command: 'interaction.open', interactionId: 'choice' }, 40000);
    expect(rehearsalSnapshot(reopened).closesAt).toBe(70000);
  });
});
