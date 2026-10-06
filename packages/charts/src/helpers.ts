import type {
  ChoiceInteractionView,
  ChoiceOptionView,
  DisplayOptions,
  RankingInteractionView,
  ScaleInteractionView,
} from '@openroom/sdk';
import type { ChartConfig } from './components/ui/chart';
import { chartColor } from './colors';

export function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1000) return String(Math.round(n));
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(abs >= 100 ? 0 : 1);
}

export function scaleSummary(p: {
  interaction: ScaleInteractionView;
  counts: Record<number, number>;
  total: number;
  mean: number | null;
  dontKnow: number;
}): string {
  const parts: string[] = [];
  for (let v = p.interaction.min; v <= p.interaction.max; v++) {
    parts.push(`${v}: ${p.counts[v] ?? 0}`);
  }
  const mean = p.mean === null ? '' : `, average ${p.mean.toFixed(1)}`;
  const dk = p.dontKnow > 0 ? `, ${p.dontKnow} don't know` : '';
  return `${p.total} answer${p.total === 1 ? '' : 's'}${mean}. ${parts.join(', ')}${dk}`;
}

export function countsChartConfig(
  rows: { key: string; label: string; color: string }[],
): ChartConfig {
  const config: ChartConfig = { count: { label: 'Answers' } };
  for (const row of rows) {
    config[row.key] = { label: row.label, color: row.color };
  }
  return config;
}

/**
 * Abstention ("I don't know") is counted in `aggregate.total`, so a display
 * that draws only the authored options draws bars that sum to less than the
 * total it states. It gets its own row instead — muted, never correct, always
 * last, and worded exactly like the spoken summary.
 */
export const ABSTAIN_KEY = '__dont-know__';
export const ABSTAIN_LABEL = "Don't know";
/** Muted role, not a sixth series colour: abstention is not an answer. */
export const ABSTAIN_FILL = 'var(--muted-foreground)';

export type SortedOption = ChoiceOptionView & {
  count: number;
  index: number;
  /** True only for the synthetic abstention row. */
  abstain?: boolean;
};

export function abstainOption(dontKnow: number, index: number): SortedOption {
  return {
    id: ABSTAIN_KEY,
    label: ABSTAIN_LABEL,
    correct: false,
    count: dontKnow,
    index,
    abstain: true,
  };
}

export function sortedChoiceOptions(p: {
  interaction: ChoiceInteractionView;
  counts: Record<string, number>;
  /** When > 0, an abstention row is appended after the sorted options. */
  dontKnow?: number;
}): SortedOption[] {
  const sortBy = p.interaction.displayOptions?.sortBy ?? 'order';
  const rows: SortedOption[] = p.interaction.options.map((o, index) => ({
    ...o,
    count: p.counts[o.id] ?? 0,
    index,
  }));
  const sorted =
    sortBy === 'votes'
      ? [...rows].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      : sortBy === 'label'
        ? [...rows].sort((a, b) => a.label.localeCompare(b.label))
        : rows;
  // Sorted last whatever the sort mode: it is not a contender.
  return p.dontKnow && p.dontKnow > 0
    ? [...sorted, abstainOption(p.dontKnow, rows.length)]
    : sorted;
}

export function choiceFill(
  opts: DisplayOptions | undefined,
  optionIndex: number,
  correct: boolean,
): string {
  if (correct) return 'var(--ok)';
  if (opts?.colorMode === 'mono') return 'var(--chart-1)';
  return chartColor(optionIndex);
}

export function formatBarValue(
  count: number,
  total: number,
  showCount: boolean,
  showPercent: boolean,
): string {
  const share = pct(count, total);
  if (showCount && showPercent) return `${count} · ${share}%`;
  if (showCount) return String(count);
  if (showPercent) return `${share}%`;
  return '';
}

function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

export function bucketize(
  vals: number[],
  extra: number | null,
  binCount?: number,
): { start: number; step: number; counts: number[]; max: number; end: number } {
  const all = extra === null ? vals : [...vals, extra];
  if (all.length === 0) return { start: 0, step: 1, counts: [0], max: 1, end: 1 };
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const target =
    typeof binCount === 'number' && binCount >= 3
      ? Math.min(24, binCount)
      : Math.max(5, Math.min(12, Math.ceil(Math.sqrt(vals.length || 1))));
  const span = hi - lo;
  const step = span === 0 ? Math.max(1, Math.abs(lo) * 0.1 || 1) : niceStep(span / target);
  const start = Math.floor(lo / step) * step;
  const count = Math.max(1, Math.ceil((hi - start) / step) || 1);
  const n = Math.max(1, Math.min(24, count === 0 ? 1 : count));
  const counts = new Array<number>(n).fill(0);
  for (const v of vals) {
    const idx = Math.min(n - 1, Math.max(0, Math.floor((v - start) / step)));
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  return { start, step, counts, max: Math.max(1, ...counts), end: start + n * step };
}

export interface RankingRow {
  id: string;
  label: string;
  score: number;
  avgRank: number | null;
}

export function rankRows(p: {
  interaction: RankingInteractionView;
  scores: Record<string, number>;
  avgRank: Record<string, number | null>;
}): RankingRow[] {
  return p.interaction.options
    .map((option) => ({
      id: option.id,
      label: option.label,
      score: p.scores[option.id] ?? 0,
      avgRank: p.avgRank[option.id] ?? null,
    }))
    .sort((a, b) => (b.score === a.score ? a.label.localeCompare(b.label) : b.score - a.score));
}

const STOPWORDS = new Set(
  (
    'a about above after again against all am an and any are arent as at be because been before being below ' +
    'between both but by cant cannot could couldnt did didnt do does doesnt doing dont down during each few ' +
    'for from further had hadnt has hasnt have havent having he her here hers herself him himself his how i ' +
    'if in into is isnt it its itself lets me more most mustnt my myself no nor not of off on once only or ' +
    'other ought our ours ourselves out over own same shant she should shouldnt so some such than that the ' +
    'their theirs them themselves then there these they this those through to too under until up very was ' +
    'wasnt we were werent what when where which while who whom why with wont would wouldnt you your yours ' +
    'yourself yourselves just really quite also get got like one two thing things maybe yes'
  ).split(' '),
);

export function tallyWords(
  texts: string[],
  options?: { maxWords?: number; minWordLength?: number },
): { word: string; count: number }[] {
  const minLen = options?.minWordLength ?? 3;
  const maxWords = options?.maxWords ?? 40;
  const freq = new Map<string, number>();
  for (const t of texts) {
    const tokens = t
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
      .split(/\s+/);
    for (const raw of tokens) {
      const w = raw.replace(/^['-]+|['-]+$/g, '');
      if (w.length < minLen) continue;
      if (STOPWORDS.has(w.replace(/'/g, ''))) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  return [...freq.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, maxWords);
}

export function deltaMark(before: number, after: number): { mark: string; word: string } {
  if (after > before) return { mark: '▲', word: 'up' };
  if (after < before) return { mark: '▼', word: 'down' };
  return { mark: '=', word: 'unchanged' };
}

/** First grapheme cluster if it looks like emoji; else ●. */
export function splitEmoji(label: string): string {
  const m = label.trim().match(/^(\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*)/u);
  return m?.[1] ?? '●';
}
