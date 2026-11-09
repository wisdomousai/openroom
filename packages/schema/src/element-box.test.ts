import { describe, expect, it } from 'vitest';

import { clampElementBox, ELEMENT_BOX_MIN } from './outline-types.js';

describe('clampElementBox draws every boxed element inside the slide', () => {
  it('leaves a box that fits unchanged', () => {
    expect(clampElementBox({ x: 10, y: 20, w: 50, h: 40 })).toEqual({ x: 10, y: 20, w: 50, h: 40 });
    expect(clampElementBox({ x: 40, y: 80, w: 60, h: 20 })).toEqual({ x: 40, y: 80, w: 60, h: 20 });
  });

  it('shrinks a box that runs past the right or bottom edge without moving it', () => {
    expect(clampElementBox({ x: 60, y: 10, w: 60, h: 20 })).toEqual({ x: 60, y: 10, w: 40, h: 20 });
    expect(clampElementBox({ x: 10, y: 92, w: 30, h: 20 })).toEqual({ x: 10, y: 92, w: 30, h: 8 });
  });

  it('brings a negative or far-off origin back inside and keeps the minimum size', () => {
    expect(clampElementBox({ x: -15, y: -3, w: 30, h: 30 })).toEqual({ x: 0, y: 0, w: 30, h: 30 });
    expect(clampElementBox({ x: 140, y: 100, w: 50, h: 50 })).toEqual({ x: 92, y: 92, w: 8, h: 8 });
    expect(clampElementBox({ x: 10, y: 10, w: 0, h: -4 })).toEqual({ x: 10, y: 10, w: 8, h: 8 });
  });

  it('never returns a box past the slide, whatever the input', () => {
    for (const x of [-50, 0, 33, 99, 100, 250]) {
      for (const w of [-10, 0, 5, 60, 100, 400]) {
        const box = clampElementBox({ x, y: x, w, h: w });
        expect([box.x >= 0, box.x + box.w <= 100, box.w >= ELEMENT_BOX_MIN]).toEqual([true, true, true]);
        expect([box.y >= 0, box.y + box.h <= 100, box.h >= ELEMENT_BOX_MIN]).toEqual([true, true, true]);
      }
    }
  });
});
