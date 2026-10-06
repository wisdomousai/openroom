import { describe, expect, it } from 'vitest';
import { assessHomework, compileRecordHomework, initialHomeworkAnswer, parseHomeworkPracticeAnswer, type HomeworkPracticeInteraction } from '../src/index.js';

describe('homework practice', () => {
  it('validates complete typed answers before assessment and canonicalizes unordered choices', () => {
    const choice: HomeworkPracticeInteraction = { id: 'q', type: 'choice', multiple: true, prompt: 'Select', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] };
    expect(parseHomeworkPracticeAnswer(choice, { kind: 'choice', optionIds: ['b', 'a'] })).toEqual({ kind: 'choice', optionIds: ['a', 'b'] });
    for (const input of [null, [], {}, { kind: 'text', text: 'a' }, { kind: 'choice', optionIds: 'a' }, { kind: 'choice', optionIds: [] }, { kind: 'choice', optionIds: ['a', 'a'] }, { kind: 'choice', optionIds: ['other'] }]) expect(parseHomeworkPracticeAnswer(choice, input)).toBeNull();
    const text: HomeworkPracticeInteraction = { id: 'q', type: 'text', prompt: 'Write', maxLength: 5 };
    expect(parseHomeworkPracticeAnswer(text, { kind: 'text', text: 'été' })).toEqual({ kind: 'text', text: 'été' });
    for (const value of ['', '   ', 'longer']) expect(parseHomeworkPracticeAnswer(text, { kind: 'text', text: value })).toBeNull();
    const gaps: HomeworkPracticeInteraction = { id: 'q', type: 'fill-the-gaps', prompt: '{{a}}', gaps: [{ id: 'a', answers: ['bin'] }] };
    expect(parseHomeworkPracticeAnswer(gaps, { kind: 'fill-the-gaps', gaps: { a: 'bin' } })).not.toBeNull();
    for (const value of [{}, { a: 1 }, { a: 'bin', extra: 'hidden' }, { a: 'x'.repeat(201) }]) expect(parseHomeworkPracticeAnswer(gaps, { kind: 'fill-the-gaps', gaps: value })).toBeNull();
    const match: HomeworkPracticeInteraction = { id: 'q', type: 'match', prompt: 'Match', left: [{ id: 'a', label: 'A' }], right: [{ id: 'b', label: 'B' }], correct: { a: 'b' } };
    expect(parseHomeworkPracticeAnswer(match, { kind: 'match', pairs: { a: 'b' } })).not.toBeNull();
    for (const value of [{}, { a: 'other' }, { a: 'b', extra: 'b' }, ['b']]) expect(parseHomeworkPracticeAnswer(match, { kind: 'match', pairs: value })).toBeNull();
    const ranking: HomeworkPracticeInteraction = { id: 'q', type: 'ranking', prompt: 'Order', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] };
    expect(parseHomeworkPracticeAnswer(ranking, { kind: 'ranking', order: ['b', 'a'] })).toEqual({ kind: 'ranking', order: ['b', 'a'] });
    expect(parseHomeworkPracticeAnswer(ranking, { kind: 'ranking', order: ['b', 'b'] })).toBeNull();
  });
  it('checks the whole multiple-choice answer, including extra and missing choices', () => {
    const question: HomeworkPracticeInteraction = { id: 'q', type: 'choice', multiple: true, prompt: 'Select', options: [{ id: 'a', label: 'A', correct: true }, { id: 'b', label: 'B', correct: true }, { id: 'c', label: 'C' }] };
    expect(assessHomework(question, { kind: 'choice', optionIds: ['b', 'a'] }).result).toBe('correct');
    expect(assessHomework(question, { kind: 'choice', optionIds: ['a'] }).result).toBe('incorrect');
    expect(assessHomework(question, { kind: 'choice', optionIds: ['a', 'b', 'c'] }).result).toBe('incorrect');
    expect(assessHomework(question, { kind: 'choice', optionIds: ['unknown'] }).complete).toBe(false);
  });

  it('honors French accents, Unicode composition, and explicitly accepted German variants', () => {
    const french: HomeworkPracticeInteraction = { id: 'fr', type: 'text', prompt: 'French', correctAnswers: ['été'], match: { locale: 'fr', accents: 'require' } };
    expect(assessHomework(french, { kind: 'text', text: 'E\u0301TE\u0301' }).result).toBe('correct');
    expect(assessHomework(french, { kind: 'text', text: 'ete' }).result).toBe('incorrect');
    expect(assessHomework({ ...french, match: { accents: 'ignore' } }, { kind: 'text', text: 'ete' }).result).toBe('correct');
    const german: HomeworkPracticeInteraction = { id: 'de', type: 'text', prompt: 'German', correctAnswers: ['Straße', 'Strasse'], match: { locale: 'de' } };
    for (const text of ['Straße', 'STRASSE']) expect(assessHomework(german, { kind: 'text', text }).result).toBe('correct');
  });

  it('scores complete gaps, matching pairs and ranking permutations', () => {
    const gaps: HomeworkPracticeInteraction = { id: 'q', type: 'fill-the-gaps', prompt: 'Ich {{a}} {{b}}.', gaps: [{ id: 'a', answers: ['bin'] }, { id: 'b', answers: ['müde'] }] };
    expect(assessHomework(gaps, { kind: 'fill-the-gaps', gaps: { a: 'bin' } }).complete).toBe(false);
    expect(assessHomework(gaps, { kind: 'fill-the-gaps', gaps: { a: 'bin', b: 'müde' } }).result).toBe('correct');
    const match: HomeworkPracticeInteraction = { id: 'q', type: 'match', prompt: 'Match', left: [{ id: 'l', label: 'le train' }], right: [{ id: 'r', label: 'der Zug' }], correct: { l: 'r' } };
    expect(assessHomework(match, { kind: 'match', pairs: { l: 'r' } }).result).toBe('correct');
    const ranking: HomeworkPracticeInteraction = { id: 'q', type: 'ranking', prompt: 'Order', options: [{ id: 'a', label: 'Second' }, { id: 'b', label: 'First' }], correctOrder: ['b', 'a'] };
    expect(assessHomework(ranking, initialHomeworkAnswer(ranking)).result).toBe('incorrect');
    expect(assessHomework(ranking, { kind: 'ranking', order: ['b', 'a'] }).result).toBe('correct');
    expect(assessHomework(ranking, { kind: 'ranking', order: ['a', 'a'] }).complete).toBe(false);
  });

  it('uses self-reflection for open answers with no correctness key', () => {
    expect(assessHomework({ id: 'q', type: 'text', prompt: 'Your opinion?' }, { kind: 'text', text: 'Je préfère le train.' })).toEqual({ complete: true, result: 'self-check', answers: [] });
  });

  it('rejects malformed activities and duplicate task identities before publication', () => {
    expect(compileRecordHomework([{ id: 'q', kind: 'quiz', interaction: { id: 'q', type: 'choice', prompt: 'Oops' } }])).toBeNull();
    expect(compileRecordHomework([{ id: 'same', kind: 'writing', prompt: 'One' }, { id: 'same', kind: 'writing', prompt: 'Two' }])).toBeNull();
  });
});
