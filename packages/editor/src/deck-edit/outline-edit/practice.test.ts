import { describe, expect, it } from 'vitest';
import { projectHomeworkInteraction, snapshotHomework, type HomeworkPracticeInteraction, type Outline } from '@openroom/schema';
import { editorRoundtrip } from '../outline-fuzz';
import { addPracticeHomework, insertPracticeExercise } from './practice';

const exercises: HomeworkPracticeInteraction[] = [
  { id: 'q', type: 'choice', multiple: true, prompt: 'Choisissez les phrases correctes.', notes: 'Private tutor note', options: [{ id: 'a', label: 'Incorrect', misconception: 'Private observation' }, { id: 'b', label: 'Correct B', correct: true }, { id: 'c', label: 'Correct C', correct: true }] },
  { id: 'q', type: 'text', prompt: 'La saison après le printemps ?', correctAnswers: ['été'], match: { locale: 'fr', accents: 'require' }, maxLength: 80 },
  { id: 'q', type: 'fill-the-gaps', prompt: 'Ich {{verb}} müde.', gaps: [{ id: 'verb', answers: ['bin'], distractors: ['ist'] }], match: { locale: 'de' } },
  { id: 'q', type: 'match', prompt: 'Reliez les mots.', left: [{ id: 'train', label: 'le train' }, { id: 'gare', label: 'la gare' }], right: [{ id: 'zug', label: 'der Zug' }, { id: 'bahnhof', label: 'der Bahnhof' }], correct: { train: 'zug', gare: 'bahnhof' } },
  { id: 'q', type: 'ranking', prompt: 'Dans quel ordre ?', options: [{ id: 'arrive', label: 'Arriver' }, { id: 'leave', label: 'Partir' }], correctOrder: ['leave', 'arrive'] },
];

describe('selected practice reuse', () => {
  it.each(exercises)('retains $type content and keys in independent slides and homework through YAML saves', (interaction) => {
    const original: Outline = { version: 1, meta: { title: 'Next lesson' }, steps: [{ id: 'welcome', kind: 'title', title: 'Bonjour' }], interactions: [] };
    const exercise = { title: 'Revoir ensemble', interaction };
    const before = JSON.stringify(exercise);
    const inserted = insertPracticeExercise(original, 'welcome', exercise);
    expect(inserted.stepId).not.toBe('');
    expect(inserted.outline.steps).toHaveLength(2);
    expect(inserted.outline.steps[1]).toMatchObject({ body: exercise.title });
    const repeated = insertPracticeExercise(inserted.outline, inserted.stepId, exercise);
    const next = addPracticeHomework(addPracticeHomework(repeated.outline, exercise), exercise);
    const roundtrip = editorRoundtrip(next);
    expect(roundtrip.ok).toBe(true);
    expect(next.interactions).toHaveLength(4);
    expect(new Set(next.interactions.map((item) => item.id)).size).toBe(4);
    expect(new Set(next.homework!.tasks!.map((item) => item.id)).size).toBe(2);
    const expected = projectHomeworkInteraction(interaction)!;
    for (const copied of next.interactions) {
      expect(copied).toEqual({ ...expected, id: copied.id });
      expect(copied).not.toBe(interaction);
    }
    expect(snapshotHomework(next).map((task) => task.kind)).toEqual(['quiz', 'quiz']);
    expect(snapshotHomework(next).map((task) => task.title)).toEqual([exercise.title, exercise.title]);
    expect(JSON.stringify(exercise)).toBe(before);
    expect(original.steps).toHaveLength(1);
    expect(original.interactions).toHaveLength(0);
    if (next.interactions[0]!.type === 'choice') {
      next.interactions[0]!.options[0]!.label = 'Edited locally';
      expect(next.interactions[1]).toEqual({ ...expected, id: next.interactions[1]!.id });
      expect(JSON.stringify(exercise)).toBe(before);
    }
  });

  it('preserves an open answer without inventing a correctness key', () => {
    const outline: Outline = { version: 1, meta: { title: 'Opinions' }, steps: [{ id: 'title', kind: 'title', title: 'Opinions' }], interactions: [] };
    const next = addPracticeHomework(outline, { interaction: { id: 'opinion', type: 'text', prompt: 'Pourquoi préférez-vous le train ?' } });
    expect(snapshotHomework(next)[0]).toEqual({ id: 'practice', kind: 'quiz', interaction: { id: 'practice-question', type: 'text', prompt: 'Pourquoi préférez-vous le train ?' } });
  });
});
