import { useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@openroom/ui/utils';

/**
 * The tutor's saved "Next session" note, as a strip above the work: two lines
 * at most, the rest one click away. A long note no longer pushes the ribbon and
 * the slide (or the deck list) down the screen. The live console and the deck
 * editor both show it; Hide is the caller's to remember.
 */
export function NextSessionBanner({
  note,
  onHide,
  className,
}: {
  note: string;
  onHide: () => void;
  className?: string;
}) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    const element = textRef.current;
    if (element === null || expanded) return;
    const measure = () => setClamped(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [note, expanded]);

  return (
    <div
      className={cn(
        'flex shrink-0 items-start justify-between gap-3 border-b border-hairline bg-card px-4 py-2',
        className,
      )}
    >
      <p
        ref={textRef}
        className={cn(
          'min-w-0 flex-1 whitespace-pre-line text-secondary',
          expanded ? 'max-h-[40svh] overflow-y-auto' : 'line-clamp-2',
        )}
      >
        <span className="text-caption text-muted-foreground">Next session · </span>
        {note}
      </p>
      <div className="flex shrink-0 items-center gap-3">
        {clamped || expanded ? (
          <button
            type="button"
            aria-expanded={expanded}
            className="text-caption text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Show less' : 'Show all'}
          </button>
        ) : null}
        <button
          type="button"
          className="text-caption text-muted-foreground hover:text-foreground"
          onClick={onHide}
        >
          Hide
        </button>
      </div>
    </div>
  );
}
