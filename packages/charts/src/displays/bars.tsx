import { useMemo } from 'react';
import type { ChoiceInteractionView } from '@openroom/sdk';
import { ChartContainer } from '../components/ui/chart';
import { CorrectTag, Frame } from '../frame';
import { TokenWords } from '../tokens';
import {
  ABSTAIN_FILL,
  choiceFill,
  countsChartConfig,
  formatBarValue,
  pct,
  sortedChoiceOptions,
} from '../helpers';
import { cn } from '../lib/utils';
import {
  barX,
  barY,
  chartAnimation,
  chartTheme,
  defineChart,
  scaleBand,
  scaleLinear,
  TanStackChart,
  text,
  useWallType,
} from '../tanstack';

/** Left and right plot margin of the columns chart, in px; the label row matches it. */
const COLUMN_INSET = 12;
/** The band scale's padding; the label row centres each name on its column with it. */
const COLUMN_PADDING = 0.12;

export function choiceSummary(p: {
  interaction: ChoiceInteractionView;
  counts: Record<string, number>;
  total: number;
  dontKnow: number;
  revealed: boolean;
}): string {
  // The spoken summary already names the abstention at the end, so the row
  // list here stays the authored options.
  const parts = sortedChoiceOptions({ interaction: p.interaction, counts: p.counts }).map(
    (o) =>
      `${o.label} ${pct(o.count, p.total)}%` + (p.revealed && o.correct ? ' (correct)' : ''),
  );
  const dk = p.dontKnow > 0 ? `, ${p.dontKnow} don't know` : '';
  return `${p.total} answer${p.total === 1 ? '' : 's'}: ${parts.join(', ')}${dk}`;
}

export function ChoiceBarsChart({
  interaction,
  counts,
  total,
  dontKnow,
  revealed,
  reduced,
  vertical = false,
  size = 'stage',
}: {
  interaction: ChoiceInteractionView;
  counts: Record<string, number>;
  total: number;
  dontKnow: number;
  revealed: boolean;
  reduced?: boolean;
  vertical?: boolean;
  size?: 'stage' | 'compact';
}) {
  const showCount = interaction.displayOptions?.showCount !== false;
  const showPercent = interaction.displayOptions?.showPercent !== false;
  const rows = useMemo(
    () =>
      sortedChoiceOptions({ interaction, counts, dontKnow }).map((o) => {
        const abstain = o.abstain === true;
        const correct = !abstain && revealed && o.correct === true;
        return {
          key: o.id,
          // The authored position, so tutor ink can name this option the way
          // the outline does (`option-N`).
          index: o.index,
          label: o.label,
          count: o.count,
          correct,
          abstain,
          color: abstain
            ? ABSTAIN_FILL
            : choiceFill(interaction.displayOptions, o.index, correct),
          display: formatBarValue(o.count, total, showCount, showPercent),
        };
      }),
    [interaction, counts, dontKnow, revealed, total, showCount, showPercent],
  );
  const config = useMemo(() => countsChartConfig(rows), [rows]);
  const compact = size === 'compact';
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  const [root, wall] = useWallType<HTMLDivElement>();
  const valueSize = wall?.value ?? (compact ? 12 : 14);

  const definition = useMemo(() => {
    const labels = rows.filter((row) => row.display.length > 0);
    const thickness = compact ? 28 : 44;
    return defineChart({
      marks: [
        barY(rows, {
          id: 'choice-bars-background',
          x: 'key',
          y1: 0,
          y2: () => maximum,
          key: 'key',
          fill: 'var(--muted)',
          maxThickness: thickness,
        }),
        barY(rows, {
          id: 'choice-bars',
          x: 'key',
          y: 'count',
          key: 'key',
          fill: (row) => row.color,
          maxThickness: thickness,
        }),
        text(labels, {
          id: 'choice-bar-values',
          x: 'key',
          y: 'count',
          text: 'display',
          key: 'key',
          fill: 'var(--foreground)',
          fontSize: valueSize,
          fontWeight: 700,
          anchor: 'middle',
          dy: -8,
        }),
      ],
      x: {
        scale: () => scaleBand<string>().padding(COLUMN_PADDING),
        // The option names sit in an HTML row under the columns, where they
        // can wrap; one-line SVG tick labels printed over each other.
        axis: { line: true, ticks: false, tickLabels: false },
      },
      y: { scale: scaleLinear, axis: false },
      // The values print above the columns, in the top margin.
      margin: { top: wall ? valueSize + 20 : compact ? 24 : 34, right: COLUMN_INSET, bottom: 0, left: COLUMN_INSET },
      theme: chartTheme,
      svgAnimation: chartAnimation(reduced),
    });
  }, [rows, maximum, compact, reduced, valueSize, wall]);

  const horizontalDefinition = useMemo(() => {
    const labels = rows.filter((row) => row.display.length > 0);
    const thickness = compact ? 24 : 38;
    return defineChart({
      marks: [
        barX(rows, {
          id: 'choice-bars-background',
          x1: 0,
          x2: () => maximum,
          y: 'label',
          key: 'key',
          fill: 'var(--muted)',
          maxThickness: thickness,
        }),
        barX(rows, {
          id: 'choice-bars',
          x: 'count',
          y: 'label',
          key: 'key',
          fill: (row) => row.color,
          maxThickness: thickness,
        }),
        text(labels, {
          id: 'choice-bar-values',
          x: 'count',
          y: 'label',
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
      y: {
        scale: () => scaleBand<string>().padding(0.14),
        axis: false,
      },
      // The values print after the bars, in the right margin.
      margin: { top: 0, right: wall ? Math.round(valueSize * 7.9) : compact ? 64 : 110, bottom: 0, left: 0 },
      theme: chartTheme,
      svgAnimation: chartAnimation(reduced),
    });
  }, [rows, maximum, compact, reduced, valueSize, wall]);

  if (vertical) {
    return (
      <Frame summary={choiceSummary({ interaction, counts, total, dontKnow, revealed })}>
        <div
          ref={root}
          className={cn('or-cols-chart', compact && 'or-chart--compact')}
          style={
            {
              '--or-cols': rows.length,
              '--or-col-inset': `${COLUMN_INSET}px`,
              '--or-col-padding': COLUMN_PADDING,
            } as React.CSSProperties
          }
          data-or-chart="columns"
        >
          <ChartContainer
            config={config}
            className={cn(
              'or-chart-frame aspect-auto w-full',
              compact ? 'min-h-40' : 'min-h-48 flex-1',
            )}
          >
            <TanStackChart
              definition={definition}
              ariaLabel="Choice responses by option"
              initialHeight={compact ? 160 : 240}
            />
          </ChartContainer>
          <ol className="or-chart-legend or-cols-chart__labels">
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
                  className="barrow__label"
                  data-part={row.abstain ? 'dont-know' : `option-${String(row.index)}`}
                >
                  <TokenWords text={row.label} />
                </span>
                {row.correct ? <CorrectTag /> : null}
              </li>
            ))}
          </ol>
        </div>
      </Frame>
    );
  }

  return (
    <Frame summary={choiceSummary({ interaction, counts, total, dontKnow, revealed })}>
      <div
        ref={root}
        className={cn('or-bars-chart', compact && 'or-chart--compact')}
        style={{ '--or-rows': rows.length } as React.CSSProperties}
        data-or-chart="bars"
      >
        <ul className="or-chart-legend">
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
                className="barrow__label"
                data-part={row.abstain ? 'dont-know' : `option-${String(row.index)}`}
              >
                <TokenWords text={row.label} />
                {row.correct ? <CorrectTag /> : null}
              </span>
            </li>
          ))}
        </ul>
        <ChartContainer config={config} className="or-chart-frame or-chart-frame--rows aspect-auto">
          <TanStackChart
            definition={horizontalDefinition}
            ariaLabel="Choice responses by option"
            initialHeight={Math.max(160, rows.length * (compact ? 40 : 52))}
          />
        </ChartContainer>
      </div>
    </Frame>
  );
}
