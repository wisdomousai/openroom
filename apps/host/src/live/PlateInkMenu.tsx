import type { ReactNode } from 'react';
import { Check, Languages } from 'lucide-react';
import {
  INK_COLORS,
  MARK_SHAPES,
  MARK_SHAPE_LABELS,
  type InkColor,
  type MarkShape,
} from '@openroom/sdk';

import { cn } from '../lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../components/ui/context-menu';

const INK_SWATCH: Record<InkColor, string> = {
  red: 'bg-destructive',
  yellow: 'bg-chart-3',
  green: 'bg-chart-2',
};

/**
 * The ink tools where the drawing happens: right-click the plate to switch tool
 * or colour without travelling back to the ribbon, and — when the click landed
 * on a word — to mark or look that word up straight away, without changing
 * which tool is active. It sets the same state the INK strip shows, and only
 * claims the context menu while the tools are actually available.
 */
export function PlateInkMenu({
  active,
  tool,
  onTool,
  color,
  onColor,
  onClear,
  target,
  onShape,
  onLookUp,
  children,
}: {
  active: boolean;
  tool: 'none' | MarkShape | 'pen';
  onTool: (tool: 'none' | MarkShape | 'pen') => void;
  color: InkColor;
  onColor: (color: InkColor) => void;
  onClear: () => void;
  /** The word the right-click landed on, if it landed on one. */
  target: { partKey: string; token: number; word: string; endToken?: number } | null;
  onShape: (shape: MarkShape, target: { partKey: string; token: number; endToken?: number }) => void;
  onLookUp: (target: { partKey: string; token: number; word: string }) => void;
  children: ReactNode;
}) {
  if (!active) return children;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="h-full w-full min-h-0 min-w-0">{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[11rem]">
        {target !== null ? (
          <>
            <ContextMenuLabel>“{target.word}”</ContextMenuLabel>
            {MARK_SHAPES.map((shape) => (
              <ContextMenuItem key={`on-${shape}`} onSelect={() => onShape(shape, target)}>
                <span
                  aria-hidden="true"
                  className={cn('size-3 rounded-[2px] border border-border', INK_SWATCH[color])}
                />
                {MARK_SHAPE_LABELS[shape]}
              </ContextMenuItem>
            ))}
            <ContextMenuItem onSelect={() => onLookUp(target)}>
              <Languages aria-hidden="true" />
              Look up
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}
        <ContextMenuLabel>Tool</ContextMenuLabel>
        {([...MARK_SHAPES, 'pen'] as const).map((option) => (
          <ContextMenuItem
            key={option}
            onSelect={() => onTool(tool === option ? 'none' : option)}
          >
            {tool === option ? <Check aria-hidden="true" /> : <span className="size-4" />}
            {option === 'pen' ? 'Pen' : MARK_SHAPE_LABELS[option]}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuLabel>Colour</ContextMenuLabel>
        {INK_COLORS.map((option) => (
          <ContextMenuItem key={option} onSelect={() => onColor(option)}>
            {color === option ? <Check aria-hidden="true" /> : <span className="size-4" />}
            <span
              aria-hidden="true"
              className={cn('size-3 rounded-[2px] border border-border', INK_SWATCH[option])}
            />
            {option}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onClear}>
          <span className="size-4" />
          Clear ink
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
