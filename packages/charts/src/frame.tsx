import type { ReactNode } from 'react';
import { cn } from './lib/utils';

/** Accessible figcaption from the raw aggregate (STAGE-06). */
export function Frame({
  summary,
  children,
  className,
}: {
  summary: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn('or-chart-viz flex h-full min-h-0 w-full flex-col', className)}>
      <div className="or-chart-viz__body min-h-0 flex-1">{children}</div>
      <figcaption className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {summary}
      </figcaption>
    </figure>
  );
}

export function CorrectTag() {
  return (
    <span className="tag-correct">
      <span aria-hidden="true">✓ </span>correct
    </span>
  );
}
