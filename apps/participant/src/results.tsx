import type { Aggregate, InteractionView } from '@openroom/sdk';
import { AggregateChart } from '@openroom/charts';

export function Results({
  interaction,
  aggregate,
  round1Aggregate = null,
}: {
  interaction: InteractionView;
  aggregate: Aggregate;
  round1Aggregate?: Aggregate | null;
}) {
  const revealed =
    (interaction.type === 'choice' && interaction.options.some((o) => o.correct)) ||
    (interaction.type === 'numeric' && typeof interaction.correct === 'number') ||
    (interaction.type === 'text' && (interaction.correctAnswers?.length ?? 0) > 0) ||
    (interaction.type === 'ranking' && (interaction.correctOrder?.length ?? 0) > 0);

  return (
    <section className="results" aria-label="Results">
      <h2 className="results__heading">Results</h2>
      <AggregateChart
        interaction={interaction}
        aggregate={aggregate}
        revealed={revealed || round1Aggregate != null}
        reduced={false}
        size="compact"
        round1Aggregate={round1Aggregate}
      />
    </section>
  );
}
