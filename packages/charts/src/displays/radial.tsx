import { useMemo, type CSSProperties } from 'react';
import type { ChoiceInteractionView } from '@openroom/sdk';
import { ChartContainer } from '../components/ui/chart';
import { CorrectTag, Frame } from '../frame';
import {
  ABSTAIN_FILL,
  choiceFill,
  countsChartConfig,
  pct,
  sortedChoiceOptions,
} from '../helpers';
import { cn } from '../lib/utils';
import {
  chartAnimation,
  chartTheme,
  defineChart,
  polar,
  radialBarRadius,
  radialText,
  scaleBand,
  scaleLinear,
  TanStackChart,
  useWallType,
} from '../tanstack';
import { choiceSummary } from './bars';

/** Longest option label still printed on its bar inside the plot. */
const PLOT_LABEL_MAX = 12;

export function ChoiceRadialChart({
  interaction,
  counts,
  total,
  dontKnow,
  revealed,
  reduced,
  size = 'stage',
}: {
  interaction: ChoiceInteractionView;
  counts: Record<string, number>;
  total: number;
  dontKnow: number;
  revealed: boolean;
  reduced?: boolean;
  size?: 'stage' | 'compact';
}) {
  const rows = useMemo(
    () =>
      sortedChoiceOptions({ interaction, counts, dontKnow }).map((option) => {
        const abstain = option.abstain === true;
        const correct = !abstain && revealed && option.correct === true;
        return {
          key: option.id,
          label: option.label,
          count: option.count,
          share: pct(option.count, total),
          correct,
          abstain,
          color: abstain
            ? ABSTAIN_FILL
            : choiceFill(interaction.displayOptions, option.index, correct),
        };
      }),
    [interaction, counts, dontKnow, revealed, total],
  );
  const config = useMemo(() => countsChartConfig(rows), [rows]);
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  const compact = size === 'compact';
  const plotLabels = rows.every((row) => row.label.length <= PLOT_LABEL_MAX);
  const [root, wall] = useWallType<HTMLDivElement>();
  const labelSize = wall?.value ?? (compact ? 10 : 13);

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          polar({
            id: 'choice-radial',
            startAngle: Math.PI / 2,
            endAngle: Math.PI / 2 - Math.PI * 2,
            radiusRatio: 0.96,
            angle: { scale: () => scaleBand<string>().padding(0.12) },
            radius: {
              scale: scaleLinear().domain([0, maximum]),
              range: [({ radius }) => radius * 0.2, ({ radius }) => radius],
            },
            marks: [
              radialBarRadius(rows, {
                id: 'choice-radial-background',
                angle: 'label',
                radius: () => maximum,
                radius1: 0,
                key: 'key',
                fill: 'var(--muted)',
              }),
              radialBarRadius(rows, {
                id: 'choice-radial-bars',
                angle: 'label',
                radius: 'count',
                radius1: 0,
                key: 'key',
                fill: (row) => row.color,
              }),
              // Long labels printed on the bars run into each other; the legend
              // beside the plot names every bar, so the plot keeps short ones only.
              ...(plotLabels
                ? [
                    radialText(rows, {
                      id: 'choice-radial-labels',
                      angle: 'label',
                      radius: 'count',
                      text: 'label',
                      key: 'key',
                      fill: 'var(--foreground)',
                      fontSize: labelSize,
                      fontWeight: 700,
                      anchor: 'middle',
                      radiusOffset: -12,
                    }),
                  ]
                : []),
            ],
          }),
        ],
        theme: chartTheme,
        svgAnimation: chartAnimation(reduced),
      }),
    [rows, maximum, reduced, plotLabels, labelSize],
  );

  return (
    <Frame summary={choiceSummary({ interaction, counts, total, dontKnow, revealed })}>
      <div
        ref={root}
        className={cn('or-radial-chart', compact ? 'or-chart--compact' : 'or-polar-chart--side')}
        data-or-chart="radial"
      >
        <ChartContainer
          config={config}
          className={cn(
            'or-chart-frame aspect-square w-full',
            compact ? 'max-h-56' : 'max-h-full',
          )}
        >
          <TanStackChart
            definition={definition}
            ariaLabel="Choice response radial chart"
            initialHeight={compact ? 220 : 360}
          />
        </ChartContainer>
        <ul
          className={cn('or-chart-legend', compact ? 'or-chart-legend--wrap' : 'or-chart-legend--columns')}
          style={{ '--or-rows': String(Math.ceil(rows.length / 2)) } as CSSProperties}
        >
          {rows.map((row) => (
            <li
              key={row.key}
              className={cn(
                'barrow',
                row.correct && 'barrow--correct',
                row.abstain && 'barrow--abstain',
              )}
              data-or-option={row.key}
              {...(row.correct ? { 'data-or-correct': '' } : {})}
              {...(row.abstain ? { 'data-or-abstain': '' } : {})}
            >
              <span
                className="or-swatch"
                style={{ background: row.color }}
                aria-hidden="true"
              />
              <span className="barrow__label">
                {row.label} {row.share}%
                {row.correct ? <CorrectTag /> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}
