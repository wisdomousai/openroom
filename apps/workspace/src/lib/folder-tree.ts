import type { FolderSummary } from '../api';

export interface FolderTreeNode {
  folder: FolderSummary;
  children: FolderTreeNode[];
}

/** Build a nested tree from a flat folder list (parent_id adjacency). */
export function buildFolderTree(folders: FolderSummary[]): FolderTreeNode[] {
  const byParent = new Map<string | null, FolderSummary[]>();
  for (const f of folders) {
    const key = f.parentId ?? null;
    const list = byParent.get(key);
    if (list) list.push(f);
    else byParent.set(key, [f]);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  function walk(parentId: string | null): FolderTreeNode[] {
    return (byParent.get(parentId) ?? []).map((folder) => ({
      folder,
      children: walk(folder.id),
    }));
  }

  return walk(null);
}

/** Direct children of a parent (null = space root). Stable name order. */
export function getChildFolders(
  folders: FolderSummary[],
  parentId: string | null,
): FolderSummary[] {
  return folders
    .filter((f) => (f.parentId ?? null) === parentId)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/**
 * Ancestors of `folderId` from root toward the folder (not including self).
 * Empty if missing or root-level.
 */
export function getFolderAncestors(
  folders: FolderSummary[],
  folderId: string,
): FolderSummary[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: FolderSummary[] = [];
  let current = byId.get(folderId);
  const seen = new Set<string>();
  while (current?.parentId) {
    if (seen.has(current.parentId)) break;
    seen.add(current.parentId);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

/** Folder row for the current id, or null. */
export function getFolderById(
  folders: FolderSummary[],
  folderId: string | null | undefined,
): FolderSummary | null {
  if (!folderId) return null;
  return folders.find((f) => f.id === folderId) ?? null;
}

/** Breadcrumb trail: ancestors + current folder (if any). */
export function getBreadcrumbTrail(
  folders: FolderSummary[],
  folderId: string | null,
): FolderSummary[] {
  if (!folderId) return [];
  const current = getFolderById(folders, folderId);
  if (!current) return [];
  return [...getFolderAncestors(folders, folderId), current];
}

/**
 * How many folders live *inside* this one, at any depth.
 *
 * The rail shows this number rather than an item count because the space tree
 * only loads items for the folder you are standing in — an item count would be
 * `0` for every folder you have not visited, which is worse than no number at
 * all. Folder structure, by contrast, is always fully loaded.
 */
export function countDescendantFolders(
  folders: FolderSummary[],
  folderId: string,
): number {
  // `collectDescendantIds` includes the root; the root is not inside itself.
  return collectDescendantIds(folders, folderId).size - 1;
}

/** True if moving `folderId` under `newParentId` would create a cycle. */
export function wouldCreateCycle(
  folders: FolderSummary[],
  folderId: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return false;
  if (newParentId === folderId) return true;
  return collectDescendantIds(folders, folderId).has(newParentId);
}

/** Collect folder id and all descendant ids. */
export function collectDescendantIds(
  folders: FolderSummary[],
  rootId: string,
): Set<string> {
  const byParent = new Map<string | null, string[]>();
  for (const f of folders) {
    const key = f.parentId ?? null;
    const list = byParent.get(key);
    if (list) list.push(f.id);
    else byParent.set(key, [f.id]);
  }

  const ids = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const childId of byParent.get(id) ?? []) {
      ids.add(childId);
      stack.push(childId);
    }
  }
  return ids;
}
