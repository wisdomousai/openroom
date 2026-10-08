import type {
  DeckDraftResponse,
  DeckDraftSavedResponse,
  DeckShape,
  Outline,
} from '@openroom/schema';
import { request } from './client';
import type { SessionSummary } from './sessions';

export interface DeckSummary {
  id: string;
  spaceId: string;
  folderId: string | null;
  contextId: string | null;
  title: string;
  shape: DeckShape;
  currentVersion: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface DeckDetailResponse {
  deck: DeckSummary;
  /** Names of the place the deck sits in — the deck editor breadcrumb reads these. */
  spaceName: string | null;
  folderName: string | null;
  contentVersion: number | null;
  contentHash: string | null;
  content: Outline | null;
}

export interface DeckFileLocation {
  deviceId: string;
  deviceName: string;
  path: string;
  localRevision: number;
  contentHash: string;
  syncedVersion: number;
  syncedHash: string;
  lastSeenAt: number;
}

export interface DeckFileLinkResponse {
  linked: boolean;
  fileId: string | null;
  locations: DeckFileLocation[];
}

export async function listDecks(options: {
  trash?: boolean;
  folderId?: string;
  spaceId?: string;
  contextId?: string;
} = {}): Promise<DeckSummary[]> {
  const query = new URLSearchParams();
  if (options.trash) query.set('trash', '1');
  if (options.folderId !== undefined) query.set('folderId', options.folderId);
  if (options.spaceId) query.set('spaceId', options.spaceId);
  if (options.contextId) query.set('contextId', options.contextId);
  const qs = query.toString();
  const body = await request<{ decks: DeckSummary[] }>(`/api/decks${qs ? `?${qs}` : ''}`);
  return body.decks ?? [];
}

export function getDeck(id: string, version?: number): Promise<DeckDetailResponse> {
  const query = version === undefined ? '' : `?version=${encodeURIComponent(String(version))}`;
  return request(`/api/decks/${encodeURIComponent(id)}${query}`);
}

export async function createDeck(input: {
  title?: string;
  contextId?: string;
  shape?: DeckShape;
  folderId?: string | null;
  spaceId?: string | null;
  content?: Outline;
  createSession?: boolean;
  fileId?: string;
}): Promise<{ deck: DeckSummary; session: SessionSummary | null }> {
  return request('/api/decks', {
    method: 'POST',
    mutating: true,
    body: JSON.stringify(input),
  });
}

export function updateDeck(
  id: string,
  input: {
    title?: string;
    contextId?: string;
    shape?: DeckShape;
    folderId?: string | null;
    spaceId?: string | null;
  },
): Promise<{ deck: DeckSummary }> {
  return request(`/api/decks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    mutating: true,
    body: JSON.stringify(input),
  });
}

export function addDeckVersion(
  id: string,
  content: Outline,
  baseVersion: number,
  fileSync?: { fileId: string; localRevision: number; baseContentHash: string },
): Promise<{ deckId: string; version: number; contentHash: string; unchanged?: boolean }> {
  return request(`/api/decks/${encodeURIComponent(id)}/versions`, {
    method: 'POST',
    mutating: true,
    body: JSON.stringify({ content, baseVersion, ...(fileSync === undefined ? {} : { fileSync }) }),
  });
}

export interface DeckVersionSummary {
  version: number;
  createdAt: number;
  createdBy: string;
  contentHash: string | null;
  sourceKind: string;
  sourceFileId: string | null;
  sourceLocalRevision: number | null;
}

/** Every stamped version, newest first. History tab of the deck editor. */
export async function listDeckVersions(id: string): Promise<DeckVersionSummary[]> {
  const body = await request<{ versions?: DeckVersionSummary[] }>(
    `/api/decks/${encodeURIComponent(id)}/versions`,
  );
  return body.versions ?? [];
}

export function getDeckFileLink(id: string): Promise<DeckFileLinkResponse> {
  return request(`/api/decks/${encodeURIComponent(id)}/file-link`);
}

export function linkDeckFile(
  id: string,
  fileId: string,
): Promise<{ linked: true; fileId: string; unchanged?: boolean }> {
  return request(`/api/decks/${encodeURIComponent(id)}/file-link`, {
    method: 'POST',
    mutating: true,
    body: JSON.stringify({ fileId }),
  });
}

/**
 * The rolling draft — auto-save's half of the hybrid. Unvalidated by design:
 * the editor writes whatever is on screen, including YAML mid-keystroke.
 */
export function putDeckDraft(
  id: string,
  source: string,
  baseVersion: number,
): Promise<DeckDraftSavedResponse> {
  return request(`/api/decks/${encodeURIComponent(id)}/draft`, {
    method: 'PUT',
    mutating: true,
    body: JSON.stringify({ source, baseVersion }),
  });
}

/** The saved working text, or the draft zero (`updatedAt: null`) when nothing is unsaved. */
export function getDeckDraft(id: string): Promise<DeckDraftResponse> {
  return request<DeckDraftResponse>(`/api/decks/${encodeURIComponent(id)}/draft`);
}

export function trashDeck(id: string): Promise<{ ok: true; recoverable: true }> {
  return request(`/api/decks/${encodeURIComponent(id)}`, { method: 'DELETE', mutating: true });
}

export function restoreDeck(id: string): Promise<{ ok: true }> {
  return request(`/api/decks/${encodeURIComponent(id)}/restore`, { method: 'POST', mutating: true });
}
