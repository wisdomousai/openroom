import { describe, expect, it } from 'vitest';
import { spanBoxes } from './ink-geometry';

describe('wrapped phrase geometry', () => {
  it('follows each selected text line without filling its unselected leading and trailing words', () => {
    const boxes = {
      'body 0': [{ x: 0, y: 0.1, w: 0.2, h: 0.05 }],
      'body 1': [{ x: 0.25, y: 0.1, w: 0.15, h: 0.05 }],
      'body 2': [{ x: 0.42, y: 0.1, w: 0.2, h: 0.05 }],
      'body 3': [{ x: 0.05, y: 0.2, w: 0.2, h: 0.05 }],
      'body 4': [{ x: 0.27, y: 0.2, w: 0.15, h: 0.05 }],
    };
    const lines = spanBoxes(boxes, { partKey: 'body', token: 1, endToken: 3 });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ x: 0.25, y: 0.1 });
    expect(lines[0]!.w).toBeCloseTo(0.37);
    expect(lines[1]).toMatchObject({ x: 0.05, y: 0.2 });
    expect(lines[1]!.w).toBeCloseTo(0.2);
  });
  it('keeps fragments of a single wrapped word and joins mixed-height words on the same line', () => {
    const lines = spanBoxes({
      'body 0': [{ x: 0.6, y: 0.1, w: 0.2, h: 0.05 }, { x: 0.05, y: 0.2, w: 0.25, h: 0.05 }],
      'body 1': [{ x: 0.32, y: 0.195, w: 0.2, h: 0.06 }],
    }, { partKey: 'body', token: 0, endToken: 1 });
    expect(lines).toHaveLength(2);
    expect(lines[0]!.x).toBe(0.6);
    expect(lines[1]!.x).toBe(0.05);
    expect(lines[1]!.w).toBeCloseTo(0.47);
    expect(lines[1]!.h).toBeCloseTo(0.06);
  });
});
