import { describe, expect, it } from 'vitest';

import {
  compileRecordHomework,
  homeworkItemId,
  parseHomeworkItemId,
  projectHomeworkInteraction,
  snapshotHomework,
  type Outline,
} from '../src/index.js';

const outline: Outline = {
  version: 1,
  meta: { title: 'Travel' },
  steps: [{ id: 'welcome', kind: 'title', title: 'Hello' }],
  interactions: [
    {
      id: 'past-tense',
      type: 'choice',
      prompt: 'Choose the correct sentence.',
      notes: 'HOST-ONLY-NOTE',
      pedagogy: { objective: 'HOST-ONLY-PEDAGOGY' },
      options: [
        { id: 'a', label: "J'ai raté le train.", correct: true, misconception: 'HOST-ONLY-MISCONCEPTION' },
        { id: 'b', label: 'Je rate le train hier.' },
      ],
    },
  ],
  homework: {
    tasks: [
      { id: 'read-1', kind: 'reading', title: 'Tonight', body: 'Read the six sentences.' },
      { id: 'write-1', kind: 'writing', prompt: 'Write six sentences.', guidance: 'Use rater once.' },
      { id: 'quiz-1', kind: 'quiz', interactionId: 'past-tense' },
    ],
  },
};

describe('homework snapshot', () => {
  it('keeps scoring keys and strips host-only fields', () => {
    const published = snapshotHomework(outline);
    expect(published).toHaveLength(3);
    const quiz = published.find((task) => task.kind === 'quiz');
    expect(quiz?.kind).toBe('quiz');
    if (quiz?.kind !== 'quiz') return;
    expect(JSON.stringify(quiz)).not.toContain('HOST-ONLY');
    expect(quiz.interaction.type).toBe('choice');
    if (quiz.interaction.type !== 'choice') return;
    expect(quiz.interaction.options[0]?.correct).toBe(true);
    expect(quiz.interaction.options[0]?.misconception).toBeUndefined();
    expect(quiz.interaction.notes).toBeUndefined();
    expect(quiz.interaction.pedagogy).toBeUndefined();
  });

  it('compiles a legacy string list into reading tasks', () => {
    const compiled = compileRecordHomework(['Write three travel sentences', '  ', 'Read page 4']);
    expect(compiled).toEqual([
      { id: 'item-1', kind: 'reading', body: 'Write three travel sentences' },
      { id: 'item-3', kind: 'reading', body: 'Read page 4' },
    ]);
  });

  it('rejects a homework array that is too large', () => {
    expect(compileRecordHomework(Array.from({ length: 51 }, () => 'x'))).toBeNull();
  });

  it('projects qna as not a homework quiz', () => {
    expect(projectHomeworkInteraction({ id: 'ask', type: 'qna', prompt: 'Ask' })).toBeNull();
  });

  it('round-trips a practice item id', () => {
    const id = homeworkItemId('sess-a', 'quiz-1');
    expect(parseHomeworkItemId(id)).toEqual({ sessionId: 'sess-a', taskId: 'quiz-1' });
    expect(parseHomeworkItemId('nope')).toBeNull();
  });
});
