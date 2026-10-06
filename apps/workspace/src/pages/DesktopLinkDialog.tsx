import { useEffect, useMemo, useState } from 'react';
import {
  materializeOpenRoomFile,
  type OpenRoomFileV1,
  type Outline,
} from '@openroom/schema';

import {
  createDeck,
  getDeck,
  getSpaceTree,
  listAllSpaces,
  listContexts,
  type ContextSummary,
  type FolderSummary,
  type MySpace,
} from '../api';
import { Button } from '@openroom/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@openroom/ui/components/dialog';

interface FolderChoice extends FolderSummary { depth: number }

function folderChoices(folders: FolderSummary[]): FolderChoice[] {
  const byParent = new Map<string | null, FolderSummary[]>();
  for (const folder of folders) {
    const siblings = byParent.get(folder.parentId) ?? [];
    siblings.push(folder);
    byParent.set(folder.parentId, siblings);
  }
  const walk = (parentId: string | null, depth: number): FolderChoice[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .flatMap((folder) => [{ ...folder, depth }, ...walk(folder.id, depth + 1)]);
  return walk(null, 0);
}

export function DesktopLinkDialog({
  file,
  origin,
  onCancel,
  onLinked,
}: {
  file: OpenRoomFileV1;
  origin: string;
  onCancel: () => void;
  onLinked: (next: OpenRoomFileV1, outline: Outline) => Promise<void>;
}) {
  const [contexts, setContexts] = useState<ContextSummary[]>([]);
  const [spaces, setSpaces] = useState<MySpace[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [contextId, setContextId] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([listContexts(), listAllSpaces()]).then(([nextContexts, nextSpaces]) => {
      setContexts(nextContexts);
      setSpaces(nextSpaces.filter((space) => space.role !== 'presenter'));

      setSpaceId(nextSpaces.filter((space) => !space.shared).sort((a, b) => a.createdAt - b.createdAt)[0]?.id ?? null);
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load your online workspace'));
  }, []);

  useEffect(() => {
    setFolderId(null);
    if (spaceId === null) { setFolders([]); return; }
    void getSpaceTree(spaceId).then((tree) => setFolders(tree.folders)).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not load folders');
    });
  }, [spaceId]);

  const choices = useMemo(() => folderChoices(folders), [folders]);

  const link = async () => {
    if (spaceId === null) return;
    const materialized = materializeOpenRoomFile(file);
    if (!materialized.ok) {
      setError('Local media needs a share URL or an OpenRoom upload before this file can go online. Nothing was uploaded.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createDeck({
        title: materialized.outline.meta.title,
        ...(contextId ? { contextId } : {}),
        spaceId,
        folderId,
        content: materialized.outline,
        fileId: file.fileId,
      });
      const detail = await getDeck(created.deck.id);
      if (detail.contentHash === null) throw new Error('The online copy did not return a content identity.');
      await onLinked({
        ...file,
        remote: {
          origin,
          deckId: created.deck.id,
          baseVersion: created.deck.currentVersion,
          baseContentHash: detail.contentHash,
          baseOutline: materialized.outline,
        },
      }, materialized.outline);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not put this file online');
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <DialogContent className="flex max-h-[85svh] max-w-3xl flex-col gap-5 overflow-auto">
        <DialogHeader>
          <DialogTitle>Save to workspace</DialogTitle>
          <DialogDescription>
            The file stays where you put it on this computer. Choose a workspace and folder for its shared copy.
          </DialogDescription>
        </DialogHeader>
        <section>
          <p className="mb-2 text-caption text-muted-foreground">Student (optional)</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant={contextId === null ? 'default' : 'outline'} onClick={() => setContextId(null)}>No student</Button>
            {contexts.filter((context) => context.spaceId === spaceId).map((context) => (
              <button key={context.id} type="button" aria-pressed={contextId === context.id} className={`rounded-md border p-3 text-left text-sm ${contextId === context.id ? 'border-foreground bg-muted' : 'border-border'}`} onClick={() => setContextId(context.id)}>
                {context.displayName}
              </button>
            ))}
          </div>
        </section>
        <section>
          <p className="mb-2 text-caption text-muted-foreground">Online place</p>
          <div className="flex flex-wrap gap-2">
            {spaces.map((space) => (
              <Button key={space.id} size="sm" variant={spaceId === space.id ? 'default' : 'outline'} onClick={() => { setSpaceId(space.id); setContextId(null); }}>{space.name}</Button>
            ))}
          </div>
          {spaceId === null ? null : (
            <div className="mt-3 rounded-md border border-border p-2" aria-label="Folder tree">
              <button type="button" aria-pressed={folderId === null} className={`block w-full rounded px-2 py-1.5 text-left text-sm ${folderId === null ? 'bg-muted font-medium' : ''}`} onClick={() => setFolderId(null)}>Space root</button>
              {choices.map((folder) => (
                <button key={folder.id} type="button" aria-pressed={folderId === folder.id} className={`block w-full rounded px-2 py-1.5 text-left text-sm ${folderId === folder.id ? 'bg-muted font-medium' : ''}`} style={{ paddingLeft: `${String(8 + folder.depth * 18)}px` }} onClick={() => setFolderId(folder.id)}>↳ {folder.name}</button>
              ))}
            </div>
          )}
        </section>
        {error === null ? null : <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button disabled={busy || spaceId === null} onClick={() => void link()}>{busy ? 'Saving…' : 'Save to workspace'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
