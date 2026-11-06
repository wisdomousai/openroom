import {
  AgentPane,
  blankDeck,
  DeckEditor,
  DeckEditorTopBar,
  desktopBridge,
  Presenter,
  questionReadinessIssue,
  questionReadinessMessage,
  renameDeck,
  seedAgentWithReading,
  useDraftSave,
  type DeckEditorFocus,
  type PresentationPosition,
  type StoredSession,
} from '@openroom/editor';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parseOutline, slideEmbedCode } from '@openroom/schema';
import { stringify } from 'yaml';
import { Button } from '@openroom/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@openroom/ui/components/dialog';
import { invalidateManagementData } from '../query-client';

import {
  addDeckVersion,
  facilitateSession,
  getContext,
  getDeck,
  getDeckDraft,
  getDeckFileLink,
  listMySessions,
  putDeckDraft,
  type MySession,
} from '../api';
import { startSessionFromDeck } from '../lib/library-actions';
import { downloadCloudDocument } from '../lib/cloud-document';
import { sessionStartMessage } from '../components/ContinuityLock';
import { isMissing, NotAvailable } from './tutor/shared';

/** The live session of this deck the tutor can rejoin, if any. */
function liveSessionOf(sessions: readonly MySession[], deckId: string): MySession | null {
  return sessions.find((session) => session.deckId === deckId && !session.ended && session.recoverable) ?? null;
}


/**
 * The cloud document adapter. It owns the document — load, parse, save a version —
 * and hands the parsed outline to the deck editor, which owns the three ways of
 * looking at it (structure, notes). The view is component state:
 * `#/decks/:id/edit` stays the single entry.
 *
 * The YAML text is the one store. Structure edits re-serialise the parsed
 * object over it, so switching views can never show two different decks.
 */
export function DeckEditorPage({
  deckId,
  onOpenSession,
}: {
  deckId: string;
  /** Hands the launched session to the host shell, which stores it and navigates. */
  onOpenSession: (live: StoredSession) => void;
}) {
  const [title, setTitle] = useState('Untitled');
  const [baseVersion, setBaseVersion] = useState(0);
  const [source, setSource] = useState('');
  const [documentLoaded, setDocumentLoaded] = useState(false);
  const [draftConflict, setDraftConflict] = useState(false);
  const [starting, setStarting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * Which presentable step Present opened at, or null while it is closed.
   * A number rather than a boolean because the ribbon will hand it the block
   * you are looking at ("start from here"); the top bar passes 0.
   */
  const [presentFrom, setPresentFrom] = useState<number | null>(null);
  const [startImmediately, setStartImmediately] = useState(false);
  const [activeStepId, setActiveStepId] = useState<string>();
  /**
   * The stored version the editor holds unchanged, with the text it was
   * loaded as. Any edit makes the text differ, and History then has no row
   * that is "open".
   */
  const [loaded, setLoaded] = useState<{ version: number; source: string } | null>(null);
  const [focus, setFocus] = useState<DeckEditorFocus>();
  const [confirmStart, setConfirmStart] = useState(false);
  const [rejoining, setRejoining] = useState(false);
  const validation = useMemo(
    () => (source === '' ? null : parseOutline(source, 'yaml')),
    [source],
  );
  // One open, two reads: the last stamped version and the rolling draft.
  const designQuery = useQuery({
    queryKey: ['decks', deckId, 'designer'] as const,
    queryFn: async () => {
      const [detail, draft, fileLink] = await Promise.all([
        getDeck(deckId),
        getDeckDraft(deckId),
        getDeckFileLink(deckId).catch(() => ({ linked: false as const, fileId: null, locations: [] })),
      ]);
      return { detail, draft, fileLink };
    },
    // A missing deck answers the same way every time.
    retry: (count, error) => !isMissing(error) && count < 2,
  });
  const liveQuery = useQuery({ queryKey: ['sessions', 'live-now'], queryFn: listMySessions, refetchInterval: 15_000 });
  const liveSession = liveSessionOf(liveQuery.data ?? [], deckId);
  const contextId = designQuery.data?.detail.deck.contextId ?? null;
  const contextQuery = useQuery({
    queryKey: ['contexts', contextId],
    queryFn: () => getContext(contextId!),
    enabled: contextId !== null && contextId !== '',
  });
  const recipient = !designQuery.data
    ? undefined
    : contextId === null || contextId === ''
      ? null
      : contextQuery.data?.displayName;

  useEffect(() => {
    const data = designQuery.data;
    if (!data || documentLoaded) return;
    setDocumentLoaded(true);
    const { detail, draft } = data;
    setTitle(detail.deck.title);
    setBaseVersion(draft?.baseVersion ?? detail.deck.currentVersion);
    setDraftConflict(draft !== null && draft.baseVersion !== detail.deck.currentVersion);
    // Preserve the draft even when its base is stale; resolve that conflict explicitly.
    const text = draft !== null
      ? draft.source
      : stringify(detail.content ?? blankDeck(detail.deck.title), { lineWidth: 100 });
    setSource(text);
    setLoaded(draft === null ? { version: detail.deck.currentVersion, source: text } : null);
  }, [designQuery.data, documentLoaded]);

  const draftSave = useDraftSave({
    deckId,
    source,
    baseVersion,
    enabled: documentLoaded && !draftConflict,
    // Another tab, a co-teacher or an agent stamped a version: this draft's
    // base is stale, and every retry would be refused the same way.
    onConflict: () => {
      void designQuery.refetch();
      setDraftConflict(true);
    },
  });
  const loadedVersion = loaded !== null && loaded.source === source ? loaded.version : null;

  /**
   * Stamp a version. Shared by the explicit Save and by Start, which must not
   * launch a session from text the server has never validated.
   */
  const stamp = async (): Promise<number> => {
    if (!validation?.ok) throw new Error('This plan file cannot be read as an outline yet.');
    const result = await addDeckVersion(deckId, validation.outline, baseVersion);
    await invalidateManagementData();
    setBaseVersion(result.version);
    // The server dropped the draft as part of stamping; match it locally so
    // auto-save does not immediately write the same text back.
    draftSave.versionSaved(source, result.version);
    setLoaded({ version: result.version, source });
    if (!result.unchanged) setTitle(validation.outline.meta.title);
    return result.version;
  };

  // Unstamped work — Start stamps before it launches.
  const dirty = draftSave.status.state !== 'idle';

  /**
   * The agent edits the hosted deck, so it must see what the tutor sees:
   * stamp unstamped work first, the same silent stamp Start performs.
   */
  const flushForAgent = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (validation?.ok !== true) return false;
    try {
      await stamp();
      return true;
    } catch {
      return false;
    }
  };

  /**
   * After a run, adopt what the agent stamped — unless the tutor typed while
   * it ran, in which case their draft stays and the normal version-conflict
   * flow arbitrates on the next stamp.
   */
  const adoptAgentEdits = async (): Promise<void> => {
    const refreshed = await designQuery.refetch();
    const nextDetail = refreshed.data?.detail;
    if (!nextDetail || nextDetail.deck.currentVersion === baseVersion) return;
    if (draftSave.status.state !== 'idle') return;
    const nextSource = stringify(nextDetail.content ?? blankDeck(nextDetail.deck.title), { lineWidth: 100 });
    setTitle(nextDetail.deck.title);
    setBaseVersion(nextDetail.deck.currentVersion);
    setSource(nextSource);
    setLoaded({ version: nextDetail.deck.currentVersion, source: nextSource });
    draftSave.versionSaved(nextSource, nextDetail.deck.currentVersion);
  };

  /**
   * Coming back to this tab: if the deck moved on elsewhere, take the newer
   * text when nothing here is unsaved, and ask otherwise. Without this a
   * second tab learns of a newer version only when its next save is refused.
   */
  const checkFreshness = async (): Promise<void> => {
    if (!documentLoaded || draftConflict) return;
    const refreshed = await designQuery.refetch();
    const fresh = refreshed.data;
    if (!fresh) return;
    const { detail: nextDetail, draft } = fresh;
    const moved = nextDetail.deck.currentVersion !== baseVersion;
    const otherDraft = draft !== null && draft.baseVersion === nextDetail.deck.currentVersion && draft.source !== source;
    if (!moved && !otherDraft) return;
    const settled = draftSave.status.state === 'idle' || draftSave.status.state === 'saved';
    if (!settled) {
      setDraftConflict(true);
      return;
    }
    const nextSource = otherDraft
      ? draft.source
      : stringify(nextDetail.content ?? blankDeck(nextDetail.deck.title), { lineWidth: 100 });
    setTitle(nextDetail.deck.title);
    setBaseVersion(nextDetail.deck.currentVersion);
    setSource(nextSource);
    setLoaded(otherDraft ? null : { version: nextDetail.deck.currentVersion, source: nextSource });
    draftSave.versionSaved(nextSource, nextDetail.deck.currentVersion);
  };
  const freshnessRef = useRef(checkFreshness);
  freshnessRef.current = checkFreshness;
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void freshnessRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  /**
   * Agents also stamp versions from outside this page — the embedded pane
   * mid-run, or a handed-off Codex terminal. The desktop broadcasts every
   * stamped save; adopt it the same way a finished pane run is adopted.
   */
  const adoptRef = useRef(adoptAgentEdits);
  adoptRef.current = adoptAgentEdits;
  useEffect(() => {
    const bridge = desktopBridge();
    if (bridge === null) return;
    return bridge.onDeckSaved((event) => {
      if (event.deckId === deckId) void adoptRef.current();
    });
  }, [deckId]);

  /**
   * Start: get the edit into a version, make a run of it, and open the session.
   * The silent stamp is the point — a tutor pressing Start has already decided
   * this is the deliverable, and a "save first" dialog would only be in the way.
   */
  const start = async (cursor: PresentationPosition): Promise<StoredSession> => {
    const deck = designQuery.data?.detail.deck;
    if (!deck || validation?.ok !== true) throw new Error('The deck is not ready.');
    const issue = questionReadinessMessage(validation.outline);
    if (issue) throw new Error(issue);
    setStarting(true);
    setLoadError(null);
    try {
      const version = await stamp();
      // One start implementation, shared with the Library and Home: the session
      // carries the deck's title and place, which is what Notes reads to find
      // its way back to the deck afterwards.
      const live = await startSessionFromDeck(
        { id: deck.id, title: validation.outline.meta.title, contextId: deck.contextId, currentVersion: version },
        { spaceId: deck.spaceId, folderId: deck.folderId },
        cursor,
      );
      await invalidateManagementData();
      // A reload returns here, and the top bar then offers Live now · Rejoin
      // from the sessions list, so a running lesson is never hidden.
      void liveQuery.refetch();
      return live;
    } catch (cause) {
      setLoadError(sessionStartMessage(cause, 'Could not start this session'));
      throw cause;
    } finally { setStarting(false); }
  };

  const resolveDraft = async (keep: boolean) => {
    // Resolve against what the server holds now, not what this tab loaded.
    const refreshed = await designQuery.refetch();
    const fresh = refreshed.data ?? designQuery.data;
    if (!fresh) return;
    const { detail, draft } = fresh;
    const savedDraft = draft !== null && draft.baseVersion === detail.deck.currentVersion ? draft.source : null;
    const stamped = stringify(detail.content ?? blankDeck(detail.deck.title), { lineWidth: 100 });
    const text = keep ? source : savedDraft ?? stamped;
    try {
      await putDeckDraft(deckId, text, detail.deck.currentVersion);
      setSource(text);
      setBaseVersion(detail.deck.currentVersion);
      setLoaded(!keep && savedDraft === null ? { version: detail.deck.currentVersion, source: text } : null);
      setLoadError(null);
      setDraftConflict(false);
    } catch (cause) { setLoadError(cause instanceof Error ? cause.message : 'Could not resolve the draft.'); }
  };

  const rejoin = async (session: MySession) => {
    setRejoining(true);
    setLoadError(null);
    try {
      onOpenSession({ ...await facilitateSession(session.sessionCode), title: session.title ?? undefined });
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not join the session.');
    } finally { setRejoining(false); }
  };

  const openStart = () => { setStartImmediately(true); setPresentFrom(0); };
  const readiness = validation?.ok ? questionReadinessIssue(validation.outline) : null;

  const detail = designQuery.data?.detail ?? null;
  const loadMessage = loadError
    ?? (designQuery.error instanceof Error ? designQuery.error.message : designQuery.error ? 'Could not load template' : null);

  const downloadFile = async () => {
    if (validation?.ok !== true || copying) return;
    setCopying(true); setLoadError(null);
    try {
      const saved = await downloadCloudDocument(deckId, { outline: validation.outline, baseVersion });
      setBaseVersion(saved.version);
      draftSave.versionSaved(source, saved.version);
      setLoaded({ version: saved.version, source });
      await invalidateManagementData();
    } catch (cause) { setLoadError(cause instanceof Error ? cause.message : 'Could not save a copy.'); }
    finally { setCopying(false); }
  };

  if (!documentLoaded && isMissing(designQuery.error)) {
    return (
      <div className="flex h-svh min-h-0 min-w-0 flex-col bg-background">
        <NotAvailable what="deck" />
      </div>
    );
  }

  return (
    <div className="flex h-svh min-h-0 min-w-0 flex-col bg-background">
      <DeckEditorTopBar
        fileStatus={copying ? <span role="status">Preparing copy…</span> : undefined}
        title={validation?.ok ? validation.outline.meta.title : title}
        onRename={(name) => { if (validation?.ok) setSource(stringify(renameDeck(validation.outline, name), { lineWidth: 100 })); }}
        folderName={detail?.folderName ?? null}
        // The back arrow lands on the deck's own row in the Library.
        libraryTo={{
          kind: 'library',
          place: {
            spaceId: detail?.deck.spaceId,
            folderId: detail?.deck.folderId,
            itemId: detail?.deck.id,
            contextId: detail?.deck.contextId,
          },
        }}
        shareTo={detail?.deck.spaceId ? { kind: 'spaceMembers', spaceId: detail.deck.spaceId } : null}
        status={draftSave.status}
        onPresent={() => { setStartImmediately(false); setPresentFrom(0); }}
        canPresent={validation?.ok === true}
        onStart={() => { if (liveSession) setConfirmStart(true); else openStart(); }}
        starting={starting}
        canStart={validation?.ok === true && !draftConflict}
        startIssue={readiness?.message ?? null}
        onShowIssue={readiness?.target
          ? () => {
              const target = readiness.target!;
              setFocus((previous) => ({ target, nonce: (previous?.nonce ?? 0) + 1 }));
            }
          : undefined}
        live={liveSession
          ? { label: liveSession.shared ? 'Join' : 'Rejoin', onRejoin: () => void rejoin(liveSession), rejoining }
          : null}
        error={loadMessage}
      />
      {draftConflict ? <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2 text-secondary">
        <p>This deck was changed somewhere else since you opened it. Your edits are kept below.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void resolveDraft(true)}>Keep this draft</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void resolveDraft(false)}>Use saved version</Button>
      </div> : null}
      <Dialog open={confirmStart} onOpenChange={setConfirmStart}>
        <DialogContent aria-describedby="deck-live-confirm">
          <DialogHeader>
            <DialogTitle>This deck is live now</DialogTitle>
            <DialogDescription id="deck-live-confirm">
              A session of this deck is still running. Rejoin it, or start another session.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmStart(false)}>Cancel</Button>
            <Button type="button" variant="outline" onClick={() => { setConfirmStart(false); openStart(); }}>Start another</Button>
            <Button
              type="button"
              disabled={rejoining || liveSession === null}
              onClick={() => { setConfirmStart(false); if (liveSession) void rejoin(liveSession); }}
            >
              Rejoin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {!documentLoaded ? (
        designQuery.isError ? (
          <div className="flex flex-col items-start gap-2 p-5" role="alert">
            <p className="text-secondary text-muted-foreground">This deck could not be opened.</p>
            <Button type="button" size="sm" variant="outline" disabled={designQuery.isFetching} onClick={() => void designQuery.refetch()}>
              {designQuery.isFetching ? 'Opening…' : 'Try again'}
            </Button>
          </div>
        ) : (
          <p className="p-5 text-secondary text-muted-foreground">Loading…</p>
        )
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <DeckEditor
              deckId={deckId}
              activeStepId={activeStepId}
              spaceId={detail?.deck.spaceId ?? null}
              contextId={detail?.deck.contextId ?? null}
              currentVersion={baseVersion}
              versionRefresh={baseVersion}
              source={source}
              onSourceChange={setSource}
              loadedVersion={loadedVersion}
              unsavedDraft={loadedVersion === null}
              onLoadVersion={(nextSource, version) => {
                setSource(nextSource);
                setLoaded({ version, source: nextSource });
              }}
              focus={focus}
              recipient={recipient}
              onEmbedCode={async (stepId) => {
                if (draftConflict) throw new Error('Resolve the saved-deck conflict before copying an embed code.');
                if (dirty || baseVersion === 0) await stamp();
                return slideEmbedCode({ deckId, stepId });
              }}
              validation={validation}
              onPresentFrom={(blockIndex) => { setStartImmediately(false); setPresentFrom(blockIndex); }}
              onDownloadFile={validation?.ok && !copying ? () => void downloadFile() : undefined}
              onRefineWithAgent={seedAgentWithReading}
            />
          </div>
          {/* Renders only inside OpenRoom Desktop (needs the bridge); browsers get nothing. */}
          <AgentPane deckId={deckId} onBeforeRun={flushForAgent} onAfterRun={() => void adoptAgentEdits()} />
        </div>
      )}
      {/* Present shows the draft as the audience would see it. It is bound to the
          parsed outline, so an edit that breaks the plan file closes nothing
          the tutor is currently showing — it simply cannot be opened. */}
      {presentFrom === null || validation?.ok !== true ? null : (
        <Presenter
          outline={validation.outline}
          fromStep={presentFrom}
          startImmediately={startImmediately}
          onStart={start}
          onClose={(stepId) => { setActiveStepId(stepId); setPresentFrom(null); }}
        />
      )}
    </div>
  );
}
