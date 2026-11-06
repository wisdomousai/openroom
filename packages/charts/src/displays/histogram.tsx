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
          correct: isCorrect,
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
    // The bin that holds the correct value. It has no height when nobody gave
    // it, so a rule marks it on the axis whatever its count.
    const correctLabel = rows.find((row) => row.correct)?.label ?? null;

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
        ...(correctLabel !== null
          ? [
              ruleX([{ label: correctLabel }], {
                id: 'numeric-correct',
                x: 'label',
                stroke: 'var(--ok)',
                strokeWidth: 4,
              }),
            ]
          : []),
        ...(showMean && meanLabel !== null
          ? [
              ruleX([{ label: meanLabel }], {
                id: 'numeric-mean',
                x: 'label',
                // Green is the correct answer's colour, so the mean takes the ink.
                stroke: 'var(--foreground)',
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
      // The tick values draw in the bottom margin; it holds their line so the
      // note below never prints over them.
      margin: { top: 16, right: 12, bottom: compact ? 22 : 28, left: 12 },
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
            compact ? 'min-h-40' : 'min-h-56 flex-1',
          )}
        >
          <TanStackChart
            definition={definition}
            ariaLabel="Numeric response distribution"
            initialHeight={compact ? 160 : 280}
          />
        </ChartContainer>
        <p className="or-hist-note" aria-hidden="true">
          {total} {total === 1 ? 'answer' : 'answers'}
          {showMean && mean !== null ? ` · mean ${fmt(mean)}` : ''}
          {showMedian && median !== null ? ` · median ${fmt(median)}` : ''}
          {interaction.unit ? ` ${interaction.unit}` : ''}
          {correct !== null ? (
            <span className="or-hist-note__correct">
              {' · correct '}
              {fmt(correct)}
              {interaction.unit ? ` ${interaction.unit}` : ''}
            </span>
          ) : null}
        </p>
      </div>
    </Frame>
  );
}
