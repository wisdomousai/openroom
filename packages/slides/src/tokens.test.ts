/**
 * Word numbering is the contract three surfaces share: the projector, the
 * console mirror and the phone all index a part's words this way, and the deck editor
 * hit-tests a caret against the same arithmetic. A drift here puts ink on the
 * wrong word.
 */
import { describe, expect, it } from 'vitest';

import { tokenIndexAt, wordAt } from './tokens';

const TEXT = 'Je rate le train';

describe('tokenIndexAt', () => {
  it('numbers words positionally, matching index >> 1 over the whitespace split', () => {
    expect(tokenIndexAt(TEXT, 0)).toBe(0);
    expect(tokenIndexAt(TEXT, 4)).toBe(1); // inside 'rate'
    expect(tokenIndexAt(TEXT, 11)).toBe(3); // inside 'train'
  });

  it('names the word a caret sits at either edge of', () => {
    expect(tokenIndexAt(TEXT, 2)).toBe(0); // right edge of 'Je'
    expect(tokenIndexAt(TEXT, 3)).toBe(1); // left edge of 'rate'
    expect(tokenIndexAt(TEXT, TEXT.length)).toBe(3);
  });

  it('is a miss on whitespace between words and past the end', () => {
    expect(tokenIndexAt('a  b', 2)).toBeNull(); // strictly inside the gap
    expect(tokenIndexAt(TEXT, -1)).toBeNull();
    expect(tokenIndexAt(TEXT, TEXT.length + 1)).toBeNull();
    expect(tokenIndexAt('', 0)).toBeNull();
  });

  it('survives leading whitespace, which shifts every later index', () => {
    // '' + ' ' + 'a' → 'a' is chunk 2, token 1. The projector agrees, because
    // it splits the same string the same way.
    expect(tokenIndexAt(' a', 1)).toBe(1);
  });
});

describe('wordAt', () => {
  it('returns the word itself, whitespace-bounded', () => {
    expect(wordAt(TEXT, 5)).toBe('rate');
    expect(wordAt(TEXT, 2)).toBe('Je');
    expect(wordAt('a  b', 2)).toBeNull();
  });
});
