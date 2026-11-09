import type { SlideElementBox } from './slide-types';

/**
 * Smallest width or height, in percent, a boxed element is drawn with.
 * Mirrors `ELEMENT_BOX_MIN` in @openroom/schema; element-box.test.ts holds the
 * two together.
 */
export const SLIDE_ELEMENT_BOX_MIN = 8;

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * The box a freeform element is drawn in: inside the slide on every surface
 * (editor canvas, stage, phone, thumbnails), because they all draw elements
 * through this one function.
 *
 * x and y stay within 0..100 (and leave room for the minimum size); w and h are
 * shrunk so x + w and y + h are at most 100, never below the minimum. A box
 * that already fits comes back unchanged. Nothing is moved to avoid the title,
 * the logo or the footer: that overlap stays the validator's warning.
 */
export function clampElementBox(box: SlideElementBox): SlideElementBox {
  const x = Math.min(100 - SLIDE_ELEMENT_BOX_MIN, Math.max(0, finite(box.x, 0)));
  const y = Math.min(100 - SLIDE_ELEMENT_BOX_MIN, Math.max(0, finite(box.y, 0)));
  const w = Math.min(100 - x, Math.max(SLIDE_ELEMENT_BOX_MIN, finite(box.w, SLIDE_ELEMENT_BOX_MIN)));
  const h = Math.min(100 - y, Math.max(SLIDE_ELEMENT_BOX_MIN, finite(box.h, SLIDE_ELEMENT_BOX_MIN)));
  return { x, y, w, h };
}
