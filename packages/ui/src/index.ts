/**
 * @openroom/ui — the typed theme-token system shared by every OpenRoom surface.
 *
 * Zero runtime dependencies, no framework, no DOM lib. The host console
 * (React + shadcn), the participant app (React) and the stage (React + GSAP +
 * Three) all consume the SAME CSS custom properties, so a host switching the
 * session theme mid-session restyles all three at once.
 *
 * Quick start:
 *
 * ```ts
 * import { applyTheme, resolveTheme, THEMES } from '@openroom/ui';
 *
 * // snapshot.theme comes off the wire and may be anything
 * applyTheme(document.documentElement, resolveTheme(snapshot.theme), 'dark');
 * ```
 */

export {
  CHART_KEYS,
  DEFAULT_THEME_ID,
  THEME_IDS,
  THEME_MODES,
  TOKEN_KEYS,
  type Theme,
  type ThemeBranding,
  type ThemeId,
  type ThemeMode,
  type ThemeTokens,
  type TokenKey,
} from './tokens.js';

export { THEME_LIST, THEMES } from './themes.js';

export {
  applyTheme,
  getTheme,
  isThemeId,
  resolveTheme,
  themeCss,
  themeToCssVars,
  type ThemeTarget,
} from './css.js';

export {
  AA_CONTRAST,
  AA_LARGE_CONTRAST,
  contrastRatio,
  meetsAA,
  parseHex,
  relativeLuminance,
  type Rgb,
} from './contrast.js';
