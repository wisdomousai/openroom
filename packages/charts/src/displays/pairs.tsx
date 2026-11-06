import type { CSSProperties } from 'react';
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

/**
 * The answers drawn for one left item: the most chosen one and, after the
 * reveal, the correct one when it is not already that. Everything else is
 * folded into a count so each pair stays one row however the room split.
 */
function shownChoices(row: LeftRow): { shown: ChoiceRow[]; more: number } {
  const top = row.choices[0];
  if (top === undefined) return { shown: [], more: 0 };
  const correct = row.choices.find((choice) => choice.correct);
  const shown = correct !== undefined && correct !== top ? [top, correct] : [top];
  return { shown, more: row.choices.length - shown.length };
}

/**
 * Match results as a two-column grid: the left item, then the answer the
 * audience gave it. One row per pair, so six long pairs still fit the plate.
 */
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
        className={cn('or-pairs-chart', compact && 'or-chart--compact')}
        style={{ '--or-rows': String(rows.length + 1) } as CSSProperties}
        data-or-chart="pairs"
      >
        <ul className="or-pairs-chart__rows">
          {rows.map((row, rowIndex) => {
            const { shown, more } = shownChoices(row);
            return (
              <li key={row.id} className="or-pairs-chart__row" data-or-option={row.id}>
                <span className="or-pairs-chart__label" data-part={`option-${String(rowIndex)}`}>
                  <TokenWords text={row.label} />
                </span>
                <span className="or-pairs-chart__answers">
                  {shown.length === 0 ? (
                    <span className="or-pairs-chart__empty">No answers yet</span>
                  ) : (
                    shown.map((choice) => (
                      <span
                        key={choice.id}
                        className={cn('or-pairs-chart__answer', choice.correct && 'barrow--correct')}
                        data-or-pair={`${row.id}:${choice.id}`}
                        {...(choice.correct ? { 'data-or-correct': '' } : {})}
                      >
                        <span
                          className="or-swatch"
                          style={{
                            background: choice.correct
                              ? 'var(--ok)'
                              : chartColor(row.choices.indexOf(choice)),
                          }}
                          aria-hidden="true"
                        />
                        <span className="or-pairs-chart__text">{choice.label}</span>
                        <span className="or-pairs-chart__count">
                          {showCount ? choice.count : `${String(pct(choice.count, row.answered))}%`}
                        </span>
                        {choice.correct ? <CorrectTag /> : null}
                      </span>
                    ))
                  )}
                  {more > 0 ? <span className="or-pairs-chart__more">+{more} more</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="or-pairs-chart__total">
          {total} answer{total === 1 ? '' : 's'}
          {dontKnow > 0 ? `, ${String(dontKnow)} don't know` : ''}
        </p>
      </div>
    </Frame>
  );
}
