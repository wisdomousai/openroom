import { normalizeTextAnswer, textAnswerMatches } from '@openroom/schema';
import type { FillTheGapsInteractionView } from '@openroom/sdk';
import { CorrectTag, Frame } from '../frame';
import { TokenWords } from '../tokens';
import { chartColor } from '../colors';
import { cn } from '../lib/utils';

export interface GapEntry {
  participantId: string;
  gaps: Record<string, string>;
  hidden: boolean;
  handle?: string;
}

interface AnswerRow {
  /** The first spelling submitted for this normalized answer — what the audience reads. */
  label: string;
  count: number;
  correct: boolean;
}

interface GapRow {
  id: string;
  index: number;
  answers: AnswerRow[];
  answered: number;
}

/**
 * One tally per gap.
 *
 * Answers are grouped by `normalizeTextAnswer` under the interaction's own match
 * policy, so "Ai" and "ai" are one bar in a case-insensitive question and two in
 * a strict one — the same rule that decides whether they are correct.
 */
function gapRows(
  interaction: FillTheGapsInteractionView,
  entries: GapEntry[],
  revealed: boolean,
): GapRow[] {
  return interaction.gaps.map((gap, index) => {
    const groups = new Map<string, AnswerRow>();
    let answered = 0;
    for (const entry of entries) {
      const raw = (entry.gaps[gap.id] ?? '').trim();
      if (raw === '') continue;
      answered += 1;
      const key = normalizeTextAnswer(raw, interaction.match);
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      groups.set(key, {
        label: raw,
        count: 1,
        correct: revealed && textAnswerMatches(raw, gap.answers, interaction.match),
      });
    }
    return {
      id: gap.id,
      index,
      answers: [...groups.values()].sort((a, b) => b.count - a.count),
      answered,
    };
  });
}

function gapsSummary(rows: GapRow[], total: number, revealed: boolean): string {
  const parts = rows.map((row) => {
    const top = row.answers[0];
    const said = top ? `${top.label} ×${String(top.count)}` : 'no answers yet';
    return `gap ${String(row.index + 1)}: ${said}${revealed && top?.correct ? ' (correct)' : ''}`;
  });
  return `${String(total)} answer${total === 1 ? '' : 's'}. ${parts.join('; ')}`;
}

/** FillTheGaps results: what the audience wrote in each blank. */
export function GapsChart({
  interaction,
  entries,
  total,
  dontKnow,
  revealed,
  frozen,
  size = 'stage',
}: {
  interaction: FillTheGapsInteractionView;
  entries: GapEntry[];
  total: number;
  dontKnow: number;
  revealed: boolean;
  frozen?: boolean;
  size?: 'stage' | 'compact';
}) {
  const compact = size === 'compact';
  const maxItems = interaction.displayOptions?.maxItems ?? (compact ? 8 : 12);
  const visible = frozen ? [] : entries.filter((entry) => !entry.hidden);
  const rows = gapRows(interaction, visible, revealed);

  return (
    <Frame
      summary={
        frozen
          ? 'Hidden while paused.'
          : gapsSummary(rows, total, revealed)
      }
    >
      <div
        className={cn(
          'or-gaps-chart flex max-h-full flex-col gap-3 overflow-y-auto',
          compact && 'or-chart--compact',
        )}
        data-or-chart="gaps"
      >
        {frozen ? (
          <p className="text-sm text-muted-foreground">Paused</p>
        ) : (
          rows.map((row) => (
            <section key={row.id} className="flex flex-col gap-1.5" data-or-gap={row.id}>
              <p className="or-gaps-chart__label m-0 text-sm font-bold text-muted-foreground">
                Gap {row.index + 1}
              </p>
              {row.answers.length === 0 ? (
                <p className="m-0 text-sm text-muted-foreground">No answers yet.</p>
              ) : (
                <ul className="or-chart-legend or-chart-legend--wrap m-0 list-none p-0">
                  {row.answers.slice(0, maxItems).map((answer, index) => (
                    <li
                      key={answer.label}
                      className={cn('barrow', answer.correct && 'barrow--correct')}
                      data-or-option={answer.label}
                      {...(answer.correct ? { 'data-or-correct': '' } : {})}
                    >
                      <span
                        className="or-swatch"
                        style={{
                          background: answer.correct ? 'var(--ok)' : chartColor(index),
                        }}
                        aria-hidden="true"
                      />
                      <span className="barrow__label" data-part={`gap-${String(row.index)}`}>
                        <TokenWords text={answer.label} />
                      </span>
                      <span className="or-gaps-chart__count font-bold tabular-nums">
                        {answer.count}
                      </span>
                      {answer.correct ? <CorrectTag /> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))
        )}
        <p className="m-0 text-sm text-muted-foreground">
          {total} answer{total === 1 ? '' : 's'}
          {dontKnow > 0 ? `, ${String(dontKnow)} don't know` : ''}
        </p>
      </div>
    </Frame>
  );
}
