import type { OutlineStep } from '@openroom/schema';

import { Button } from '@openroom/ui/components/button';
import { cn } from '@openroom/ui/utils';
import { mergeNext, movePart, splitPart } from '../reveal-order';
import { partLabel } from '../outline-edit';
import type { PropertiesPanelProps } from './shared';

export function RevealControls({
  step,
  groups,
  onReveal,
  onSelectPart,
}: PropertiesPanelProps & { step: OutlineStep }) {
  const together = step.reveal === 'together' || step.reveal === undefined;
  return (
    <>
      <div className="flex rounded-lg bg-chrome p-0.5">
        {(
          [
            { id: 'together', label: 'All at once' },
            { id: 'sequence', label: 'One at a time' },
          ] as const
        ).map((mode) => (
          <button
            key={mode.id}
            type="button"
            aria-pressed={mode.id === (together ? 'together' : 'sequence')}
            onClick={() =>
              onReveal(
                mode.id === 'together'
                  ? [groups.flat()]
                  : groups.flat().map((key) => [key]),
              )
            }
            className={cn(
              'flex-1 inline-flex h-7 items-center justify-center rounded-[3px] text-secondary',
              mode.id === (together ? 'together' : 'sequence')
                ? 'bg-card font-semibold'
                : 'text-muted-foreground',
            )}
          >
            {mode.label}
          </button>
        ))}
      </div>
      {together ? (
        <p className="text-caption text-muted-foreground">
          Select one at a time to set an order.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {groups.map((group, index) => (
            <li key={index} className="flex flex-col gap-1.5 rounded-md border border-border p-2">
              <div className="flex items-center gap-2">
                <span className="text-caption text-muted-foreground tabular-nums">Step {index + 1}</span>
                {index + 1 < groups.length ? (
                  <Button type="button" size="sm" variant="subtle" onClick={() => onReveal(mergeNext(groups, index))}>
                    merge next
                  </Button>
                ) : null}
              </div>
              {group.map((key) => (
                <div key={key} className="flex items-center gap-1">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-secondary font-semibold hover:underline"
                    onClick={() => onSelectPart(key)}
                  >
                    {partLabel(step, key)}
                  </button>
                  {group.length > 1 ? (
                    <Button type="button" size="sm" variant="subtle" onClick={() => onReveal(splitPart(groups, key))}>
                      ⇥
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" variant="subtle" onClick={() => onReveal(movePart(groups, key, -1))}>
                    ▲
                  </Button>
                  <Button type="button" size="sm" variant="subtle" onClick={() => onReveal(movePart(groups, key, 1))}>
                    ▼
                  </Button>
                </div>
              ))}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
