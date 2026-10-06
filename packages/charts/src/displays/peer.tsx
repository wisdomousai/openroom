import { useMemo } from 'react';
import type { ChoiceInteractionView } from '@openroom/sdk';
import { ChartContainer, type ChartConfig } from '../components/ui/chart';
import { CorrectTag, Frame } from '../frame';
import { deltaMark, pct } from '../helpers';
import { cn } from '../lib/utils';
import {
  barX,
  chartAnimation,
  chartTheme,
  defineChart,
  group,
  scaleBand,
  scaleLinear,
  TanStackChart,
} from '../tanstack';

export function choiceRoundsSummary(p: {
  interaction: ChoiceInteractionView;
  counts: Record<string, number>;
  total: number;
  dontKnow: number;
  revealed: boolean;
  round1Counts: Record<string, number>;
  round1Total: number;
}): string {
  const parts = p.interaction.options.map((o) => {
    const before = pct(p.round1Counts[o.id] ?? 0, p.round1Total);
    const after = pct(p.counts[o.id] ?? 0, p.total);
    const { word } = deltaMark(before, after);
    return (
      `${o.label} ${before}% to ${after}% (${word})` +
      (p.revealed && o.correct ? ' (correct)' : '')
    );
  });
  return (
    `Round 1 ${p.round1Total} answers, round 2 ${p.total} answers. ` +
    parts.join('; ') +
    (p.dontKnow > 0 ? `. ${p.dontKnow} don't know in round 2` : '')
  );
}

/** Peer instruction: grouped native TanStack bars (round1 / round2). */
export function ChoicePeerBarsChart({
  interaction,
  counts,
  total,
  dontKnow,
  revealed,
  reduced,
  round1Counts,
  round1Total,
  size = 'stage',
}: {
  interaction: ChoiceInteractionView;
  counts: Record<string, number>;
  total: number;
  dontKnow: number;
  revealed: boolean;
  reduced?: boolean;
  round1Counts: Record<string, number>;
  round1Total: number;
  size?: 'stage' | 'compact';
}) {
  const rows = useMemo(
    () =>
      interaction.options.map((option) => {
        const before = pct(round1Counts[option.id] ?? 0, round1Total);
        const after = pct(counts[option.id] ?? 0, total);
        const correct = revealed && option.correct === true;
        return {
          key: option.id,
          label: option.label,
          round1: before,
          round2: after,
          correct,
          delta: deltaMark(before, after),
        };
      }),
    [interaction.options, counts, total, round1Counts, round1Total, revealed],
  );
  const seriesRows = useMemo(
    () =>
      rows.flatMap((row) => [
        {
          key: `${row.key}-round1`,
          label: row.label,
          series: 'round1',
          value: row.round1,
          color: 'var(--muted-foreground)',
        },
        {
          key: `${row.key}-round2`,
          label: row.label,
          series: 'round2',
          value: row.round2,
          color: 'var(--chart-1)',
        },
      ]),
    [rows],
  );
  const config = {
    round1: { label: 'Round 1', color: 'var(--muted-foreground)' },
    round2: { label: 'Round 2', color: 'var(--chart-1)' },
  } satisfies ChartConfig;
  const compact = size === 'compact';

  const thinNote =
    round1Total > 0 && total > 0 && total < round1Total * 0.5
      ? ' Fewer answers in round 2.'
      : '';

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barX(seriesRows, {
            id: 'peer-bars-background',
            x: 'value',
            y: 'label',
            z: 'series',
            key: 'key',
            layout: group(),
            fill: 'var(--muted)',
            maxThickness: compact ? 12 : 18,
          }),
          barX(seriesRows, {
            id: 'peer-bars',
            x: 'value',
            y: 'label',
            z: 'series',
            key: 'key',
            layout: group(),
            fill: (row) => row.color,
            maxThickness: compact ? 12 : 18,
          }),
        ],
        x: { scale: scaleLinear().domain([0, 100]), axis: false },
        y: {
          scale: () => scaleBand<string>().padding(0.18),
          axis: false,
        },
        margin: { top: 0, right: 16, bottom: 0, left: 0 },
        theme: chartTheme,
        svgAnimation: chartAnimation(reduced),
      }),
    [seriesRows, compact, reduced],
  );

  return (
    <Frame
      summary={
        choiceRoundsSummary({
          interaction,
          counts,
          total,
          dontKnow,
          revealed,
          round1Counts,
          round1Total,
        }) + thinNote
      }
    >
      <div
        className={cn('or-bars-chart or-peer-chart', compact && 'or-chart--compact')}
        style={{ '--or-rows': rows.length } as React.CSSProperties}
        data-or-chart="peer"
      >
        <ul className="or-chart-legend">
          {rows.map((row) => (
            <li
              key={row.key}
              className={cn('shiftrow', row.correct && 'shiftrow--correct barrow--correct')}
              data-or-option={row.key}
              {...(row.correct ? { 'data-or-correct': '' } : {})}
            >
              <span className="barrow__label shiftrow__label">
                {row.label}
                {row.correct ? <CorrectTag /> : null}
              </span>
              <span className="shiftrow__nums text-sm tabular-nums text-muted-foreground">
                <span className="shiftrow__was" data-round="r1">
                  {row.round1}% →
                </span>{' '}
                <strong className="shiftrow__now text-foreground" data-round="r2">
                  {row.round2}%
                </strong>{' '}
                {row.delta.mark}
              </span>
            </li>
          ))}
        </ul>
        <ChartContainer config={config} className="or-chart-frame or-chart-frame--rows aspect-auto">
          <TanStackChart
            definition={definition}
            ariaLabel="Choice responses by round"
            initialHeight={Math.max(180, rows.length * (compact ? 60 : 68))}
          />
        </ChartContainer>
        <p className="shiftnote text-sm text-muted-foreground">
          Round 1: {round1Total} answer{round1Total === 1 ? '' : 's'} · round 2: {total}{' '}
          answer{total === 1 ? '' : 's'}.{thinNote}
        </p>
      </div>
    </Frame>
  );
}
