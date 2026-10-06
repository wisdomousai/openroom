import { useEffect } from 'react';
import { DISPLAY_LABELS, displaysFor } from './builder/displays';
import { cn } from '@openroom/ui/utils';
import type { InteractionType } from './types';

const MENU_LABELS: Record<string, string> = {
  ...DISPLAY_LABELS,
  number: 'Big number only',
  tally: 'Tally marks',
  'word-cloud': 'Word cloud',
  wordcloud: 'Word cloud',
};

const HONEST: Record<InteractionType, string> = {
  choice: 'Needs open text.',
  text: 'Needs a set of choices.',
  scale: 'Needs a scale question.',
  numeric: 'Needs a number question.',
  ranking: 'Needs a ranking question.',
  qna: 'Needs a Q&A list.',
  'fill-the-gaps': 'Needs a fill-the-gaps question.',
  match: 'Needs a matching question.',
};

export function displayMenuLabel(display: string): string {
  return MENU_LABELS[display] ?? display;
}

export function honestDisplayLine(type: InteractionType): string {
  return HONEST[type];
}

function Glyph({ display }: { display: string }) {
  if (display === 'pie' || display === 'donut') {
    return (
      <span
        aria-hidden="true"
        className="block size-4 shrink-0 rounded-full bg-primary"
        style={{ borderRight: '8px solid var(--chart-2)' }}
      />
    );
  }
  if (display === 'number') {
    return (
      <span aria-hidden="true" className="grid h-4 w-[22px] shrink-0 place-items-center text-caption font-semibold">
        61
      </span>
    );
  }
  if (display === 'tally') {
    return (
      <span aria-hidden="true" className="flex h-4 w-[22px] shrink-0 items-end gap-0.5">
        <span className="size-1.5 rounded-full bg-chart-3" />
        <span className="size-1.5 rounded-full bg-chart-3" />
        <span className="size-1.5 rounded-full bg-chart-3" />
      </span>
    );
  }
  if (display === 'word-cloud' || display === 'wordcloud') {
    return (
      <span aria-hidden="true" className="flex h-4 w-[22px] shrink-0 items-end justify-center gap-px">
        <span className="h-2 w-1 bg-foreground" />
        <span className="h-3.5 w-1 bg-foreground" />
        <span className="h-2.5 w-1 bg-foreground" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="flex h-4 w-[22px] shrink-0 flex-col justify-center gap-0.5">
      <span className="h-[3px] w-full rounded-sm bg-primary" />
      <span className="h-[3px] w-2/3 rounded-sm bg-primary" />
      <span className="h-[3px] w-1/3 rounded-sm bg-primary" />
    </span>
  );
}

export function ChartMenu({
  type,
  current,
  correctShown,
  showPercent,
  hasCorrect,
  x,
  y,
  onPick,
  onCallOut,
  onTogglePercent,
  onClose,
}: {
  type: InteractionType;
  current: string | undefined;
  correctShown: boolean;
  showPercent: boolean;
  hasCorrect: boolean;
  x: number;
  y: number;
  onPick: (display: string) => void;
  onCallOut: () => void;
  onTogglePercent: () => void;
  onClose: () => void;
}) {
  const options = displaysFor(type);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const viewW = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const viewH = typeof window === 'undefined' ? 900 : window.innerHeight;
  const left = Math.min(x, viewW - 280);
  const top = Math.min(y, viewH - 360);

  return (
    <div className="fixed inset-0 z-40 bg-foreground/10" onClick={onClose} role="presentation">
      <div
        role="menu"
        aria-label="Chart type"
        onClick={(event) => event.stopPropagation()}
        className="absolute max-h-[min(24rem,calc(100svh-2rem))] w-[266px] overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border border-border bg-card py-1.5 shadow-[var(--shadow-overlay)]"
        style={{ left, top }}
      >
        <p className="px-3.5 pb-2 pt-1.5 text-caption text-muted-foreground">Chart type</p>
        {options.map((display) => {
          const selected = display === current;
          return (
            <button
              key={display}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              onClick={() => onPick(display)}
              className={cn(
                'flex w-full items-center gap-3 px-3.5 py-2 text-left text-secondary',
                selected
                  ? 'bg-accent font-semibold text-accent-foreground'
                  : 'text-foreground hover:bg-chrome',
              )}
            >
              <Glyph display={display} />
              {displayMenuLabel(display)}
              <span className="flex-1" />
              {selected ? <span aria-hidden="true">✓</span> : null}
            </button>
          );
        })}
        {hasCorrect || options.some((d) => (OPTION_KEYS[d] ?? []).includes('showPercent')) ? (
          <span aria-hidden="true" className="my-1.5 block h-px bg-hairline" />
        ) : null}
        {hasCorrect ? (
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={correctShown}
            onClick={onCallOut}
            className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-secondary text-foreground hover:bg-chrome"
          >
            <span aria-hidden="true" className="w-[22px] text-center text-chart-2">
              ✓
            </span>
            Call out the correct answer
          </button>
        ) : null}
        {options.some((d) => (OPTION_KEYS[d] ?? []).includes('showPercent')) ? (
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={showPercent}
            onClick={onTogglePercent}
            className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-secondary text-foreground hover:bg-chrome"
          >
            <span aria-hidden="true" className="w-[22px] text-center text-muted-foreground">
              %
            </span>
            Show percentages
          </button>
        ) : null}
        <span aria-hidden="true" className="my-1.5 block h-px bg-hairline" />
        <p className="px-3.5 pb-1.5 pt-0.5 text-caption text-muted-foreground">{honestDisplayLine(type)}</p>
      </div>
    </div>
  );
}

const OPTION_KEYS: Record<string, readonly string[]> = {
  bars: ['showPercent'],
  columns: ['showPercent'],
  donut: ['showPercent'],
  pie: ['showPercent'],
  radial: ['showPercent'],
  'emoji-pulse': ['showPercent'],
  tally: ['showPercent'],
  emoji: ['showPercent'],
  'ordered-bars': ['showPercent'],
  rank: ['showPercent'],
};
