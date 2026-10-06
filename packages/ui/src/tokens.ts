/**
 * The OpenRoom theme token table.
 *
 * Keys are written exactly as they appear as CSS custom properties (kebab-case,
 * shadcn/ui convention), so emitting a stylesheet is a mechanical `--${key}`.
 * Every surface in the product — the shadcn host console, the Preact
 * participant app, the React/GSAP/Three stage — reads the SAME variables, which
 * is what makes branding a single sellable knob instead of three code paths.
 *
 * Colour values are `#rrggbb` hex. That is deliberate: hex is trivially
 * parseable, which lets the contrast test in this package prove WCAG AA for
 * every built-in variant, and it interpolates predictably in CSS transitions.
 *
 * Radius and shadow roles are CSS strings (lengths / box-shadow lists), not
 * hex. The contrast gate only parseHex's the AA text pairs and the chart keys.
 */
export interface ThemeTokens {
  /** page / canvas fill — the field panes and rails sit on */
  background: string;
  /** default body text on `background` — WCAG AA enforced */
  foreground: string;

  /** raised surface (cards, panels, the page itself) */
  card: string;
  'card-foreground': string;

  /** floating surface (menus, dialogs, tooltips) */
  popover: string;
  'popover-foreground': string;

  /** primary action colour — "you can act" */
  primary: string;
  /** text/icon on `primary` — WCAG AA enforced */
  'primary-foreground': string;

  secondary: string;
  'secondary-foreground': string;

  /** low-emphasis surface; matches `chrome` on the default table */
  muted: string;
  /** low-emphasis text */
  'muted-foreground': string;

  /** hover/highlight surface; the Pro branding accent overrides this */
  accent: string;
  'accent-foreground': string;

  destructive: string;
  'destructive-foreground': string;

  border: string;
  input: string;
  /** focus ring */
  ring: string;

  /** base control radius, a CSS length (e.g. `0.25rem`, `0rem` for projector) */
  radius: string;

  /** categorical visualisation palette — bars, donut slices, ranking rows */
  'chart-1': string;
  'chart-2': string;
  'chart-3': string;
  'chart-4': string;
  'chart-5': string;

  /** UI font stack */
  'font-sans': string;
  /** headline/stage font stack */
  'font-display': string;

  /** field a page or slide floats on; the only place `--shadow-page` is allowed */
  desk: string;
  /** app furniture — title bar, ribbon strip, nav, status bar */
  chrome: string;
  /** divider inside a pane or list, quieter than `border` */
  hairline: string;

  /** live hue — "the class is in it" */
  live: string;
  /** hover fill for a live control — a solid shade of `live`, never a tint */
  'live-hover': string;
  /** text/icon on `live` and on `live-hover` — WCAG AA enforced */
  'live-foreground': string;
  /** wash behind a live marker */
  'live-tint': string;
  /** text on `live-tint` — WCAG AA enforced */
  'live-tint-foreground': string;

  /** radius ramp — chips / bars */
  'radius-sm': string;
  /** radius ramp — buttons, inputs, tabs */
  'radius-md': string;
  /** radius ramp — slide thumbs, list rows, the slide on the desk */
  'radius-lg': string;
  /** radius ramp — panes, cards, dialogs, the page */
  'radius-xl': string;

  /** elevation on a page or slide floating on the desk */
  'shadow-page': string;
  /** elevation on a dialog, menu, or anything over a scrim */
  'shadow-overlay': string;
}

/** Every token key, in emission order. */
export const TOKEN_KEYS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'radius',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'font-sans',
  'font-display',
  'desk',
  'chrome',
  'hairline',
  'live',
  'live-hover',
  'live-foreground',
  'live-tint',
  'live-tint-foreground',
  'radius-sm',
  'radius-md',
  'radius-lg',
  'radius-xl',
  'shadow-page',
  'shadow-overlay',
] as const satisfies readonly (keyof ThemeTokens)[];

export type TokenKey = (typeof TOKEN_KEYS)[number];

/** The chart palette keys, in order, for viz code that iterates a series. */
export const CHART_KEYS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] as const;

/** The five built-in theme ids. Unknown ids resolve to `default`. */
export type ThemeId = 'default' | 'chalkboard' | 'paper' | 'projector' | 'sherbet';

export const THEME_IDS = ['default', 'chalkboard', 'paper', 'projector', 'sherbet'] as const;

export const DEFAULT_THEME_ID: ThemeId = 'default';

/** Light or dark variant of a theme. */
export type ThemeMode = 'light' | 'dark';

export const THEME_MODES = ['light', 'dark'] as const;

/**
 * Pro-tier branding slots. These are explicit typed fields, NOT raw tokens:
 * customisation is a constrained override (PRD SCHOOL-07), never custom CSS.
 *
 * - `accent`: a colour that replaces `--accent` and `--ring`, and is always
 *   published as `--brand-accent` so a surface can reach for the brand colour
 *   without guessing whether one was set.
 * - `logo`: an absolute or root-relative image URL, published as
 *   `--brand-logo: url("…")` when present. `null` means "use the wordmark".
 */
export interface ThemeBranding {
  accent: string | null;
  logo: string | null;
}

/** A complete theme: identity, branding slots and both token tables. */
export interface Theme {
  id: ThemeId;
  /** human label for the theme picker */
  name: string;
  /** one-line description for the theme picker */
  description: string;
  branding: ThemeBranding;
  light: ThemeTokens;
  dark: ThemeTokens;
}
