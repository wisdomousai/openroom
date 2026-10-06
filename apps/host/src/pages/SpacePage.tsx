import { downloadCloudDocument, renameCloudDocument } from '../lib/cloud-document';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  copyFolder,
  createFolder,
  getContext,
  getDeck,
  getDeckFileLink,
  getSpaceMembers,
  getSpaceTree,
  linkDeckFile,
  listAllSpaces,
  listContexts,
  trashDeck,
  trashFolder,
  updateDeck,
  updateFolder,
  type SpaceTree,
} from '../api';
import { ContextLinksCard } from './tutor/ContextLinks';
import { sessionStartMessage } from '../components/ContinuityLock';
import { WorkspaceUpdates } from '../components/WorkspaceUpdates';
import { SpaceWelcome } from '../components/SpaceWelcome';
import { LiveNow } from '../components/LiveNow';
import { ContextPanel } from '../components/ContextPanel';
import { ConfirmActionDialog } from '../components/ManagementTable';
import {
  LibraryList,
  type Crumb,
  type LibraryRow,
} from '../components/LibraryList';
import {
  EmptyInspector,
  ItemDetailPanel,
  type PanelItem,
  type DeckAside,
} from '../components/ItemDetailPanel';
import { PersonBadge } from '../components/PersonBadge';
import { TreeRail } from '../components/TreeRail';
import { Button } from '@openroom/ui/components/button';
import { formatContentsMeta } from '../lib/contents-meta';
import { collectDescendantIds, getBreadcrumbTrail } from '../lib/folder-tree';
import { givenName } from '../lib/initials';
import {
  duplicateDeck,
  startSessionFromDeck,
} from '../lib/library-actions';
import { parseRows, ROW_DRAG_MIME, type DragRow } from '../lib/row-drag';
import { to } from '../destinations';
import { invalidateManagementData } from '../query-client';
import type { AuthSession } from '../useAuth';
import type { StoredSession } from '@openroom/editor';
import { stringifyOpenRoomFile, type OpenRoomFileV1 } from '@openroom/schema';

interface Props {
  session: AuthSession;
  spaceId?: string | null;
  /** Current folder from the URL (`?folderId=`). null/undefined = space root. */
  folderId?: string | null;
  /** Selected item from the URL (`?itemId=`); the kind is resolved by lookup. */
  itemId?: string | null;
  /** Selected person from the URL (`?contextId=`). */
  contextId?: string | null;
  onOpenSession: (live: StoredSession) => void;
  notify: (message: string, tone?: 'info' | 'error') => void;
}

type TrashTarget = { kind: 'deck' | 'folder'; id: string; label: string };

/**
 * The library.
 *
 * Three columns when browsing a space: **tree · list · inspector**.
 * Person view (a Who-I-teach folder): header · context · decks · inspector.
 */
export function SpacePage({
  session,
  spaceId: spaceIdProp,
  folderId: folderIdProp,
  itemId: itemIdProp,
  contextId: contextIdProp,
  onOpenSession,
  notify,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TrashTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState('');
  const [dropTarget, setDropTarget] = useState<string | 'root' | null>(null);

  const signedIn = session.user !== null && session.user !== undefined;
  const currentFolderId = folderIdProp ?? null;
  const currentContextId = contextIdProp ?? null;
  const navigate = useNavigate();

  const defaultSpaceQuery = useQuery({
    queryKey: ['spaces', 'personal-default'] as const,
    enabled: signedIn && !spaceIdProp,
    queryFn: async () => {
      const spaces = await listAllSpaces();
      return spaces.filter((s) => !s.shared).sort((a, b) => a.createdAt - b.createdAt)[0]?.id ?? spaces[0]?.id ?? null;
    },
  });
  const spaceId = spaceIdProp ?? defaultSpaceQuery.data ?? null;

  const treeQuery = useQuery({
    queryKey: ['spaces', spaceId, 'tree', 'all'] as const,
    enabled: signedIn && spaceId !== null,
    queryFn: () => getSpaceTree(spaceId!),
  });
  const tree: SpaceTree | undefined = treeQuery.data;
  const space = tree?.space ?? null;
  const folders = useMemo(() => tree?.folders ?? [], [tree]);
  const decks = useMemo(() => tree?.decks ?? [], [tree]);
  const records = useMemo(() => tree?.records ?? [], [tree]);
  const spaceName = space?.name ?? 'Space';

  const contextsQuery = useQuery({
    queryKey: ['contexts', 'all'] as const,
    enabled: signedIn,
    queryFn: () => listContexts(),
  });
  const contextNames = useMemo(
    () => new Map((contextsQuery.data ?? []).map((c) => [c.id, c.displayName])),
    [contextsQuery.data],
  );

  const personQuery = useQuery({
    queryKey: ['contexts', currentContextId, 'detail'] as const,
    enabled: signedIn && currentContextId !== null,
    queryFn: () => getContext(currentContextId!),
  });
  const person = personQuery.data ?? null;

  const membersQuery = useQuery({
    queryKey: ['spaces', spaceId, 'members'] as const,
    enabled: signedIn && spaceId !== null && currentContextId !== null,
    queryFn: () => getSpaceMembers(spaceId!),
  });
  const members = membersQuery.data?.members ?? [];
  const sharedWith = members.find((member) => member.role !== 'owner') ?? null;

  const activeItemId = itemIdProp ?? null;

  const goTo = useCallback(
    (next: { folderId?: string | null; itemId?: string | null; contextId?: string | null }, replace = false) => {
      if (!spaceId) return;
      void navigate({
        ...to.library({
          spaceId,
          folderId: next.folderId === undefined ? currentFolderId : next.folderId,
          itemId: next.itemId === undefined ? activeItemId : next.itemId,
          contextId: next.contextId === undefined ? currentContextId : next.contextId,
        }),
        replace,
      });
    },
    [activeItemId, currentContextId, currentFolderId, navigate, spaceId],
  );

  useEffect(() => {
    if (!spaceIdProp && spaceId) {
      void navigate({
        ...to.library({
          spaceId,
          folderId: currentFolderId,
          itemId: activeItemId,
          contextId: currentContextId,
        }),
        replace: true,
      });
    }
  }, [activeItemId, currentContextId, currentFolderId, navigate, spaceId, spaceIdProp]);

  const refresh = useCallback(async () => {
    await treeQuery.refetch();
    if (currentContextId) await personQuery.refetch();
  }, [currentContextId, personQuery, treeQuery]);

  const navigateFolder = useCallback(
    (nextFolderId: string | null) => {
      setQuery('');
      goTo({ folderId: nextFolderId, itemId: null });
    },
    [goTo],
  );

  const canEdit = space === null || space.role !== 'presenter';

  const allRows = useMemo((): (LibraryRow & { folderId: string | null; contextId: string | null })[] => {
    return decks
      .filter((d) => currentContextId === null || d.contextId === currentContextId)
      .map((d) => {
        const who = contextNames.get(d.contextId ?? '') ?? null;
        const contents = d.contents;
        const meta = formatContentsMeta(contents) || (who ?? '');
        return {
          id: d.id,
          name: d.title,
          folderId: d.folderId ?? null,
          contextId: d.contextId ?? null,
          searchText: who ?? '',
          meta,
          kind: 'deck' as const,
          asksTheClass: (contents?.askTheClass ?? 0) > 0,
        };
      });
  }, [decks, contextNames, currentContextId]);

  const idsInFolder = useCallback(
    (folderId: string | null): Set<string> => {
      if (folderId === null) return new Set(allRows.map((row) => row.id));
      const under = collectDescendantIds(folders, folderId);
      return new Set(
        allRows.filter((row) => row.folderId !== null && under.has(row.folderId)).map((r) => r.id),
      );
    },
    [allRows, folders],
  );

  const itemCountIn = useCallback(
    (folderId: string | null): number => idsInFolder(folderId).size,
    [idsInFolder],
  );

  const childFolders = useMemo((): LibraryRow[] => {
    const kids = folders.filter((folder) => (folder.parentId ?? null) === currentFolderId);
    return kids.map((folder) => ({
      id: folder.id,
      name: folder.name,
      meta: `${itemCountIn(folder.id)} ${itemCountIn(folder.id) === 1 ? 'deck' : 'decks'}`,
      kind: 'folder' as const,
      folderCount: itemCountIn(folder.id),
    }));
  }, [currentContextId, currentFolderId, folders, itemCountIn]);

  const visibleRows = useMemo((): LibraryRow[] => {
    const needle = query.trim().toLocaleLowerCase();
    const inScope = new Set(allRows.filter((row) => needle || row.folderId === currentFolderId).map((row) => row.id));
    const deckRows = allRows
      .filter((row) => inScope.has(row.id))
      .filter(
        (row) =>
          !needle ||
          `${row.name} ${row.searchText ?? ''}`
            .toLocaleLowerCase()
            .includes(needle),
      );
    if (needle) return deckRows.map((row) => ({ ...row, location: [spaceName, ...getBreadcrumbTrail(folders, row.folderId).map((folder) => folder.name)].join(' / ') }));
    return [...childFolders, ...deckRows];
  }, [allRows, childFolders, currentFolderId, query, spaceName, folders]);

  const crumbs = useMemo((): Crumb[] => {
    const trail = getBreadcrumbTrail(folders, currentFolderId);
    const rootName = person?.displayName ?? spaceName;
    return [{ id: null, name: rootName }, ...trail.map((f) => ({ id: f.id, name: f.name }))];
  }, [folders, currentFolderId, spaceName, person]);

  const folderName = crumbs[crumbs.length - 1]?.name ?? spaceName;

  const activePanelItem = useMemo((): PanelItem | null => {
    if (!activeItemId) return null;
    const deck = decks.find((d) => d.id === activeItemId);
    if (deck) return { kind: 'deck', data: deck };
    return null;
  }, [activeItemId, decks]);

  const outlineQuery = useQuery({
    queryKey: ['decks', activeItemId, 'outline'] as const,
    enabled: activeItemId !== null,
    queryFn: () => getDeck(activeItemId!),
  });
  const aside: DeckAside | null = outlineQuery.data?.content
    ? {
        homework: outlineQuery.data.content.homework ?? null,
        recap: outlineQuery.data.content.recap ?? null,
      }
    : null;

  const itemRecords = useMemo(() => {
    if (!activePanelItem) return [];
    const deckId = activePanelItem.data.id;
    const contextId = activePanelItem.data.contextId;
    return records.filter((record) => {
      const session = tree?.sessions?.find((r) => r.id === record.sessionId);
      return session?.deckId === deckId;
    });
  }, [activePanelItem, records, tree?.sessions]);

  const renameItem = async (item: PanelItem, name: string) => {
    try {
      await renameCloudDocument(item.data.id, name);
      await invalidateManagementData();
      await refresh();
      notify('Renamed');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not rename', 'error');
    }
  };

  const moveRows = useCallback(
    async (rows: readonly DragRow[], targetFolderId: string | null) => {
      if (!canEdit || rows.length === 0) return;
      let moved = 0;
      try {
        for (const row of rows) {
          if (row.kind !== 'deck') continue;
          await updateDeck(row.id, { folderId: targetFolderId });
          moved += 1;
        }
        await invalidateManagementData();
        await refresh();
        notify(moved === 1 ? 'Moved' : `Moved ${moved} items`);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Could not move', 'error');
      }
    },
    [canEdit, notify, refresh],
  );

  const moveItem = (item: PanelItem, folderId: string | null) =>
    moveRows([{ kind: 'deck', id: item.data.id }], folderId);

  const acceptDrop = (event: DragEvent, target: string | 'root') => {
    if (!canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(target);
    event.dataTransfer.dropEffect = 'move';
  };

  const finishDrop = (event: DragEvent, targetFolderId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const rows = parseRows(event.dataTransfer.getData(ROW_DRAG_MIME));
    if (rows.length > 0) void moveRows(rows, targetFolderId);
  };

  const startItem = async (item: PanelItem) => {
    if (!spaceId) return;
    setBusyId(item.data.id);
    try {
      const live = await startSessionFromDeck(item.data, {
        spaceId,
        folderId: item.data.folderId ?? currentFolderId,
      });
      await invalidateManagementData();
      onOpenSession(live);
    } catch (err) {
      notify(sessionStartMessage(err, 'Could not start the session'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const duplicateItem = async (item: PanelItem) => {
    if (!spaceId) return;
    setBusyId(item.data.id);
    try {
      const copy = await duplicateDeck(item.data, { spaceId, folderId: currentFolderId });
      await invalidateManagementData();
      await refresh();
      goTo({ itemId: copy.id }, true);
      notify(`Copied as “${copy.title}”`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not duplicate', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const saveCopy = async (item: PanelItem) => {
    try {
      await downloadCloudDocument(item.data.id);
      await invalidateManagementData();
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save a copy', 'error');
    }
  };

  const trashOne = async (target: TrashTarget) => {
    if (target.kind === 'deck') await trashDeck(target.id);
    if (target.kind === 'folder') await trashFolder(target.id);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await trashOne(pendingDelete);
      await invalidateManagementData();
      notify('Moved to trash');
      if (pendingDelete.id === activeItemId) goTo({ itemId: null }, true);
      setPendingDelete(null);
      await refresh();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not move to trash', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const folderActions = canEdit
    ? {
        onCreateFolder: async (parentId: string | null, name: string) => {
          if (!spaceId) return;
          try {
            await createFolder(spaceId, name, parentId);
            await invalidateManagementData();
            await refresh();
            notify('Folder created');
          } catch (err) {
            notify(err instanceof Error ? err.message : 'Could not create folder', 'error');
          }
        },
        onRenameFolder: async (folderId: string, name: string) => {
          try {
            await updateFolder(folderId, { name });
            await invalidateManagementData();
            await refresh();
            notify('Folder renamed');
          } catch (err) {
            notify(err instanceof Error ? err.message : 'Could not rename folder', 'error');
          }
        },
        onCopyFolder: async (folderId: string) => {
          try {
            const copied = await copyFolder(folderId);
            await refresh();
            notify(`Copied as “${copied.name}”`);
          } catch (err) {
            notify(err instanceof Error ? err.message : 'Could not copy folder', 'error');
          }
        },
        onTrashFolder: (folderId: string) => {
          const folder = folders.find((f) => f.id === folderId);
          setPendingDelete({ kind: 'folder', id: folderId, label: folder?.name ?? 'folder' });
        },
      }
    : undefined;

  const createTo = useMemo(
    () =>
      spaceId
        ? to.deckNew({ contextId: currentContextId, spaceId, folderId: currentFolderId })
        : null,
    [spaceId, currentFolderId, currentContextId],
  );

  const shareTo = useMemo(() => (spaceId ? to.spaceMembers(spaceId) : null), [spaceId]);

  const settingsTo = useMemo(() => (spaceId ? to.spaceEdit(spaceId) : null), [spaceId]);

  const selectRow = (id: string | null) => {
    const folder = folders.find((f) => f.id === id);
    if (folder) {
      navigateFolder(folder.id);
      return;
    }
    // Selecting a row replaces: Back walks folders, not selections.
    goTo({ itemId: id }, true);
  };

  if (!signedIn) {
    return <p className="text-secondary text-muted-foreground">Sign in to open this space.</p>;
  }

  const loadError = defaultSpaceQuery.error ?? treeQuery.error;
  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-2 p-8 text-secondary text-destructive" role="alert">
        <p>{loadError instanceof Error ? loadError.message : 'Could not load space.'}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void (spaceId ? treeQuery.refetch() : defaultSpaceQuery.refetch())}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (
    (!spaceIdProp && defaultSpaceQuery.isPending) ||
    (spaceId !== null && treeQuery.isPending) ||
    (currentContextId !== null && personQuery.isPending)
  ) {
    return <p className="p-8 text-secondary text-muted-foreground">Loading…</p>;
  }

  if (!spaceId) {
    return <p className="p-8 text-secondary text-muted-foreground">No space available.</p>;
  }

  const inspector = activePanelItem ? (
    <ItemDetailPanel
      item={activePanelItem}
      place={{ spaceId, folderId: currentFolderId }}
      canEdit={canEdit}
      busy={busyId === activePanelItem.data.id}
      onStart={(item) => void startItem(item)}
      onDuplicate={(item) => void duplicateItem(item)}
      onTrash={(item) => {
        setPendingDelete({ kind: item.kind, id: item.data.id, label: item.data.title });
      }}
      onRename={renameItem}
      onMove={moveItem}
      folders={folders}
      spaceName={spaceName}
      contents={activePanelItem.data.contents ?? null}
      aside={aside}
      records={itemRecords}
      onClose={() => goTo({ itemId: null }, true)}
      onSaveCopy={(item) => void saveCopy(item)}
    />
  ) : (
    <EmptyInspector />
  );

  const personView = currentContextId !== null && person !== null;

  return (
    <>
      <div
        className={cnLibrary(personView)}
        aria-label="Library"
      >
        {
          <TreeRail
            spaceName={spaceName}
            folders={folders}
            folderId={currentFolderId}
            onNavigate={navigateFolder}
            itemCountIn={itemCountIn}
            canDrop={canEdit}
            dropTarget={dropTarget}
            onDragOverFolder={acceptDrop}
            onDragLeaveFolder={(id) => setDropTarget((t) => (t === id ? null : t))}
            onDropOnFolder={finishDrop}
            {...(folderActions ? { folderActions } : {})}
          />
        }

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
          <LiveNow onOpen={onOpenSession} />
          <WorkspaceUpdates contextId={currentContextId} />
          {personView && person ? (
            <div className="flex items-start gap-3.5 px-8 pb-[18px] pt-[26px]">
              <PersonBadge name={person.displayName} id={person.id} size="lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <h1 className="text-page-title">{person.displayName}</h1>
                {sharedWith ? (
                  <p className="text-rail font-normal text-muted-foreground">
                    Shared with {sharedWith.name ?? sharedWith.email ?? givenName(spaceName)}
                  </p>
                ) : (
                  <p className="text-rail font-normal text-muted-foreground">Not shared</p>
                )}
              </div>
              {space?.role === 'owner' ? (
                <Button asChild variant="outline" className="h-8 bg-card"><Link {...to.spaceMembers(spaceId)}>Share</Link></Button>
              ) : null}
              {canEdit && createTo ? (
                <Button asChild className="h-8">
                  <Link {...createTo}>New deck</Link>
                </Button>
              ) : null}
            </div>
          ) : null}

          {personView && person ? (
            <div className="px-8 pb-[22px]">
              <ContextPanel
                displayName={person.displayName}
                context={person.context}
                nextNote={person.nextNote}
                onEdit={canEdit ? () => void navigate(to.studentEdit(person.id)) : undefined}
                languages={space?.settings?.languages}
                /*
                 * The person view has no other route to space settings — its
                 * chrome drops the Settings button — and the language pair is a
                 * prerequisite for word lookup, so the link lives here.
                 */
                settingsTo={canEdit ? settingsTo : null}
              />
            </div>
          ) : null}

          {personView && canEdit && currentContextId ? <details className="mx-8 mb-4 text-sm"><summary className="cursor-pointer">Student access links</summary><ContextLinksCard contextId={currentContextId} /></details> : null}
          {personView && canEdit && currentContextId ? <div className="mx-8 mb-4"><Button asChild variant="outline"><Link {...to.studentWork(currentContextId)}>Review learner work</Link></Button></div> : null}

          {canEdit && decks.length === 0 && folders.length === 0 && !currentFolderId && !query.trim()
            ? <SpaceWelcome spaceId={spaceId} contextId={currentContextId} experience={space?.settings?.experience ?? 'classroom'} /> : null}

          <LibraryList
            crumbs={crumbs}
            onNavigate={navigateFolder}
            rows={visibleRows}
            folders={folders}
            spaceName={spaceName}
            folderId={currentFolderId}
            folderName={folderName}
            query={query}
            onQuery={setQuery}
            selectedId={activeItemId}
            onSelect={selectRow}
            onOpen={(id) => { if (folders.some((f) => f.id === id)) navigateFolder(id); else void navigate(to.deckEditor(id)); }}
            canEdit={canEdit}
            createTo={canEdit ? createTo : null}
            shareTo={personView ? null : shareTo}
            settingsTo={personView || !canEdit ? null : settingsTo}
            samplesTo={canEdit && space?.settings?.experience === 'tutoring' ? to.lessonExamples(spaceId, { folderId: currentFolderId, contextId: currentContextId }) : null}
            onDragEnd={() => setDropTarget(null)}
            chrome="browser"
          />
        </div>

        {inspector}
      </div>

      <ConfirmActionDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
        title={pendingDelete?.kind === 'folder' ? 'Move folder to trash' : 'Move to trash'}
        description={
          pendingDelete ? `Moves “${pendingDelete.label}” to Trash.` : ''
        }
        confirmLabel="Move to trash"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}

function cnLibrary(_personView: boolean): string {
  return 'grid h-full min-h-0 flex-1 grid-cols-1 overflow-hidden bg-background lg:grid-cols-[200px_minmax(0,1fr)_300px]';
}
