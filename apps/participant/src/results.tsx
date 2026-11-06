import type { Aggregate, InteractionView } from '@openroom/sdk';
import { AggregateChart } from '@openroom/charts';

export function Results({
  interaction,
  aggregate,
  revealed,
  round1Aggregate = null,
}: {
  interaction: InteractionView;
  aggregate: Aggregate;
  /** The tutor revealed the answer; the key fields travel only from then on. */
  revealed: boolean;
  round1Aggregate?: Aggregate | null;
}) {
  // A typed answer is marked against forms the learner has not seen: name them.
  const text = revealed && interaction.type === 'text' ? interaction : null;
  const accepted = text?.correctAnswers ?? [];

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
      {accepted.length > 0 ? (
        <p className="hint">
          {accepted.length === 1 ? 'Accepted answer: ' : 'Accepted answers: '}
          <span lang={text?.match?.locale}>{accepted.join(' · ')}</span>
        </p>
      ) : null}
    </section>
  );
}
