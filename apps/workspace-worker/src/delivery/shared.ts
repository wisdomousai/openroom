/**
 * Folder-scoped decks (content) and sessions (delivery instances).
 * Students stay in tutoring.ts. Live sessions are launched from a session.
 */
import {
  canonicalOutlineJson,
  validateOutline,
  DECK_SHAPES,
  SESSION_STATUSES,
  SESSION_STATUSES_CLIENT_WRITABLE,
  type Outline,
  type PresentationPosition,
} from '@openroom/schema';
import { and, desc, eq } from 'drizzle-orm';

import { sha256Hex } from '../api-tokens.js';
import { json, type ControlEnv, type SessionUser } from '../auth.js';
import { requireControlUser } from '../control-auth.js';
import { DELETION_INTENT_TTL_MS, memberOfSpace, parseJson, resolveSpace } from '../control-utils.js';
import { orm } from '../db/client.js';
import { deckFileLocations, deckVersions, decks, sessions, spaceMembers, students } from '../db/schema.js';
import { folderAccess, spaceRole, roleAtLeast } from '../members.js';

/**
 * Shared plumbing for the delivery routes: row shapes, access checks,
 * JSON builders, folder resolution.
 *
 * Everything exported here is internal to `delivery/`; the barrel only
 * re-exports the route handlers and launch/permanent-deletion API.
 */


export { DELETION_INTENT_TTL_MS };

export type DeliveryResourceType = 'deck' | 'session';

export const DECK_SHAPE_SET: ReadonlySet<string> = new Set(DECK_SHAPES);

export interface SessionLaunchInput {
  /** Server-derived credential provenance, never taken from the request body. */
  connectionId?: string;
  /** The request's own origin, used only to build absolute stage and join URLs. */
  origin?: string;
  sessionId: string;
  deckId: string;
  studentId: string | null;
  title: string;
  version: number;
  outline: Outline;
  start: boolean;
  /**
   * Answer 409 session-already-live when the DO reports the session running.
   * Set by POST /api/sessions/:id/launch for a session D1 records as live;
   * the deck start retries the same launch and leaves it unset.
   */
  refuseLive?: boolean;
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
    if (access === null || access.folder.spaceId !== spaceId) {
      return { ok: false, response: json({ error: 'folder-not-found' }, 404) };
    }
    return { ok: true, folderId: access.folder.id };
  }
  if (input.folderId === null || input.folderId === '') return { ok: true, folderId: null };
  return { ok: true, folderId: currentFolderId };
}

export type DeckRow = typeof decks.$inferSelect;

export type SessionRow = typeof sessions.$inferSelect;

export type DeckFileLocationRow = typeof deckFileLocations.$inferSelect;

export const FILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

export function deckFileLocationJson(row: DeckFileLocationRow): Record<string, unknown> {
  return {
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    path: row.path,
    localRevision: row.localRevision,
    contentHash: row.contentHash,
    syncedVersion: row.syncedVersion,
    syncedHash: row.syncedHash,
    lastSeenAt: row.lastSeenAt,
  };
}

export async function deckAccess(env: ControlEnv, userId: string, deckId: string): Promise<DeckRow | null> {
  const row = await orm(env).select().from(decks).where(eq(decks.id, deckId)).get();
  if (row === undefined) return null;
  return (await memberOfSpace(env, userId, row.spaceId)) ? row : null;
}

export async function sessionAccess(env: ControlEnv, userId: string, sessionId: string): Promise<SessionRow | null> {
  const row = await orm(env).select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (row === undefined) return null;
  return (await memberOfSpace(env, userId, row.spaceId)) ? row : null;
}

export async function studentAccess(
  env: ControlEnv,
  userId: string,
  studentId: string,
): Promise<{ id: string; spaceId: string; deletedAt: number | null } | null> {
  const row = await orm(env)
    .select({ id: students.id, spaceId: students.spaceId, deletedAt: students.deletedAt })
    .from(students)
    .innerJoin(spaceMembers, and(eq(spaceMembers.spaceId, students.spaceId), eq(spaceMembers.userId, userId)))
    .where(eq(students.id, studentId))
    .get();
  return row ?? null;
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
 * Space a create request lands in: the folder's space, else the named student's,
 * else the requested one.
 *
 * The student comes before the requested space because a space holds one
 * student: naming a student names its space, and defaulting to the caller's
 * home space instead would put the item somewhere its own student is not —
 * which the cross-boundary check then refuses. Only an explicit `spaceId` that
 * disagrees with the student is still an error, and it is still caught.
 */
export async function targetSpace(
  env: ControlEnv,
  user: SessionUser,
  input: { folderId?: unknown; spaceId?: unknown; studentId?: unknown },
): Promise<string | null> {
  if (typeof input.folderId === 'string' && input.folderId !== '') {
    const folder = await folderAccess(env, user, input.folderId);
    return folder?.folder.spaceId ?? null;
  }
  if (
    (typeof input.spaceId !== 'string' || input.spaceId === '') &&
    typeof input.studentId === 'string' &&
    input.studentId !== ''
  ) {
    const student = await studentAccess(env, user.id, input.studentId);
    if (student !== null) return student.spaceId;
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
    spaceId: row.spaceId,
    folderId: row.folderId,
    studentId: row.studentId,
    title: row.title,
    shape: row.shape,
    currentVersion: row.currentVersion,
    metadata: parseJson(row.metadataJson, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export function sessionJson(row: SessionRow): Record<string, unknown> {
  return {
    id: row.id,
    spaceId: row.spaceId,
    folderId: row.folderId,
    deckId: row.deckId,
    deckVersion: row.deckVersion,
    studentId: row.studentId,
    title: row.title,
    shape: row.shape,
    status: row.status,
    metadata: parseJson(row.metadataJson, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export async function latestContent(
  env: ControlEnv,
  deckId: string,
  version?: number,
): Promise<{ version: number; outline: Outline; contentHash: string } | null> {
  const versions = orm(env)
    .select({ version: deckVersions.version, contentJson: deckVersions.contentJson, contentHash: deckVersions.contentHash })
    .from(deckVersions);
  const row = version === undefined
    ? await versions.where(eq(deckVersions.deckId, deckId)).orderBy(desc(deckVersions.version)).limit(1).get()
    : await versions.where(and(eq(deckVersions.deckId, deckId), eq(deckVersions.version, version))).get();
  if (row === undefined) return null;
  const validation = validateOutline(parseJson(row.contentJson, null));
  if (!validation.ok) return null;
  const contentHash = row.contentHash ?? await sha256Hex(canonicalOutlineJson(validation.outline));
  return { version: row.version, outline: validation.outline, contentHash };
}

export const SESSION_STATUSES_SERVER_OWNED: ReadonlySet<string> = new Set(
  SESSION_STATUSES.filter((s) => !(SESSION_STATUSES_CLIENT_WRITABLE as readonly string[]).includes(s)),
);

/**
 * An identified session admits only holders of an access link minted for the
 * session's own student (`resolveJoinIdentity`). Without a student the
 * session can be started but nobody can ever join it, so refuse at the start and
 * name the fix. Join refusals stay one indistinguishable answer; this message is
 * for the tutor who starts the session, never for a joining holder.
 */
export function identifiedNeedsStudent(): Response {
  return json({
    ok: false,
    error: 'identified-session-needs-student',
    message: 'An identified session needs a student: file the deck under the student (studentId), then start it with deck_start or POST /api/decks/{id}/start.',
  }, 422);
}
