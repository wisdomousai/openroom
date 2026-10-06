import { THEMES } from './themes.js';
import {
  DEFAULT_THEME_ID,
  THEME_IDS,
  TOKEN_KEYS,
  type Theme,
  type ThemeId,
  type ThemeMode,
} from './tokens.js';

/** Type guard for the five built-in theme ids. */
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

/**
 * Coerce anything into a usable theme id. Unknown, missing or malformed input
 * falls back to `default` — a bad id must never blank out a live projector.
 */
export function resolveTheme(id: string | undefined | null): ThemeId {
  return isThemeId(id) ? id : DEFAULT_THEME_ID;
}

/** The `Theme` object for an id, falling back to `default`. */
export function getTheme(id: string | undefined | null): Theme {
  return THEMES[resolveTheme(id)];
}

/** Characters that could break out of a `url("…")` declaration. */
const FORBIDDEN_IN_URL = ['"', "'", '(', ')', '\\', ';', '{', '}', '<', '>', ' ', '\n', '\r', '\t'];

/**
 * A URL is safe to inline into `url("…")` only when it cannot break out of the
 * quoted string or the declaration. Anything else is dropped rather than
 * escaped — branding is a constrained override, not a CSS injection point.
 */
function safeLogoUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed === '') return null;
  if (FORBIDDEN_IN_URL.some((ch) => trimmed.includes(ch))) return null;
  if (!trimmed.startsWith('/') && !/^https?:/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * The CSS custom properties for one mode of one theme.
 *
 * Keys include the leading `--`, values are ready to assign. Branding is
 * layered on top of the raw token table:
 *   `--brand-accent` is always present (the branding accent, or the theme's own
 *   `--accent` when there is none), and a branding accent additionally
 *   overrides `--accent` and `--ring`.
 *   `--brand-logo` is emitted as a `url(…)` only when a safe logo URL is set.
 */
export function themeToCssVars(theme: Theme | ThemeId, mode: ThemeMode): Record<string, string> {
  const resolved: Theme = typeof theme === 'string' ? getTheme(theme) : theme;
  const tokens = mode === 'dark' ? resolved.dark : resolved.light;
  const vars: Record<string, string> = {};
  for (const key of TOKEN_KEYS) vars[`--${key}`] = tokens[key];

  const brandAccent = resolved.branding.accent;
  if (brandAccent !== null && brandAccent.trim() !== '') {
    vars['--accent'] = brandAccent;
    vars['--ring'] = brandAccent;
    vars['--brand-accent'] = brandAccent;
  } else {
    vars['--brand-accent'] = tokens.accent;
  }

  const logo = resolved.branding.logo === null ? null : safeLogoUrl(resolved.branding.logo);
  if (logo !== null) vars['--brand-logo'] = `url("${logo}")`;

  return vars;
}

function block(selector: string, vars: Record<string, string>, indent = '  '): string {
  const body = Object.entries(vars)
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join('\n');
  return `${selector} {\n${body}\n}`;
}

/**
 * A complete stylesheet for one theme, as a string.
 *
 * Emits three blocks:
 *   `:root`                                       — light tokens
 *   `[data-theme-mode="dark"]`                    — explicit dark mode
 *   `@media (prefers-color-scheme: dark)` around
 *   `:root:not([data-theme-mode="light"])`        — system dark, unless the
 *                                                   host pinned light mode
 *
 * So an app that never touches `data-theme-mode` still gets working dark mode,
 * and an app that sets it gets an explicit, host-controlled override.
 */
export function themeCss(themeId: string | undefined | null): string {
  const theme = getTheme(themeId);
  const light = themeToCssVars(theme, 'light');
  const dark = themeToCssVars(theme, 'dark');
  return [
    `/* @openroom/ui theme: ${theme.id} */`,
    block(':root', light),
    block('[data-theme-mode="dark"]', dark),
    `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-theme-mode="light"])', dark, '    ')
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')}\n}`,
  ].join('\n\n');
}

/**
 * The minimal DOM surface `applyTheme` needs. Declared structurally so this
 * package compiles without the DOM lib and runs unchanged in Preact, React and
 * plain-DOM code; a real `HTMLElement` satisfies it.
 */
export interface ThemeTarget {
  style: { setProperty(property: string, value: string): void };
  setAttribute(name: string, value: string): void;
}

/**
 * Apply a theme to an element by setting the custom properties inline, plus
 * `data-theme` / `data-theme-mode` attributes for selector-based styling.
 *
 * Inline application is deliberate: it is SSR-free, framework-agnostic and
 * instant, which is what live host theme switching (`session.theme`) needs. It
 * returns the applied variables so callers can diff or snapshot them.
 */
export function applyTheme(
  el: ThemeTarget,
  themeId: string | undefined | null,
  mode: ThemeMode,
): Record<string, string> {
  const theme = getTheme(themeId);
  const vars = themeToCssVars(theme, mode);
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value);
  el.setAttribute('data-theme', theme.id);
  el.setAttribute('data-theme-mode', mode);
  return vars;
}
