/**
 * Accessibility gate for the built-in themes (PRD: branding is sellable, but
 * never at the cost of legibility). Every one of the 10 token tables — 5 themes
 * x light/dark — must clear WCAG AA 4.5:1 on the pairs that actually carry text.
 */
import { describe, expect, it } from 'vitest';

import { AA_CONTRAST, contrastRatio, meetsAA, parseHex, relativeLuminance } from '../src/contrast.js';
import { THEMES } from '../src/themes.js';
import { THEME_IDS, THEME_MODES, type ThemeTokens } from '../src/tokens.js';

/** [foreground token, background token] pairs held to AA. */
const AA_PAIRS: [keyof ThemeTokens, keyof ThemeTokens][] = [
  ['foreground', 'background'],
  ['primary-foreground', 'primary'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['destructive-foreground', 'destructive'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'muted'],
  ['live-foreground', 'live'],
  ['live-foreground', 'live-hover'],
  ['live-tint-foreground', 'live-tint'],
];

describe('contrast math', () => {
  it('parses short and long hex', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('#0A0B0C')).toEqual({ r: 10, g: 11, b: 12 });
    expect(() => parseHex('rgb(0,0,0)')).toThrow();
  });

  it('matches the WCAG reference values', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 4);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.478, 2);
    expect(meetsAA('#767676', '#ffffff')).toBe(true);
    expect(meetsAA('#999999', '#ffffff')).toBe(false);
  });
});

describe('WCAG AA across all 10 built-in theme variants', () => {
  for (const id of THEME_IDS) {
    for (const mode of THEME_MODES) {
      const tokens = THEMES[id][mode];
      it(`${id}/${mode} meets AA on every text pair`, () => {
        for (const [fgKey, bgKey] of AA_PAIRS) {
          const ratio = contrastRatio(tokens[fgKey], tokens[bgKey]);
          expect(
            ratio,
            `${id}/${mode}: ${fgKey} on ${bgKey} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(AA_CONTRAST);
        }
      });

      it(`${id}/${mode} chart colours are distinguishable from the background`, () => {
        // Charts are large shapes, so 3:1 (AA non-text) is the bar here.
        for (const key of ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] as const) {
          const ratio = contrastRatio(tokens[key], tokens.background);
          expect(ratio, `${id}/${mode}: ${key} on background`).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }

  it('every token is present and non-empty in both modes', () => {
    for (const id of THEME_IDS) {
      for (const mode of THEME_MODES) {
        for (const [key, value] of Object.entries(THEMES[id][mode])) {
          expect(typeof value, `${id}/${mode}/${key}`).toBe('string');
          expect(value.length, `${id}/${mode}/${key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('projector is the zero-radius, maximum-contrast theme', () => {
    const zero = new Set(['0', '0rem', '0px']);
    for (const mode of THEME_MODES) {
      const tokens = THEMES.projector[mode];
      expect(tokens.radius, `projector/${mode} radius`).toBe('0rem');
      for (const key of ['radius-sm', 'radius-md', 'radius-lg', 'radius-xl'] as const) {
        expect(zero.has(tokens[key]), `projector/${mode} ${key} is ${tokens[key]}`).toBe(true);
      }
    }
    expect(contrastRatio(THEMES.projector.light.foreground, THEMES.projector.light.background)).toBe(21);
    expect(contrastRatio(THEMES.projector.dark.foreground, THEMES.projector.dark.background)).toBe(21);
  });
});
