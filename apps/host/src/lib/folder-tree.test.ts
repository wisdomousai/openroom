import { describe, expect, it } from 'vitest';
import {
  buildFolderTree,
  collectDescendantIds,
  countDescendantFolders,
  getBreadcrumbTrail,
  getChildFolders,
  getFolderAncestors,
  wouldCreateCycle,
} from './folder-tree';
import type { FolderSummary } from '../api';

const folders: FolderSummary[] = [
  { id: 'a', name: 'Biology', parentId: null, sortOrder: 0, createdAt: 1 },
  { id: 'b', name: 'Week 1', parentId: 'a', sortOrder: 0, createdAt: 2 },
  { id: 'c', name: 'Week 2', parentId: 'a', sortOrder: 1, createdAt: 3 },
  { id: 'd', name: 'Monday', parentId: 'b', sortOrder: 0, createdAt: 4 },
];

describe('folder-tree', () => {
  it('builds nested tree from flat list', () => {
    const tree = buildFolderTree(folders);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.folder.id).toBe('a');
    expect(tree[0]!.children).toHaveLength(2);
    expect(tree[0]!.children[0]!.children[0]!.folder.id).toBe('d');
  });

  it('lists direct children of root and a folder', () => {
    expect(getChildFolders(folders, null).map((f) => f.id)).toEqual(['a']);
    expect(getChildFolders(folders, 'a').map((f) => f.id)).toEqual(['b', 'c']);
    expect(getChildFolders(folders, 'b').map((f) => f.id)).toEqual(['d']);
  });

  it('walks ancestors root-ward and builds breadcrumbs', () => {
    expect(getFolderAncestors(folders, 'd').map((f) => f.id)).toEqual(['a', 'b']);
    expect(getBreadcrumbTrail(folders, 'd').map((f) => f.id)).toEqual(['a', 'b', 'd']);
    expect(getBreadcrumbTrail(folders, null)).toEqual([]);
  });

  it('detects cycles for folder moves', () => {
    expect(wouldCreateCycle(folders, 'a', 'd')).toBe(true);
    expect(wouldCreateCycle(folders, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(folders, 'c', 'b')).toBe(false);
    expect(wouldCreateCycle(folders, 'c', null)).toBe(false);
  });

  it('collects descendant ids', () => {
    const ids = collectDescendantIds(folders, 'a');
    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('counts what is inside a folder, excluding the folder itself', () => {
    // The rail's number: a folder is not inside itself, and a leaf shows none.
    expect(countDescendantFolders(folders, 'a')).toBe(3);
    expect(countDescendantFolders(folders, 'b')).toBe(1);
    expect(countDescendantFolders(folders, 'd')).toBe(0);
  });
});
