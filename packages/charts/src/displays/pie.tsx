import { useMemo } from 'react';
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
  pie,
  polar,
  radialArc,
  TanStackChart,
} from '../tanstack';
import { choiceSummary } from './bars';

export function ChoicePieChart({
  interaction,
  counts,
  total,
  dontKnow,
  revealed,
  reduced,
  donut = false,
  size = 'stage',
}: {
  interaction: ChoiceInteractionView;
  counts: Record<string, number>;
  total: number;
  dontKnow: number;
  revealed: boolean;
  reduced?: boolean;
  donut?: boolean;
  size?: 'stage' | 'compact';
}) {
  const hole = interaction.displayOptions?.innerHole;
  const innerRatio = donut
    ? typeof hole === 'number'
      ? Math.max(0, Math.min(1, hole))
      : 0.55
    : typeof hole === 'number' && hole >= 0.15
      ? Math.max(0, Math.min(1, hole))
      : 0;

  const rows = useMemo(
    () =>
      sortedChoiceOptions({ interaction, counts, dontKnow }).map((option) => {
        const abstain = option.abstain === true;
        const correct = !abstain && revealed && option.correct === true;
        return {
          key: option.id,
          label: option.label,
          count: option.count,
          correct,
          abstain,
          color: abstain
            ? ABSTAIN_FILL
            : choiceFill(interaction.displayOptions, option.index, correct),
          share: pct(option.count, total),
        };
      }),
    [interaction, counts, dontKnow, revealed, total],
  );
  const config = useMemo(() => countsChartConfig(rows), [rows]);

  const definition = useMemo(() => {
    const slices = pie(rows, { value: 'count' });
    return defineChart({
      marks: [
        polar({
          id: donut ? 'choice-donut' : 'choice-pie',
          radiusRatio: 0.92,
          marks: [
            radialArc(slices, {
              id: 'choice-slices',
              key: 'key',
              fill: (row) => row.color,
              innerRadius: ({ radius }) => radius * innerRatio,
              stroke: 'var(--background)',
              strokeWidth: 2,
            }),
          ],
        }),
      ],
      theme: chartTheme,
      svgAnimation: chartAnimation(reduced),
    });
  }, [rows, donut, innerRatio, reduced]);

  const compact = size === 'compact';

  return (
    <Frame summary={choiceSummary({ interaction, counts, total, dontKnow, revealed })}>
      <div
        className={cn('or-pie-chart', compact && 'or-chart--compact')}
        data-or-chart={donut ? 'donut' : 'pie'}
      >
        <ChartContainer
          config={config}
          className={cn(
            'or-chart-frame aspect-square w-full',
            compact ? 'max-h-56' : 'max-h-[min(100%,28rem)]',
          )}
        >
          <TanStackChart
            definition={definition}
            ariaLabel={donut ? 'Choice response donut chart' : 'Choice response pie chart'}
            initialHeight={compact ? 220 : 360}
          />
        </ChartContainer>
        <ul className="or-chart-legend or-chart-legend--wrap">
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
