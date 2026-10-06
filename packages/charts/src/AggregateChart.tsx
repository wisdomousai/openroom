import type { Aggregate, InteractionView } from '@openroom/sdk';
import { ChoiceBarsChart } from './displays/bars';
import { ChoiceEmojiPulseChart } from './displays/emoji-pulse';
import { GapsChart } from './displays/gaps';
import { ScaleGaugeChart } from './displays/gauge';
import { NumericHistogramChart } from './displays/histogram';
import { TextListChart } from './displays/list';
import { PairsChart } from './displays/pairs';
import { ChoicePeerBarsChart } from './displays/peer';
import { ChoicePieChart } from './displays/pie';
import { ChoiceRadialChart } from './displays/radial';
import { RankingBarsChart } from './displays/ranking';
import { ScaleBarsChart } from './displays/scale';
import { WordCloudChart } from './displays/word-cloud';

export type ChartSize = 'stage' | 'compact';

export interface AggregateChartProps {
  interaction: InteractionView;
  aggregate: Aggregate;
  revealed: boolean;
  frozen?: boolean;
  reduced?: boolean;
  size?: ChartSize;
  /** Peer instruction round-1 tally (choice only). */
  round1Aggregate?: Aggregate | null;
}

/**
 * Single entry for stage / host Results / participant results.
 * All catalog displays paint through TanStack chart marks
 * (or ecosystem libs for word-cloud, emoji marquee, and list cards).
 */
export function AggregateChart(p: AggregateChartProps) {
  const { interaction, aggregate, revealed, frozen = false, reduced = false, size = 'stage' } = p;
  const round1 = p.round1Aggregate ?? null;

  if (interaction.type === 'choice' && aggregate.kind === 'choice') {
    if (round1 !== null && round1.kind === 'choice') {
      return (
        <ChoicePeerBarsChart
          interaction={interaction}
          counts={aggregate.counts}
          total={aggregate.total}
          dontKnow={aggregate.dontKnow}
          revealed={revealed}
          reduced={reduced}
          round1Counts={round1.counts}
          round1Total={round1.total}
          size={size}
        />
      );
    }
    const base = {
      interaction,
      counts: aggregate.counts,
      total: aggregate.total,
      dontKnow: aggregate.dontKnow,
      revealed,
      reduced,
      size,
    };
    switch (interaction.display) {
      case 'columns':
        return <ChoiceBarsChart {...base} vertical />;
      case 'donut':
        return <ChoicePieChart {...base} donut />;
      case 'pie':
        return <ChoicePieChart {...base} />;
      case 'radial':
        return <ChoiceRadialChart {...base} />;
      case 'emoji-pulse':
        return <ChoiceEmojiPulseChart {...base} />;
      default:
        return (
          <ChoiceBarsChart
            {...base}
            vertical={interaction.displayOptions?.orientation === 'vertical'}
          />
        );
    }
  }

  if (interaction.type === 'scale' && aggregate.kind === 'scale') {
    const base = {
      interaction,
      counts: aggregate.counts,
      total: aggregate.total,
      mean: aggregate.mean,
      dontKnow: aggregate.dontKnow,
      reduced,
      size,
    };
    if (interaction.display === 'gauge') return <ScaleGaugeChart {...base} />;
    return <ScaleBarsChart {...base} />;
  }

  if (interaction.type === 'numeric' && aggregate.kind === 'numeric') {
    return (
      <NumericHistogramChart
        interaction={interaction}
        values={aggregate.values}
        total={aggregate.total}
        mean={aggregate.mean}
        median={aggregate.median}
        dontKnow={aggregate.dontKnow}
        revealed={revealed}
        reduced={reduced}
        size={size}
      />
    );
  }

  if (interaction.type === 'ranking' && aggregate.kind === 'ranking') {
    return (
      <RankingBarsChart
        interaction={interaction}
        scores={aggregate.scores}
        avgRank={aggregate.avgRank}
        total={aggregate.total}
        dontKnow={aggregate.dontKnow}
        revealed={revealed}
        reduced={reduced}
        size={size}
      />
    );
  }

  if (aggregate.kind === 'text' && interaction.type === 'text') {
    if (interaction.display === 'word-cloud') {
      return (
        <WordCloudChart
          interaction={interaction}
          entries={aggregate.entries}
          total={aggregate.total}
          frozen={frozen}
          size={size}
        />
      );
    }
    return (
      <TextListChart
        interaction={interaction}
        entries={aggregate.entries}
        total={aggregate.total}
        isQna={false}
        revealed={revealed}
        frozen={frozen}
        size={size}
      />
    );
  }

  if (interaction.type === 'fill-the-gaps' && aggregate.kind === 'fill-the-gaps') {
    return (
      <GapsChart
        interaction={interaction}
        entries={aggregate.entries}
        total={aggregate.total}
        dontKnow={aggregate.dontKnow}
        revealed={revealed}
        frozen={frozen}
        size={size}
      />
    );
  }

  if (interaction.type === 'match' && aggregate.kind === 'match') {
    return (
      <PairsChart
        interaction={interaction}
        pairs={aggregate.pairs}
        total={aggregate.total}
        dontKnow={aggregate.dontKnow}
        revealed={revealed}
        size={size}
      />
    );
  }

  if (aggregate.kind === 'qna') {
    return (
      <TextListChart
        interaction={interaction.type === 'qna' ? interaction : { type: 'qna' }}
        entries={aggregate.entries}
        total={aggregate.total}
        isQna={true}
        revealed={revealed}
        frozen={frozen}
        size={size}
      />
    );
  }

  return (
    <p className="text-sm text-muted-foreground" data-or-chart="empty">
      No results view.
    </p>
  );
}
