import { describe, expect, it } from 'vitest';

import { participantView, type Session } from '../src/index.js';

/**
 * API-06 / pre-reveal safety: participantView must never leak notes, correct,
 * misconception, tolerance, or pedagogy (objective/explanation/followUp/durationSec)
 * for ANY interaction type. Pedagogy is a fixed known-deviation fix: the package
 * previously passed pedagogy.explanation/followUp straight through, which leaks
 * "explanations after reveal" content to participants before reveal.
 */

const FORBIDDEN_SENTINELS = [
  'SECRET_NOTE',
  'SECRET_MISCONCEPTION',
  'SECRET_OBJECTIVE',
  'SECRET_EXPLANATION',
  'SECRET_FOLLOWUP',
];

const session: Session = {
  version: 1,
  meta: { title: 't' },
  interactions: [
    {
      id: 'choice-q',
      type: 'choice',
      prompt: 'Pick',
      notes: 'SECRET_NOTE',
      pedagogy: {
        objective: 'SECRET_OBJECTIVE',
        explanation: 'SECRET_EXPLANATION',
        followUp: 'SECRET_FOLLOWUP',
        durationSec: 42,
      },
      options: [
        { id: 'a', label: 'A', correct: true },
        { id: 'b', label: 'B', misconception: 'SECRET_MISCONCEPTION' },
      ],
    },
    {
      id: 'scale-q',
      type: 'scale',
      prompt: 'Rate',
      min: 1,
      max: 5,
      notes: 'SECRET_NOTE',
      pedagogy: {
        objective: 'SECRET_OBJECTIVE',
        explanation: 'SECRET_EXPLANATION',
        followUp: 'SECRET_FOLLOWUP',
      },
    },
    {
      id: 'numeric-q',
      type: 'numeric',
      prompt: 'Guess',
      correct: 10,
      tolerance: 2,
      notes: 'SECRET_NOTE',
      pedagogy: {
        objective: 'SECRET_OBJECTIVE',
        explanation: 'SECRET_EXPLANATION',
        followUp: 'SECRET_FOLLOWUP',
      },
    },
    {
      id: 'text-q',
      type: 'text',
      prompt: 'Reflect',
      correctAnswers: ['SECRET_TEXT_ANSWER'],
      notes: 'SECRET_NOTE',
      pedagogy: {
        objective: 'SECRET_OBJECTIVE',
        explanation: 'SECRET_EXPLANATION',
        followUp: 'SECRET_FOLLOWUP',
      },
    },
    {
      id: 'qna-q',
      type: 'qna',
      prompt: 'Ask',
      notes: 'SECRET_NOTE',
      pedagogy: {
        objective: 'SECRET_OBJECTIVE',
        explanation: 'SECRET_EXPLANATION',
        followUp: 'SECRET_FOLLOWUP',
      },
    },
    {
      id: 'rank-q',
      type: 'ranking',
      prompt: 'Order',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      correctOrder: ['b', 'a'],
      notes: 'SECRET_NOTE',
      pedagogy: {
        objective: 'SECRET_OBJECTIVE',
        explanation: 'SECRET_EXPLANATION',
        followUp: 'SECRET_FOLLOWUP',
      },
    },
    {
      id: 'gap-q',
      type: 'fill-the-gaps',
      prompt: "J'{{g1}} raté le train.",
      notes: 'SECRET_NOTE',
      pedagogy: {
        objective: 'SECRET_OBJECTIVE',
        explanation: 'SECRET_EXPLANATION',
        followUp: 'SECRET_FOLLOWUP',
      },
      gaps: [{ id: 'g1', answers: ['ai'], distractors: ['suis'] }],
      bank: ['le'],
    },
  ],
};

describe('participantView — pedagogy and pre-reveal safety, every interaction type', () => {
  it.each(session.interactions.map((i) => i.id))('%s: no forbidden sentinel leaks', (id) => {
    const view = participantView(session, id);
    expect(view).not.toBeNull();
    const serialized = JSON.stringify(view);
    for (const sentinel of FORBIDDEN_SENTINELS) {
      expect(serialized).not.toContain(sentinel);
    }
    expect(serialized).not.toContain('"pedagogy"');
    expect(serialized).not.toContain('"notes"');
  });

  it('choice: correct/misconception stripped even though options remain', () => {
    const view = participantView(session, 'choice-q');
    expect(view).not.toBeNull();
    if (view === null || !('options' in view)) throw new Error('expected options');
    expect(view.options).toEqual([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);
  });

  it('numeric: correct and tolerance both stripped', () => {
    const view = participantView(session, 'numeric-q');
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('"correct"');
    expect(serialized).not.toContain('"tolerance"');
  });

  it('text: correctAnswers stripped', () => {
    const view = participantView(session, 'text-q');
    expect(JSON.stringify(view)).not.toContain('"correctAnswers"');
    expect(JSON.stringify(view)).not.toContain('SECRET_TEXT_ANSWER');
  });

  it('ranking: correctOrder stripped', () => {
    const view = participantView(session, 'rank-q');
    expect(JSON.stringify(view)).not.toContain('"correctOrder"');
  });

  it('fill-the-gaps: answers and authored bank stripped; options sorted', () => {
    const view = participantView(session, 'gap-q');
    expect(view).not.toBeNull();
    if (view === null || view.type !== 'fill-the-gaps') throw new Error('expected fill-the-gaps');
    expect(JSON.stringify(view)).not.toContain('"answers"');
    expect(JSON.stringify(view)).not.toContain('"bank"');
    expect(view.gaps[0]?.options).toEqual(['ai', 'suis']);
    expect(view.bankWords).toEqual(['ai', 'le']);
  });

  it('pedagogy key is absent (not merely empty) on every type', () => {
    for (const interaction of session.interactions) {
      const view = participantView(session, interaction.id) as Record<string, unknown> | null;
      expect(view).not.toBeNull();
      expect(view).not.toHaveProperty('pedagogy');
    }
  });
});
