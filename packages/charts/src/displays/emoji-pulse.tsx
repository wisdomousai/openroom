import { useMemo } from 'react';
import type { ChoiceInteractionView } from '@openroom/sdk';
import { chartColor } from '../colors';
import { Frame } from '../frame';
import { pct, sortedChoiceOptions, splitEmoji } from '../helpers';
import { cn } from '../lib/utils';
import { Marquee } from '../components/marquee';
import { choiceSummary } from './bars';

/**
 * emoji-pulse via Magic UI-style marquee: emoji repeated by vote weight.
 */
export function ChoiceEmojiPulseChart({
  interaction,
  counts,
  total,
  dontKnow,
  revealed,
  reduced,
  size = 'stage',
}: {
  interaction: ChoiceInteractionView;
  counts: Record<string, number>;
  total: number;
  dontKnow: number;
  revealed: boolean;
  reduced?: boolean;
  size?: 'stage' | 'compact';
}) {
  const items = useMemo(() => {
    const rows = sortedChoiceOptions({ interaction, counts });
    const out: { key: string; emoji: string; color: string; label: string; correct: boolean }[] = [];
    for (const o of rows) {
      const emoji = splitEmoji(o.label);
      const weight = Math.max(1, Math.min(12, o.count || (total === 0 ? 1 : 0)));
      const correct = revealed && o.correct === true;
      const color = correct ? 'var(--ok)' : chartColor(o.index);
      for (let i = 0; i < weight; i++) {
        out.push({
          key: `${o.id}-${i}`,
          emoji,
          color,
          label: `${o.label} ${pct(o.count, total)}%`,
          correct,
        });
      }
    }
    return out;
  }, [interaction, counts, total, revealed]);

  return (
    <Frame summary={choiceSummary({ interaction, counts, total, dontKnow, revealed })}>
      <div
        className={cn('or-emoji-chart', size === 'compact' && 'or-chart--compact')}
        data-or-chart="emoji-pulse"
      >
        <Marquee pauseOnHover={!reduced} className="[--duration:28s]">
          {items.map((item) => (
            <span
              key={item.key}
              className={cn(
                'or-emoji-item mx-2 inline-flex size-12 items-center justify-center text-3xl',
                item.correct && 'outline outline-2 outline-[var(--ok)]',
              )}
              style={{ color: item.color }}
              title={item.label}
              data-or-option={item.key.split('-')[0]}
              {...(item.correct ? { 'data-or-correct': '' } : {})}
            >
              {item.emoji}
            </span>
          ))}
        </Marquee>
        <ul className="or-chart-legend or-chart-legend--wrap mt-3">
          {sortedChoiceOptions({ interaction, counts }).map((o) => {
            const correct = revealed && o.correct === true;
            return (
              <li
                key={o.id}
                className={cn('barrow', correct && 'barrow--correct')}
                data-or-option={o.id}
                {...(correct ? { 'data-or-correct': '' } : {})}
              >
                <span className="barrow__label">
                  {splitEmoji(o.label)} {o.label} {pct(o.count, total)}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Frame>
  );
}
