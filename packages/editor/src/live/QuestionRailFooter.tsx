import type { ReactNode } from 'react';
import { Button } from '@openroom/ui/components/button';
import { cn } from '@openroom/ui/utils';

export interface FooterDot {
  id: string;
  label: string;
  /** Already visited (behind the current slide). */
  visited?: boolean;
}

/**
 * The single control bar of a host surface. Back / circle dots / Next sit
 * left; live status and the orange primary sit on the right.
 */
export function QuestionRailFooter({
  items,
  activeId,
  selectedId,
  selectedIndex,
  onPrev,
  onNext,
  canPrev,
  canNext,
  onSelect,
  status,
  actions,
  className,
  contentClassName,
}: {
  items: FooterDot[];
  activeId: string | null;
  selectedId: string | null;
  selectedIndex: number;
  onPrev: () => void;
  onNext: () => void;
  canPrev?: boolean;
  canNext?: boolean;
  onSelect: (id: string) => void;
  /** `Slide 3 of 6 · question open · 42s left` — live status only. */
  status?: ReactNode;
  /** Live controls, rendered right-aligned; primary flow action goes last. */
  actions?: ReactNode;
  className?: string;
  /** Inner row width/gutters — keep aligned with LiveHost header. */
  contentClassName?: string;
}) {
  if (items.length === 0 && !actions && !status) return null;

  return (
    <footer className={cn('h-[52px] shrink-0 border-t border-border bg-chrome', className)}>
      <div
        className={cn(
          'flex h-full w-full items-center gap-4 px-5',
          contentClassName,
        )}
      >
        {items.length > 0 ? (
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={onPrev} disabled={canPrev === undefined ? selectedIndex <= 0 : !canPrev}>
              ← Back
            </Button>
            <div className="flex max-w-80 items-center overflow-x-auto px-1 py-1" role="tablist" aria-label="Slides">
              {items.map((item, index) => {
                const current = item.id === selectedId || item.id === activeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={item.id === selectedId}
                    tabIndex={item.id === selectedId ? 0 : -1}
                    aria-label={`Slide ${index + 1}: ${item.label}`}
                    title={item.label}
                    onClick={() => onSelect(item.id)}
                    onKeyDown={(event) => {
                      const next = event.key === 'ArrowRight' ? (index + 1) % items.length
                        : event.key === 'ArrowLeft' ? (index - 1 + items.length) % items.length
                        : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
                      if (next === null) return;
                      event.preventDefault();
                      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
                      onSelect(items[next]!.id);
                    }}
                    className="flex size-6 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  ><span aria-hidden="true" className={cn(
                      'rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      current
                        ? 'size-[11px] bg-live'
                        : item.visited
                          ? 'size-[9px] bg-[color-mix(in_oklab,var(--muted-foreground)_55%,var(--input))]'
                          : 'size-[9px] bg-input hover:bg-muted-foreground',
                    )} /></button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onNext}
              disabled={canNext === undefined ? selectedIndex >= items.length - 1 : !canNext}
            >
              Next →
            </Button>
          </div>
        ) : (
          <span aria-hidden="true" />
        )}
        {status ? <span className="text-caption text-muted-foreground">{status}</span> : null}
        <span className="flex-1" />
        {actions ? <div className="flex flex-none flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </footer>
  );
}
