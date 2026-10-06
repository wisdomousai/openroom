/**
 * The host's two `EditorServices` adapters for @openroom/editor.
 *
 *  - `CloudEditorServices` wraps every route: hosted decks, the live console,
 *    the presenter remote, the Q&A desk and the desktop presentation window.
 *  - `DesktopFileEditorServices` wraps the desktop document window
 *    (`#/desktop/file`). A local file has no space or person, so it carries no
 *    draft writes, learner work or brand kits.
 *  - `RelayLiveServices` narrows either one for a session that runs on the
 *    desktop's relay (signed out, live server set): links point at the relay,
 *    and nothing reads workspace records the relay does not have.
 *
 * This is the one place the editor meets the API client, the router, the query
 * cache and this device's storage.
 */
// First, so the projector sheet keeps its place at the head of the host CSS.
import './stage.css';
import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { StageView } from '@openroom/stage-src/StageView';
import {
  EditorServicesProvider,
  useEditorServices,
  type EditorDestination,
  type EditorLinkProps,
  type EditorServices,
  type EditorSlots,
} from '@openroom/editor';

import {
  assetUrl,
  checkEmbeddable,
  downloadExport,
  fetchHostSnapshot,
  fetchSessionContext,
  fetchStageToken,
  getContextReturned,
  getSessionItem,
  importReadingMaterial,
  listAssets,
  lookupDictionary,
  putDeckDraft,
  resolveJoinUrl,
  searchStock,
  setSpaceLanguages,
  stageUrlFor,
  unconfiguredSpace,
  uploadAsset,
} from './api';
import { listBrandKits } from './api/brand-kits';
import { sessionStartMessage } from './components/ContinuityLock';
import { LanguagePairFields, useLanguagePair } from './components/LanguagePairFields';
import { SavedResultsLinks } from './components/SavedResultsLinks';
import { VersionHistory } from './components/VersionHistory';
import { desktopBridge } from './desktop-bridge';
import { qnaShareUrl, remoteShareUrl, to, type LinkTarget } from './destinations';
import { handOffLiveNotes, readLiveNotes, writeLiveNotes } from './lib/scratchpad';
import { invalidateManagementData } from './query-client';
import { clearLiveSession, saveLiveSession } from './storage';

type RouteDestination = Exclude<EditorDestination, { kind: 'deckDocument' }>;

/** The desktop shell owns this URL; the document window's deck view lives there. */
const DECK_DOCUMENT_HASH = '#/desktop/file';

export function routeFor(destination: RouteDestination): LinkTarget {
  switch (destination.kind) {
    case 'library':
      return to.library(destination.place ?? undefined);
    case 'spaceMembers':
      return to.spaceMembers(destination.spaceId);
    case 'sessionConsole':
      return to.sessionConsole(destination.sessionCode);
    case 'sessionRemote':
      return to.sessionRemote(destination.sessionCode);
    case 'sessionQna':
      return to.sessionQna(destination.sessionCode);
    case 'sessionRecap':
      return to.sessionRecap(destination.sessionCode);
    case 'sessionNotes':
      return to.sessionNotes(destination.sessionId);
    case 'plans':
      return to.billing();
  }
}

function RouterLink({ to: destination, ...rest }: EditorLinkProps) {
  if (destination.kind === 'deckDocument') return <a href={DECK_DOCUMENT_HASH} {...rest} />;
  return <Link {...routeFor(destination)} {...rest} />;
}

function CompactSavedResults({ sessionCode }: { sessionCode: string }) {
  return <SavedResultsLinks sessionCode={sessionCode} compact />;
}

function useDictionaryEntry(word: string, deckId: string) {
  return useQuery({
    queryKey: ['dictionary', deckId, word] as const,
    queryFn: () => lookupDictionary({ word, scope: { deckId } }),
    retry: false,
  });
}

function useReturned(contextId: string | null) {
  return useQuery({
    queryKey: ['contexts', contextId, 'returned'] as const,
    queryFn: () => getContextReturned(contextId!),
    enabled: contextId !== null && contextId !== '',
  });
}

function useBrandKits(spaceId: string) {
  return useQuery({ queryKey: ['brand-kits', spaceId, false], queryFn: () => listBrandKits(spaceId) });
}

/** Slots both windows offer: they follow the session or the deck, not the file. */
const SHARED_SLOTS: EditorSlots = {
  VersionHistory,
  languagePair: {
    unconfiguredSpace,
    usePair: useLanguagePair,
    Fields: LanguagePairFields,
    save: setSpaceLanguages,
  },
  scratchpad: { read: readLiveNotes, write: writeLiveNotes, handOff: handOffLiveNotes },
  SavedResults: CompactSavedResults,
};

const CLOUD_SLOTS: EditorSlots = {
  ...SHARED_SLOTS,
  drafts: {
    save: async (deckId, source, baseVersion) => {
      const result = await putDeckDraft(deckId, source, baseVersion);
      void invalidateManagementData();
      return result;
    },
  },
  learnerWork: { useReturned },
  brandKits: {
    useBrandKits,
    manageUrl: (spaceId) => `/host/#/space/${encodeURIComponent(spaceId)}/brand-kits`,
  },
};

const FILE_SLOTS: EditorSlots = SHARED_SLOTS;

function useHostEditorServices(slots: EditorSlots): EditorServices {
  const routerNavigate = useNavigate();
  return useMemo<EditorServices>(() => ({
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
      navigate: (destination, options) => {
        /*
         * The single sanctioned hash write in the app: the desktop shell owns
         * the `/desktop/file` URL, and the document window must route back to
         * the deck rather than into the web workspace shell.
         */
        if (destination.kind === 'deckDocument') {
          location.hash = DECK_DOCUMENT_HASH;
          return;
        }
        const target = routeFor(destination);
        void routerNavigate(options?.replace ? { ...target, replace: true } : target);
      },
      Link: RouterLink,
      shareUrl: (surface, sessionCode, hostToken) =>
        surface === 'remote' ? remoteShareUrl(sessionCode, hostToken) : qnaShareUrl(sessionCode, hostToken),
    },
    desktop: desktopBridge(),
    slots,
  }), [routerNavigate, slots]);
}

export function CloudEditorServices({ children }: { children: ReactNode }) {
  return <EditorServicesProvider services={useHostEditorServices(CLOUD_SLOTS)}>{children}</EditorServicesProvider>;
}

export function DesktopFileEditorServices({ children }: { children: ReactNode }) {
  return <EditorServicesProvider services={useHostEditorServices(FILE_SLOTS)}>{children}</EditorServicesProvider>;
}

/**
 * The live services for a session on a relay at `origin`.
 *
 * The session's own API calls (state, commands, assets, export, stage token)
 * need no change: the desktop shell routes `/api/sessions/<code>/…` of a relay
 * session to the relay. What changes is everything the relay does not hold:
 * there is no saved session record or Library place, no saved results, and no
 * remote or Q&A desk page on another device. Join and stage links are the
 * relay's own pages.
 */
export function relayEditorServices(base: EditorServices, origin: string): EditorServices {
  const relay = `${origin.replace(/\/$/, '')}/`;
  const { SavedResults: _savedResults, ...slots } = base.slots;
  return {
    ...base,
    live: {
      ...base.live,
      fetchSessionContext: () => Promise.resolve({ context: null, session: null }),
      getSessionItem: () => Promise.reject(new Error('This session has no saved record.')),
      stageUrl: (sessionCode, stageToken) =>
        new URL(`stage/?session=${encodeURIComponent(sessionCode)}&token=${encodeURIComponent(stageToken)}`, relay).toString(),
      joinUrl: (code, serverJoinUrl) => {
        const fallback = `join/?code=${encodeURIComponent(code)}`;
        try {
          const url = new URL(serverJoinUrl ?? fallback, relay);
          return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : new URL(fallback, relay).toString();
        } catch {
          return new URL(fallback, relay).toString();
        }
      },
    },
    navigation: { ...base.navigation, shareUrl: () => null },
    slots,
  };
}

/** Pass-through without a relay origin; the relay adapter with one. */
export function RelayLiveServices({ origin, children }: { origin: string | null; children: ReactNode }) {
  const base = useEditorServices();
  const services = useMemo(() => (origin === null ? base : relayEditorServices(base, origin)), [base, origin]);
  return <EditorServicesProvider services={services}>{children}</EditorServicesProvider>;
}
