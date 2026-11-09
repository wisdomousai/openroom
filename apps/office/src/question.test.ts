import { describe, expect, it } from 'vitest';
import { validateOutline, type Interaction, type Outline } from '@openroom/schema';
import { addQuestion, draftFromInteraction, draftProblem, emptyDraft, newOutline, QUESTION_KINDS, questionForStep, replaceQuestion, type QuestionDraft } from './question';
import { parseDeckReference, presentationTitle } from './presentation-deck';

const filled = (kind: QuestionDraft['kind']): QuestionDraft => ({ ...emptyDraft(kind), prompt: 'Which option?', options: [{ label: 'One', correct: true }, { label: 'Two', correct: false }, { label: '', correct: false }] });

describe('questions created in PowerPoint', () => {
  it('turns every kind into a valid outline step', () => {
    let outline: Outline = newOutline('Quarterly review');
    for (const { kind } of QUESTION_KINDS) outline = addQuestion(outline, filled(kind)).outline;
    const result = validateOutline(outline);
    expect(result.ok, JSON.stringify(result.ok ? null : result.errors)).toBe(true);
    expect(outline.steps).toHaveLength(QUESTION_KINDS.length);
    expect(outline.interactions.map((item) => item.type)).toEqual(['choice', 'text', 'text', 'scale', 'numeric', 'ranking', 'qna']);
    expect(outline.interactions[1]).toMatchObject({ display: 'word-cloud' });
  });

  it('drops empty answers and keeps correct marks only on choice', () => {
    const { outline, stepId } = addQuestion(newOutline('Deck'), filled('choice'));
    const question = questionForStep(outline, stepId) as Extract<Interaction, { type: 'choice' }>;
    expect(question.options.map((option) => option.label)).toEqual(['One', 'Two']);
    expect(question.options[0]).toMatchObject({ correct: true });
    expect(question.options[1]).not.toHaveProperty('correct');
    const rankingDeck = addQuestion(newOutline('Deck'), filled('ranking'));
    const ranking = questionForStep(rankingDeck.outline, rankingDeck.stepId) as Extract<Interaction, { type: 'ranking' }>;
    expect(ranking.options[0]).not.toHaveProperty('correct');
  });

  it('edits a question in place and keeps its IDs and editor settings', () => {
    const { outline, stepId } = addQuestion(newOutline('Deck'), filled('choice'));
    const original = questionForStep(outline, stepId)!;
    const tuned: Outline = { ...outline, interactions: outline.interactions.map((item) => item.id === original.id ? { ...item, display: 'donut', timerSec: 30 } as Interaction : item) };
    const draft = draftFromInteraction(questionForStep(tuned, stepId)!)!;
    const edited = replaceQuestion(tuned, stepId, { ...draft, prompt: 'Which one now?', options: [...draft.options, { label: 'Three', correct: false }] });
    const question = questionForStep(edited, stepId) as Extract<Interaction, { type: 'choice' }>;
    expect(question.id).toBe(original.id);
    expect(question).toMatchObject({ prompt: 'Which one now?', display: 'donut', timerSec: 30 });
    expect(question.options.slice(0, 2).map((option) => option.id)).toEqual((original as typeof question).options.map((option) => option.id));
    expect(validateOutline(edited).ok).toBe(true);
  });

  it('changes the kind of an existing question', () => {
    const { outline, stepId } = addQuestion(newOutline('Deck'), filled('choice'));
    const edited = replaceQuestion(outline, stepId, { ...emptyDraft('word-cloud'), prompt: 'One word for today' });
    expect(questionForStep(edited, stepId)).toMatchObject({ type: 'text', display: 'word-cloud', prompt: 'One word for today' });
    expect(validateOutline(edited).ok).toBe(true);
  });

  it('reports what is missing before saving', () => {
    expect(draftProblem(emptyDraft('choice'))).toBe('Write the question.');
    expect(draftProblem({ ...emptyDraft('choice'), prompt: 'Q', options: [{ label: 'A', correct: false }] })).toBe('Add at least two options.');
    expect(draftProblem({ ...emptyDraft('ranking'), prompt: 'Q', options: [{ label: 'A', correct: false }, { label: 'A ', correct: false }] })).toBe('Give each option a different text.');
    expect(draftProblem({ ...emptyDraft('word-cloud'), prompt: 'Q' })).toBeNull();
  });

  it('accepts only scales the server accepts', () => {
    const scale = (min: number, max: number) => draftProblem({ ...emptyDraft('scale'), prompt: 'Q', min, max });
    expect(scale(1, 2)).not.toBeNull();
    expect(scale(3, 3)).not.toBeNull();
    expect(scale(1, 3)).toBeNull();
    expect(scale(0, 10)).toBeNull();
    expect(scale(0, 11)).not.toBeNull();
    expect(scale(1, 2.5)).not.toBeNull();
    for (const [min, max] of [[1, 2], [1, 3], [0, 10], [0, 11]] as const) {
      const outline = addQuestion(newOutline('Deck'), { ...emptyDraft('scale'), prompt: 'Q', min, max }).outline;
      expect(scale(min, max) === null, `${min}-${max}`).toBe(validateOutline(outline).ok);
    }
  });

  it('leaves questions this form cannot write back to the deck editor', () => {
    expect(draftFromInteraction({ id: 'x', type: 'numeric', prompt: 'Guess', correct: 4 })).toBeNull();
    expect(draftFromInteraction({ id: 'x', type: 'text', prompt: 'Say', correctAnswers: ['hi'] })).toBeNull();
    expect(draftFromInteraction({ id: 'x', type: 'match', prompt: 'Match', left: [], right: [], correct: {} } as unknown as Interaction)).toBeNull();
  });
});

describe('presentation deck reference', () => {
  const presentationId = '7c2f1d1e-4b7a-4d3a-9a51-0b2e6f1c9d10';
  it('accepts only a public reference for this presentation', () => {
    const raw = JSON.stringify({ version: 1, presentationId, spaceId: 'space_1', deckId: 'deck_1' });
    expect(parseDeckReference(raw, presentationId)).toEqual({ version: 1, presentationId, spaceId: 'space_1', deckId: 'deck_1' });
    expect(parseDeckReference(raw, 'b0c1d2e3-0000-4000-8000-000000000000')).toBeNull();
    expect(parseDeckReference(JSON.stringify({ version: 1, presentationId, spaceId: 'space_1', deckId: 'deck_1', token: 'x' }), presentationId)).toBeNull();
  });
  it('names the deck after the file', () => {
    const office = (url: string) => ({ context: { document: { url } } }) as unknown as typeof Office;
    expect(presentationTitle(office('/Users/me/Documents/Q4%20Training.pptx'))).toBe('Q4 Training');
    expect(presentationTitle(office('/Users/me/50% off.pptx'))).toBe('50% off');
    expect(presentationTitle(office('https://contoso.sharepoint.com/sites/a/Shared%20Documents/50%25%20off.pptx?web=1'))).toBe('50% off');
    expect(presentationTitle(office('C:\\Users\\me\\C# basics.pptx'))).toBe('C# basics');
    expect(presentationTitle(office(''))).toBe('PowerPoint questions');
    expect(presentationTitle(null)).toBe('PowerPoint questions');
  });
});
