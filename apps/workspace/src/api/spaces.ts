import type { SpaceLanguages, SpaceSettings, WorkspaceExperience } from '@openroom/schema';
import { request, type DeletionIntent } from './client';

export interface FolderSummary {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: number;
}

export interface TrashedFolderSummary {
  id: string;
  name: string;
  spaceId: string;
  parentId: string | null;
  deletedAt: number;
}

export type SpaceRole = 'owner' | 'editor' | 'presenter';

/** What is *in* the file — slides, asks, homework. Never a date. */
export interface DeckContents {
  slides: number;
  askTheClass: number;
  homework: boolean;
  recap: boolean;
  minutes: number | null;
}

export interface SpaceTreeDeck {
  id: string;
  title: string;
  shape: string;
  currentVersion: number;
  folderId: string | null;
  contextId: string | null;
  updatedAt: number;
  contents?: DeckContents;
}

export interface SpaceTreeSession {
  id: string;
  title: string;
  shape: string;
  status: string;
  deckId: string;
  deckVersion: number;
  folderId: string | null;
  contextId: string | null;
  updatedAt: number;
}

/**
 * A session record, as a browsable row.
 *
 * A record has no place of its own — `folderId` is the session's. `notes` is
 * absent on purpose: it is tutor-private prose and the list has no use for it,
 * so the API does not send it to a browser building rows.
 */
export interface SpaceTreeRecord {
  id: string;
  sessionId: string;
  /** The session's title; a record is not separately named. */
  title: string;
  contextId: string | null;
  deckVersion: number;
  folderId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SpaceTree {
  space: { id: string; name: string; role: SpaceRole; settings?: SpaceSettings };
  folders: FolderSummary[];
  /** Folder-scoped decks (content items). */
  decks?: SpaceTreeDeck[];
  /** Folder-scoped durable sessions. */
  sessions?: SpaceTreeSession[];
  /** Session records filed by their session's folder. */
  records?: SpaceTreeRecord[];
  /** Live session history for this space. */
  liveSessions: {
    code: string;
    sessionCode: string;
    title: string | null;
    createdAt: number;
    ended: boolean;
  }[];
}

export async function getSpaceTree(
  spaceId: string,
  opts?: { folderId?: string },
): Promise<SpaceTree> {
  const q = new URLSearchParams();
  if (opts?.folderId !== undefined) q.set('folderId', opts.folderId);
  const qs = q.toString();
  const body = await request<Omit<SpaceTree, 'liveSessions'> & { liveSessions?: SpaceTree['liveSessions'] }>(
    `/api/my/spaces/${encodeURIComponent(spaceId)}${qs ? `?${qs}` : ''}`,
  );
  return { ...body, liveSessions: body.liveSessions ?? [] };
}

/**
 * PATCH /api/my/spaces/:id — the space's language pair.
 *
 * `languages: null` clears it. The server refuses a pair it cannot serve, so
 * the picker offering only supported pairs is a courtesy, not the guard.
 */
export function setSpaceLanguages(
  spaceId: string,
  languages: SpaceLanguages | null,
): Promise<{ ok: boolean; settings: SpaceSettings }> {
  return updateSpaceSettings(spaceId, { languages });
}

export function updateSpaceSettings(
  spaceId: string,
  settings: { experience?: WorkspaceExperience; languages?: SpaceLanguages | null },
): Promise<{ ok: boolean; settings: SpaceSettings }> {
  return request(`/api/my/spaces/${encodeURIComponent(spaceId)}`, {
    method: 'PATCH',
    mutating: true,
    body: JSON.stringify(settings),
  });
}

export function createSpace(input: { name: string; experience: WorkspaceExperience }): Promise<{ id: string; name: string; settings: SpaceSettings }> {
  return request('/api/my/spaces', { method: 'POST', mutating: true, body: JSON.stringify(input) });
}

export function createFolder(
  spaceId: string,
  name: string,
  parentId?: string | null,
): Promise<{ id: string; name: string; spaceId: string; parentId: string | null }> {
  return request(`/api/my/spaces/${encodeURIComponent(spaceId)}/folders`, {
    method: 'POST',
    mutating: true,
    body: JSON.stringify({ name, ...(parentId ? { parentId } : {}) }),
  });
}

export function updateFolder(
  folderId: string,
  body: { name?: string; parentId?: string | null; sortOrder?: number },
): Promise<{
  ok: true;
  id: string;
  name?: string;
  parentId?: string | null;
  sortOrder?: number;
}> {
  return request(`/api/my/folders/${encodeURIComponent(folderId)}`, {
    method: 'PATCH',
    mutating: true,
    body: JSON.stringify(body),
  });
}

export function trashFolder(folderId: string): Promise<{ ok: true; recoverable: true }> {
  return request(`/api/my/folders/${encodeURIComponent(folderId)}/trash`, {
    method: 'POST',
    mutating: true,
  });
}

export function restoreFolder(folderId: string): Promise<{ ok: true }> {
  return request(`/api/my/folders/${encodeURIComponent(folderId)}/restore`, {
    method: 'POST',
    mutating: true,
  });
}

export async function listTrashedFolders(): Promise<TrashedFolderSummary[]> {
  const body = await request<{ folders: TrashedFolderSummary[] }>('/api/my/folders/trash');
  return body.folders ?? [];
}

export function requestFolderPermanentDeletion(folderId: string): Promise<DeletionIntent> {
  return request(`/api/my/folders/${encodeURIComponent(folderId)}/permanent-deletion`, {
    method: 'POST',
    mutating: true,
  });
}

export function copyFolder(
  folderId: string,
  name?: string,
): Promise<{ id: string; name: string; spaceId: string }> {
  return request(`/api/my/folders/${encodeURIComponent(folderId)}/copy`, {
    method: 'POST',
    mutating: true,
    body: JSON.stringify(name ? { name } : {}),
  });
}

/* -------------------------------------------------------- collaboration */

/** A space the caller can open — owned (`shared: false`) or joined. */
export interface MySpace {
  id: string;
  name: string;
  role: SpaceRole;
  shared: boolean;
  settings: SpaceSettings;
  createdAt: number;
  updatedAt: number;
}

export async function listAllSpaces(): Promise<MySpace[]> {
  const body = await request<{ spaces: MySpace[] }>('/api/my/spaces');
  return body.spaces ?? [];
}

export interface SpaceMember {
  userId: string;
  email: string | null;
  name: string | null;
  role: SpaceRole;
  invitedBy: string | null;
}

export interface PendingSpaceInvite {
  id: string;
  email: string;
  role: SpaceRole;
  createdAt: number;
  inviterName: string | null;
}

export function getSpaceMembers(spaceId: string): Promise<{
  role: SpaceRole;
  members: SpaceMember[];
  invites?: PendingSpaceInvite[];
}> {
  return request(`/api/my/spaces/${encodeURIComponent(spaceId)}/members`);
}

export function createInvite(
  spaceId: string,
  email: string,
  role: 'editor' | 'presenter',
): Promise<{ id: string; email: string; role: SpaceRole }> {
  return request(`/api/my/spaces/${encodeURIComponent(spaceId)}/invites`, {
    method: 'POST',
    mutating: true,
    body: JSON.stringify({ email, role }),
  });
}

export function revokeInvite(inviteId: string): Promise<{ ok: true }> {
  return request(`/api/my/invites/${encodeURIComponent(inviteId)}`, {
    method: 'DELETE',
    mutating: true,
  });
}

export interface MyInvite {
  id: string;
  role: SpaceRole;
  createdAt: number;
  spaceId: string;
  spaceName: string;
  inviterName: string | null;
}

export async function myInvites(): Promise<MyInvite[]> {
  const body = await request<{ invites: MyInvite[] }>('/api/my/invites');
  return body.invites ?? [];
}

export function acceptInvite(
  inviteId: string,
): Promise<{ ok: true; spaceId: string; role: SpaceRole }> {
  return request(`/api/my/invites/${encodeURIComponent(inviteId)}/accept`, {
    method: 'POST',
    mutating: true,
  });
}

export function patchMember(
  spaceId: string,
  userId: string,
  role: SpaceRole,
): Promise<{ ok: true }> {
  return request(
    `/api/my/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(userId)}`,
    { method: 'PATCH', mutating: true, body: JSON.stringify({ role }) },
  );
}

export function removeMember(spaceId: string, userId: string): Promise<{ ok: true }> {
  return request(
    `/api/my/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE', mutating: true },
  );
}
