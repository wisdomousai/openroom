import { describe, expect, it } from 'vitest';

import { mergeNext, movePart, setSequence, setTogether, splitPart } from './reveal-order';

/**
 * The reveal editor is only safe if every operation is total: whatever the
 * author clicks, the result is still a full grouping of the step's parts. So
 * the cases below check the two things that can actually break a session —
 * where a part ends up, and that no part is lost, duplicated, or stranded in
 * an empty group.
 */

const cases: {
  name: string;
  before: string[][];
  after: string[][];
}[] = [
  {
    name: 'move up joins the previous group',
    before: [['header'], ['body', 'stat']],
    after: movePart([['header'], ['body', 'stat']], 'body', -1),
  },
  {
    name: 'move up off the start opens a new first group',
    before: [['header', 'body']],
    after: movePart([['header', 'body']], 'body', -1),
  },
  {
    name: 'move down off the end opens a new last group',
    before: [['header', 'body']],
    after: movePart([['header', 'body']], 'header', 1),
  },
  {
    name: 'move down joins the next group at its start',
    before: [['header', 'stat'], ['body']],
    after: movePart([['header', 'stat'], ['body']], 'stat', 1),
  },
  {
    name: 'split pulls a part into its own group just after',
    before: [['cell-0', 'cell-1', 'cell-2']],
    after: splitPart([['cell-0', 'cell-1', 'cell-2']], 'cell-1'),
  },
  {
    name: 'merge folds the next group in',
    before: [['header'], ['body'], ['image']],
    after: mergeNext([['header'], ['body'], ['image']], 0),
  },
  {
    name: 'together collapses everything into one group',
    before: [['header'], ['body'], ['image']],
    after: setTogether([['header'], ['body'], ['image']]),
  },
  {
    name: 'sequence gives every part its own group',
    before: [['header', 'body'], ['image']],
    after: setSequence([['header', 'body'], ['image']]),
  },
];

describe('reveal order editing', () => {
  it.each(cases)('$name preserves every key exactly once and leaves no empty group', (testCase) => {
    const keysBefore = testCase.before.flat().sort();
    const keysAfter = testCase.after.flat().sort();
    expect(keysAfter).toEqual(keysBefore);
    expect(testCase.after.some((group) => group.length === 0)).toBe(false);
  });

  it('places the moved part where the author expects', () => {
    expect(movePart([['header'], ['body', 'stat']], 'body', -1)).toEqual([['header', 'body'], ['stat']]);
    expect(movePart([['header', 'body']], 'body', -1)).toEqual([['body'], ['header']]);
    expect(movePart([['header', 'body']], 'header', 1)).toEqual([['body'], ['header']]);
    expect(movePart([['header', 'stat'], ['body']], 'stat', 1)).toEqual([['header'], ['stat', 'body']]);
  });

  it('refuses moves and splits that would change nothing', () => {
    expect(movePart([['header'], ['body']], 'header', -1)).toEqual([['header'], ['body']]);
    expect(movePart([['header'], ['body']], 'body', 1)).toEqual([['header'], ['body']]);
    expect(splitPart([['header'], ['body']], 'header')).toEqual([['header'], ['body']]);
    expect(mergeNext([['header'], ['body']], 1)).toEqual([['header'], ['body']]);
    expect(movePart([['header']], 'nope', -1)).toEqual([['header']]);
  });

  it('handles a step with no revealable parts', () => {
    expect(setTogether([])).toEqual([]);
    expect(setSequence([])).toEqual([]);
    expect(movePart([], 'header', 1)).toEqual([]);
  });

  it('splits and merges round-trip', () => {
    const start = [['cell-0', 'cell-1']];
    const split = splitPart(start, 'cell-1');
    expect(split).toEqual([['cell-0'], ['cell-1']]);
    expect(mergeNext(split, 0)).toEqual(start);
  });
});
