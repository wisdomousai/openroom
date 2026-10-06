import { describe, expect, it } from 'vitest';

import {
  applyTheme,
  getTheme,
  isThemeId,
  resolveTheme,
  themeCss,
  themeToCssVars,
  type ThemeTarget,
} from '../src/css.js';
import { THEMES } from '../src/themes.js';
import { THEME_IDS, TOKEN_KEYS, type Theme } from '../src/tokens.js';

/** Minimal stand-in for an HTMLElement; a real one satisfies `ThemeTarget`. */
function fakeElement(): ThemeTarget & {
  vars: Record<string, string>;
  attrs: Record<string, string>;
} {
  const vars: Record<string, string> = {};
  const attrs: Record<string, string> = {};
  return {
    vars,
    attrs,
    style: {
      setProperty(property: string, value: string) {
        vars[property] = value;
      },
    },
    setAttribute(name: string, value: string) {
      attrs[name] = value;
    },
  };
}

describe('resolveTheme', () => {
  it('passes through every known id', () => {
    for (const id of THEME_IDS) expect(resolveTheme(id)).toBe(id);
  });

  it('falls back to default for unknown, empty, undefined and null input', () => {
    expect(resolveTheme('nope')).toBe('default');
    expect(resolveTheme('')).toBe('default');
    expect(resolveTheme(undefined)).toBe('default');
    expect(resolveTheme(null)).toBe('default');
    expect(resolveTheme('DEFAULT')).toBe('default');
    expect(resolveTheme('__proto__')).toBe('default');
  });

  it('isThemeId is a real guard', () => {
    expect(isThemeId('sherbet')).toBe(true);
    expect(isThemeId('Sherbet')).toBe(false);
    expect(isThemeId(42)).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
  });

  it('getTheme returns the theme object, defaulting on junk', () => {
    expect(getTheme('paper').id).toBe('paper');
    expect(getTheme('junk').id).toBe('default');
  });
});

describe('themeToCssVars', () => {
  it('emits one `--token` per token key, in both modes, for every theme', () => {
    const expected = TOKEN_KEYS.map((key) => `--${key}`);
    for (const id of THEME_IDS) {
      for (const mode of ['light', 'dark'] as const) {
        const vars = themeToCssVars(id, mode);
        for (const name of expected) {
          expect(vars[name], `${id}/${mode} ${name}`).toBeTypeOf('string');
        }
        // token keys + the always-present --brand-accent
        expect(Object.keys(vars).sort()).toEqual([...expected, '--brand-accent'].sort());
      }
    }
  });

  it('picks the light or dark table according to the mode', () => {
    expect(themeToCssVars('chalkboard', 'light')['--background']).toBe(
      THEMES.chalkboard.light.background,
    );
    expect(themeToCssVars('chalkboard', 'dark')['--background']).toBe(
      THEMES.chalkboard.dark.background,
    );
  });

  it('accepts a Theme object as well as an id', () => {
    expect(themeToCssVars(THEMES.paper, 'light')).toEqual(themeToCssVars('paper', 'light'));
  });

  it('mirrors --brand-accent from the token accent when no branding is set', () => {
    const vars = themeToCssVars('default', 'light');
    expect(vars['--brand-accent']).toBe(THEMES.default.light.accent);
  });

  it('a branding accent overrides --accent and --ring and publishes --brand-accent', () => {
    const branded: Theme = {
      ...THEMES.default,
      branding: { accent: '#123456', logo: 'https://cdn.example.com/logo.svg' },
    };
    const vars = themeToCssVars(branded, 'light');
    expect(vars['--accent']).toBe('#123456');
    expect(vars['--ring']).toBe('#123456');
    expect(vars['--brand-accent']).toBe('#123456');
    expect(vars['--brand-logo']).toBe('url("https://cdn.example.com/logo.svg")');
  });

  it('drops a logo URL that could break out of the url() declaration', () => {
    const hostile: Theme = {
      ...THEMES.default,
      branding: { accent: null, logo: 'https://x.test/a.svg"); background: red; /*' },
    };
    expect(themeToCssVars(hostile, 'light')['--brand-logo']).toBeUndefined();

    const relative: Theme = {
      ...THEMES.default,
      branding: { accent: null, logo: '/assets/logo.png' },
    };
    expect(themeToCssVars(relative, 'light')['--brand-logo']).toBe('url("/assets/logo.png")');

    const bogusScheme: Theme = {
      ...THEMES.default,
      branding: { accent: null, logo: 'javascript:alert(1)' },
    };
    expect(themeToCssVars(bogusScheme, 'light')['--brand-logo']).toBeUndefined();
  });
});

describe('themeCss', () => {
  const css = themeCss('sherbet');

  it('emits a :root block, an explicit dark block and a prefers-color-scheme block', () => {
    expect(css).toContain(':root {');
    expect(css).toContain('[data-theme-mode="dark"] {');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root:not([data-theme-mode="light"])');
  });

  it('carries the light values in :root and the dark values in the dark block', () => {
    const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('[data-theme-mode="dark"] {'));
    expect(rootBlock).toContain(`--background: ${THEMES.sherbet.light.background};`);
    expect(css).toContain(`--background: ${THEMES.sherbet.dark.background};`);
  });

  it('is balanced and declares every token', () => {
    expect(css.split('{').length).toBe(css.split('}').length);
    for (const key of TOKEN_KEYS) expect(css).toContain(`--${key}:`);
  });

  it('falls back to the default theme for an unknown id', () => {
    expect(themeCss('nonsense')).toBe(themeCss('default'));
  });
});

describe('applyTheme', () => {
  it('sets every variable inline plus the two data attributes', () => {
    const el = fakeElement();
    const applied = applyTheme(el, 'projector', 'dark');
    expect(el.attrs['data-theme']).toBe('projector');
    expect(el.attrs['data-theme-mode']).toBe('dark');
    expect(el.vars['--background']).toBe(THEMES.projector.dark.background);
    expect(el.vars['--radius']).toBe('0rem');
    expect(el.vars).toEqual(applied);
  });

  it('resolves an unknown id to default rather than blanking the surface', () => {
    const el = fakeElement();
    applyTheme(el, 'not-a-theme', 'light');
    expect(el.attrs['data-theme']).toBe('default');
    expect(el.vars['--background']).toBe(THEMES.default.light.background);
  });

  it('a second call fully replaces the previous theme values', () => {
    const el = fakeElement();
    applyTheme(el, 'sherbet', 'light');
    applyTheme(el, 'paper', 'light');
    expect(el.attrs['data-theme']).toBe('paper');
    expect(el.vars['--primary']).toBe(THEMES.paper.light.primary);
  });
});
