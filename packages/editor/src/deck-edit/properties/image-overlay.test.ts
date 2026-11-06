import { describe, expect, it } from 'vitest';
import { colorContrast, slideTheme, SLIDE_THEME_FAMILIES } from '@openroom/schema';

import { defaultImageOverlay } from './image-overlay';

/** The overlay painted over one picture pixel, as the slide shows it. */
function blend(overlay: { color: string; opacity: number }, under: string): string {
  const channel = (hex: string, at: number) => parseInt(hex.slice(1 + at * 2, 3 + at * 2), 16);
  return `#${[0, 1, 2]
    .map((at) => Math.round(overlay.opacity * channel(overlay.color, at) + (1 - overlay.opacity) * channel(under, at)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

describe('default background picture overlay', () => {
  it.each(SLIDE_THEME_FAMILIES)('keeps %s text at 4.5:1 over a black, white or grey picture', (family) => {
    const { colors } = slideTheme(family);
    const overlay = defaultImageOverlay(colors);
    for (const picture of ['#000000', '#FFFFFF', '#808080']) {
      expect(colorContrast(colors.foreground, blend(overlay, picture))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
