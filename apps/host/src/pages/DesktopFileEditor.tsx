import { blankDeck, renameDeck, questionReadinessMessage } from '../lib/deck-document';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  editableOutlineForOpenRoomFile,
  outlineResourceIds,
  materializeOpenRoomFile,
  mergeOutlines,
  outlineContentHash,
  parseOpenRoomFile,
  parseOutline,
  slideEmbedCode,
  stringifyOpenRoomFile,
  updateOpenRoomFileOutline,
  type OpenRoomFileV1,
  type Outline,
} from '@openroom/schema';
import { stringify } from 'yaml';


import { to } from '../destinations';
import { desktopBridge, type DesktopDocumentChanged } from '../desktop-bridge';
import { AgentPane } from './AgentPane';
import {
  addDeckVersion,
  startSessionFromOutline,
  getDeck,
  getDeckIfChanged,
  reportDeckFileLocation,
  startCreatedSession,
  uploadEphemeralSessionResource,
  uploadAsset,
} from '../api';
import { Button } from '@openroom/ui/components/button';
import { DeckEditor } from './deck-edit/DeckEditor';
import { Presenter, type PresentationPosition } from '../presenter/Presenter';
import { DeckEditorTopBar } from './deck-edit/DeckEditorTopBar';
import { startSessionFromDeck } from '../lib/library-actions';
import type { StoredSession } from '../types';
import { DesktopLinkDialog } from './DesktopLinkDialog';
import { sessionStartMessage } from '../components/ContinuityLock';


function newFile(): OpenRoomFileV1 {
  return {
    format: 'openroom-file',
    fileVersion: 1,
    fileId: crypto.randomUUID(),
    localRevision: 0,
    outline: blankDeck(),
  };
}

function problem(errors: { path: string; message: string }[]): string {
  return errors.slice(0, 3).map((error) => `${error.path}: ${error.message}`).join('\n');
}

export function DesktopFileEditor() {
  const bridge = desktopBridge();
  const [file, setFile] = useState<OpenRoomFileV1 | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('Untitled.openroom');
  const [source, setSource] = useState('');
  const [savedSource, setSavedSource] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [presentFrom, setPresentFrom] = useState<number | null>(null);
  const [startImmediately, setStartImmediately] = useState(false);
  const [activeStepId, setActiveStepId] = useState<string>();
  const [device, setDevice] = useState<{ id: string; name: string; origin: string } | null>(null);
  const [showLink, setShowLink] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'local' | 'checking' | 'synced' | 'offline' | 'conflict'>('local');
  const [syncConflict, setSyncConflict] = useState<{ outline: Outline; version: number; hash: string } | null>(null);
  const recoveryTimer = useRef<number | null>(null);
  const syncing = useRef(false);
  const etag = useRef('');

  useEffect(() => {
    if (bridge === null) {
      setError('This route is available in the OpenRoom desktop client.');
      return;
    }
    void bridge.getDocument().then((snapshot) => {
      const text = snapshot.recoverySource ?? snapshot.source;
      const parsed = text === null ? { ok: true as const, file: newFile() } : parseOpenRoomFile(text);
      if (!parsed.ok) {
        setError(problem(parsed.errors));
        return;
      }
      const visual = stringify(editableOutlineForOpenRoomFile(parsed.file), { lineWidth: 100 });
      setFile(parsed.file);
      setSource(visual);
      setSavedSource(snapshot.recoverySource === null ? visual : '');
      setPath(snapshot.path);
      setDisplayName(snapshot.displayName);
      setDevice({ id: snapshot.deviceId, name: snapshot.deviceName, origin: snapshot.onlineOrigin });
      setSyncStatus(parsed.file.remote === undefined ? 'local' : 'checking');
      if (snapshot.recoverySource !== null) setError('Recovered changes that had not been saved to the file.');
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not open this file');
    });
  }, [bridge]);

  const validation = useMemo(() => (source === '' ? null : parseOutline(source, 'yaml')), [source]);
  const dirty = source !== savedSource || path === null;

  const serialized = useCallback((incrementRevision: boolean): string | null => {
    if (file === null || validation?.ok !== true) return null;
    const next = updateOpenRoomFileOutline(file, validation.outline);
    return stringifyOpenRoomFile({
      ...next,
      localRevision: incrementRevision ? file.localRevision + 1 : file.localRevision,
    });
  }, [file, validation]);

  useEffect(() => {
    if (bridge === null || file === null || !dirty) return;
    if (recoveryTimer.current !== null) window.clearTimeout(recoveryTimer.current);
    recoveryTimer.current = window.setTimeout(() => {
      const text = serialized(false);
      if (text !== null) void bridge.saveRecovery(file.fileId, text);
    }, 750);
    return () => {
      if (recoveryTimer.current !== null) window.clearTimeout(recoveryTimer.current);
    };
  }, [bridge, dirty, file, serialized]);

  const save = async (as = false) => {
    if (bridge === null || file === null) return;
    const text = serialized(true);
    if (text === null) {
      setError('Repair the outline before saving.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const snapshot = as ? await bridge.saveDocumentAs(text) : await bridge.saveDocument(text);
      if (snapshot === null) return;
      const parsed = parseOpenRoomFile(text);
      if (!parsed.ok) throw new Error(problem(parsed.errors));
      setFile(parsed.file);
      setSavedSource(source);
      setPath(snapshot.path);
      setDisplayName(snapshot.displayName);
      await bridge.clearRecovery(parsed.file.fileId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this file');
    } finally {
      setSaving(false);
    }
  };

  const writeLinkedFile = useCallback(async (next: OpenRoomFileV1, outline: Outline) => {
    if (bridge === null) return;
    const written = { ...next, localRevision: next.localRevision + 1 };
    const text = stringifyOpenRoomFile(written);
    const snapshot = await bridge.saveDocument(text);
    setFile(written);
    const visual = stringify(editableOutlineForOpenRoomFile(written), { lineWidth: 100 });
    setSource(visual);
    setSavedSource(visual);
    setPath(snapshot.path);
    setDisplayName(snapshot.displayName);
    setShowLink(false);
    setSyncStatus('synced');
    if (written.remote !== undefined && snapshot.path !== null && device !== null) {
      const hash = await outlineContentHash(outline);
      await reportDeckFileLocation(written.remote.deckId, device.id, {
        fileId: written.fileId,
        deviceName: device.name,
        path: snapshot.path,
        localRevision: written.localRevision,
        contentHash: hash,
        syncedVersion: written.remote.baseVersion,
        syncedHash: written.remote.baseContentHash,
      });
    }
  }, [bridge, device]);

  const syncNow = useCallback(async () => {
    if (bridge === null || file?.remote === undefined || device === null || syncing.current || dirty) return;
    const remote = file.remote;
    syncing.current = true;
    setSyncStatus('checking');
    try {
      let syncFile = file;
      const pendingResources = Object.entries(file.resources ?? {}).filter(
        ([, resource]) => resource.online?.sha256 !== resource.sha256,
      );
      if (pendingResources.length > 0) {
        const detail = await getDeck(remote.deckId);
        const resources = { ...(file.resources ?? {}) };
        for (const [resourceId, resource] of pendingResources) {
          const bytes = await bridge.readResource(resourceId);
          const uploaded = await uploadAsset(
            detail.deck.spaceId,
            new File([Uint8Array.from(bytes).buffer], resource.name, { type: resource.contentType }),
          );
          resources[resourceId] = {
            ...resource,
            online: { kind: 'openroom-asset', assetId: uploaded.id, sha256: resource.sha256 },
          };
        }
        syncFile = { ...file, resources };
        await bridge.saveDocument(stringifyOpenRoomFile(syncFile));
        setFile(syncFile);
      }
      const localResult = materializeOpenRoomFile(syncFile);
      if (!localResult.ok) { setSyncStatus('offline'); return; }
      const response = await getDeckIfChanged(remote.deckId, etag.current);
      if (!response.changed) {
        if (path !== null) {
          const hash = await outlineContentHash(localResult.outline);
          await reportDeckFileLocation(remote.deckId, device.id, {
            fileId: syncFile.fileId,
            deviceName: device.name,
            path,
            localRevision: syncFile.localRevision,
            contentHash: hash,
            syncedVersion: remote.baseVersion,
            syncedHash: remote.baseContentHash,
          });
        }
        setSyncStatus('synced');
        return;
      }
      if (response.etag !== null) etag.current = response.etag;
      const remoteOutline = response.detail.content;
      const remoteHash = response.detail.contentHash;
      if (remoteOutline === null || remoteHash === null) throw new Error('The online copy has no readable outline.');
      const localHash = await outlineContentHash(localResult.outline);
      const localChanged = localHash !== remote.baseContentHash;
      const remoteChanged = remoteHash !== remote.baseContentHash;

      if (!localChanged && !remoteChanged) { setSyncStatus('synced'); return; }
      if (!localChanged && remoteChanged) {
        await writeLinkedFile({
          ...updateOpenRoomFileOutline(syncFile, remoteOutline),
          remote: { ...remote, baseVersion: response.detail.deck.currentVersion, baseContentHash: remoteHash, baseOutline: remoteOutline },
        }, remoteOutline);
        return;
      }

      let upload = localResult.outline;
      if (remoteChanged) {
        const merged = mergeOutlines(remote.baseOutline, localResult.outline, remoteOutline);
        if (!merged.ok) {
          setSyncConflict({ outline: remoteOutline, version: response.detail.deck.currentVersion, hash: remoteHash });
          setSyncStatus('conflict');
          return;
        }
        upload = merged.outline;
      }
      const saved = await addDeckVersion(remote.deckId, upload, response.detail.deck.currentVersion, {
        fileId: syncFile.fileId,
        localRevision: syncFile.localRevision,
        baseContentHash: remoteHash,
      });
      await writeLinkedFile({
        ...updateOpenRoomFileOutline(syncFile, upload),
        remote: { ...remote, baseVersion: saved.version, baseContentHash: saved.contentHash, baseOutline: upload },
      }, upload);
    } catch {
      setSyncStatus('offline');
    } finally {
      syncing.current = false;
    }
  }, [bridge, device, dirty, file, path, writeLinkedFile]);

  const resolveSyncConflict = async (choice: 'local' | 'online') => {
    if (file?.remote === undefined || syncConflict === null) return;
    setSyncStatus('checking');
    try {
      if (choice === 'online') {
        await writeLinkedFile({
          ...updateOpenRoomFileOutline(file, syncConflict.outline),
          remote: { ...file.remote, baseVersion: syncConflict.version, baseContentHash: syncConflict.hash, baseOutline: syncConflict.outline },
        }, syncConflict.outline);
      } else {
        const local = materializeOpenRoomFile(file);
        if (!local.ok) throw new Error('Local media must be shareable before choosing this file.');
        const saved = await addDeckVersion(file.remote.deckId, local.outline, syncConflict.version, {
          fileId: file.fileId,
          localRevision: file.localRevision,
          baseContentHash: syncConflict.hash,
        });
        await writeLinkedFile({
          ...file,
          remote: { ...file.remote, baseVersion: saved.version, baseContentHash: saved.contentHash, baseOutline: local.outline },
        }, local.outline);
      }
      setSyncConflict(null);
      setSyncStatus('synced');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not resolve the sync conflict');
      setSyncStatus('conflict');
    }
  };

  useEffect(() => {
    if (file?.remote === undefined) return;
    void syncNow();
    const timer = window.setInterval(() => void syncNow(), 30_000);
    const focus = () => void syncNow();
    window.addEventListener('focus', focus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [file?.remote, syncNow]);

  const applyDocumentSource = useCallback((text: string, pathValue: string | null, name: string) => {
    const parsed = parseOpenRoomFile(text);
    if (!parsed.ok) {
      setError(problem(parsed.errors));
      return;
    }
    const visual = stringify(editableOutlineForOpenRoomFile(parsed.file), { lineWidth: 100 });
    setFile(parsed.file);
    setSource(visual);
    setSavedSource(visual);
    setPath(pathValue);
    setDisplayName(name);
  }, []);

  useEffect(() => {
    if (bridge === null) return;
    return bridge.onDocumentChanged((change: DesktopDocumentChanged) => {
      applyDocumentSource(change.source, change.path, change.displayName);
    });
  }, [applyDocumentSource, bridge]);

  const flushForAgent = async (): Promise<boolean> => {
    if (bridge === null || file === null) return false;
    const text = serialized(false);
    if (text === null) return false;
    try {
      if (path === null) {
        await bridge.saveRecovery(file.fileId, text);
        return true;
      }
      const snapshot = await bridge.saveDocument(text);
      const parsed = parseOpenRoomFile(text);
      if (parsed.ok) {
        setFile(parsed.file);
        setSavedSource(source);
        setPath(snapshot.path);
        setDisplayName(snapshot.displayName);
      }
      return true;
    } catch {
      return false;
    }
  };

  const startSession = async (cursor: PresentationPosition): Promise<StoredSession> => {
    if (bridge === null || file === null || validation?.ok !== true) throw new Error('The deck is not ready.');
    const issue = questionReadinessMessage(validation.outline);
    if (issue) throw new Error(issue);
    setStarting(true);
    setError(null);
    try {
      const currentFile = updateOpenRoomFileOutline(file, validation.outline);
      if (file.remote) {
        const materialized = materializeOpenRoomFile(currentFile);
        if (!materialized.ok) throw new Error('The linked deck has local resources that need to be synced first.');
        const saved = await addDeckVersion(file.remote.deckId, materialized.outline, file.remote.baseVersion);
        await writeLinkedFile({ ...currentFile, remote: { ...file.remote, baseVersion: saved.version, baseContentHash: saved.contentHash, baseOutline: materialized.outline } }, materialized.outline);
        const detail = await getDeck(file.remote.deckId);
        return startSessionFromDeck({ ...detail.deck, currentVersion: saved.version }, { spaceId: detail.deck.spaceId, folderId: detail.deck.folderId }, cursor);
      }
      const embeddedOutline = currentFile.outline;
      const created = await startSessionFromOutline(embeddedOutline);
      for (const resourceId of outlineResourceIds(embeddedOutline)) {
        const resource = file.resources?.[resourceId];
        if (resource === undefined) throw new Error(`Embedded resource ${resourceId} is missing from this file.`);
        const bytes = await bridge.readResource(resourceId);
        await uploadEphemeralSessionResource(
          created.sessionCode,
          created.hostToken,
          resourceId,
          resource.contentType,
          resource.sha256,
          bytes,
        );
      }
      await startCreatedSession(created.sessionCode, created.hostToken, cursor);
      return {
        ...created,
        title: validation.outline.meta.title,
        createdAt: Date.now(),
      };
    } catch (cause) {
      setError(sessionStartMessage(cause, 'Could not start the session.'));
      throw cause;
    } finally {
      setStarting(false);
    }
  };

  if (file === null) {
    return <main className="flex min-h-svh items-center justify-center bg-background p-6 text-muted-foreground">{error ?? 'Opening file…'}</main>;
  }

  return (
    <div className="flex h-svh min-h-0 min-w-0 flex-col bg-background">
      <DeckEditorTopBar
        title={validation?.ok ? validation.outline.meta.title : displayName}
        onRename={(name) => { if (validation?.ok) setSource(stringify(renameDeck(validation.outline, name), { lineWidth: 100 })); }}
        folderName={null} libraryTo={to.library()} shareTo={null}
        status={{ state: saving ? 'saving' : dirty ? 'dirty' : 'saved', label: saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved', retrying: false, savedAt: null }}
        fileStatus={<span className="text-caption text-muted-foreground">{file.remote ? syncStatus === 'synced' ? 'Synced' : syncStatus === 'conflict' ? 'Sync conflict' : syncStatus === 'checking' ? 'Syncing…' : 'Offline' : 'Local file'}</span>}
        onPresent={() => { setStartImmediately(false); setPresentFrom(0); }} canPresent={validation?.ok === true}
        onStart={() => { setStartImmediately(true); setPresentFrom(0); }} canStart={validation?.ok === true} starting={starting} error={error}
        startIssue={validation?.ok ? questionReadinessMessage(validation.outline) : null}
      />
        {syncConflict === null ? null : (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-destructive/5 px-5 py-2" role="alert">
            <p className="text-xs"><span className="font-semibold">This file and the online copy changed in the same place.</span> Both are preserved in online version history until you choose.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void resolveSyncConflict('online')}>Use online copy</Button>
              <Button size="sm" onClick={() => void resolveSyncConflict('local')}>Keep this file</Button>
            </div>
          </div>
        )}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DeckEditor
            deckId={file.remote?.deckId ?? file.fileId}
            activeStepId={activeStepId}
            spaceId={null}
            source={source}
            onSourceChange={setSource}
            onEmbedCode={async (stepId) => {
              if (!file.remote) throw new Error('Use File → Save to workspace first so PowerPoint can load this slide.');
              if (!validation?.ok) throw new Error('This deck cannot be read yet.');
              if (syncConflict) throw new Error('Resolve the sync conflict before copying an embed code.');
              const currentFile = updateOpenRoomFileOutline(file, validation.outline);
              const materialized = materializeOpenRoomFile(currentFile);
              if (!materialized.ok) throw new Error('Sync the deck’s media before copying an embed code.');
              const saved = await addDeckVersion(file.remote.deckId, materialized.outline, file.remote.baseVersion);
              await writeLinkedFile({ ...currentFile, remote: { ...file.remote, baseVersion: saved.version, baseContentHash: saved.contentHash, baseOutline: materialized.outline } }, materialized.outline);
              return slideEmbedCode({ deckId: file.remote.deckId, stepId });
            }}
            validation={validation}
            onPresentFrom={(index) => { setStartImmediately(false); setPresentFrom(index); }}
            fileActions={<>
              <Button size="sm" variant="subtle" onClick={() => void bridge?.openFile()}>Open…</Button>
              <Button size="sm" variant="subtle" disabled={saving || validation?.ok !== true} onClick={() => void save()}>Save</Button>
              <Button size="sm" variant="subtle" disabled={saving || validation?.ok !== true} onClick={() => void save(true)}>Save as…</Button>
              <Button size="sm" variant="subtle" disabled={!path} onClick={() => void bridge?.showInFolder()}>Show in folder</Button>
              {file.remote ? <>
                <Button size="sm" variant="subtle" disabled={dirty || syncStatus === 'checking'} onClick={() => void syncNow()}>Sync now</Button>
                <Button asChild size="sm" variant="subtle"><a href={`${file.remote.origin}host/#/decks/${encodeURIComponent(file.remote.deckId)}/edit`}>Open online</a></Button>
              </> : <Button size="sm" variant="subtle" onClick={() => setShowLink(true)}>Save to workspace…</Button>}
            </>}
            onEmbeddedResource={(resourceId, resource) => {
              setFile((current) => current === null ? current : {
                ...current,
                resources: { ...(current.resources ?? {}), [resourceId]: resource },
              });
            }}
          />
        </div>
        <AgentPane onBeforeRun={flushForAgent} />
      </div>
      {presentFrom === null || validation?.ok !== true ? null : (
        <Presenter outline={validation.outline} fromStep={presentFrom} startImmediately={startImmediately} documentSource={serialized(false)} onStart={startSession} onClose={(stepId) => { setActiveStepId(stepId); setPresentFrom(null); }} />
      )}
      {showLink && device !== null ? (
        <DesktopLinkDialog
          file={validation?.ok ? updateOpenRoomFileOutline(file, validation.outline) : file}
          origin={device.origin}
          onCancel={() => setShowLink(false)}
          onLinked={writeLinkedFile}
        />
      ) : null}
    </div>
  );
}
