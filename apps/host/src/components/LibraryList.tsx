import { useState, type DragEvent } from 'react';
import { Link } from '@tanstack/react-router';

import type { LinkTarget } from '../destinations';

import type { FolderSummary } from '../api';
import { cn } from '../lib/utils';
import { ROW_DRAG_MIME, serializeRows } from '../lib/row-drag';
import { DeckThumb } from './DeckThumb';
import { Button } from './ui/button';
import { Input } from './ui/input';

export interface LibraryRow {
  id: string;
  name: string;
  /** Contents line under the name (`6 slides · 2 ask the class`), or empty. */
  meta: string;
  location?: string;
  /** Extra plain text folded into the search, such as a linked context. */
  searchText?: string;
  kind?: 'deck' | 'folder';
  asksTheClass?: boolean;
  folderCount?: number;
}

export interface Crumb {
  id: string | null;
  name: string;
}

export interface LibraryListProps {
  crumbs: Crumb[];
  /** Navigate to a folder from the breadcrumb. Writes `?folderId=`. */
  onNavigate: (folderId: string | null) => void;
  rows: LibraryRow[];
  folders: FolderSummary[];
  spaceName: string;
  /** The folder being viewed; `null` = space root. */
  folderId: string | null;
  /** Its name, for “New in {folder}”. */
  folderName: string;
  query: string;
  onQuery: (query: string) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void;
  canEdit: boolean;
  /** Where “New deck” goes. Creating lands in the open folder. */
  createTo: LinkTarget | null;
  /** One share surface for the space (members + invite). */
  shareTo?: LinkTarget | null;
  /** The space's own settings page. */
  settingsTo?: LinkTarget | null;
  samplesTo?: LinkTarget | null;
  /** Clears the rail's hover state when a drag ends anywhere. */
  onDragEnd: () => void;
  /**
   * `browser` — path + search + create (space library).
   * `folder` — just the decks card (person view already has a header).
   */
  chrome?: 'browser' | 'folder';
  heading?: string;
}

/**
 * The middle column: deck (and folder) rows that state what is in the file.
 */
export function LibraryList({
  crumbs,
  onNavigate,
  rows,
  query,
  onQuery,
  selectedId,
  onSelect,
  onOpen,
  canEdit,
  createTo,
  shareTo = null,
  settingsTo = null,
  samplesTo = null,
  onDragEnd,
  chrome = 'browser',
  heading = 'Decks',
}: LibraryListProps) {
  const [view, setView] = useState<'list' | 'tiles'>('list');

  const startDrag = (event: DragEvent, row: LibraryRow) => {
    if (!canEdit || row.kind === 'folder') {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(ROW_DRAG_MIME, serializeRows([{ kind: 'deck', id: row.id }]));
    event.dataTransfer.effectAllowed = 'move';
  };

  const empty = (
    <div className="flex flex-col items-center gap-2.5 px-6 py-14 text-center">
      <p className="text-section">No decks in this folder</p>
      {canEdit && createTo ? (
        <Button asChild>
          <Link {...createTo}>New deck</Link>
        </Button>
      ) : null}
    </div>
  );

  const list = (
    <ul role="listbox" aria-label="Library">
      {rows.map((row, index) => {
        const isSelected = selectedId === row.id;
        const last = index === rows.length - 1;
        return (
          <li
            key={row.id}
            role="option"
            aria-selected={isSelected}
            draggable={canEdit && row.kind !== 'folder'}
            onDragStart={(event) => startDrag(event, row)}
            onDragEnd={onDragEnd}
            tabIndex={0}
            onClick={() => onSelect(row.id)}
            onDoubleClick={() => onOpen(row.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); onOpen(row.id); }
              else if (event.key === ' ') { event.preventDefault(); onSelect(row.id); }
            }}
            className={cn(
              'flex cursor-pointer items-center gap-3.5 px-4 py-[11px]',
              !last && 'border-b border-hairline',
              isSelected
                ? 'bg-accent outline outline-1 -outline-offset-1 outline-primary'
                : 'hover:bg-background',
            )}
          >
            <DeckThumb
              asksTheClass={row.asksTheClass}
              folderCount={row.kind === 'folder' ? (row.folderCount ?? 0) : undefined}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-row-title">{row.name}</span>
              {row.location ? <span className="truncate text-caption text-muted-foreground">{row.location}</span> : null}
              {row.meta ? (
                <span
                  className={cn(
                    'truncate text-caption',
                    row.asksTheClass && row.kind !== 'folder'
                      ? 'inline-flex items-center gap-1.5 text-live-tint-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  {row.asksTheClass && row.kind !== 'folder' ? (
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-live" />
                  ) : null}
                  {row.meta}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );

  const tiles = (
    <ul role="listbox" aria-label="Library" className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 xl:grid-cols-4">
      {rows.map((row) => {
        const isSelected = selectedId === row.id;
        return (
          <li
            key={row.id}
            role="option"
            aria-selected={isSelected}
            tabIndex={0}
            onClick={() => onSelect(row.id)}
            onDoubleClick={() => onOpen(row.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); onOpen(row.id); }
              else if (event.key === ' ') { event.preventDefault(); onSelect(row.id); }
            }}
            className={cn(
              'cursor-pointer overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card',
              isSelected ? 'border-primary' : 'hover:border-primary',
            )}
          >
            <div className="flex aspect-[16/10] flex-col justify-center gap-1.5 border-b border-hairline p-4">
              <span className="text-row-title leading-tight">{row.name}</span>
              <span className="block h-0.5 w-[58%] rounded-sm bg-border" />
              <span className="block h-0.5 w-[42%] rounded-sm bg-border" />
            </div>
            <div className="px-3 pb-3 pt-2.5">
              <p className="text-rail">{row.name}</p>
              {row.meta ? <p className="mt-0.5 text-caption text-muted-foreground">{row.meta}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {chrome === 'browser' ? (
        <div className="flex flex-col gap-3 px-8 pb-2.5 pt-6">
          <div className="flex flex-col gap-3">
            <nav
              aria-label="Folder path"
              className="flex min-w-0 flex-wrap items-center gap-1.5 text-secondary text-muted-foreground"
            >
              {crumbs.map((crumb, index) => {
                const last = index === crumbs.length - 1;
                return (
                  <span key={crumb.id ?? 'root'} className="flex min-w-0 items-center gap-1.5">
                    {index > 0 ? <span aria-hidden>/</span> : null}
                    <button
                      type="button"
                      className={cn(
                        'max-w-[14rem] truncate text-secondary',
                        last ? 'font-semibold text-foreground' : 'hover:text-foreground',
                      )}
                      aria-current={last ? 'true' : undefined}
                      onClick={() => onNavigate(crumb.id)}
                    >
                      {crumb.name}
                    </button>
                  </span>
                );
              })}
            </nav>
            <div className="flex flex-wrap items-center gap-2">
              {settingsTo ? (
                <Button asChild size="sm" variant="outline">
                  <Link {...settingsTo}>Settings</Link>
                </Button>
              ) : null}
              {shareTo ? (
                <Button asChild size="sm" variant="outline">
                  <Link {...shareTo}>Share</Link>
                </Button>
              ) : null}
              <Input
                value={query}
                onChange={(event) => onQuery(event.currentTarget.value)}
                placeholder="Search all folders"
                aria-label="Search decks"
                className="h-8 min-w-32 flex-1 basis-40"
              />
              {canEdit && createTo ? (
                <Button asChild size="sm">
                  <Link {...createTo}>New deck</Link>
                </Button>
              ) : null}
              {samplesTo ? <Button asChild size="sm" variant="outline"><Link {...samplesTo}>Sample lessons</Link></Button> : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-8 pb-2.5">
          <h2 className="text-section">{heading}</h2>
          <span className="flex-1" />
          <button
            type="button"
            className={cn(
              'inline-flex h-7 items-center rounded-md px-2.5 text-rail font-normal',
              view === 'list' ? 'bg-desk font-semibold' : 'text-muted-foreground hover:bg-desk',
            )}
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            List
          </button>
          <button
            type="button"
            className={cn(
              'inline-flex h-7 items-center rounded-md px-2.5 text-rail font-normal',
              view === 'tiles' ? 'bg-desk font-semibold' : 'text-muted-foreground hover:bg-desk',
            )}
            aria-pressed={view === 'tiles'}
            onClick={() => setView('tiles')}
          >
            Tiles
          </button>
        </div>
      )}

      <div className={cn('min-h-0 flex-1 overflow-auto', chrome === 'folder' ? 'px-8 pb-6' : 'px-8 pb-6')}>
        {rows.length === 0 ? (
          empty
        ) : view === 'tiles' && chrome === 'folder' ? (
          tiles
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card">
            {list}
          </div>
        )}
      </div>
    </div>
  );
}
