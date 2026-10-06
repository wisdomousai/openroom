/**
 * Chart presentation options on interactions (`displayOptions`).
 * Normalized to only keys that apply to the selected `display`; unknown keys
 * are stripped (sessions stay clean). Semantic type errors are reported by validate.
 */

import type { Display } from './types.js';

export type SortBy = 'order' | 'votes' | 'label';
export type ColorMode = 'series' | 'mono';
export type Orientation = 'horizontal' | 'vertical';

/** Authoring + wire shape; all fields optional. */
export interface DisplayOptions {
  orientation?: Orientation;
  showPercent?: boolean;
  showCount?: boolean;
  sortBy?: SortBy;
  colorMode?: ColorMode;
  /** Donut/pie hole as fraction of radius, 0–0.85. */
  innerHole?: number;
  showMean?: boolean;
  showMedian?: boolean;
  showAvgRank?: boolean;
  /** Histogram bin count (3–24). */
  binCount?: number;
  /** Max list cards / Q&A rows. */
  maxItems?: number;
  /** Word cloud word cap. */
  maxWords?: number;
  /** Minimum token length for word cloud. */
  minWordLength?: number;
}

/** Keys allowed on any display (then filtered per chart). */
export const DISPLAY_OPTION_KEYS = [
  'orientation',
  'showPercent',
  'showCount',
  'sortBy',
  'colorMode',
  'innerHole',
  'showMean',
  'showMedian',
  'showAvgRank',
  'binCount',
  'maxItems',
  'maxWords',
  'minWordLength',
] as const satisfies readonly (keyof DisplayOptions)[];

export type DisplayOptionKey = (typeof DISPLAY_OPTION_KEYS)[number];

/** Which option keys apply to each chart type. */
export const DISPLAY_OPTION_KEYS_FOR: Record<Display, readonly DisplayOptionKey[]> = {
  bars: ['orientation', 'showPercent', 'showCount', 'sortBy', 'colorMode'],
  columns: ['showPercent', 'showCount', 'sortBy', 'colorMode'],
  donut: ['showPercent', 'showCount', 'sortBy', 'colorMode', 'innerHole'],
  pie: ['showPercent', 'showCount', 'sortBy', 'colorMode', 'innerHole'],
  radial: ['showPercent', 'showCount', 'sortBy', 'colorMode'],
  'emoji-pulse': ['showPercent', 'showCount', 'sortBy'],
  dots: ['showMean', 'showCount'],
  gauge: ['showMean', 'showCount'],
  histogram: ['binCount', 'showMean', 'showMedian', 'showCount'],
  list: ['maxItems', 'sortBy'],
  'word-cloud': ['maxWords', 'minWordLength'],
  'ordered-bars': ['showAvgRank', 'showCount', 'showPercent'],
  sentence: ['showCount'],
  gaps: ['maxItems'],
  bank: ['maxItems'],
  choices: ['maxItems'],
  pairs: ['showCount'],
  number: ['showCount'],
  tally: ['showPercent', 'showCount', 'sortBy'],
  wordcloud: ['maxWords', 'minWordLength'],
  scale: ['showMean', 'showCount'],
  rank: ['showAvgRank', 'showCount', 'showPercent'],
  emoji: ['showPercent', 'showCount', 'sortBy'],
  cards: ['maxItems', 'sortBy'],
};

const SORT_BY = new Set<SortBy>(['order', 'votes', 'label']);
const COLOR_MODE = new Set<ColorMode>(['series', 'mono']);
const ORIENTATION = new Set<Orientation>(['horizontal', 'vertical']);

export interface DisplayOptionsIssue {
  key: string;
  message: string;
}

/** Type/range checks for authored options (before strip). */
export function validateDisplayOptionsShape(
  options: DisplayOptions | undefined,
): DisplayOptionsIssue[] {
  if (options === undefined) return [];
  const issues: DisplayOptionsIssue[] = [];
  for (const key of Object.keys(options) as DisplayOptionKey[]) {
    if (!(DISPLAY_OPTION_KEYS as readonly string[]).includes(key)) {
      issues.push({ key, message: `unknown displayOptions key "${key}"` });
      continue;
    }
    const value = options[key];
    switch (key) {
      case 'orientation':
        if (typeof value !== 'string' || !ORIENTATION.has(value as Orientation)) {
          issues.push({ key, message: 'orientation must be "horizontal" or "vertical"' });
        }
        break;
      case 'sortBy':
        if (typeof value !== 'string' || !SORT_BY.has(value as SortBy)) {
          issues.push({ key, message: 'sortBy must be "order", "votes", or "label"' });
        }
        break;
      case 'colorMode':
        if (typeof value !== 'string' || !COLOR_MODE.has(value as ColorMode)) {
          issues.push({ key, message: 'colorMode must be "series" or "mono"' });
        }
        break;
      case 'showPercent':
      case 'showCount':
      case 'showMean':
      case 'showMedian':
      case 'showAvgRank':
        if (typeof value !== 'boolean') {
          issues.push({ key, message: `${key} must be a boolean` });
        }
        break;
      case 'innerHole':
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 0.85) {
          issues.push({ key, message: 'innerHole must be a number between 0 and 0.85' });
        }
        break;
      case 'binCount':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 3 || value > 24) {
          issues.push({ key, message: 'binCount must be an integer from 3 to 24' });
        }
        break;
      case 'maxItems':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) {
          issues.push({ key, message: 'maxItems must be an integer from 1 to 100' });
        }
        break;
      case 'maxWords':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 5 || value > 80) {
          issues.push({ key, message: 'maxWords must be an integer from 5 to 80' });
        }
        break;
      case 'minWordLength':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 2 || value > 12) {
          issues.push({ key, message: 'minWordLength must be an integer from 2 to 12' });
        }
        break;
      default:
        break;
    }
  }
  return issues;
}

/**
 * Keep only keys that apply to `display`, fill chart defaults, omit empty object.
 */
export function normalizeDisplayOptions(
  display: Display,
  options: DisplayOptions | undefined,
): DisplayOptions | undefined {
  const allowed = new Set(DISPLAY_OPTION_KEYS_FOR[display]);
  const out: DisplayOptions = {};

  const raw = options ?? {};
  for (const key of allowed) {
    const value = raw[key];
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }

  // Materialize defaults so stage/host never branch on undefined for common knobs.
  switch (display) {
    case 'bars':
      if (out.orientation === undefined) out.orientation = 'horizontal';
      if (out.showPercent === undefined) out.showPercent = true;
      if (out.showCount === undefined) out.showCount = true;
      if (out.sortBy === undefined) out.sortBy = 'order';
      if (out.colorMode === undefined) out.colorMode = 'series';
      break;
    case 'columns':
      if (out.showPercent === undefined) out.showPercent = true;
      if (out.showCount === undefined) out.showCount = true;
      if (out.sortBy === undefined) out.sortBy = 'order';
      if (out.colorMode === undefined) out.colorMode = 'series';
      break;
    case 'donut':
      if (out.innerHole === undefined) out.innerHole = 0.55;
      if (out.showPercent === undefined) out.showPercent = true;
      if (out.showCount === undefined) out.showCount = false;
      if (out.sortBy === undefined) out.sortBy = 'order';
      if (out.colorMode === undefined) out.colorMode = 'series';
      break;
    case 'pie':
      if (out.innerHole === undefined) out.innerHole = 0;
      if (out.showPercent === undefined) out.showPercent = true;
      if (out.showCount === undefined) out.showCount = false;
      if (out.sortBy === undefined) out.sortBy = 'order';
      if (out.colorMode === undefined) out.colorMode = 'series';
      break;
    case 'radial':
      if (out.showPercent === undefined) out.showPercent = true;
      if (out.showCount === undefined) out.showCount = true;
      if (out.sortBy === undefined) out.sortBy = 'order';
      if (out.colorMode === undefined) out.colorMode = 'series';
      break;
    case 'emoji-pulse':
      if (out.showPercent === undefined) out.showPercent = true;
      if (out.showCount === undefined) out.showCount = true;
      if (out.sortBy === undefined) out.sortBy = 'order';
      break;
    case 'dots':
    case 'gauge':
      if (out.showMean === undefined) out.showMean = true;
      if (out.showCount === undefined) out.showCount = true;
      break;
    case 'histogram':
      if (out.binCount === undefined) out.binCount = 10;
      if (out.showMean === undefined) out.showMean = true;
      if (out.showMedian === undefined) out.showMedian = true;
      if (out.showCount === undefined) out.showCount = true;
      break;
    case 'list':
      if (out.maxItems === undefined) out.maxItems = 24;
      if (out.sortBy === undefined) out.sortBy = 'order';
      break;
    case 'word-cloud':
    case 'wordcloud':
      if (out.maxWords === undefined) out.maxWords = 40;
      if (out.minWordLength === undefined) out.minWordLength = 3;
      break;
    case 'ordered-bars':
    case 'rank':
      if (out.showAvgRank === undefined) out.showAvgRank = true;
      if (out.showCount === undefined) out.showCount = true;
      if (out.showPercent === undefined) out.showPercent = false;
      break;
    case 'number':
      if (out.showCount === undefined) out.showCount = true;
      break;
    case 'tally':
    case 'emoji':
      if (out.showPercent === undefined) out.showPercent = true;
      if (out.showCount === undefined) out.showCount = true;
      if (out.sortBy === undefined) out.sortBy = 'order';
      break;
    case 'scale':
      if (out.showMean === undefined) out.showMean = true;
      if (out.showCount === undefined) out.showCount = true;
      break;
    case 'cards':
      if (out.maxItems === undefined) out.maxItems = 24;
      if (out.sortBy === undefined) out.sortBy = 'order';
      break;
    default:
      break;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
