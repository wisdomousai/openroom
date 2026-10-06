/**
 * The presenter's position, which is the only state Present has. These pin the
 * three things a tutor would notice on a projector: a step never lands blank,
 * next plays reveals before slides, and back reverses them in the same order.
 */
import { describe, expect, it } from 'vitest';

import { advance, atEnd, atStart, openCursor, retreat } from './cursor';

// step 0 lands whole, step 1 has three reveal groups, step 2 has nothing to
// reveal (a bare countdown), step 3 lands whole.
const COUNTS = [1, 3, 0, 1];

describe('present cursor', () => {
  it('opens on a step with its first group already showing', () => {
    expect(openCursor(COUNTS, 0)).toEqual({ step: 0, shown: 1 });
    expect(openCursor(COUNTS, 1)).toEqual({ step: 1, shown: 1 });
  });

  it('opens at the step it is given, so "start from here" is honoured', () => {
    expect(openCursor(COUNTS, 3)).toEqual({ step: 3, shown: 1 });
  });

  it('clamps an out-of-range opening rather than showing nothing', () => {
    expect(openCursor(COUNTS, 99)).toEqual({ step: 3, shown: 1 });
    expect(openCursor(COUNTS, -2)).toEqual({ step: 0, shown: 1 });
    expect(openCursor([], 4)).toEqual({ step: 0, shown: 0 });
  });

  it('advances whole steps when there is one reveal group', () => {
    expect(advance(COUNTS, { step: 0, shown: 1 })).toEqual({ step: 1, shown: 1 });
  });

  it('plays every reveal group before moving on', () => {
    let cursor = openCursor(COUNTS, 1);
    cursor = advance(COUNTS, cursor);
    expect(cursor).toEqual({ step: 1, shown: 2 });
    cursor = advance(COUNTS, cursor);
    expect(cursor).toEqual({ step: 1, shown: 3 });
    cursor = advance(COUNTS, cursor);
    expect(cursor).toEqual({ step: 2, shown: 0 });
  });

  it('passes straight through a step with no revealable parts', () => {
    expect(advance(COUNTS, { step: 2, shown: 0 })).toEqual({ step: 3, shown: 1 });
  });

  it('stands still at the end instead of closing itself', () => {
    const last = { step: 3, shown: 1 };
    expect(advance(COUNTS, last)).toEqual(last);
    expect(atEnd(COUNTS, last)).toBe(true);
    expect(atEnd(COUNTS, { step: 1, shown: 3 })).toBe(false);
  });

  it('reverses reveals before returning to the previous step, shown in full', () => {
    expect(retreat(COUNTS, { step: 2, shown: 0 })).toEqual({ step: 1, shown: 3 });
    expect(retreat(COUNTS, { step: 1, shown: 3 })).toEqual({ step: 1, shown: 2 });
    expect(retreat(COUNTS, { step: 1, shown: 2 })).toEqual({ step: 1, shown: 1 });
    expect(retreat(COUNTS, { step: 1, shown: 1 })).toEqual({ step: 0, shown: 1 });
  });

  it('reverses reveals on the first step and stops at its first group', () => {
    expect(retreat([3, 1], { step: 0, shown: 2 })).toEqual({ step: 0, shown: 1 });
    expect(retreat([3, 1], { step: 0, shown: 1 })).toEqual({ step: 0, shown: 1 });
    expect(atStart([3, 1], { step: 0, shown: 1 })).toBe(true);
    expect(atStart([3, 1], { step: 0, shown: 2 })).toBe(false);
    expect(atStart(COUNTS, { step: 2, shown: 0 })).toBe(false);
    expect(atStart([], openCursor([], 0))).toBe(true);
  });
});
