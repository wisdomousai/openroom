import type { OutlineLayout } from '@openroom/schema';

/**
 * A layout is a *typed arrangement of regions*, so the picker shows the
 * arrangement rather than a word for it. Each thumbnail is a handful of
 * absolutely positioned cells in percentages — 1px `--border` strokes and solid
 * token fills, no shadow, no gradient, no image. The stage still owns the
 * pixels; this is only enough of a wireframe to recognise the shape.
 */

type Fill = 'line' | 'ink' | 'accent';

interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: Fill;
}

const LAYOUT_CELLS: Record<OutlineLayout, Cell[]> = {
  title: [
    { x: 10, y: 34, w: 80, h: 16, fill: 'ink' },
    { x: 24, y: 58, w: 52, h: 7, fill: 'line' },
  ],
  text: [
    { x: 8, y: 12, w: 56, h: 12, fill: 'ink' },
    { x: 8, y: 34, w: 84, h: 7, fill: 'line' },
    { x: 8, y: 48, w: 84, h: 7, fill: 'line' },
    { x: 8, y: 62, w: 60, h: 7, fill: 'line' },
  ],
  split: [
    { x: 8, y: 12, w: 38, h: 12, fill: 'ink' },
    { x: 8, y: 32, w: 38, h: 7, fill: 'line' },
    { x: 8, y: 45, w: 30, h: 7, fill: 'line' },
    { x: 54, y: 12, w: 38, h: 66, fill: 'line' },
  ],
  grid: [
    { x: 8, y: 10, w: 48, h: 10, fill: 'ink' },
    { x: 8, y: 28, w: 40, h: 24, fill: 'line' },
    { x: 52, y: 28, w: 40, h: 24, fill: 'line' },
    { x: 8, y: 58, w: 40, h: 24, fill: 'line' },
    { x: 52, y: 58, w: 40, h: 24, fill: 'line' },
  ],
  media: [
    { x: 8, y: 10, w: 84, h: 56, fill: 'ink' },
    { x: 8, y: 74, w: 52, h: 7, fill: 'line' },
  ],
  poll: [
    { x: 8, y: 10, w: 62, h: 10, fill: 'ink' },
    { x: 8, y: 30, w: 74, h: 11, fill: 'accent' },
    { x: 8, y: 47, w: 46, h: 11, fill: 'accent' },
    { x: 8, y: 64, w: 28, h: 11, fill: 'accent' },
  ],
  activity: [
    { x: 8, y: 10, w: 50, h: 10, fill: 'ink' },
    { x: 8, y: 28, w: 52, h: 7, fill: 'line' },
    { x: 8, y: 41, w: 52, h: 7, fill: 'line' },
    { x: 8, y: 54, w: 44, h: 7, fill: 'line' },
    { x: 66, y: 28, w: 26, h: 33, fill: 'line' },
  ],
  timer: [
    { x: 30, y: 20, w: 40, h: 40, fill: 'ink' },
    { x: 28, y: 70, w: 44, h: 7, fill: 'line' },
  ],
  join: [
    { x: 28, y: 14, w: 44, h: 56, fill: 'ink' },
    { x: 32, y: 78, w: 36, h: 7, fill: 'line' },
  ],
  blank: [
    { x: 8, y: 10, w: 40, h: 10, fill: 'line' },
    { x: 56, y: 34, w: 32, h: 40, fill: 'line' },
  ],
};

/** Plain-language names, so the picker is never a row of unlabelled pictures. */
export const LAYOUT_WORDS: Record<OutlineLayout, string> = {
  title: 'Title',
  /** Stacked: heading above the body / picture. On media steps this is the portrait-friendly layout. */
  text: 'Stacked',
  split: 'Split',
  grid: 'Grid',
  media: 'Full frame',
  poll: 'Poll',
  activity: 'Activity',
  timer: 'Timer',
  join: 'Join',
  blank: 'Empty',
};

const FILL_CLASS: Record<Fill, string> = {
  line: 'border border-border',
  ink: 'bg-muted-foreground',
  accent: 'bg-primary',
};

export function LayoutThumb({ layout, className }: { layout: OutlineLayout; className?: string }) {
  return (
    <span aria-hidden="true" className={`relative block h-14 w-full rounded-md bg-background ${className ?? ''}`}>
      {LAYOUT_CELLS[layout].map((cell, index) => (
        <span
          key={index}
          className={`absolute rounded-[var(--radius)] ${FILL_CLASS[cell.fill ?? 'line']}`}
          style={{
            left: `${String(cell.x)}%`,
            top: `${String(cell.y)}%`,
            width: `${String(cell.w)}%`,
            height: `${String(cell.h)}%`,
          }}
        />
      ))}
    </span>
  );
}

/**
 * The same wireframe for a *composition* preset, drawn straight from the boxes
 * the preset writes. There is no stored layout to name here — the picture is
 * the arrangement the elements are about to take.
 */
export function ElementLayoutThumb({
  slots,
  className,
}: {
  slots: { heading?: Cell; body?: Cell; media?: Cell };
  className?: string;
}) {
  const cells: Cell[] = [
    ...(slots.media === undefined ? [] : [{ ...slots.media, fill: 'line' as Fill }]),
    ...(slots.heading === undefined ? [] : [{ ...slots.heading, fill: 'ink' as Fill }]),
    ...(slots.body === undefined ? [] : [{ ...slots.body, fill: 'line' as Fill }]),
  ];
  return (
    <span aria-hidden="true" className={`relative block h-14 w-full rounded-md bg-background ${className ?? ''}`}>
      {cells.map((cell, index) => (
        <span
          key={index}
          className={`absolute rounded-[var(--radius)] ${FILL_CLASS[cell.fill ?? 'line']}`}
          style={{
            left: `${String(cell.x)}%`,
            top: `${String(cell.y)}%`,
            width: `${String(cell.w)}%`,
            height: `${String(cell.h)}%`,
          }}
        />
      ))}
    </span>
  );
}
