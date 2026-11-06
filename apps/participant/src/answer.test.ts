import { describe, expect, it } from 'vitest';
import type { InteractionView } from '@openroom/sdk';
import { describeAnswer, insertAt, orderedBy, startingOrder } from './answer';

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

describe('startingOrder', () => {
  it('never starts a ranking in the authored order, which is often the key', () => {
    for (const ids of [['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e', 'f']]) {
      for (const seed of ['p1:r', 'p2:r', 'p3:r', ':r', 'x', '']) {
        const order = startingOrder(ids, seed);
        expect(order).not.toEqual(ids);
        expect([...order].sort()).toEqual(ids);
      }
    }
  });

  it('gives one learner the same start on every render', () => {
    expect(startingOrder(['a', 'b', 'c', 'd'], 'p1:r')).toEqual(startingOrder(['a', 'b', 'c', 'd'], 'p1:r'));
  });
});

describe('insertAt', () => {
  it('puts an accent at the caret, not at the end', () => {
    expect(insertAt('Je suis all', 2, 2, 'é', 200)).toEqual({ value: 'Jeé suis all', caret: 3 });
  });

  it('replaces a selection', () => {
    expect(insertAt('cafe', 3, 4, 'é', 200)).toEqual({ value: 'café', caret: 4 });
  });

  it('refuses a key that would pass the limit instead of cutting the end', () => {
    expect(insertAt('abc', 1, 1, 'é', 3)).toEqual({ value: 'abc', caret: 1 });
  });
});
