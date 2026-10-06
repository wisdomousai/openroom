import { useMemo } from 'react';
import type { RankingInteractionView } from '@openroom/sdk';
import { ChartContainer } from '../components/ui/chart';
import { chartColor } from '../colors';
import { Frame } from '../frame';
import { fmt, rankRows, countsChartConfig } from '../helpers';
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
        label: `${index + 1}. ${row.label}`,
        count: row.score,
        color: chartColor(colorIndex.get(row.id) ?? index),
        display:
          `${row.score} pts` +
          (showAvg && row.avgRank !== null ? ` · avg ${fmt(row.avgRank)}` : ''),
      })),
    [interaction, scores, avgRank, colorIndex, showAvg],
  );
  const config = useMemo(() => countsChartConfig(rows), [rows]);
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  const compact = size === 'compact';

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barX(rows, {
            id: 'ranking-bars-background',
            x1: 0,
            x2: () => maximum,
            y: 'label',
            key: 'key',
            fill: 'var(--muted)',
            maxThickness: compact ? 24 : 38,
          }),
          barX(rows, {
            id: 'ranking-bars',
            x: 'count',
            y: 'label',
            key: 'key',
            fill: (row) => row.color,
            maxThickness: compact ? 24 : 38,
          }),
          text(rows, {
            id: 'ranking-bar-values',
            x: 'count',
            y: 'label',
            text: 'display',
            key: 'key',
            fill: 'var(--foreground)',
            fontSize: compact ? 12 : 14,
            fontWeight: 700,
            anchor: 'start',
            dx: 8,
          }),
        ],
        x: { scale: scaleLinear, axis: false },
        y: {
          scale: () => scaleBand<string>().padding(0.14),
          axis: {
            line: false,
            ticks: { size: 0, padding: 0 },
            tickLabels: { fontSize: compact ? 12 : 17, fontWeight: 700, thin: false },
          },
        },
        margin: { top: 0, right: compact ? 80 : 130, bottom: 0, left: 8 },
        theme: chartTheme,
        svgAnimation: chartAnimation(reduced),
      }),
    [rows, maximum, compact, reduced],
  );

  return (
    <Frame summary={rankingSummary({ interaction, scores, avgRank, total, dontKnow, revealed })}>
      <div
        className={cn('or-rank-chart', compact && 'or-chart--compact')}
        style={{ '--or-rows': rows.length } as React.CSSProperties}
        data-or-chart="ordered-bars"
      >
        <ChartContainer
          config={config}
          className="or-chart-frame or-chart-frame--rows aspect-auto w-full"
        >
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
