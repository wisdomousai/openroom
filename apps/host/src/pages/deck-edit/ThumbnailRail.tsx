import type { Outline, OutlineAside, OutlineStep } from '@openroom/schema';
import { useState } from 'react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import { cn } from '../../lib/utils';
import { LayoutThumb } from './LayoutThumb';
import { SlideThumbnail } from './SlideThumbnail';
import {
  INSERT_CATALOG,
  INSERT_TOP,
  STEP_KIND_WORDS,
  asideMeta,
  asksTheClass,
  orderedBlocks,
  stepMinutes,
  stepTitle,
  type InsertKind,
  type InsertOptions,
} from './outline-edit';

export type RailSelection =
  | { kind: 'step'; id: string }
  | { kind: 'homework' }
  | { kind: 'recap' };

function CatalogSubmenu({ onPick }: { onPick: (kind: InsertKind) => void }) {
  return (
    <>
      {INSERT_CATALOG.map((group, groupIndex) => (
        <div key={group.group}>
          {groupIndex > 0 ? <ContextMenuSeparator /> : null}
          <ContextMenuLabel>{group.group}</ContextMenuLabel>
          {group.items.map((item) => (
            <ContextMenuItem key={item.kind} onSelect={() => onPick(item.kind)}>
              {item.label}
            </ContextMenuItem>
          ))}
        </div>
      ))}
    </>
  );
}

/** Shared by the thumbnail rail and the slide canvas. */
export function BlockInsertMenu({
  isBreakout,
  canDelete,
  onInsert,
  onDuplicate,
  onDelete,
  lookUpWord = null,
  onLookUp,
}: {
  isBreakout: boolean;
  canDelete: boolean;
  onInsert: (kind: InsertKind, options?: InsertOptions) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** The word the right-click landed on; absent from the rail, which has none. */
  lookUpWord?: string | null;
  onLookUp?: (word: string) => void;
}) {
  return (
    <ContextMenuContent className="min-w-[11rem]">
      {lookUpWord !== null && onLookUp !== undefined ? (
        <>
          <ContextMenuItem onSelect={() => onLookUp(lookUpWord)}>
            Look up “{lookUpWord}”
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      ) : null}
      {INSERT_TOP.map((item) => (
        <ContextMenuItem key={item.kind} onSelect={() => onInsert(item.kind)}>
          {item.label}
        </ContextMenuItem>
      ))}
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>More</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <CatalogSubmenu onPick={(kind) => onInsert(kind)} />
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={isBreakout}>Breakout</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <p className="max-w-[14rem] px-2 py-1.5 text-secondary text-muted-foreground">
            Opens from a part of this slide, then returns. Same types as insert.
          </p>
          <ContextMenuSeparator />
          <CatalogSubmenu onPick={(kind) => onInsert(kind, { asBreakout: true })} />
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onDuplicate}>Duplicate</ContextMenuItem>
      <ContextMenuItem
        className="text-destructive focus:text-destructive"
        disabled={!canDelete}
        onSelect={onDelete}
      >
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function slideMeta(outline: Outline, step: OutlineStep): { text: string; asks: boolean } {
  if (asksTheClass(step)) return { text: 'Question', asks: true };
  const minutes = stepMinutes(step);
  const kind = STEP_KIND_WORDS[step.kind];
  if (minutes === null) return { text: kind, asks: false };
  return { text: `${kind} · ${String(minutes)} min`, asks: false };
}

export function ThumbnailRail({
  outline,
  selection,
  onSelect,
  onMove,
  onInsert,
  onDuplicate,
  onDelete,
  canDelete,
  onTemplates,
  onSelectHomework,
  onSelectRecap,
}: {
  outline: Outline;
  selection: RailSelection;
  onSelect: (stepId: string) => void;
  onMove: (stepId: string, toIndex: number) => void;
  onInsert: (afterStepId: string, kind: InsertKind, options?: InsertOptions) => void;
  onDuplicate: (stepId: string) => void;
  onDelete: (stepId: string) => void;
  canDelete: (stepId: string) => boolean;
  onTemplates: () => void;
  onSelectHomework: () => void;
  onSelectRecap: () => void;
}) {
  const blocks = orderedBlocks(outline);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const selectedStepId = selection.kind === 'step' ? selection.id : null;

  const onKeyDown = (event: React.KeyboardEvent, index: number, stepId: string) => {
    if (!event.altKey) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onMove(stepId, index - 1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      onMove(stepId, index + 1);
    }
  };

  const blockMenu = (step: OutlineStep, isBreakout: boolean) => (
    <BlockInsertMenu
      isBreakout={isBreakout}
      canDelete={canDelete(step.id)}
      onInsert={(kind, options) => {
        onSelect(step.id);
        onInsert(step.id, kind, options);
      }}
      onDuplicate={() => {
        onSelect(step.id);
        onDuplicate(step.id);
      }}
      onDelete={() => {
        onSelect(step.id);
        onDelete(step.id);
      }}
    />
  );

  return (
    <div className="flex h-full min-h-0 w-[244px] shrink-0 flex-col border-r border-border bg-background">
      <div className="flex items-center justify-between gap-2 px-3.5 pb-1.5 pt-3">
        <span className="text-caption text-muted-foreground">
          <span className="tabular-nums">{blocks.length}</span>{' '}
          {blocks.length === 1 ? 'slide' : 'slides'}
        </span>
        <button
          type="button"
          onClick={onTemplates}
          className="h-[26px] rounded-md px-2 text-secondary text-primary hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Add
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-3">
      <ol className="flex flex-col gap-px" aria-label="Slides">
        {blocks.map((block, index) => {
          const selected = block.step.id === selectedStepId;
          const meta = slideMeta(outline, block.step);
          return (
            <li
              key={block.step.id}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDragOver(index);
              }}
              onDragLeave={() => setDragOver((at) => (at === index ? null : at))}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(null);
                const id = event.dataTransfer.getData('text/plain');
                if (id !== '') onMove(id, index);
              }}
              className={cn(dragOver === index && 'border-t border-primary')}
            >
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    draggable
                    className={cn(
                      'flex w-full items-center gap-[9px] rounded-lg p-1.5 text-left',
                      'hover:bg-chrome focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      selected && 'bg-accent outline outline-1 -outline-offset-1 outline-primary',
                    )}
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => onSelect(block.step.id)}
                    onKeyDown={(event) => onKeyDown(event, index, block.step.id)}
                    onContextMenu={() => onSelect(block.step.id)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', block.step.id);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                  >
                    <span
                      className={cn(
                        'w-3.5 shrink-0 text-right text-caption tabular-nums',
                        selected ? 'font-semibold text-accent-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {block.number}
                    </span>
                    <span
                      className={cn(
                        'relative block h-9 w-[58px] shrink-0 overflow-hidden rounded-md bg-card',
                        meta.asks
                          ? 'border border-live'
                          : selected
                            ? 'border border-primary'
                            : 'border border-border',
                      )}
                    >
                      <SlideThumbnail outline={outline} step={block.step} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate text-rail leading-snug">
                        {stepTitle(outline, block.step)}
                      </span>
                      {meta.asks ? (
                        <span className="inline-flex items-center gap-1.5 text-caption text-live-tint-foreground">
                          <span aria-hidden="true" className="size-1.5 rounded-full bg-live" />
                          Question
                        </span>
                      ) : (
                        <span className="text-caption text-muted-foreground">{meta.text}</span>
                      )}
                    </span>
                  </button>
                </ContextMenuTrigger>
                {blockMenu(block.step, false)}
              </ContextMenu>

              {block.breakouts.map((child) => {
                const childSelected = child.id === selectedStepId;
                return (
                  <ContextMenu key={child.id}>
                    <ContextMenuTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg py-1.5 pl-7 pr-1.5 text-left',
                          'hover:bg-chrome focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                          childSelected && 'bg-accent outline outline-1 -outline-offset-1 outline-primary',
                        )}
                        aria-current={childSelected ? 'true' : undefined}
                        onClick={() => onSelect(child.id)}
                        onContextMenu={() => onSelect(child.id)}
                      >
                        <span aria-hidden="true" className="shrink-0 text-caption text-muted-foreground">
                          ↳
                        </span>
                        <span className="block h-[25px] w-10 shrink-0 overflow-hidden rounded-[3px] border border-dashed border-input bg-card"><SlideThumbnail outline={outline} step={child} /></span>
                        <span className="flex min-w-0 flex-1 flex-col gap-px">
                          <span className="truncate text-[12px] leading-snug text-secondary">
                            {stepTitle(outline, child)}
                          </span>
                          <span className="text-[11px] text-muted-foreground">Only if they need it</span>
                        </span>
                      </button>
                    </ContextMenuTrigger>
                    {blockMenu(child, true)}
                  </ContextMenu>
                );
              })}
            </li>
          );
        })}

      </ol>
        <button
          type="button"
          onClick={onTemplates}
          className="mt-1.5 flex w-full items-center justify-center rounded-lg border border-dashed border-input px-2 py-2.5 text-secondary text-muted-foreground hover:border-primary hover:bg-card hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Add a slide
        </button>
        <p className="mt-4 px-1.5 text-caption text-muted-foreground">Homework & recap</p>
        <AsideRow
          label="Homework"
          meta={asideMeta(outline.homework, 'Not written')}
          aside={outline.homework}
          selected={selection.kind === 'homework'}
          empty={outline.homework === undefined}
          onSelect={onSelectHomework}
        />
        <AsideRow
          label="Recap"
          meta={asideMeta(outline.recap, 'Not written')}
          aside={outline.recap}
          selected={selection.kind === 'recap'}
          empty={outline.recap === undefined}
          onSelect={onSelectRecap}
        />
        <p className="px-1.5 pt-1.5 text-caption leading-snug text-muted-foreground">
          Not slides — one page each, in the same file.
        </p>
      </div>
    </div>
  );
}

function AsideRow({
  label,
  meta,
  aside,
  selected,
  empty,
  onSelect,
}: {
  label: string;
  meta: string;
  aside: OutlineAside | undefined;
  selected: boolean;
  empty?: boolean;
  onSelect: () => void;
}) {
  const vacant = aside === undefined && empty;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-[9px] rounded-lg p-1.5 text-left',
        'hover:bg-chrome focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        selected && 'bg-accent outline outline-1 -outline-offset-1 outline-primary',
      )}
      aria-current={selected ? 'true' : undefined}
    >
      <span className="w-3.5 shrink-0" />
      {vacant ? (
        <span className="grid h-9 w-[58px] shrink-0 place-items-center rounded-md border border-dashed border-input bg-background text-secondary text-muted-foreground">
          ＋
        </span>
      ) : (
        <span className="relative block h-9 w-[58px] shrink-0 overflow-hidden rounded-md border border-border bg-card">
          <LayoutThumb layout="text" className="h-full" />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className={cn('text-rail leading-snug', vacant && 'text-muted-foreground')}>
          {label}
        </span>
        <span className="text-caption text-muted-foreground">{meta}</span>
      </span>
    </button>
  );
}
