import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import type { FolderSummary } from '../api';
import {
  buildFolderTree,
  getFolderAncestors,
  type FolderTreeNode,
} from '../lib/folder-tree';
import { cn } from '../lib/utils';
import { Input } from './ui/input';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ui/context-menu';

/** The folder verbs the rail can perform. Omitted for a read-only role. */
export interface FolderActions {
  onCreateFolder: (parentId: string | null, name: string) => void | Promise<void>;
  onRenameFolder: (folderId: string, name: string) => void | Promise<void>;
  onCopyFolder: (folderId: string) => void | Promise<void>;
  onTrashFolder: (folderId: string) => void;
}

export interface TreeRailProps {
  spaceName: string;
  folders: FolderSummary[];
  /** The folder the **URL** names. null = space root. */
  folderId: string | null;
  /**
   * Navigate. This must change `?folderId=`; the rail has no location state of
   * its own beyond which branches are expanded.
   */
  onNavigate: (folderId: string | null) => void;
  /**
   * How many items live in a folder **including its descendants**. A folder
   * that reads `0` while holding a full subfolder would be a lie, and the
   * count is the only reason to trust the tree as a map.
   */
  itemCountIn: (folderId: string | null) => number;
  /** Drop handlers, shared with the list — there is one DnD path, not two. */
  canDrop: boolean;
  onDragOverFolder: (event: DragEvent, folderId: string | 'root') => void;
  onDragLeaveFolder: (folderId: string | 'root') => void;
  onDropOnFolder: (event: DragEvent, folderId: string | null) => void;
  /** Which folder (or 'root') is currently the hovered drop target. */
  dropTarget: string | 'root' | null;
  folderActions?: FolderActions;
}

/**
 * The persistent folder tree beside the list.
 *
 * Two rules are load-bearing:
 *
 * 1. **The URL owns location.** Clicking a row calls `onNavigate`, which writes
 *    `?folderId=`. The rail derives "you are here" from the `folderId` prop —
 *    it never holds a location the URL does not, so reload, Back and a pasted
 *    link all land in the same place. The only state this component owns is
 *    which branches are open, which is chrome, not location.
 * 2. **No "Unfiled" pseudo-folder.** The space root row *is* where unfiled
 *    items live. There is no second destination and no synthetic node.
 *
 * Folder verbs (rename · copy · trash · new inside a node) stay on the row's
 * context menu. **New folder** is also a visible button: creating a folder in
 * the place you are standing must not require a right-click.
 */
export function TreeRail({
  spaceName,
  folders,
  folderId,
  onNavigate,
  itemCountIn,
  canDrop,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropOnFolder,
  dropTarget,
  folderActions,
}: TreeRailProps) {
  const tree = useMemo(() => buildFolderTree(folders), [folders]);

  // Ancestors of the active folder are always open: a rail that hides the row
  // the URL names would be a rail that disagrees with the URL.
  const forcedOpen = useMemo(() => {
    if (!folderId) return new Set<string>();
    return new Set(getFolderAncestors(folders, folderId).map((f) => f.id));
  }, [folders, folderId]);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /** Where an inline "new folder" row is being typed. `undefined` = nowhere. */
  const [creatingIn, setCreatingIn] = useState<string | null | undefined>(undefined);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId || creatingIn !== undefined) editRef.current?.select();
  }, [renamingId, creatingIn]);

  const isOpen = (id: string): boolean => forcedOpen.has(id) || !collapsed.has(id);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startRename = (folder: FolderSummary) => {
    setCreatingIn(undefined);
    setRenamingId(folder.id);
    setDraft(folder.name);
  };

  const startCreate = (parentId: string | null) => {
    setRenamingId(null);
    setCreatingIn(parentId);
    setDraft('New folder');
  };

  const commitEdit = () => {
    const name = draft.trim();
    if (renamingId !== null) {
      const id = renamingId;
      setRenamingId(null);
      const folder = folders.find((f) => f.id === id);
      if (name && folder && folder.name !== name) void folderActions?.onRenameFolder(id, name);
      return;
    }
    if (creatingIn !== undefined) {
      const parentId = creatingIn;
      setCreatingIn(undefined);
      if (name) void folderActions?.onCreateFolder(parentId, name);
    }
  };

  const cancelEdit = () => {
    setRenamingId(null);
    setCreatingIn(undefined);
  };

  const editRow = (depth: number, label: string) => (
    <div
      className="flex items-center gap-1 py-0.5"
      style={{ paddingLeft: `${depth * 14 + 4}px` }}
    >
      <Input
        ref={editRef}
        value={draft}
        aria-label={label}
        className="h-7 text-secondary"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitEdit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelEdit();
          }
        }}
        onBlur={commitEdit}
      />
    </div>
  );

  const row = (
    id: string | null,
    name: string,
    depth: number,
    hasChildren: boolean,
    open: boolean,
  ) => {
    const active = folderId === id;
    const isDrop = dropTarget === (id ?? 'root');
    return (
      <div
        className={cn(
          'flex h-[34px] items-center gap-0.5 border border-transparent',
          active && 'bg-desk',
          isDrop && 'border-primary bg-accent',
        )}
        style={{ paddingLeft: `${depth * 14}px` }}
        onDragOver={canDrop ? (event) => onDragOverFolder(event, id ?? 'root') : undefined}
        onDragLeave={canDrop ? () => onDragLeaveFolder(id ?? 'root') : undefined}
        onDrop={canDrop ? (event) => onDropOnFolder(event, id) : undefined}
      >
        {hasChildren && id !== null ? (
          <button
            type="button"
            className="flex h-7 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
            aria-expanded={open}
            onClick={() => toggle(id)}
          >
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        ) : (
          <span className="h-7 w-5 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          className={cn(
            'min-w-0 flex-1 truncate py-1 pr-2 text-left text-secondary',
            active ? 'font-semibold text-foreground' : 'text-muted-foreground',
          )}
          aria-current={active ? 'true' : undefined}
          onClick={() => onNavigate(id)}
        >
          {name}
        </button>
        <span className="shrink-0 pr-2 tabular-nums text-caption font-normal text-muted-foreground">
          {itemCountIn(id)}
        </span>
      </div>
    );
  };

  const renderNode = (node: FolderTreeNode, depth: number) => {
    const { folder, children } = node;
    const open = isOpen(folder.id);
    return (
      <li key={folder.id}>
        {renamingId === folder.id ? (
          editRow(depth, 'Rename folder')
        ) : folderActions ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div>{row(folder.id, folder.name, depth, children.length > 0, open)}</div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => onNavigate(folder.id)}>Open</ContextMenuItem>
              <ContextMenuItem onSelect={() => startCreate(folder.id)}>
                New folder inside
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => startRename(folder)}>Rename</ContextMenuItem>
              <ContextMenuItem onSelect={() => void folderActions.onCopyFolder(folder.id)}>
                Duplicate
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => folderActions.onTrashFolder(folder.id)}
              >
                Move to trash
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          row(folder.id, folder.name, depth, children.length > 0, open)
        )}
        {creatingIn === folder.id ? editRow(depth + 1, 'New folder name') : null}
        {open && children.length > 0 ? (
          <ul>{children.map((child) => renderNode(child, depth + 1))}</ul>
        ) : null}
      </li>
    );
  };

  return (
    <nav
      aria-label="Folder tree"
      className="flex h-full min-h-0 flex-col overflow-y-auto border-r border-border"
    >
      <div className="flex flex-col gap-0.5 px-3 pb-3 pt-3.5">
        {folderActions ? (
          <div className="mb-1.5 flex items-center justify-end px-0.5">
            <button
              type="button"
              className="rounded-md px-1.5 py-0.5 text-secondary font-semibold text-primary hover:bg-muted"
              onClick={() => startCreate(folderId)}
            >
              New folder
            </button>
          </div>
        ) : null}
        <ul>
          <li>
            {folderActions ? (
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div>{row(null, spaceName, 0, tree.length > 0, true)}</div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => onNavigate(null)}>Open</ContextMenuItem>
                  <ContextMenuItem onSelect={() => startCreate(null)}>
                    New folder inside
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ) : (
              row(null, spaceName, 0, tree.length > 0, true)
            )}
          </li>
          {creatingIn === null ? <li>{editRow(1, 'New folder name')}</li> : null}
          {tree.map((node) => renderNode(node, 1))}
        </ul>
      </div>
    </nav>
  );
}
