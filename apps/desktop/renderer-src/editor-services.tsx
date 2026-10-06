/**
 * Desktop's `EditorServices` adapter for @openroom/editor: the file window
 * (`#/file`) and the presentation window (`#/present`).
 *
 * A local file has no space or person, so the adapter carries no draft writes,
 * learner work, brand kits or other workspace slots. Signed in, decks link to
 * the control plane through the API; Library and session pages open in the
 * workspace bundle when this build ships it, and are not offered when it does
 * not (destinations.ts).
 *
 * This is the one place the editor meets this renderer's API client, the query
 * cache and this device's storage.
 */
// First, so the projector sheet keeps its place at the head of the CSS.
import './stage.css';
import { useCallback, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StageView } from '@openroom/stage-src/StageView';
import {
  desktopBridge,
  EditorServicesProvider,
  type EditorDestination,
  type EditorLinkProps,
  type EditorServices,
} from '@openroom/editor';
import { ToastRegion, useToasts } from '@openroom/ui/toasts';

import {
  assetUrl,
  checkEmbeddable,
  downloadExport,
  fetchHostSnapshot,
  fetchSessionContext,
  fetchStageToken,
  getSessionItem,
  importReadingMaterial,
  listAssets,
  lookupDictionary,
  resolveJoinUrl,
  searchStock,
  sessionStartMessage,
  stageUrlFor,
  uploadAsset,
} from './api';
import { DECK_DOCUMENT_HREF, destinationHref, workspaceAvailable, workspaceShareUrl } from './destinations';
import { clearLiveSession, saveLiveSession } from './session-storage';

/** The line shown when a destination needs the workspace this build does not ship. */
const NO_WORKSPACE = 'This build has no workspace.';

function DestinationLink({ to: destination, ...rest }: EditorLinkProps) {
  const href = destinationHref(destination, workspaceAvailable());
  if (href === null) return null;
  return <a href={href} {...rest} />;
}

function useDictionaryEntry(word: string, deckId: string) {
  return useQuery({
    queryKey: ['dictionary', deckId, word] as const,
    queryFn: () => lookupDictionary({ word, scope: { deckId } }),
    retry: false,
  });
}

export function DesktopFileEditorServices({ children }: { children: ReactNode }) {
  const { toasts, push } = useToasts();
  const navigate = useCallback((destination: EditorDestination, options?: { replace?: boolean }) => {
    if (destination.kind === 'deckDocument') {
      location.hash = new URL(DECK_DOCUMENT_HREF, location.href).hash;
      return;
    }
    const href = destinationHref(destination, workspaceAvailable());
    if (href === null) {
      push(NO_WORKSPACE);
      return;
    }
    if (options?.replace) location.replace(href);
    else location.assign(href);
  }, [push]);
  const services = useMemo<EditorServices>(() => ({
    assets: { upload: uploadAsset, list: listAssets, url: assetUrl },
    tools: {
      useDictionaryEntry,
      lookUpWord: lookupDictionary,
      searchStock,
      checkEmbeddable,
      importReadingMaterial,
    },
    live: {
      fetchHostSnapshot,
      fetchStageToken,
      fetchSessionContext,
      getSessionItem,
      downloadExport,
      stageUrl: stageUrlFor,
      joinUrl: resolveJoinUrl,
      startFailureMessage: sessionStartMessage,
      sessions: { save: saveLiveSession, clear: clearLiveSession },
      StageView,
    },
    navigation: {
      navigate,
      Link: DestinationLink,
      shareUrl: (surface, sessionCode, hostToken) =>
        workspaceAvailable() ? workspaceShareUrl(surface, sessionCode, hostToken, location.origin) : null,
    },
    desktop: desktopBridge(),
    slots: {},
  }), [navigate]);
  return (
    <EditorServicesProvider services={services}>
      {children}
      <ToastRegion toasts={toasts} />
    </EditorServicesProvider>
  );
}
