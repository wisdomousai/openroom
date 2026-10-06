import { useState } from 'react';
import type { Outline, OutlineStep } from '@openroom/schema';

import { Button } from '@openroom/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@openroom/ui/components/dialog';
import { cn } from '@openroom/ui/utils';
import { stepTitle } from './outline-edit';

export type BreakoutPick = 'prepared' | 'blank' | 'poll';

/**
 * Presenting-safe breakout picker — a pick list only. No authoring controls.
 * Editing stays in the deck.
 */
export function BreakoutPickerDialog({
  open,
  outline,
  step,
  prepared,
  onOpenChange,
  onShow,
}: {
  open: boolean;
  outline: Outline;
  step: OutlineStep | null;
  prepared: OutlineStep[];
  onOpenChange: (open: boolean) => void;
  onShow: (pick: BreakoutPick, preparedId?: string) => void;
}) {
  const [pick, setPick] = useState<BreakoutPick>(prepared[0] === undefined ? 'blank' : 'prepared');
  const [preparedId, setPreparedId] = useState<string | undefined>(prepared[0]?.id);

  const slideLabel = step === null ? 'this slide' : stepTitle(outline, step);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="breakout-picker-copy"
        className="flex max-h-[calc(100svh-3rem)] w-[min(32.5rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="px-6 pb-1.5 pt-5">
          <DialogTitle>Open a breakout</DialogTitle>
          <DialogDescription id="breakout-picker-copy">
            Only your screen changes until you show it. The class still sees {slideLabel}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain px-4 pb-2">
          {prepared.map((child) => {
            const selected = pick === 'prepared' && preparedId === child.id;
            return (
              <button
                key={child.id}
                type="button"
                onClick={() => {
                  setPick('prepared');
                  setPreparedId(child.id);
                }}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-2 py-2.5 text-left',
                  selected
                    ? 'bg-accent outline outline-1 -outline-offset-1 outline-primary'
                    : 'hover:bg-chrome',
                )}
              >
                <span className="relative block h-[35px] w-14 shrink-0 rounded-md border border-primary bg-card" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-row-title">{stepTitle(outline, child)}</span>
                  <span className="text-caption text-muted-foreground">Prepared earlier</span>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setPick('blank')}
            className={cn(
              'flex items-center gap-3 rounded-lg px-2 py-2.5 text-left',
              pick === 'blank' ? 'bg-accent outline outline-1 -outline-offset-1 outline-primary' : 'hover:bg-chrome',
            )}
          >
            <span className="grid h-[35px] w-14 shrink-0 place-items-center rounded-md border border-dashed border-input bg-background text-muted-foreground">
              ＋
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-row-title">Blank slide</span>
              <span className="text-caption text-muted-foreground">
                Write on it live — one heading, no layout choices
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setPick('poll')}
            className={cn(
              'flex items-center gap-3 rounded-lg px-2 py-2.5 text-left',
              pick === 'poll' ? 'bg-accent outline outline-1 -outline-offset-1 outline-primary' : 'hover:bg-chrome',
            )}
          >
            <span className="grid h-[35px] w-14 shrink-0 place-items-center rounded-md border border-live bg-card text-row-title text-live-tint-foreground">
              ?
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-row-title">Quick poll</span>
              <span className="text-caption text-muted-foreground">
                Ask a yes/no on the spot — same session, no new code
              </span>
            </span>
          </button>
        </div>
        <DialogFooter>
          <span className="min-w-0 text-caption text-muted-foreground">Editing stays in the deck.</span>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="live"
            onClick={() => {
              onShow(pick, preparedId);
              onOpenChange(false);
            }}
          >
            Show it now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
