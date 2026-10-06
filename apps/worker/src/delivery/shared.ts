/**
 * Folder-scoped decks (content) and sessions (delivery instances).
 * Contexts stay in tutoring.ts. Live sessions are launched from a session.
 */
import {
  canonicalOutlineJson,
  clipNextNote,
  compileRecordHomework,
  validateOutline,
  DECK_DRAFT_MAX_CHARS,
  DECK_SHAPES,
  SESSION_STATUSES,
  SESSION_STATUSES_CLIENT_WRITABLE,
  type Outline,
  type PresentationPosition,
  type OutlineValidateResult,
} from '@openroom/schema';

import { sha256Hex } from '../api-tokens.js';
import { json, type ControlEnv, type SessionUser } from '../auth.js';
import { requireControlUser } from '../control-auth.js';
import { DELETION_INTENT_TTL_MS, compactArray, memberOfSpace, parseJson, plainObject, randomId, randomToken, readJson, resolveSpace } from '../control-utils.js';
import { folderAccess, spaceRole, roleAtLeast } from '../members.js';
import { ensureWorkspace } from '../workspace.js';

/**
 * Shared plumbing for the delivery routes: row shapes, access checks,
 * JSON builders, folder resolution.
 *
 * Everything exported here is internal to `delivery/`; the barrel only
 * re-exports the route handlers and launch/purge API.
 */


export { DELETION_INTENT_TTL_MS };

export type DeliveryResourceType = 'deck' | 'session';

export const DECK_SHAPE_SET: ReadonlySet<string> = new Set(DECK_SHAPES);

export interface SessionLaunchInput {
  /** Server-derived credential provenance, never taken from the request body. */
  connectionId?: string;
  sessionId: string;
  deckId: string;
  contextId: string | null;
  title: string;
  version: number;
  outline: Outline;
  start: boolean;
  cursor?: PresentationPosition;
}

export type SessionLauncher = (input: SessionLaunchInput, user: SessionUser) => Promise<Response>;

export function parseShape(value: unknown, fallback = 'tutoring'): string {
  return typeof value === 'string' && DECK_SHAPE_SET.has(value) ? value : fallback;
}

/**
 * Validate a folder link for a resource living in `spaceId`.
 * undefined keeps `currentFolderId`; null unfiles. A provided id must be
 * visible to the user and belong to the resource's space — otherwise a
 * deck/session could be filed under another space's folder and leak through
 * that space's detail route.
 */
export async function resolveFolder(
  env: ControlEnv,
  user: SessionUser,
  spaceId: string,
  input: { folderId?: unknown },
  currentFolderId: string | null,
): Promise<{ ok: true; folderId: string | null } | { ok: false; response: Response }> {
  if (typeof input.folderId === 'string' && input.folderId !== '') {
    const access = await folderAccess(env, user, input.folderId);
    if (access === null || access.folder.space_id !== spaceId) {
      return { ok: false, response: json({ error: 'folder-not-found' }, 404) };
    }
    return { ok: true, folderId: access.folder.id };
  }
  if (input.folderId === null || input.folderId === '') return { ok: true, folderId: null };
  return { ok: true, folderId: currentFolderId };
}

export interface DeckRow {
  id: string;
  space_id: string;
  folder_id: string | null;
  context_id: string | null;
  created_by: string;
  title: string;
  shape: string;
  current_version: number;
  metadata_json: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface SessionRow {
  id: string;
  space_id: string;
  folder_id: string | null;
  deck_id: string;
  deck_version: number;
  context_id: string | null;
  created_by: string;
  title: string;
  shape: string;
  status: string;
  metadata_json: string;
  source_outline_json: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface DeckFileLinkRow {
  file_id: string;
  deck_id: string;
  created_by: string;
  created_at: number;
}

export interface DeckFileLocationRow {
  file_id: string;
  user_id: string;
  device_id: string;
  device_name: string;
  path: string;
  local_revision: number;
  content_hash: string;
  synced_version: number;
  synced_hash: string;
  last_seen_at: number;
}

export const FILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

export function deckFileLocationJson(row: DeckFileLocationRow): Record<string, unknown> {
  return {
    deviceId: row.device_id,
    deviceName: row.device_name,
    path: row.path,
    localRevision: row.local_revision,
    contentHash: row.content_hash,
    syncedVersion: row.synced_version,
    syncedHash: row.synced_hash,
    lastSeenAt: row.last_seen_at,
  };
}

export async function deckAccess(env: ControlEnv, userId: string, deckId: string): Promise<DeckRow | null> {
  const row = await env.DB.prepare('SELECT * FROM decks WHERE id = ?1')
    .bind(deckId)
    .first<DeckRow>();
  if (row === null) return null;
  return (await memberOfSpace(env, userId, row.space_id)) ? row : null;
}

export async function sessionAccess(env: ControlEnv, userId: string, sessionId: string): Promise<SessionRow | null> {
  const row = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?1')
    .bind(sessionId)
    .first<SessionRow>();
  if (row === null) return null;
  return (await memberOfSpace(env, userId, row.space_id)) ? row : null;
}

export async function contextAccess(
  env: ControlEnv,
  userId: string,
  contextId: string,
): Promise<{ id: string; space_id: string; deleted_at: number | null } | null> {
  return env.DB.prepare(
    `SELECT c.id, c.space_id, c.deleted_at FROM contexts c
      JOIN space_members m ON m.space_id = c.space_id AND m.user_id = ?2
     WHERE c.id = ?1`,
  ).bind(contextId, userId).first();
}

/** Editing a deck or session needs `editor` on the space that holds it. */
export async function mutationAllowed(
  env: ControlEnv,
  user: SessionUser,
  spaceId: string,
): Promise<boolean> {
  const access = await spaceRole(env, user, spaceId);
  return access !== null && roleAtLeast(access.role, 'editor');
}

/**
 * Space a create request lands in: the folder's space, else the named context's,
 * else the requested one.
 *
 * The context comes before the requested space because a space holds one
 * context: naming a context names its space, and defaulting to the caller's
 * home space instead would put the item somewhere its own context is not —
 * which the cross-boundary check then refuses. Only an explicit `spaceId` that
 * disagrees with the context is still an error, and it is still caught.
 */
export async function targetSpace(
  env: ControlEnv,
  user: SessionUser,
  input: { folderId?: unknown; spaceId?: unknown; contextId?: unknown },
): Promise<string | null> {
  if (typeof input.folderId === 'string' && input.folderId !== '') {
    const folder = await folderAccess(env, user, input.folderId);
    return folder?.folder.space_id ?? null;
  }
  if (
    (typeof input.spaceId !== 'string' || input.spaceId === '') &&
    typeof input.contextId === 'string' &&
    input.contextId !== ''
  ) {
    const context = await contextAccess(env, user.id, input.contextId);
    if (context !== null) return context.space_id;
  }
  return resolveSpace(env, user, input.spaceId);
}

export async function requestedLocationEditable(
  env: ControlEnv,
  user: SessionUser,
  input: { folderId?: unknown },
): Promise<'editable' | 'forbidden' | 'not-found'> {
  if (typeof input.folderId === 'string' && input.folderId !== '') {
    const folder = await folderAccess(env, user, input.folderId);
    if (folder === null) return 'not-found';
    return roleAtLeast(folder.role, 'editor') ? 'editable' : 'forbidden';
  }
  return 'editable';
}

export function deckJson(row: DeckRow): Record<string, unknown> {
  return {
    id: row.id,
    spaceId: row.space_id,
    folderId: row.folder_id,
    contextId: row.context_id,
    title: row.title,
    shape: row.shape,
    currentVersion: row.current_version,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function sessionJson(row: SessionRow): Record<string, unknown> {
  return {
    id: row.id,
    spaceId: row.space_id,
    folderId: row.folder_id,
    deckId: row.deck_id,
    deckVersion: row.deck_version,
    contextId: row.context_id,
    title: row.title,
    shape: row.shape,
    status: row.status,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export async function latestContent(
  env: ControlEnv,
  deckId: string,
  version?: number,
): Promise<{ version: number; outline: Outline; contentHash: string } | null> {
  const row = version === undefined
    ? await env.DB.prepare(
        'SELECT version, content_json, content_hash FROM deck_versions WHERE deck_id = ?1 ORDER BY version DESC LIMIT 1',
      ).bind(deckId).first<{ version: number; content_json: string; content_hash: string | null }>()
    : await env.DB.prepare(
        'SELECT version, content_json, content_hash FROM deck_versions WHERE deck_id = ?1 AND version = ?2',
      ).bind(deckId, version).first<{ version: number; content_json: string; content_hash: string | null }>();
  if (row === null) return null;
  const validation = validateOutline(parseJson(row.content_json, null));
  if (!validation.ok) return null;
  const contentHash = row.content_hash ?? await sha256Hex(canonicalOutlineJson(validation.outline));
  return { version: row.version, outline: validation.outline, contentHash };
}

export const SESSION_STATUSES_SERVER_OWNED: ReadonlySet<string> = new Set(
  SESSION_STATUSES.filter((s) => !(SESSION_STATUSES_CLIENT_WRITABLE as readonly string[]).includes(s)),
);
