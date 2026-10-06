import { describe, expect, it } from 'vitest';
import type { InteractionView } from '@openroom/sdk';
import { describeAnswer, orderedBy } from './answer';

const ranking: InteractionView = {
  id: 'r',
  type: 'ranking',
  prompt: 'Order these',
  options: [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta' },
    { id: 'c', label: 'Gamma' },
  ],
};

describe('orderedBy', () => {
  it('replays a stored ballot in its submitted order', () => {
    expect(orderedBy(['c', 'a', 'b'], ranking.type === 'ranking' ? ranking.options : [])).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('never drops an option the ballot did not mention', () => {
    const options = ranking.type === 'ranking' ? ranking.options : [];
    expect(orderedBy(['c'], options)).toEqual(['c', 'a', 'b']);
  });

  it('ignores an option id that is no longer in the session', () => {
    const options = ranking.type === 'ranking' ? ranking.options : [];
    expect(orderedBy(['zz', 'b'], options)).toEqual(['b', 'a', 'c']);
  });
});

describe('describeAnswer', () => {
  it('reads a ranking back as labels, best first', () => {
    expect(describeAnswer(ranking, { kind: 'ranking', optionIds: ['b', 'c', 'a'] })).toBe(
      'Beta → Gamma → Alpha',
    );
  });

  it('falls back to ids when the interaction is not the ranking', () => {
    const other: InteractionView = { id: 'q', type: 'qna', prompt: 'Ask' };
    expect(describeAnswer(other, { kind: 'ranking', optionIds: ['b', 'a'] })).toBe('b → a');
  });

  it('names a don’t-know ballot in words', () => {
    expect(describeAnswer(ranking, { kind: 'dont-know' })).toBe("Don't know");
  });

  it('still describes a choice answer with its labels (round-1 recall path)', () => {
    const choice: InteractionView = {
      id: 'v',
      type: 'choice',
      prompt: 'Which?',
      peerInstruction: true,
      options: [
        { id: 'right', label: 'Right' },
        { id: 'wrong', label: 'Wrong' },
      ],
    };
    expect(describeAnswer(choice, { kind: 'choice', optionIds: ['wrong'] })).toBe('Wrong');
  });
});
