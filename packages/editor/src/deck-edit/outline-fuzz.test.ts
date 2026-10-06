/**
 * Combination coverage for the deck editor's write path.
 *
 * The unit tests name the cases we already know. This file walks the whole
 * catalog so a new insert kind or a new part-key commit cannot lock the editor
 * without a seed we can replay.
 */
import { describe, expect, it } from 'vitest';

import * as edits from './outline-edit';
import {
  exhaustAskRewrites,
  exhaustInsertKinds,
  unclassifiedEditExports,
  walkEdits,
} from './outline-fuzz';

function report(failure: ReturnType<typeof walkEdits>): string {
  if (failure === null) return '';
  return [
    `${failure.op} (seed ${String(failure.seed)} walk ${String(failure.walk)} step ${String(failure.step)})`,
    ...failure.errors,
  ].join('\n');
}

describe('outline editor combination walk', () => {
  it('classifies every outline-edit export as a walked write or a read', () => {
    expect(unclassifiedEditExports(edits)).toEqual([]);
  });

  it('every insert kind still validates after the writes the canvas can make', () => {
    const failure = exhaustInsertKinds();
    expect(report(failure)).toBe('');
  });

  it('every Ask-dialog rewrite stays a readable outline', () => {
    expect(report(exhaustAskRewrites())).toBe('');
  });

  it('random sequences of structured edits stay a readable outline', () => {
    const seed = Number(process.env.OUTLINE_FUZZ_SEED ?? 20260816);
    const failure = walkEdits({ seed, walks: 64, steps: 20 });
    expect(report(failure)).toBe('');
    // 1280 seeded edits, each fully revalidated. Deterministic, so the budget is
    // only guarding against a hang — keep it well clear of what a loaded machine
    // costs when the whole workspace's suites run at once.
  }, 30_000);
});
