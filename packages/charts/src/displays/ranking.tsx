import { useMemo } from 'react';
import type { RankingInteractionView } from '@openroom/sdk';
import { ChartContainer } from '../components/ui/chart';
import { chartColor } from '../colors';
import { Frame } from '../frame';
import { fmt, rankRows, countsChartConfig } from '../helpers';
import { TokenWords } from '../tokens';
import { cn } from '../lib/utils';
import {
  barX,
  chartAnimation,
  chartTheme,
  defineChart,
  scaleBand,
  scaleLinear,
  TanStackChart,
  text,
  useWallType,
} from '../tanstack';

export function rankingSummary(p: {
  interaction: RankingInteractionView;
  scores: Record<string, number>;
  avgRank: Record<string, number | null>;
  total: number;
  dontKnow: number;
  revealed: boolean;
}): string {
  const rows = rankRows(p);
  const parts = rows.map(
    (row, index) =>
      `${index + 1}. ${row.label}, ${row.score} point${row.score === 1 ? '' : 's'}` +
      (row.avgRank === null ? '' : `, average rank ${fmt(row.avgRank)}`),
  );
  const dk = p.dontKnow > 0 ? `, ${p.dontKnow} don't know` : '';
  const order = p.revealed ? p.interaction.correctOrder : undefined;
  const correct =
    order && order.length > 0
      ? `. Correct order: ${order
          .map((id) => p.interaction.options.find((o) => o.id === id)?.label ?? id)
          .join(' → ')}`
      : '';
  return `${p.total} ranking${p.total === 1 ? '' : 's'}: ${parts.join('; ')}${dk}${correct}`;
}

export function RankingBarsChart({
  interaction,
  scores,
  avgRank,
  total,
  dontKnow,
  revealed,
  reduced,
  size = 'stage',
}: {
  interaction: RankingInteractionView;
  scores: Record<string, number>;
  avgRank: Record<string, number | null>;
  total: number;
  dontKnow: number;
  revealed: boolean;
  reduced?: boolean;
  size?: 'stage' | 'compact';
}) {
  const showAvg = interaction.displayOptions?.showAvgRank !== false;
  const colorIndex = useMemo(() => {
    const map = new Map<string, number>();
    interaction.options.forEach((option, index) => map.set(option.id, index));
    return map;
  }, [interaction.options]);

  const rows = useMemo(
    () =>
      rankRows({ interaction, scores, avgRank }).map((row, index) => ({
        key: row.id,
        rank: index + 1,
        // The authored position, so tutor ink names this item `option-N`.
        index: colorIndex.get(row.id) ?? index,
        label: row.label,
        count: row.score,
        color: chartColor(colorIndex.get(row.id) ?? index),
        display:
          `${row.score} ${row.score === 1 ? 'pt' : 'pts'}` +
          (showAvg && row.avgRank !== null ? ` · avg ${fmt(row.avgRank)}` : ''),
      })),
    [interaction, scores, avgRank, colorIndex, showAvg],
  );
  const config = useMemo(() => countsChartConfig(rows), [rows]);
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  const compact = size === 'compact';
  const [root, wall] = useWallType<HTMLDivElement>();
  const valueSize = wall?.value ?? (compact ? 12 : 14);

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barX(rows, {
            id: 'ranking-bars-background',
            x1: 0,
            x2: () => maximum,
            y: 'key',
            key: 'key',
            fill: 'var(--muted)',
            maxThickness: compact ? 24 : 38,
          }),
          barX(rows, {
            id: 'ranking-bars',
            x: 'count',
            y: 'key',
            key: 'key',
            fill: (row) => row.color,
            maxThickness: compact ? 24 : 38,
          }),
          text(rows, {
            id: 'ranking-bar-values',
            x: 'count',
            y: 'key',
            text: 'display',
            key: 'key',
            fill: 'var(--foreground)',
            fontSize: valueSize,
            fontWeight: 700,
            anchor: 'start',
            dx: 8,
          }),
        ],
        x: { scale: scaleLinear, axis: false },
        // The names sit in the HTML label column beside the plot, as on the
        // choice bars: an SVG tick label had no room and was cut to a letter.
        y: {
          scale: () => scaleBand<string>().padding(0.14),
          axis: false,
        },
        // "3 pts · avg 2.3" prints after the bars, in the right margin.
        margin: { top: 0, right: wall ? Math.round(valueSize * 9.3) : compact ? 80 : 130, bottom: 0, left: 0 },
        theme: chartTheme,
        svgAnimation: chartAnimation(reduced),
      }),
    [rows, maximum, compact, reduced, valueSize, wall],
  );

  return (
    <Frame summary={rankingSummary({ interaction, scores, avgRank, total, dontKnow, revealed })}>
      <div
        ref={root}
        className={cn('or-bars-chart or-rank-chart', compact && 'or-chart--compact')}
        style={{ '--or-rows': rows.length } as React.CSSProperties}
        data-or-chart="ordered-bars"
      >
        <ol className="or-chart-legend">
          {rows.map((row) => (
            <li key={row.key} className="barrow" data-or-option={row.key}>
              <span className="barrow__label">
                <span className="barrow__rank">{row.rank}.</span>{' '}
                <span data-part={`option-${String(row.index)}`}>
                  <TokenWords text={row.label} />
                </span>
              </span>
            </li>
          ))}
        </ol>
        <ChartContainer config={config} className="or-chart-frame or-chart-frame--rows aspect-auto">
          <TanStackChart
            definition={definition}
            ariaLabel="Ranking scores"
            initialHeight={Math.max(160, rows.length * (compact ? 40 : 52))}
          />
        </ChartContainer>
      </div>
    </Frame>
  );
}
