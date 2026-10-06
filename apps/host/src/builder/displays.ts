/**
 * Chart type catalog + attribute field metadata for the deck builder.
 * `DISPLAY_STYLES` / `displaysFor` live in @openroom/schema so the picker
 * and the validator share one table.
 */
import { DISPLAY_STYLES, displaysFor } from '@openroom/schema';
import type { DisplayOptions, InteractionType } from '../types';

export { DISPLAY_STYLES, displaysFor };

export const DISPLAY_LABELS: Record<string, string> = {
  bars: 'Bars',
  columns: 'Columns',
  donut: 'Donut',
  pie: 'Pie',
  radial: 'Radial',
  'emoji-pulse': 'Emoji pulse',
  dots: 'Dots',
  gauge: 'Gauge',
  histogram: 'Histogram',
  list: 'List',
  'word-cloud': 'Word cloud',
  'ordered-bars': 'Ordered bars',
  sentence: 'Sentence',
  gaps: 'Gaps',
  bank: 'Word bank',
  choices: 'Per-gap choices',
  pairs: 'Pairs',
  number: 'Big number',
  tally: 'Tally',
  wordcloud: 'Word cloud',
  scale: 'Scale',
  rank: 'Rank',
  emoji: 'Emoji',
  cards: 'Cards',
};

export function defaultDisplay(type: InteractionType): string {
  return displaysFor(type)[0] ?? 'bars';
}

export type DisplayOptionKey = keyof DisplayOptions;

/** Which option keys apply to each chart type (same as schema). */
export const OPTION_KEYS_FOR: Record<string, readonly DisplayOptionKey[]> = {
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

export type OptionFieldKind = 'boolean' | 'select' | 'number';

export interface OptionFieldMeta {
  key: DisplayOptionKey;
  label: string;
  kind: OptionFieldKind;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
}

const FIELD_META: Record<DisplayOptionKey, OptionFieldMeta> = {
  orientation: {
    key: 'orientation',
    label: 'Orientation',
    kind: 'select',
    options: [
      { value: 'horizontal', label: 'Horizontal' },
      { value: 'vertical', label: 'Vertical' },
    ],
  },
  showPercent: { key: 'showPercent', label: 'Show percent', kind: 'boolean' },
  showCount: { key: 'showCount', label: 'Show count', kind: 'boolean' },
  sortBy: {
    key: 'sortBy',
    label: 'Sort by',
    kind: 'select',
    options: [
      { value: 'order', label: 'Authored order' },
      { value: 'votes', label: 'Votes' },
      { value: 'label', label: 'Label' },
    ],
  },
  colorMode: {
    key: 'colorMode',
    label: 'Colors',
    kind: 'select',
    options: [
      { value: 'series', label: 'Series' },
      { value: 'mono', label: 'Single color' },
    ],
  },
  innerHole: {
    key: 'innerHole',
    label: 'Hole size',
    kind: 'number',
    min: 0,
    max: 0.85,
    step: 0.05,
  },
  showMean: { key: 'showMean', label: 'Show mean', kind: 'boolean' },
  showMedian: { key: 'showMedian', label: 'Show median', kind: 'boolean' },
  showAvgRank: { key: 'showAvgRank', label: 'Show avg rank', kind: 'boolean' },
  binCount: { key: 'binCount', label: 'Bins', kind: 'number', min: 3, max: 24, step: 1 },
  maxItems: { key: 'maxItems', label: 'Max items', kind: 'number', min: 1, max: 100, step: 1 },
  maxWords: { key: 'maxWords', label: 'Max words', kind: 'number', min: 5, max: 80, step: 1 },
  minWordLength: {
    key: 'minWordLength',
    label: 'Min word length',
    kind: 'number',
    min: 2,
    max: 12,
    step: 1,
  },
};

export function fieldsForDisplay(display: string): OptionFieldMeta[] {
  const keys = OPTION_KEYS_FOR[display] ?? [];
  return keys.map((k) => FIELD_META[k]);
}

/** Defaults shown in the builder when options are omitted. */
export function defaultOptionsFor(display: string): DisplayOptions {
  switch (display) {
    case 'bars':
      return {
        orientation: 'horizontal',
        showPercent: true,
        showCount: true,
        sortBy: 'order',
        colorMode: 'series',
      };
    case 'columns':
      return { showPercent: true, showCount: true, sortBy: 'order', colorMode: 'series' };
    case 'donut':
      return {
        innerHole: 0.55,
        showPercent: true,
        showCount: false,
        sortBy: 'order',
        colorMode: 'series',
      };
    case 'pie':
      return {
        innerHole: 0,
        showPercent: true,
        showCount: false,
        sortBy: 'order',
        colorMode: 'series',
      };
    case 'radial':
      return { showPercent: true, showCount: true, sortBy: 'order', colorMode: 'series' };
    case 'emoji-pulse':
      return { showPercent: true, showCount: true, sortBy: 'order' };
    case 'dots':
    case 'gauge':
      return { showMean: true, showCount: true };
    case 'histogram':
      return { binCount: 10, showMean: true, showMedian: true, showCount: true };
    case 'list':
      return { maxItems: 24, sortBy: 'order' };
    case 'word-cloud':
    case 'wordcloud':
      return { maxWords: 40, minWordLength: 3 };
    case 'ordered-bars':
    case 'rank':
      return { showAvgRank: true, showCount: true, showPercent: false };
    case 'sentence':
    case 'pairs':
      return { showCount: true };
    case 'gaps':
    case 'bank':
    case 'choices':
      return { maxItems: 12 };
    case 'number':
      return { showCount: true };
    case 'tally':
    case 'emoji':
      return { showPercent: true, showCount: true, sortBy: 'order' };
    case 'scale':
      return { showMean: true, showCount: true };
    case 'cards':
      return { maxItems: 24, sortBy: 'order' };
    default:
      return {};
  }
}

/** Keep only keys for this display; merge with defaults for form display. */
export function resolveOptions(display: string, current?: DisplayOptions): DisplayOptions {
  const allowed = new Set(OPTION_KEYS_FOR[display] ?? []);
  const defaults = defaultOptionsFor(display);
  const out: DisplayOptions = { ...defaults };
  if (current) {
    for (const key of Object.keys(current) as DisplayOptionKey[]) {
      if (allowed.has(key) && current[key] !== undefined) {
        (out as Record<string, unknown>)[key] = current[key];
      }
    }
  }
  return out;
}

/** Persist only non-default / explicit author values that apply to the chart. */
export function compactOptions(
  display: string,
  options: DisplayOptions,
): DisplayOptions | undefined {
  const allowed = OPTION_KEYS_FOR[display] ?? [];
  const defaults = defaultOptionsFor(display);
  const out: DisplayOptions = {};
  for (const key of allowed) {
    const value = options[key];
    if (value === undefined) continue;
    if (value === defaults[key]) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export const THEME_IDS = ['default', 'chalkboard', 'paper', 'projector', 'sherbet'] as const;

export const INTERACTION_TYPES: { value: InteractionType; label: string }[] = [
  { value: 'choice', label: 'Multiple choice' },
  { value: 'scale', label: 'Scale' },
  { value: 'numeric', label: 'Number' },
  { value: 'text', label: 'Open text' },
  { value: 'qna', label: 'Q&A' },
  { value: 'ranking', label: 'Ranking' },
  { value: 'fill-the-gaps', label: 'Fill the gaps' },
  { value: 'match', label: 'Match pairs' },
];

export type BuilderAddType = InteractionType | 'word-cloud';

export const BUILDER_ADD_TYPES: { value: BuilderAddType; label: string }[] = [
  { value: 'choice', label: 'Multiple choice' },
  { value: 'word-cloud', label: 'Word cloud' },
  { value: 'text', label: 'Open text' },
  { value: 'scale', label: 'Scale' },
  { value: 'numeric', label: 'Number' },
  { value: 'qna', label: 'Q&A' },
  { value: 'ranking', label: 'Ranking' },
  { value: 'fill-the-gaps', label: 'Fill the gaps' },
  { value: 'match', label: 'Match pairs' },
];

export function builderTypeValue(interaction: {
  type: InteractionType;
  display?: string;
}): BuilderAddType {
  if (interaction.type === 'text' && interaction.display === 'word-cloud') return 'word-cloud';
  return interaction.type;
}
