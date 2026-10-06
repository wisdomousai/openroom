/**
 * The editor's one port to whatever hosts it.
 *
 * The deck editor, presenter and live console never reach a server, a router,
 * a query cache or browser storage directly: every such call goes through
 * `EditorServices`, supplied once by `EditorServicesProvider`. The web host and
 * the desktop file window each build one (apps/host/src/editor-services.tsx).
 *
 * Required groups are what making and presenting a deck needs. `slots` are
 * workspace features; an absent slot means its affordance is not rendered.
 * Hook-shaped members (`use…`) are called as hooks, so a provider must keep the
 * same object, and the same slots, for its whole lifetime.
 */
import { createContext, useContext, type AnchorHTMLAttributes, type ComponentType, type ReactNode, type Ref } from 'react';
import type {
  BrandKit,
  DictionaryEntry,
  HomeworkPracticeAnswer,
  HomeworkPracticeInteraction,
  LearnerCorrection,
  MediaAssetSummary,
  SpaceLanguages,
} from '@openroom/schema';
import type { ConnectionStatus, InkColor, MarkShape, StageSnapshot } from '@openroom/sdk';

import type { OpenRoomDesktopBridge } from './desktop-bridge';
import type { StoredSession } from './types';

/* ------------------------------------------------------------------ errors */

/** A failed service call that carries the server's verdict. */
export interface ServiceError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body?: unknown;
}

/** True for an error a service raised from an HTTP response (it has a numeric status). */
export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof Error && typeof (error as { status?: unknown }).status === 'number';
}

/* ------------------------------------------------------------------- reads */

/** What a host's data hook returns: the fields the editor reads from a query. */
export interface EditorQuery<T> {
  data: T | undefined;
  error: unknown;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => unknown;
}

/* ------------------------------------------------------------------- shapes */

export interface StockHit {
  id: number;
  previewUrl: string;
  imageUrl: string;
  pageUrl: string;
  tags: string;
  user: string;
  width: number;
  height: number;
}

export interface StockSearch {
  hits: StockHit[];
  totalHits: number;
  page: number;
  source?: string;
}

/** Whether a page allows being framed, and what refused if it does not. */
export type EmbedCheck =
  | { embeddable: true }
  | { embeddable: false; reason: 'x-frame-options' | 'frame-ancestors' | 'unreachable' };

export interface DictionaryLookupInput {
  word: string;
  scope: { deckId: string } | { sessionCode: string };
}

/** `unsupported` says which half could not be served. */
export interface DictionaryLookup {
  entry: DictionaryEntry | null;
  meaning: string | null;
  unsupported?: 'language' | 'meaning-language';
}

/** What a session was launched for; `context: null` means it is a shared session. */
export interface SessionContext {
  context: {
    id: string;
    kind: string | null;
    displayName: string | null;
    level: string | null;
    nextNote?: string | null;
  } | null;
  session: { id: string; title: string } | null;
}

/** A deck's place in the Library: space, folder, selected item, person. */
export interface LibraryPlace {
  spaceId: string | null | undefined;
  folderId?: string | null;
  itemId?: string | null;
  contextId?: string | null;
}

/** Learner work returned to a context, offered in the deck editor's pickers. */
export interface ContextReturned {
  nextNote: string;
  corrections: Array<LearnerCorrection & { id: string; learnerId: string; displayName: string }>;
  writing: Array<{ learnerId: string; displayName: string; sessionId: string; taskId: string; title?: string; body: string }>;
  missed: Array<{
    learnerId: string;
    displayName: string;
    itemId: string;
    exercise: { title?: string; interaction: HomeworkPracticeInteraction };
    lastAnswer: HomeworkPracticeAnswer;
  }>;
}

export type ExportFormat = 'csv' | 'json' | 'ballots';

/** The projector surface the live console mirrors (apps/stage `StageView`). */
export interface StageViewProps {
  snapshot: StageSnapshot | null;
  status: ConnectionStatus;
  embedded?: boolean;
  hideRail?: boolean;
  hideMeaning?: boolean;
  className?: string;
  drawTool?: 'none' | MarkShape | 'pen';
  inkColor?: InkColor;
  track?: boolean;
  onCircle?: (partKey: string, token: number, word: string, endToken?: number) => void;
  onStroke?: (points: { x: number; y: number }[]) => void;
  onErase?: (id: string) => void;
  onTarget?: (
    target: { partKey: string; token: number; word: string; endToken?: number } | null,
  ) => void;
}

/* -------------------------------------------------------------- navigation */

/** Every place the editor can send the teacher; the host maps each to a route. */
export type EditorDestination =
  | { kind: 'library'; place?: LibraryPlace | null }
  | { kind: 'spaceMembers'; spaceId: string }
  | { kind: 'sessionConsole'; sessionCode: string }
  | { kind: 'sessionRemote'; sessionCode: string }
  | { kind: 'sessionQna'; sessionCode: string }
  | { kind: 'sessionRecap'; sessionCode: string }
  | { kind: 'sessionNotes'; sessionId: string }
  | { kind: 'plans' }
  /** The desktop document window's own deck view. */
  | { kind: 'deckDocument' };

export type EditorLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: EditorDestination;
  ref?: Ref<HTMLAnchorElement>;
};

/* ------------------------------------------------------------------- slots */

export interface VersionHistoryProps {
  deckId: string;
  /** Bumped after a stamp so the list refreshes. */
  refreshKey: number;
  currentVersion: number;
  onLoadVersion: (source: string, version: number) => void;
}

export interface LanguagePairState {
  native: string;
  taught: string;
  chooseNative: (value: string) => void;
  chooseTaught: (value: string) => void;
  /** Both halves picked and the pair is one the dictionary can serve. */
  complete: boolean;
  /** Differs from what is stored. */
  changed: boolean;
}

export interface LanguagePairFieldsProps {
  pair: Pick<LanguagePairState, 'native' | 'taught' | 'chooseNative' | 'chooseTaught'>;
  disabled?: boolean;
  idPrefix: string;
  className?: string;
  triggerClassName?: string;
}

export interface EditorSlots {
  /** Rolling draft writes for a hosted deck. */
  drafts?: {
    save(deckId: string, source: string, baseVersion: number): Promise<{ savedAt: number }>;
  };
  /** Practice and Feedback pickers and the context's next note. */
  learnerWork?: {
    useReturned(contextId: string | null): EditorQuery<ContextReturned>;
  };
  /** The space's brand kits in the Deck tab. */
  brandKits?: {
    useBrandKits(spaceId: string): EditorQuery<{ brandKits: BrandKit[] }>;
    manageUrl(spaceId: string): string;
  };
  /** Stamped versions of a deck: the History tab and the repair screen. */
  VersionHistory?: ComponentType<VersionHistoryProps>;
  /** The space language pair a live word lookup needs, set from the meaning card. */
  languagePair?: {
    /** The space a lookup failed for because it has no pair, else null. */
    unconfiguredSpace(error: unknown): { spaceId: string; canEdit: boolean } | null;
    usePair(stored: SpaceLanguages | null): LanguagePairState;
    Fields: ComponentType<LanguagePairFieldsProps>;
    save(spaceId: string, languages: SpaceLanguages): Promise<unknown>;
  };
  /** The live console's private notes, kept on this device and handed to Notes. */
  scratchpad?: {
    read(sessionCode: string): string;
    write(sessionCode: string, text: string): void;
    handOff(sessionCode: string, sessionId: string | null): void;
  };
  /** The saved-results link shown once a session has ended. */
  SavedResults?: ComponentType<{ sessionCode: string }>;
}

/* -------------------------------------------------------------------- port */

export interface EditorServices {
  assets: {
    upload(spaceId: string, file: File, options?: { alt?: string }): Promise<MediaAssetSummary>;
    list(spaceId: string, query?: string): Promise<MediaAssetSummary[]>;
    url(assetId: string): string;
  };
  tools: {
    /** The deck editor's dictionary read for one word. */
    useDictionaryEntry(word: string, deckId: string): EditorQuery<DictionaryLookup>;
    lookUpWord(input: DictionaryLookupInput, signal?: AbortSignal): Promise<DictionaryLookup>;
    searchStock(query: string, page?: number): Promise<StockSearch>;
    checkEmbeddable(input: { url: string; deckId: string }): Promise<EmbedCheck>;
    importReadingMaterial(input: { url: string; deckId: string }): Promise<{ markdown: string; title: string }>;
  };
  live: {
    fetchHostSnapshot(sessionCode: string, hostToken: string): Promise<unknown>;
    fetchStageToken(sessionCode: string, hostToken: string): Promise<string>;
    fetchSessionContext(sessionCode: string, hostToken: string): Promise<SessionContext>;
    getSessionItem(sessionId: string): Promise<{
      session: { spaceId: string; folderId: string | null; deckId: string };
      canEdit: boolean;
    }>;
    downloadExport(sessionCode: string, hostToken: string, format: ExportFormat): Promise<void>;
    stageUrl(sessionCode: string, stageToken: string): string;
    joinUrl(code: string, serverJoinUrl?: string | null): string;
    /** The line shown when starting a session failed. */
    startFailureMessage(cause: unknown, fallback: string): string;
    /** Host credentials for running sessions, kept on this device. */
    sessions: {
      save(session: StoredSession): void;
      clear(sessionCode: string): void;
    };
    StageView: ComponentType<StageViewProps>;
  };
  navigation: {
    navigate(destination: EditorDestination, options?: { replace?: boolean }): void;
    Link: ComponentType<EditorLinkProps>;
    /** Absolute link handed to another device: the phone remote or the Q&A desk. */
    shareUrl(surface: 'remote' | 'qna', sessionCode: string, hostToken: string): string;
  };
  /** The desktop shell's bridge; null in a browser. */
  desktop: OpenRoomDesktopBridge | null;
  slots: EditorSlots;
}

const EditorServicesContext = createContext<EditorServices | null>(null);

export function EditorServicesProvider({ services, children }: { services: EditorServices; children: ReactNode }) {
  return <EditorServicesContext.Provider value={services}>{children}</EditorServicesContext.Provider>;
}

export function useEditorServices(): EditorServices {
  const services = useContext(EditorServicesContext);
  if (services === null) throw new Error('useEditorServices needs an EditorServicesProvider.');
  return services;
}

/* --------------------------------------------------- absent-slot fallbacks */

const IDLE_QUERY: EditorQuery<never> = {
  data: undefined,
  error: null,
  isPending: false,
  isError: false,
  isFetching: false,
  refetch: () => undefined,
};

/** Stands in for an absent slot's data hook. */
export function useIdleQuery<T>(): EditorQuery<T> {
  return IDLE_QUERY;
}

const NO_PAIR: LanguagePairState = {
  native: '',
  taught: '',
  chooseNative: () => undefined,
  chooseTaught: () => undefined,
  complete: false,
  changed: false,
};

/** Stands in for an absent language-pair slot. */
export function useNoLanguagePair(): LanguagePairState {
  return NO_PAIR;
}
