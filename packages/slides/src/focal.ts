import type { CSSProperties } from 'react';

/** The nine named focal points, in reading order — the 3×3 picker's own order. */
export const FOCAL_POINTS = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
] as const;

export type FocalPoint = (typeof FOCAL_POINTS)[number];

const POSITIONS: Record<FocalPoint, string> = {
  'top-left': 'left top',
  top: 'center top',
  'top-right': 'right top',
  left: 'left center',
  center: 'center center',
  right: 'right center',
  'bottom-left': 'left bottom',
  bottom: 'center bottom',
  'bottom-right': 'right bottom',
};

/** Plain words for the picker; a focal point is never a colour or a coordinate. */
export const FOCAL_WORDS: Record<FocalPoint, string> = {
  'top-left': 'Top left',
  top: 'Top',
  'top-right': 'Top right',
  left: 'Left',
  center: 'Centre',
  right: 'Right',
  'bottom-left': 'Bottom left',
  bottom: 'Bottom',
  'bottom-right': 'Bottom right',
};

/**
 * The style a focal point becomes.
 *
 * Nothing at all when the author picked no point: the media region then keeps
 * its default fit and no `style` attribute is emitted. Choosing a point *is*
 * choosing to crop — that is what "which part of the frame to keep" means — so
 * the fit switches to `cover` in the same breath, in shared code, so the deck
 * editor canvas and the projector crop the same way rather than one of them
 * quietly letterboxing.
 */
export function focalStyle(focal: string | undefined): CSSProperties | undefined {
  if (focal === undefined) return undefined;
  const position = POSITIONS[focal as FocalPoint] as string | undefined;
  if (position === undefined) return undefined;
  return { objectFit: 'cover', objectPosition: position };
}
