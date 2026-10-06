import { useMemo, useState } from 'react';

import type { FolderSummary } from '../api';
import { buildFolderTree, getFolderAncestors, type FolderTreeNode } from '../lib/folder-tree';
import { cn } from '../lib/utils';
import { Input } from './ui/input';

export interface MoveTreePickerProps {
  spaceName: string;
  folders: FolderSummary[];
  /** Where the item is now, so the picker can say "already here". */
  currentFolderId: string | null;
  /** null = the space root. */
  onMove: (folderId: string | null) => void;
  disabled?: boolean;
}

/**
 * The keyboard-reachable form of the drag gesture.
 *
 * `AGENTS.md` §"Entity panel": **Move is not a location field.** This is not a
 * parent/folder `<select>` and must never become one — a flat list of every
 * folder you own is exactly the DB-admin picker the place-first rule bans.
 * What makes it legitimate is that it shows *the same hierarchy as the rail*,
 * so choosing a destination is the same act as dragging a row onto a folder,
 * performed with a keyboard.
 *
 * Filtering keeps ancestors of a match visible rather than flattening the
 * result. A tree that collapses into a flat list under search is a `<select>`
 * wearing a text box, and the hierarchy is the whole reason this is allowed.
 */
export function MoveTreePicker({
  spaceName,
  folders,
  currentFolderId,
  onMove,
  disabled = false,
}: MoveTreePickerProps) {
  const [query, setQuery] = useState('');
  const tree = useMemo(() => buildFolderTree(folders), [folders]);

  /**
   * Ids to render: every folder whose name matches, plus every ancestor of a
   * match so the path to it stays intact. An empty query shows everything.
   */
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (needle === '') return null;
    const keep = new Set<string>();
    for (const folder of folders) {
      if (!folder.name.toLocaleLowerCase().includes(needle)) continue;
      keep.add(folder.id);
      for (const ancestor of getFolderAncestors(folders, folder.id)) keep.add(ancestor.id);
    }
    return keep;
  }, [folders, query]);

  const renderNode = (node: FolderTreeNode, depth: number) => {
    if (visible !== null && !visible.has(node.folder.id)) return null;
    const here = currentFolderId === node.folder.id;
    return (
      <li key={node.folder.id}>
        <button
          type="button"
          disabled={disabled || here}
          className={cn(
            'flex w-full items-center gap-2 truncate rounded-[var(--radius)] py-1.5 pr-2 text-left text-secondary font-semibold',
            here ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
            'disabled:cursor-default',
          )}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          onClick={() => onMove(node.folder.id)}
        >
          <span className="min-w-0 flex-1 truncate">{node.folder.name}</span>
        </button>
        {node.children.length > 0 ? (
          <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>
        ) : null}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-2 border border-primary p-2.5">
      <Input
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder="Filter folders"
        aria-label="Filter folders"
        className="h-8"
      />
      <ul className="flex max-h-52 flex-col overflow-y-auto">
        <li>
          <button
            type="button"
            disabled={disabled || currentFolderId === null}
            className={cn(
              'flex w-full items-center gap-2 rounded-[var(--radius)] py-1.5 pl-2 pr-2 text-left text-secondary font-semibold',
              currentFolderId === null ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
              'disabled:cursor-default',
            )}
            onClick={() => onMove(null)}
          >
            {/* The space root holds unfiled items — there is no "Unfiled". */}
            <span className="min-w-0 flex-1 truncate">{spaceName}</span>
          </button>
        </li>
        {tree.map((node) => renderNode(node, 1))}
      </ul>
      <p className="text-caption font-normal text-muted-foreground">
        Real hierarchy, filterable. Never a flat list of every folder.
      </p>
    </div>
  );
}
