/**
 * Where a mark *is*, which is what erasing depends on.
 *
 * The sharp rule: a double-click erases a mark only when it lands on the mark's
 * own line. Circling a word and then double-clicking the word must reach the
 * word — not rub the circle out — so the inside of a ring is deliberately not
 * part of it. A highlight is a wash rather than a line, so there the fill counts.
 */
import { describe, expect, it } from 'vitest';

import { markHit } from './ink';
import { markTokens, spanBoxes, type TokenBox, type TokenBoxes } from '@openroom/slides';

/** A 1000×500 plate, and one word sitting in the middle of it. */
const FRAME = { width: 1000, height: 500 };
const WORD: TokenBox = { x: 0.4, y: 0.4, w: 0.2, h: 0.1 };
const BOXES: TokenBoxes = {
  'header 0': [WORD],
  'header 1': [{ x: 0.62, y: 0.4, w: 0.1, h: 0.1 }],
};

const at = (partKey: string, token: number, kind: 'circle' | 'highlight' | 'underline') => ({
  id: 'm1',
  kind,
  partKey,
  token,
});

describe('erasing a mark', () => {
  it('takes a circle by its ring, never by the word inside it', () => {
    const circle = at('header', 0, 'circle');
    // Dead centre of the word: the click belongs to the word.
    expect(markHit(circle, { x: 0.5, y: 0.45 }, FRAME, BOXES)).toBe(false);
    // The left edge of the ring, one radius out from the centre.
    expect(markHit(circle, { x: 0.4 - 0.032, y: 0.45 }, FRAME, BOXES)).toBe(true);
  });

  it('takes a highlight anywhere on the wash', () => {
    expect(markHit(at('header', 0, 'highlight'), { x: 0.5, y: 0.45 }, FRAME, BOXES)).toBe(true);
    expect(markHit(at('header', 0, 'highlight'), { x: 0.9, y: 0.45 }, FRAME, BOXES)).toBe(false);
  });

  it('erases any line of a wrapped phrase without treating the blank space between lines as ink', () => {
    const boxes = { ...BOXES, 'header 1': [{ x: 0.2, y: 0.7, w: 0.3, h: 0.1 }] };
    const phrase = { ...at('header', 0, 'highlight'), endToken: 1 };
    expect(markHit(phrase, { x: 0.3, y: 0.75 }, FRAME, boxes)).toBe(true);
    expect(markHit(phrase, { x: 0.4, y: 0.6 }, FRAME, boxes)).toBe(false);
  });

  it('takes an underline on its line, not on the word above it', () => {
    const underline = at('header', 0, 'underline');
    expect(markHit(underline, { x: 0.5, y: 0.515 }, FRAME, BOXES)).toBe(true);
    expect(markHit(underline, { x: 0.5, y: 0.43 }, FRAME, BOXES)).toBe(false);
  });

  it('takes a pen stroke near the line it drew', () => {
    const pen = {
      id: 'm2',
      kind: 'pen' as const,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
      ],
    };
    expect(markHit(pen, { x: 0.5, y: 0.105 }, FRAME, BOXES)).toBe(true);
    expect(markHit(pen, { x: 0.5, y: 0.4 }, FRAME, BOXES)).toBe(false);
  });
});

describe('a marked span', () => {
  it('covers every word from the first to the last', () => {
    expect(markTokens({ partKey: 'header', token: 1, endToken: 3 })).toEqual([
      { partKey: 'header', token: 1 },
      { partKey: 'header', token: 2 },
      { partKey: 'header', token: 3 },
    ]);
    expect(markTokens({ partKey: 'header', token: 4 })).toHaveLength(1);
  });

  it('is drawn round the union of its words', () => {
    const [box] = spanBoxes(BOXES, { partKey: 'header', token: 0, endToken: 1 });
    expect(box?.x).toBeCloseTo(0.4);
    expect(box?.y).toBeCloseTo(0.4);
    expect(box?.w).toBeCloseTo(0.32);
    expect(box?.h).toBeCloseTo(0.1);
  });

  it('still draws round the words it can find when one is gone', () => {
    expect(spanBoxes(BOXES, { partKey: 'header', token: 1, endToken: 9 })).toEqual(BOXES['header 1']);
    expect(spanBoxes(BOXES, { partKey: 'body', token: 0 })).toEqual([]);
  });
});
