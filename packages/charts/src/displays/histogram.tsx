import { useMemo } from 'react';
import type { NumericInteractionView } from '@openroom/sdk';
import { ChartContainer } from '../components/ui/chart';
import { Frame } from '../frame';
import { bucketize, countsChartConfig, fmt } from '../helpers';
import { cn } from '../lib/utils';
import {
  barY,
  chartAnimation,
  chartTheme,
  defineChart,
  ruleX,
  scaleBand,
  scaleLinear,
  TanStackChart,
} from '../tanstack';

function numericSummary(p: {
  interaction: NumericInteractionView;
  total: number;
  mean: number | null;
  median: number | null;
  dontKnow: number;
  revealed: boolean;
}): string {
  const mean = p.mean === null ? '' : `, mean ${fmt(p.mean)}`;
  const median = p.median === null ? '' : `, median ${fmt(p.median)}`;
  const unit = p.interaction.unit ? ` ${p.interaction.unit}` : '';
  const correct =
    p.revealed && typeof p.interaction.correct === 'number'
      ? `. Correct answer ${fmt(p.interaction.correct)}${unit}`
      : '';
  const dk = p.dontKnow > 0 ? `, ${p.dontKnow} don't know` : '';
  return `${p.total} answer${p.total === 1 ? '' : 's'}${mean}${median}${unit}${correct}${dk}`;
}

export function NumericHistogramChart({
  interaction,
  values,
  total,
  mean,
  median,
  dontKnow,
  revealed,
  reduced,
  size = 'stage',
}: {
  interaction: NumericInteractionView;
  values: number[];
  total: number;
  mean: number | null;
  median: number | null;
  dontKnow: number;
  revealed: boolean;
  reduced?: boolean;
  size?: 'stage' | 'compact';
}) {
  const correct = revealed ? (interaction.correct ?? null) : null;
  const bins = useMemo(
    () => bucketize(values, correct, interaction.displayOptions?.binCount),
    [values, correct, interaction.displayOptions?.binCount],
  );
  const rows = useMemo(
    () =>
      bins.counts.map((count, index) => {
        const lo = bins.start + index * bins.step;
        const hi = lo + bins.step;
        const isCorrect =
          correct !== null &&
          correct >= lo &&
          (index === bins.counts.length - 1 ? correct <= hi : correct < hi);
        return {
          key: `b${index}`,
          label: fmt(lo),
          count,
          color: isCorrect ? 'var(--ok)' : 'var(--chart-1)',
          lo,
          hi,
        };
      }),
    [bins, correct],
  );
  const config = useMemo(() => countsChartConfig(rows), [rows]);
  const showMean = interaction.displayOptions?.showMean !== false;
  const showMedian = interaction.displayOptions?.showMedian !== false;
  const compact = size === 'compact';
  const maximum = Math.max(1, ...rows.map((row) => row.count));

  const definition = useMemo(() => {
    const meanLabel =
      mean === null
        ? null
        : fmt(bins.start + Math.floor((mean - bins.start) / bins.step) * bins.step);
    const medianLabel =
      median === null
        ? null
        : fmt(bins.start + Math.floor((median - bins.start) / bins.step) * bins.step);

    return defineChart({
      marks: [
        barY(rows, {
          id: 'numeric-histogram',
          x: 'label',
          y: 'count',
          key: 'key',
          fill: (row) => row.color,
          maxThickness: 48,
        }),
        ...(showMean && meanLabel !== null
          ? [
              ruleX([{ label: meanLabel }], {
                id: 'numeric-mean',
                x: 'label',
                stroke: 'var(--chart-2)',
                strokeWidth: 2,
              }),
            ]
          : []),
        ...(showMedian && medianLabel !== null
          ? [
              ruleX([{ label: medianLabel }], {
                id: 'numeric-median',
                x: 'label',
                stroke: 'var(--chart-3)',
                strokeDasharray: '4 4',
              }),
            ]
          : []),
      ],
      x: {
        scale: () => scaleBand<string>().padding(0.04),
        axis: {
          line: false,
          ticks: { size: 0, padding: 8 },
          tickLabels: { fontSize: compact ? 11 : 15, fontWeight: 600, thin: true },
        },
      },
      y: { scale: scaleLinear, grid: true, axis: false },
      margin: { top: 16, right: 12, bottom: 8, left: 12 },
      theme: chartTheme,
      svgAnimation: chartAnimation(reduced),
    });
  }, [rows, bins, mean, median, showMean, showMedian, compact, reduced]);

  return (
    <Frame
      summary={numericSummary({ interaction, total, mean, median, dontKnow, revealed })}
    >
      <div
        className={cn('or-hist-chart', compact && 'or-chart--compact')}
        data-or-chart="histogram"
      >
        <ChartContainer
          config={config}
          className={cn(
            'or-chart-frame aspect-auto w-full',
            compact ? 'min-h-40' : 'h-full min-h-56',
          )}
        >
          <TanStackChart
            definition={definition}
            ariaLabel="Numeric response distribution"
            initialHeight={compact ? 160 : 280}
          />
        </ChartContainer>
        <p className="text-sm text-muted-foreground">
          {total} answers
          {showMean && mean !== null ? ` · mean ${fmt(mean)}` : ''}
          {showMedian && median !== null ? ` · median ${fmt(median)}` : ''}
          {interaction.unit ? ` ${interaction.unit}` : ''}
        </p>
      </div>
    </Frame>
  );
}
