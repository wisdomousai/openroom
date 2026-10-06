import { cn } from '@openroom/ui/utils';

interface Props {
  /** Folder rows show a count instead of a wireframe. */
  folderCount?: number;
  /** Interactive decks get the live-orange edge. */
  asksTheClass?: boolean;
  className?: string;
}

/** 60×38 file thumbnail. A wireframe, not a screenshot. */
export function DeckThumb({ folderCount, asksTheClass = false, className }: Props) {
  if (folderCount !== undefined) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'grid h-[38px] w-[60px] shrink-0 place-items-center rounded-md border border-border bg-card text-caption text-muted-foreground',
          className,
        )}
      >
        {folderCount}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative block h-[38px] w-[60px] shrink-0 rounded-md border bg-card',
        asksTheClass ? 'border-live' : 'border-border',
        className,
      )}
    >
      {asksTheClass ? (
        <>
          <span className="absolute left-[8%] top-[16%] h-[11%] w-[60%] bg-muted-foreground" />
          <span className="absolute left-[8%] top-[38%] h-[12%] w-[74%] bg-live-tint" />
          <span className="absolute left-[8%] top-[56%] h-[12%] w-[52%] bg-live-tint" />
        </>
      ) : (
        <>
          <span className="absolute left-[10%] top-[36%] h-[12%] w-[64%] bg-muted-foreground" />
          <span className="absolute left-[24%] top-[58%] h-[6%] w-[40%] bg-input" />
        </>
      )}
    </span>
  );
}

/** 16:10 preview used in the detail pane. */
export function DeckPreview({ asksTheClass = false, className }: { asksTheClass?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative block w-full rounded-[var(--radius-lg)] border border-border bg-card',
        'aspect-[16/10]',
        className,
      )}
    >
      {asksTheClass ? (
        <>
          <span className="absolute left-[8%] top-[16%] h-[9%] w-[56%] bg-muted-foreground" />
          <span className="absolute left-[8%] top-[38%] h-[12%] w-[70%] bg-live-tint" />
          <span className="absolute left-[8%] top-[56%] h-[12%] w-[48%] bg-live-tint" />
        </>
      ) : (
        <>
          <span className="absolute left-[10%] top-[38%] h-[9%] w-[62%] bg-muted-foreground" />
          <span className="absolute left-[24%] top-[56%] h-[4%] w-[38%] bg-input" />
        </>
      )}
    </span>
  );
}
