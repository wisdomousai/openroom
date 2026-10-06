import { describe, expect, it } from 'vitest';
import { slideTheme, SLIDE_THEME_FAMILIES } from '@openroom/schema';
import { contrastRatio } from '@openroom/ui';

describe('built-in slide palettes', () => {
  it.each(SLIDE_THEME_FAMILIES)('%s keeps body text and chart marks legible on slide and card surfaces', (family) => {
    const colors = slideTheme(family).colors;
    for (const background of [colors.background, colors.surface]) {
      for (const foreground of [colors.foreground, colors.muted]) {
        expect(contrastRatio(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const chart of colors.charts) {
        expect(contrastRatio(chart, background), `${chart} on ${background}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
