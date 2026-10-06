import type { MatchInteractionView } from '@openroom/sdk';
import { CorrectTag, Frame } from '../frame';
import { TokenWords } from '../tokens';
import { chartColor } from '../colors';
import { cn } from '../lib/utils';
import { pct } from '../helpers';

interface ChoiceRow {
  id: string;
  label: string;
  count: number;
  correct: boolean;
}

interface LeftRow {
  id: string;
  label: string;
  choices: ChoiceRow[];
  answered: number;
}

function leftRows(
  interaction: MatchInteractionView,
  pairs: Record<string, Record<string, number>>,
  revealed: boolean,
): LeftRow[] {
  return interaction.left.map((left) => {
    const counts = pairs[left.id] ?? {};
    const key = interaction.correct?.[left.id];
    const choices = Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([rightId, count]) => ({
        id: rightId,
        label: interaction.right.find((item) => item.id === rightId)?.label ?? rightId,
        count,
        correct: revealed && key === rightId,
      }))
      .sort((a, b) => b.count - a.count);
    return {
      id: left.id,
      label: left.label,
      choices,
      answered: choices.reduce((sum, choice) => sum + choice.count, 0),
    };
  });
}

function pairsSummary(rows: LeftRow[], total: number, revealed: boolean): string {
  const parts = rows.map((row) => {
    const top = row.choices[0];
    if (!top) return `${row.label}: no answers yet`;
    return `${row.label} → ${top.label} ${String(top.count)}${revealed && top.correct ? ' (correct)' : ''}`;
  });
  return `${String(total)} answer${total === 1 ? '' : 's'}. ${parts.join('; ')}`;
}

/** Match results: for each left item, which right item the audience chose. */
export function PairsChart({
  interaction,
  pairs,
  total,
  dontKnow,
  revealed,
  size = 'stage',
}: {
  interaction: MatchInteractionView;
  pairs: Record<string, Record<string, number>>;
  total: number;
  dontKnow: number;
  revealed: boolean;
  size?: 'stage' | 'compact';
}) {
  const compact = size === 'compact';
  const showCount = interaction.displayOptions?.showCount !== false;
  const rows = leftRows(interaction, pairs, revealed);

  return (
    <Frame summary={pairsSummary(rows, total, revealed)}>
      <div
        className={cn(
          'or-pairs-chart flex max-h-full flex-col gap-3 overflow-y-auto',
          compact && 'or-chart--compact',
        )}
        data-or-chart="pairs"
      >
        {rows.map((row, rowIndex) => (
          <section key={row.id} className="flex flex-col gap-1.5" data-or-option={row.id}>
            <p className="or-pairs-chart__label m-0 font-bold" data-part={`option-${String(rowIndex)}`}>
              <TokenWords text={row.label} />
            </p>
            {row.choices.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">No answers yet.</p>
            ) : (
              <ul className="or-chart-legend m-0 list-none p-0">
                {row.choices.map((choice, index) => (
                  <li
                    key={choice.id}
                    className={cn('barrow', choice.correct && 'barrow--correct')}
                    data-or-pair={`${row.id}:${choice.id}`}
                    {...(choice.correct ? { 'data-or-correct': '' } : {})}
                  >
                    <span
                      className="or-swatch"
                      style={{ background: choice.correct ? 'var(--ok)' : chartColor(index) }}
                      aria-hidden="true"
                    />
                    <span className="barrow__label">{choice.label}</span>
                    <span className="or-pairs-chart__count font-bold tabular-nums">
                      {showCount ? choice.count : `${String(pct(choice.count, row.answered))}%`}
                    </span>
                    {choice.correct ? <CorrectTag /> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
        <p className="m-0 text-sm text-muted-foreground">
          {total} answer{total === 1 ? '' : 's'}
          {dontKnow > 0 ? `, ${String(dontKnow)} don't know` : ''}
        </p>
      </div>
    </Frame>
  );
}
