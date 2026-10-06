import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link } from '@tanstack/react-router';

import type { FolderSummary, SpaceTreeDeck, SpaceTreeRecord } from '../api';
import { homeworkLine, recapLine, slidesLine, type DeckContentsMeta } from '../lib/contents-meta';
import { ROW_DRAG_MIME, serializeRows } from '../lib/row-drag';
import { cn } from '@openroom/ui/utils';
import { to } from '../destinations';
import { DeckPreview } from './DeckThumb';
import { Button } from '@openroom/ui/components/button';
import { Input } from '@openroom/ui/components/input';
import { MoveTreePicker } from './MoveTreePicker';
import { SavedResultsLinks } from './SavedResultsLinks';

export type PanelItem = { kind: 'deck'; data: SpaceTreeDeck };

export interface DeckAside {
  homework?: { title?: string; body?: string; items?: string[] } | null;
  recap?: { title?: string; body?: string; items?: string[] } | null;
}

interface Props {
  item: PanelItem;
  place: { spaceId: string | null; folderId: string | null };
  canEdit: boolean;
  busy?: boolean;
  /** Run the primary action that is a side effect, not a navigation. */
  onStart: (item: PanelItem) => void;
  onTrash: (item: PanelItem) => void;
  onDuplicate: (item: PanelItem) => void;
  variant?: 'panel' | 'page';

  /** Commit a rename. Called on blur and on Enter; Escape never calls it. */
  onRename?: (item: PanelItem, name: string) => void | Promise<void>;
  /** Folders of this space, for the move picker's tree. */
  folders?: FolderSummary[];
  spaceName?: string;
  onMove?: (item: PanelItem, folderId: string | null) => void | Promise<void>;

  /** The item's own path, written out. */
  path?: string;
  onClose?: () => void;
  contents?: DeckContentsMeta | null;
  aside?: DeckAside | null;
  records?: SpaceTreeRecord[];
  onSaveCopy?: (item: PanelItem) => void;
}

/**
 * Notes of one deck all carry the session's title, so two of them read as the
 * same row. Dates would say them apart, but a date is a ledger (`AGENTS.md`
 * §The No-Ledger Rule): the list is already sorted most-recent-first, so the
 * second and later occurrences of a title take a silent ordinal instead —
 * "Algebra hour", "Algebra hour · 2". Titles that occur once are untouched.
 */
export function labelRecords(
  records: SpaceTreeRecord[],
): { id: string; sessionId: string; label: string }[] {
  const seen = new Map<string, number>();
  return records.map((record) => {
    const n = (seen.get(record.title) ?? 0) + 1;
    seen.set(record.title, n);
    return {
      id: record.id,
      sessionId: record.sessionId,
      label: n === 1 ? record.title : `${record.title} · ${n}`,
    };
  });
}

/**
 * The third column: one deck, rename and move, then the next verb.
 *
 * Two identity edits, and the list is closed: rename and move. Each commits
 * immediately. There is no Save button.
 */
export function ItemDetailPanel({
  item,
  canEdit,
  busy = false,
  onStart,
  onTrash,
  onDuplicate,
  variant = 'panel',
  onRename,
  folders,
  spaceName,
  onMove,
  onClose,
  contents,
  aside,
  records = [],
  onSaveCopy,
}: Props) {
  const title = item.data.title;
  const openTo = to.deckEditor(item.data.id);
  const canStart = item.data.currentVersion > 0;

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(title);
  const [movePane, setMovePane] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRenaming(false);
    setDraftName(title);
    setMovePane(false);
  }, [item.data.id, title]);

  useEffect(() => {
    if (renaming) renameRef.current?.select();
  }, [renaming]);

  const canRename = canEdit && onRename !== undefined;

  const commitRename = () => {
    const name = draftName.trim();
    setRenaming(false);
    if (name !== '' && name !== title) void onRename?.(item, name);
    else setDraftName(title);
  };

  const startDrag = (event: DragEvent) => {
    event.dataTransfer.setData(ROW_DRAG_MIME, serializeRows([{ kind: 'deck', id: item.data.id }]));
    event.dataTransfer.effectAllowed = 'move';
  };

  const asks = (contents?.askTheClass ?? 0) > 0;

  return (
    <aside
      aria-label={`${title} details`}
      className={cn(
        'flex min-h-0 w-full flex-col bg-card',
        variant === 'panel' ? 'h-full w-[300px] shrink-0 overflow-hidden border-l border-border' : 'gap-4',
      )}
    >
      <div
        className="flex items-start justify-between gap-2 px-[18px] pb-3 pt-4"
        draggable={canEdit && onMove !== undefined && !renaming}
        onDragStart={startDrag}
      >
        {renaming ? (
          <Input
            ref={renameRef}
            value={draftName}
            aria-label="Rename"
            className="h-[30px] flex-1 border-transparent bg-transparent px-2 text-section"
            onChange={(event) => setDraftName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitRename();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setDraftName(title);
                setRenaming(false);
              }
            }}
            onBlur={commitRename}
          />
        ) : canRename ? (
          <button
            type="button"
            title="Click to rename"
            aria-label={`Rename ${title}`}
            className="min-w-0 flex-1 cursor-text truncate rounded-md border border-transparent px-2 py-1 text-left text-section hover:border-input"
            onClick={() => {
              setDraftName(title);
              setRenaming(true);
            }}
          >
            {title}
          </button>
        ) : (
          <h2 className="min-w-0 flex-1 truncate px-2 text-section">{title}</h2>
        )}
        {onClose ? (
          <button
            type="button"
            title="Close"
            aria-label="Close"
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-chrome"
            onClick={onClose}
          >
            ✕
          </button>
        ) : null}
      </div>

      <div className="px-[18px] pb-4">
        <DeckPreview asksTheClass={asks} />
      </div>

      {canEdit ? (
        <div className="flex flex-col gap-2 px-[18px] pb-[18px]">
          <Button asChild className="h-[34px] w-full">
            <Link {...openTo}>Open</Link>
          </Button>
          <Button
            variant="outline"
            className="h-[34px] w-full bg-card"
            disabled={busy || !canStart}
            onClick={() => onStart(item)}
          >
            {busy ? 'Starting…' : 'Start session'}
          </Button>
        </div>
      ) : (
        <div className="px-[18px] pb-[18px]">
          <Button asChild className="h-[34px] w-full">
            <Link {...openTo}>Open</Link>
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <section className="flex flex-col gap-0.5 border-t border-hairline px-2.5 py-3">
          <p className="mb-1.5 px-2 text-caption text-muted-foreground">In this deck</p>
          <Link
            {...openTo}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-chrome"
          >
            <span
              aria-hidden="true"
              className="relative block h-[17px] w-[26px] shrink-0 rounded-sm border border-input bg-card"
            >
              <span className="absolute left-[3px] top-[4px] h-0.5 w-3 bg-muted-foreground" />
              <span className="absolute left-[3px] top-[10px] h-[1.5px] w-[17px] bg-input" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px] font-semibold">Slides</span>
              <span className="text-caption text-muted-foreground">{slidesLine(contents)}</span>
            </span>
          </Link>
          <Link
            {...openTo}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-chrome"
          >
            <span
              aria-hidden="true"
              className="grid h-[17px] w-[26px] shrink-0 place-items-center rounded-sm border border-input bg-card text-[9px] text-muted-foreground"
            >
              ✎
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px] font-semibold">Homework</span>
              <span className="text-caption text-muted-foreground">{homeworkLine(aside?.homework)}</span>
            </span>
          </Link>
          <Link
            {...openTo}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-chrome"
          >
            <span
              aria-hidden="true"
              className="grid h-[17px] w-[26px] shrink-0 place-items-center rounded-sm border border-dashed border-input bg-background text-[10px] text-muted-foreground"
            >
              ＋
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px] font-semibold text-muted-foreground">Recap</span>
              <span className="text-caption text-muted-foreground">{recapLine(aside?.recap)}</span>
            </span>
          </Link>
        </section>

        {records.length > 0 ? (
          <section className="flex flex-col gap-0.5 border-t border-hairline px-2.5 py-3">
            <p className="mb-1.5 px-2 text-caption text-muted-foreground">Notes</p>
            {labelRecords(records).map((record) => (
              <Link
                key={record.id}
                {...to.sessionNotes(record.sessionId)}
                className="truncate rounded-md px-2 py-1.5 text-[13px] hover:bg-chrome"
              >
                {record.label}
              </Link>
            ))}
          </section>
        ) : null}

        <SavedResultsLinks deckId={item.data.id} />

        {canEdit ? (
          <div className="flex flex-col gap-0.5 border-t border-hairline px-2.5 py-3">
            {onMove && folders ? (
              <>
                <button
                  type="button"
                  className="flex h-8 items-center rounded-md px-2 text-secondary hover:bg-chrome"
                  onClick={() => setMovePane((open) => !open)}
                >
                  {movePane ? 'Cancel' : 'Move to another folder…'}
                </button>
                {movePane ? (
                  <div className="px-1 pb-2">
                    <MoveTreePicker
                      spaceName={spaceName ?? 'Space'}
                      folders={folders}
                      currentFolderId={item.data.folderId ?? null}
                      onMove={(folderId) => {
                        setMovePane(false);
                        void onMove(item, folderId);
                      }}
                    />
                  </div>
                ) : null}
              </>
            ) : null}
            <button
              type="button"
              className="flex h-8 items-center rounded-md px-2 text-secondary hover:bg-chrome"
              disabled={busy}
              onClick={() => onDuplicate(item)}
            >
              Duplicate
            </button>
            {onSaveCopy ? (
              <button
                type="button"
                className="flex h-8 items-center rounded-md px-2 text-secondary hover:bg-chrome"
                onClick={() => onSaveCopy(item)}
              >
                Save a copy on this computer
              </button>
            ) : null}
            <button
              type="button"
              className="flex h-8 items-center rounded-md px-2 text-secondary text-destructive hover:bg-[var(--destructive)]/10"
              onClick={() => onTrash(item)}
            >
              Move to trash
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/** The third column with nothing chosen. Still a column, never a blank slot. */
export function EmptyInspector() {
  return (
    <div className="flex h-full w-[300px] shrink-0 flex-col items-center justify-center gap-2 border-l border-border bg-card p-8 text-center">
      <p className="text-row-title">Nothing selected</p>
    </div>
  );
}
