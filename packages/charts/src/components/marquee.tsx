import { cn } from '../lib/utils';

/** Magic UI–style infinite marquee (shadcn ecosystem pattern). */
export function Marquee({
  children,
  className,
  pauseOnHover = true,
  reverse = false,
}: {
  children: React.ReactNode;
  className?: string;
  pauseOnHover?: boolean;
  reverse?: boolean;
}) {
  return (
    <div
      className={cn(
        'group flex overflow-hidden p-2 [--gap:1rem] [gap:var(--gap)]',
        className,
      )}
    >
      <div
        className={cn(
          'flex shrink-0 justify-around [gap:var(--gap)] animate-or-marquee',
          pauseOnHover && 'group-hover:[animation-play-state:paused]',
          reverse && '[animation-direction:reverse]',
        )}
      >
        {children}
      </div>
      <div
        className={cn(
          'flex shrink-0 justify-around [gap:var(--gap)] animate-or-marquee',
          pauseOnHover && 'group-hover:[animation-play-state:paused]',
          reverse && '[animation-direction:reverse]',
        )}
        aria-hidden="true"
      >
        {children}
      </div>
    </div>
  );
}
