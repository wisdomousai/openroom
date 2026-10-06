import { textAnswerMatches } from '@openroom/schema';
import type { TextInteractionView } from '@openroom/sdk';
import { CorrectTag, Frame } from '../frame';
import { chartColor } from '../colors';
import { cn } from '../lib/utils';

export interface TextEntry {
  participantId: string;
  text: string;
  hidden: boolean;
  votes?: number;
  handle?: string;
}

function textMatchesCorrect(
  text: string,
  interaction: TextInteractionView | { type: 'qna' },
  revealed: boolean,
): boolean {
  if (!revealed || interaction.type !== 'text') return false;
  return textAnswerMatches(text, interaction.correctAnswers, interaction.match);
}

/** Text / QnA list via shadcn-style Card composition. */
export function TextListChart({
  interaction,
  entries,
  total,
  isQna,
  revealed,
  frozen,
  size = 'stage',
}: {
  interaction: TextInteractionView | { type: 'qna'; displayOptions?: { maxItems?: number } };
  entries: TextEntry[];
  total: number;
  isQna: boolean;
  revealed: boolean;
  frozen?: boolean;
  size?: 'stage' | 'compact';
}) {
  const maxItems = interaction.displayOptions?.maxItems ?? (size === 'compact' ? 8 : 24);
  const visible = frozen ? [] : entries.filter((e) => !e.hidden).slice(0, maxItems);

  const summary = frozen
    ? 'Hidden while paused.'
    : `${visible.length} ${isQna ? 'question' : 'response'}${visible.length === 1 ? '' : 's'}` +
      (visible[0] ? `. Most recent: ${visible[0].text}` : '');

  return (
    <Frame summary={summary}>
      <div
        className={cn(
          'or-list-chart flex max-h-full flex-col gap-2 overflow-y-auto',
          size === 'compact' && 'or-chart--compact',
        )}
        data-or-chart="list"
      >
        {frozen ? (
          <p className="text-sm text-muted-foreground">Paused</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No responses yet.</p>
        ) : (
          visible.map((e, i) => {
            const correct = textMatchesCorrect(e.text, interaction, revealed);
            return (
              <article
                key={`${e.participantId}-${i}`}
                className="card flex flex-col gap-1 rounded-[var(--radius)] p-3"
                style={{ '--card-tone': correct ? 'var(--ok)' : chartColor(i) } as React.CSSProperties}
                data-or-option={e.participantId}
                {...(correct ? { 'data-or-correct': '' } : {})}
              >
                <p className="card__text m-0 leading-snug">{e.text}</p>
                <div className="flex items-center gap-2 text-[0.8em] text-muted-foreground">
                  {e.handle ? <span>{e.handle}</span> : null}
                  {typeof e.votes === 'number' ? (
                    <span className="rounded-[var(--radius)] border border-border px-1.5 py-0.5 font-bold tabular-nums">
                      {e.votes}
                    </span>
                  ) : null}
                  {correct ? <CorrectTag /> : null}
                </div>
              </article>
            );
          })
        )}
        <p className="text-sm text-muted-foreground">
          {total} {isQna ? 'question' : 'response'}
          {total === 1 ? '' : 's'}
        </p>
      </div>
    </Frame>
  );
}
