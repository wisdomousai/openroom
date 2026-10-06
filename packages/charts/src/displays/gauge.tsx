import { useMemo } from 'react';
import type { ScaleInteractionView } from '@openroom/sdk';
import { ChartContainer, type ChartConfig } from '../components/ui/chart';
import { Frame } from '../frame';
import { fmt, scaleSummary } from '../helpers';
import { cn } from '../lib/utils';
import {
  chartAnimation,
  chartTheme,
  defineChart,
  pie,
  polar,
  radialArc,
  radialText,
  scaleLinear,
  TanStackChart,
} from '../tanstack';

/** Gauge via TanStack's native partial-pie and radial-text marks. */
export function ScaleGaugeChart({
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
  const { min, max } = interaction;
  const value = mean ?? min;
  const frac = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  const compact = size === 'compact';
  const config = {
    mean: { label: 'Average', color: 'var(--chart-1)' },
  } satisfies ChartConfig;

  const definition = useMemo(() => {
    const parts = [
      { id: 'mean', value: frac, color: 'var(--chart-1)' },
      { id: 'remaining', value: 1 - frac, color: 'var(--muted)' },
    ];
    const slices = pie(parts, {
      value: 'value',
      startAngle: -Math.PI / 2,
      endAngle: Math.PI / 2,
    });
    const labels = [
      { id: 'value', angle: 0, radius: 0, text: mean === null ? '—' : fmt(mean) },
      { id: 'caption', angle: 0, radius: 0, text: `${min}–${max} · ${total} answers` },
    ];
    const valueLabel = labels[0]!;
    const captionLabel = labels[1]!;

    return defineChart({
      marks: [
        polar({
          id: 'scale-gauge',
          radiusRatio: 0.84,
          angle: { scale: scaleLinear().domain([-Math.PI, Math.PI]) },
          radius: { scale: scaleLinear().domain([0, 1]) },
          marks: [
            radialArc(slices, {
              id: 'scale-gauge-arc',
              key: 'id',
              fill: (row) => row.color,
              innerRadius: ({ radius }) => radius * 0.72,
              cornerRadius: 0,
            }),
            radialText([valueLabel], {
              id: 'scale-gauge-value',
              angle: 'angle',
              radius: 'radius',
              text: 'text',
              key: 'id',
              fill: 'var(--foreground)',
              fontSize: compact ? 30 : 54,
              fontWeight: 800,
              anchor: 'middle',
              baseline: 'middle',
              dy: compact ? -14 : -22,
            }),
            radialText([captionLabel], {
              id: 'scale-gauge-caption',
              angle: 'angle',
              radius: 'radius',
              text: 'text',
              key: 'id',
              fill: 'var(--muted-foreground)',
              fontSize: compact ? 12 : 18,
              fontWeight: 600,
              anchor: 'middle',
              baseline: 'middle',
              dy: compact ? 12 : 18,
            }),
          ],
        }),
      ],
      theme: chartTheme,
      svgAnimation: chartAnimation(reduced),
    });
  }, [frac, mean, min, max, total, compact, reduced]);

  return (
    <Frame summary={scaleSummary({ interaction, counts, total, mean, dontKnow })}>
      <div
        className={cn('or-gauge-chart', compact && 'or-chart--compact')}
        data-or-chart="gauge"
      >
        <ChartContainer
          config={config}
          className={cn(
            'or-chart-frame mx-auto aspect-[2/1] w-full',
            compact ? 'max-h-44' : 'max-h-[min(100%,26rem)]',
          )}
        >
          <TanStackChart
            definition={definition}
            ariaLabel="Scale average gauge"
            initialHeight={compact ? 176 : 320}
          />
        </ChartContainer>
        {(interaction.minLabel || interaction.maxLabel) && (
          <div className="or-scale-ends mx-auto w-full max-w-[36rem]" aria-hidden="true">
            <span>{interaction.minLabel ?? ''}</span>
            <span>{interaction.maxLabel ?? ''}</span>
          </div>
        )}
      </div>
    </Frame>
  );
}
