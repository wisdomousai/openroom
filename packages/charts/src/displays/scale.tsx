import { useMemo } from 'react';
import type { ScaleInteractionView } from '@openroom/sdk';
import { ChartContainer } from '../components/ui/chart';
import { Frame } from '../frame';
import {
  ABSTAIN_FILL,
  ABSTAIN_KEY,
  ABSTAIN_LABEL,
  countsChartConfig,
  fmt,
  scaleSummary,
} from '../helpers';
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
  text,
} from '../tanstack';

export function ScaleBarsChart({
  interaction,
  counts,
  total,
  mean,
  dontKnow,
  reduced,
  size = 'stage',
}: {
  interaction: ScaleInteractionView;
  counts: Record<number, number>;
  total: number;
  mean: number | null;
  dontKnow: number;
  reduced?: boolean;
  size?: 'stage' | 'compact';
}) {
  const showCount = interaction.displayOptions?.showCount !== false;
  const { min, max } = interaction;
  const rows = useMemo(() => {
    const out: {
      key: string;
      label: string;
      count: number;
      color: string;
      display: string;
    }[] = [];
    for (let value = min; value <= max; value++) {
      out.push({
        key: String(value),
        label: String(value),
        count: counts[value] ?? 0,
        color: 'var(--chart-1)',
        display: showCount ? String(counts[value] ?? 0) : '',
      });
    }
    // Abstention is inside `total`, so it gets the last band of its own —
    // muted, off the scale, never averaged into the mean rule.
    if (dontKnow > 0) {
      out.push({
        key: ABSTAIN_KEY,
        label: ABSTAIN_LABEL,
        count: dontKnow,
        color: ABSTAIN_FILL,
        display: showCount ? String(dontKnow) : '',
      });
    }
    return out;
  }, [min, max, counts, dontKnow, showCount]);
  const config = useMemo(() => countsChartConfig(rows), [rows]);
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  const compact = size === 'compact';

  const definition = useMemo(() => {
    const labels = rows.filter((row) => row.display.length > 0);
    const roundedMean = mean === null ? null : Math.round(mean);
    return defineChart({
      marks: [
        barY(rows, {
          id: 'scale-bars-background',
          x: 'label',
          y1: 0,
          y2: () => maximum,
          key: 'key',
          fill: 'var(--muted)',
          maxThickness: compact ? 32 : 48,
        }),
        barY(rows, {
          id: 'scale-bars',
          x: 'label',
          y: 'count',
          key: 'key',
          fill: (row) => row.color,
          maxThickness: compact ? 32 : 48,
        }),
        ...(showCount
          ? [
              text(labels, {
                id: 'scale-bar-values',
                x: 'label',
                y: 'count',
                text: 'display',
                key: 'key',
                fill: 'var(--foreground)',
                fontSize: compact ? 12 : 14,
                fontWeight: 700,
                anchor: 'middle',
                dy: -8,
              }),
            ]
          : []),
        ...(roundedMean === null
          ? []
          : [
              ruleX([{ label: String(roundedMean) }], {
                id: 'scale-mean',
                x: 'label',
                stroke: 'var(--foreground)',
                strokeWidth: 2,
              }),
            ]),
      ],
      x: {
        scale: () => scaleBand<string>().padding(0.12),
        axis: {
          line: true,
          ticks: { size: 0, padding: 8 },
          tickLabels: { fontSize: compact ? 12 : 22, fontWeight: 700, thin: false },
        },
      },
      y: { scale: scaleLinear, axis: false },
      margin: { top: 28, right: 12, bottom: 8, left: 12 },
      theme: chartTheme,
      svgAnimation: chartAnimation(reduced),
    });
  }, [rows, maximum, compact, mean, reduced, showCount]);

  return (
    <Frame summary={scaleSummary({ interaction, counts, total, mean, dontKnow })}>
      <div
        className={cn('or-scale-chart', compact && 'or-chart--compact')}
        data-or-chart="scale"
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
            ariaLabel="Scale responses"
            initialHeight={compact ? 160 : 280}
          />
        </ChartContainer>
        {(interaction.minLabel || interaction.maxLabel) && (
          <div className="or-scale-ends" aria-hidden="true">
            <span>{interaction.minLabel ?? ''}</span>
            <span>{interaction.maxLabel ?? ''}</span>
          </div>
        )}
        {mean !== null && interaction.displayOptions?.showMean !== false ? (
          <p className="or-mean-chip justify-self-center" aria-hidden="true">
            avg {fmt(mean)}
          </p>
        ) : null}
      </div>
    </Frame>
  );
}
