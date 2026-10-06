import { useMemo } from 'react';
import { WordCloud as IsoterikWordCloud } from '@isoterik/react-word-cloud';
import type { TextInteractionView } from '@openroom/sdk';
import { chartColor } from '../colors';
import { Frame } from '../frame';
import { tallyWords } from '../helpers';
import { cn } from '../lib/utils';
import type { TextEntry } from './list';

export function WordCloudChart({
  interaction,
  entries,
  total,
  frozen,
  size = 'stage',
}: {
  interaction: TextInteractionView;
  entries: TextEntry[];
  total: number;
  frozen?: boolean;
  size?: 'stage' | 'compact';
}) {
  const opts = interaction.displayOptions ?? {};
  const visible = frozen ? [] : entries.filter((e) => !e.hidden);
  const words = useMemo(
    () =>
      tallyWords(
        visible.map((e) => e.text),
        { maxWords: opts.maxWords, minWordLength: opts.minWordLength },
      ),
    [visible, opts.maxWords, opts.minWordLength],
  );

  const cloudWords = useMemo(
    () => words.map((w) => ({ text: w.word, value: w.count })),
    [words],
  );
  /* Size relative to the top word so a handful of answers still fills the canvas. */
  const maxValue = Math.max(1, ...cloudWords.map((w) => w.value));

  const summary = frozen
    ? 'Hidden while paused.'
    : `${visible.length} response${visible.length === 1 ? '' : 's'}. Most common words: ${words
        .slice(0, 5)
        .map((w) => `${w.word} (${w.count})`)
        .join(', ')}`;

  return (
    <Frame summary={summary}>
      <div
        className={cn(
          'or-cloud-chart flex h-full min-h-0 flex-col',
          size === 'compact' && 'or-chart--compact',
        )}
        data-or-chart="word-cloud"
      >
        {frozen ? (
          <p className="text-sm text-muted-foreground">Paused</p>
        ) : cloudWords.length === 0 ? (
          <p className="text-sm text-muted-foreground">No words yet.</p>
        ) : (
          <div className={cn('min-h-0 w-full flex-1', size === 'compact' ? 'min-h-40' : 'min-h-56')}>
            <IsoterikWordCloud
              words={cloudWords}
              width={size === 'compact' ? 360 : 720}
              height={size === 'compact' ? 200 : 360}
              /* Concrete stack: the layout measures via canvas, where CSS vars don't resolve —
                 a mismatched measuring font makes words overlap once they get big. */
              font="'Helvetica Neue', Helvetica, Arial, sans-serif"
              fontSize={(word) => 18 + (Math.sqrt(word.value) / Math.sqrt(maxValue)) * 54}
              fill={(_d, i) => chartColor(i)}
              rotate={() => 0}
              padding={2}
            />
          </div>
        )}
        <p className="text-sm text-muted-foreground">{total} responses</p>
      </div>
    </Frame>
  );
}
