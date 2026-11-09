/**
 * Workspace hierarchy: spaces and folders.
 * Bootstrap creates the Personal space.
 */
import { isWorkspaceExperience, parseOutline, parseSpaceSettings, readSpaceSettings, type SpaceSettings } from '@openroom/schema';
import { and, asc, desc, eq, exists, inArray, isNotNull, isNull, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { alias } from 'drizzle-orm/sqlite-core';

import { sha256Hex } from './api-tokens.js';
import { json, requireSession, type ControlEnv, type SessionUser } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { DELETION_INTENT_TTL_MS, linkStudent } from './control-utils.js';
import { orm, type Orm } from './db/client.js';
import {
  deckDrafts,
  decks,
  deckVersions,
  deletionIntents,
  folders,
  liveSessions,
  sessionRecords,
  sessions,
  spaceMembers,
  spaces,
  spaceStudents,
  students,
} from './db/schema.js';
import { folderAccess, spaceRole, roleAtLeast } from './members.js';
import { readSpaceItemTags } from './tags.js';

function randomId(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let binary = '';
  for (const b of buf) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

type DeckContents = {
  slides: number;
  askTheClass: number;
  homework: boolean;
  recap: boolean;
  minutes: number | null;
};

const NO_CONTENTS: DeckContents = { slides: 0, askTheClass: 0, homework: false, recap: false, minutes: null };

/** Counts what is *in* an outline object. Never returns the outline itself. */
function summarizeOutlineRecord(parsed: unknown): DeckContents {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return NO_CONTENTS;
  const record = parsed as Record<string, unknown>;
  const steps = Array.isArray(record.steps) ? record.steps : [];
  const meta = record.meta !== null && typeof record.meta === 'object' && !Array.isArray(record.meta)
    ? (record.meta as Record<string, unknown>)
    : {};
  const minutes = typeof meta.durationMinutes === 'number' && meta.durationMinutes > 0
    ? meta.durationMinutes
    : null;
  return {
    slides: steps.length,
    askTheClass: steps.filter(
      (step) => step !== null && typeof step === 'object' && (step as { kind?: unknown }).kind === 'interaction',
    ).length,
    homework: record.homework != null,
    recap: record.recap != null,
    minutes,
  };
}

/**
 * What is in the file the tutor is editing: the rolling draft when there is
 * one on the current version and it parses, otherwise the saved version. A
 * row states what is in the file, and the editor shows the draft.
 */
function summarizeDeckContents(contentJson: string | null, draftYaml: string | null = null): DeckContents {
  if (draftYaml !== null) {
    const draft = parseOutline(draftYaml, 'yaml');
    if (draft.ok) return summarizeOutlineRecord(draft.outline);
  }
  if (!contentJson) return NO_CONTENTS;
  try {
    return summarizeOutlineRecord(JSON.parse(contentJson));
  } catch {
    return NO_CONTENTS;
  }
}

export interface WorkspaceHome {
  spaceId: string;
  spaceName: string;
}

/**
 * Ensure the user has at least one space. Idempotent.
 *
 * The Personal space stores no experience: it reads as Classroom until the
 * owner saves one, and the Library's first-run card offers the choice until then.
 */
export async function ensureWorkspace(
  env: ControlEnv,
  user: SessionUser,
  now = Date.now(),
): Promise<WorkspaceHome> {
  const db = orm(env);
  const existing = await db
    .select({ id: spaces.id, name: spaces.name })
    .from(spaces)
    .where(eq(spaces.ownerUserId, user.id))
    .orderBy(asc(spaces.createdAt))
    .limit(1)
    .get();

  if (existing) {
    return { spaceId: existing.id, spaceName: existing.name };
  }

  const spaceId = randomId();
  await db.batch([
    db
      .insert(spaces)
      .values({ id: spaceId, ownerUserId: user.id, name: 'Personal', createdAt: now, updatedAt: now, settings: '{}' }),
    db.insert(spaceMembers).values({ spaceId, userId: user.id, role: 'owner', invitedBy: null, createdAt: now }),
  ]);

  return { spaceId, spaceName: 'Personal' };
}

/** Create a place with an explicit experience; generic API creation defaults to Classroom. */
export async function createSpaceRoute(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const body = await readJson(request);
  if (body === null) return json({ ok: false, error: 'invalid-json' }, 400);
  if ('experience' in body && !isWorkspaceExperience(body.experience)) {
    return json({ ok: false, error: 'invalid-experience' }, 422);
  }
  const settings = parseSpaceSettings(body);
  if ('languages' in body && body.languages !== null && !settings.languages) {
    return json({ ok: false, error: 'unsupported-language-pair' }, 422);
  }
  const name =
    typeof body.name === 'string' && body.name.trim() !== ''
      ? body.name.trim().slice(0, 120)
      : 'Space';
  const now = Date.now();
  const spaceId = randomId();
  const db = orm(env);

  /*
   * `studentId` reuses an existing student in the new space — the other half of
   * "a space holds one student". The same student taught a second language is
   * one student in two spaces, because the language pair is a space setting;
   * duplicating the person to carry a second pair would make two people out of
   * one, and their goals and notes would drift apart.
   *
   * Membership on a space the student is already in is the gate: reuse must not
   * be a way to reach a student you could not otherwise see.
   */
  let reuse: string | null = null;
  if (typeof body.studentId === 'string' && body.studentId !== '') {
    const row = await db
      .select({ id: students.id })
      .from(students)
      .innerJoin(spaceMembers, and(eq(spaceMembers.spaceId, students.spaceId), eq(spaceMembers.userId, guard.user.id)))
      .where(and(eq(students.id, body.studentId), isNull(students.deletedAt)))
      .get();
    if (row === undefined) return json({ ok: false, error: 'not-found' }, 404);
    reuse = row.id;
  }

  await db.batch([
    db.insert(spaces).values({
      id: spaceId,
      ownerUserId: guard.user.id,
      name,
      createdAt: now,
      updatedAt: now,
      settings: JSON.stringify(settings),
    }),
    db.insert(spaceMembers).values({ spaceId, userId: guard.user.id, role: 'owner', invitedBy: null, createdAt: now }),
  ]);
  if (reuse !== null) await linkStudent(env, spaceId, reuse, now);
  return json({ id: spaceId, name, settings, ...(reuse === null ? {} : { studentId: reuse }) }, 201);
}

/**
 * Patch independent space settings. Owners choose the experience; editors can
 * configure languages. A change never modifies content, access, or paid capabilities.
 */
export async function patchSpaceRoute(
  request: Request,
  env: ControlEnv,
  spaceId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const access = await spaceRole(env, guard.user, spaceId);
  if (access === null) return json({ ok: false, error: 'not-found' }, 404);
  if (!roleAtLeast(access.role, 'editor')) return json({ ok: false, error: 'forbidden' }, 403);

  const body = await readJson(request);
  if (body === null) return json({ ok: false, error: 'invalid-json' }, 400);
  if (!('languages' in body) && !('experience' in body)) return json({ ok: false, error: 'nothing-to-change' }, 422);
  if ('experience' in body) {
    if (access.role !== 'owner') return json({ ok: false, error: 'forbidden' }, 403);
    if (!isWorkspaceExperience(body.experience)) return json({ ok: false, error: 'invalid-experience' }, 422);
  }
  const patch: { experience?: SpaceSettings['experience']; languages?: SpaceSettings['languages'] | null } = {};
  if (isWorkspaceExperience(body.experience)) patch.experience = body.experience;
  if ('languages' in body) {
    const languages = parseSpaceSettings({ languages: body.languages }).languages;
    if (body.languages !== null && languages === undefined) {
      return json({ ok: false, error: 'unsupported-language-pair' }, 422);
    }
    patch.languages = languages ?? null;
  }
  // JSON Merge Patch updates only the requested fields in one SQL statement.
  // Concurrent language and experience edits cannot overwrite each other.
  await orm(env)
    .update(spaces)
    .set({ settings: sql`json_patch(${spaces.settings}, ${JSON.stringify(patch)})`, updatedAt: Date.now() })
    .where(eq(spaces.id, spaceId))
    .run();
  const settings = await spaceSettings(env, spaceId);
  return json({ ok: true, settings });
}

/** The stored settings of a space, narrowed. Unreadable JSON reads as unset. */
export async function spaceSettings(env: ControlEnv, spaceId: string): Promise<SpaceSettings> {
  return (await storedSpaceSettings(env, spaceId)).settings;
}

/** The narrowed settings, and whether an experience was ever saved (the default is not one). */
async function storedSpaceSettings(env: ControlEnv, spaceId: string): Promise<{ settings: SpaceSettings; experienceSaved: boolean }> {
  const row = await orm(env).select({ settings: spaces.settings }).from(spaces).where(eq(spaces.id, spaceId)).get();
  const source = row?.settings ?? null;
  let experienceSaved = false;
  try {
    const raw: unknown = source === null ? null : JSON.parse(source);
    experienceSaved = raw !== null && typeof raw === 'object' && isWorkspaceExperience((raw as { experience?: unknown }).experience);
  } catch { /* unreadable reads as unset */ }
  return { settings: readSpaceSettings(source), experienceSaved };
}

/**
 * Where a live row shows in the tree. A row still filed in a folder that is in
 * Trash (restored on its own, or in a folder trashed before its decks went
 * along) shows at the space root, so it stays reachable; restoring the folder
 * puts it back inside. Trashing a folder moves its own rows to Trash with it.
 */
function shownFolder(db: Orm, folderId: AnyColumn): SQL<string | null> {
  const trashed = db
    .select({ one: sql`1` })
    .from(folders)
    .where(and(eq(folders.id, folderId), isNotNull(folders.deletedAt)));
  return sql<string | null>`(CASE WHEN ${exists(trashed)} THEN NULL ELSE ${folderId} END)`;
}

/**
 * GET /api/my/spaces/:id
 * Returns space meta, folders, and everything filed in it + optional folder filter.
 */
export async function getSpaceRoute(
  request: Request,
  env: ControlEnv,
  spaceId: string,
  url: URL,
): Promise<Response> {
  const guard = await requireControlUser(request, env);
  if (!guard.ok) return guard.response;
  const access = await spaceRole(env, guard.user, spaceId);
  if (access === null) return json({ ok: false, error: 'not-found' }, 404);
  const space = access.space;

  const folderFilter = url.searchParams.get('folderId'); // null = all; '' or 'root' = unfiled

  const db = orm(env);

  const folderRows = await db
    .select({
      id: folders.id,
      name: folders.name,
      parentId: folders.parentId,
      sortOrder: folders.sortOrder,
      createdAt: folders.createdAt,
    })
    .from(folders)
    .where(and(eq(folders.spaceId, spaceId), isNull(folders.deletedAt)))
    .orderBy(asc(folders.sortOrder), asc(folders.name));

  const liveRows = await db
    .select({
      code: liveSessions.code,
      title: liveSessions.title,
      createdAt: liveSessions.createdAt,
      ended: liveSessions.ended,
    })
    .from(liveSessions)
    .where(eq(liveSessions.spaceId, spaceId))
    .orderBy(desc(liveSessions.createdAt))
    .limit(50);

  // Rows shown at the requested folder: the unfiled ones for 'root' or '', else that folder's.
  const inFolder = (shown: SQL<string | null>, folderId: AnyColumn) =>
    folderFilter === 'root' || folderFilter === ''
      ? or(isNull(shown), eq(folderId, ''))
      : folderFilter !== null
        ? eq(shown, folderFilter)
        : undefined;

  // Folder-scoped decks (content) and sessions (when/who/launch).
  const deckFolder = shownFolder(db, decks.folderId);
  const deckRows = await db
    .select({
      id: decks.id,
      title: decks.title,
      shape: decks.shape,
      currentVersion: decks.currentVersion,
      folderId: deckFolder,
      studentId: decks.studentId,
      updatedAt: decks.updatedAt,
      contentJson: deckVersions.contentJson,
      draftYaml: deckDrafts.contentYaml,
    })
    .from(decks)
    .leftJoin(deckVersions, and(eq(deckVersions.deckId, decks.id), eq(deckVersions.version, decks.currentVersion)))
    .leftJoin(deckDrafts, and(eq(deckDrafts.deckId, decks.id), eq(deckDrafts.baseVersion, decks.currentVersion)))
    .where(and(eq(decks.spaceId, spaceId), isNull(decks.deletedAt), inFolder(deckFolder, decks.folderId)))
    .orderBy(desc(decks.updatedAt))
    .limit(200);

  const sessionFolder = shownFolder(db, sessions.folderId);
  const durableSessions = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      shape: sessions.shape,
      status: sessions.status,
      deckId: sessions.deckId,
      deckVersion: sessions.deckVersion,
      folderId: sessionFolder,
      studentId: sessions.studentId,
      updatedAt: sessions.updatedAt,
    })
    .from(sessions)
    .where(and(eq(sessions.spaceId, spaceId), isNull(sessions.deletedAt), inFolder(sessionFolder, sessions.folderId)))
    .orderBy(desc(sessions.updatedAt))
    .limit(200);

  /*
   * Records are browsable rows now (`AGENTS.md` §Naming), but a record has no
   * place of its own — it inherits the session's folder, which is why the filter
   * below is applied to the session's `folder_id` and not to anything on `session_records`.
   * `notes` is deliberately absent: it is tutor-private prose, and a list row
   * has no use for it.
   */
  const recordFolder = shownFolder(db, sessions.folderId);
  const records = await db
    .select({
      id: sessionRecords.id,
      sessionId: sessionRecords.sessionId,
      studentId: sessionRecords.studentId,
      deckVersion: sessionRecords.deckVersion,
      createdAt: sessionRecords.createdAt,
      updatedAt: sessionRecords.updatedAt,
      sessionTitle: sessions.title,
      folderId: recordFolder,
    })
    .from(sessionRecords)
    .innerJoin(sessions, eq(sessions.id, sessionRecords.sessionId))
    .where(and(eq(sessions.spaceId, spaceId), isNull(sessions.deletedAt), inFolder(recordFolder, sessions.folderId)))
    .orderBy(desc(sessionRecords.updatedAt))
    .limit(200);

  /*
   * Tags are space-wide, not folder-scoped: the facet list under the tree rail
   * is "every tag in this space", and filtering by a tag must be able to say
   * how many matches live outside the folder you are standing in. One read of
   * the whole space is cheaper than a second round trip per navigation.
   */
  const tags = await readSpaceItemTags(env, spaceId);

  /*
   * Settings ride on the space, not on a sibling endpoint: the edit page and
   * the dictionary both need the language pair, and neither has anywhere else
   * to learn it. An unset pair is an absent key, not a null — a space that is
   * not a language-tutoring space carries no language state at all.
   */
  /*
   * A student's own space names its student, so settings can say whose they
   * are. A student in Trash still owns the space, so the name stays.
   */
  const [{ settings, experienceSaved }, owner] = await Promise.all([
    storedSpaceSettings(env, spaceId),
    db
      .select({ id: students.id, displayName: students.displayName })
      .from(spaceStudents)
      .innerJoin(students, eq(students.id, spaceStudents.studentId))
      .where(eq(spaceStudents.spaceId, spaceId))
      .get(),
  ]);

  return json({
    space: {
      id: space.id, name: space.name, role: access.role, settings, experienceSaved,
      student: owner === undefined ? null : { id: owner.id, displayName: owner.displayName },
    },
    itemTags: tags,
    records: records.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      title: r.sessionTitle,
      studentId: r.studentId,
      deckVersion: r.deckVersion,
      folderId: r.folderId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    folders: folderRows.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      sortOrder: f.sortOrder,
      createdAt: f.createdAt,
    })),
    decks: deckRows.map((d) => ({
      id: d.id,
      title: d.title,
      shape: d.shape,
      currentVersion: d.currentVersion,
      folderId: d.folderId,
      studentId: d.studentId,
      updatedAt: d.updatedAt,
      contents: summarizeDeckContents(d.contentJson, d.draftYaml),
    })),
    sessions: durableSessions.map((r) => ({
      id: r.id,
      title: r.title,
      shape: r.shape,
      status: r.status,
      deckId: r.deckId,
      deckVersion: r.deckVersion,
      folderId: r.folderId,
      studentId: r.studentId,
      updatedAt: r.updatedAt,
    })),
    liveSessions: liveRows.map((r) => ({
      code: r.code,
      sessionCode: r.code,
      title: r.title,
      createdAt: r.createdAt,
      ended: r.ended === 1,
    })),
  });
}

/** POST /api/my/spaces/:id/folders  body { name, parentId? } */
export async function createFolderRoute(
  request: Request,
  env: ControlEnv,
  spaceId: string,
): Promise<Response> {
  const guard = await requireSession(request, env, true);
  if (!guard.ok) return guard.response;
  const access = await spaceRole(env, guard.user, spaceId);
  if (access === null) return json({ ok: false, error: 'not-found' }, 404);
  if (!roleAtLeast(access.role, 'editor')) return json({ ok: false, error: 'forbidden' }, 403);

  const body = await readJson(request);
  if (body === null) return json({ ok: false, error: 'invalid-json' }, 400);
  const name =
    typeof body.name === 'string' && body.name.trim() !== ''
      ? body.name.trim().slice(0, 120)
      : 'Folder';
  let parentId: string | null = null;
  if (typeof body.parentId === 'string' && body.parentId.trim() !== '') {
    const parent = await folderAccess(env, guard.user, body.parentId);
    if (parent === null || parent.folder.spaceId !== spaceId) {
      return json({ ok: false, error: 'not-found' }, 404);
    }
    parentId = parent.folder.id;
  }

  const id = randomId();
  const now = Date.now();
  const db = orm(env);
  await db.insert(folders).values({ id, spaceId, parentId, name, sortOrder: 0, createdAt: now }).run();
  await db.update(spaces).set({ updatedAt: now }).where(eq(spaces.id, spaceId)).run();

  return json({ id, name, spaceId, parentId }, 201);
}

/** PATCH /api/my/folders/:id  body { name?, parentId?, sortOrder? } */
export async function patchFolderRoute(
  request: Request,
  env: ControlEnv,
  folderId: string,
): Promise<Response> {
  const guard = await requireSession(request, env, true);
  if (!guard.ok) return guard.response;
  const access = await folderAccess(env, guard.user, folderId);
  if (access === null) return json({ ok: false, error: 'not-found' }, 404);
  if (!roleAtLeast(access.role, 'editor')) return json({ ok: false, error: 'forbidden' }, 403);
  const body = await readJson(request);
  if (body === null) return json({ ok: false, error: 'invalid-json' }, 400);

  const spaceId = access.folder.spaceId;
  let nextName: string | null = null;
  if (typeof body.name === 'string' && body.name.trim() !== '') {
    nextName = body.name.trim().slice(0, 120);
  }

  let nextParentId: string | null | undefined;
  if (body.parentId === null) {
    nextParentId = null;
  } else if (typeof body.parentId === 'string') {
    if (body.parentId === folderId) {
      return json({ ok: false, error: 'invalid-parent' }, 400);
    }
    if (body.parentId.trim() === '') {
      nextParentId = null;
    } else {
      const parent = await folderAccess(env, guard.user, body.parentId);
      if (parent === null || parent.folder.spaceId !== spaceId) {
        return json({ ok: false, error: 'not-found' }, 404);
      }
      const subtree = await collectFolderSubtree(env, spaceId, folderId);
      if (subtree.includes(body.parentId)) {
        return json({ ok: false, error: 'invalid-parent' }, 400);
      }
      nextParentId = body.parentId;
    }
  }

  let nextSortOrder: number | undefined;
  if (typeof body.sortOrder === 'number' && Number.isFinite(body.sortOrder)) {
    nextSortOrder = Math.trunc(body.sortOrder);
  }

  const db = orm(env);
  if (nextName !== null) {
    await db.update(folders).set({ name: nextName }).where(eq(folders.id, folderId)).run();
  }
  if (nextParentId !== undefined) {
    await db.update(folders).set({ parentId: nextParentId }).where(eq(folders.id, folderId)).run();
  }
  if (nextSortOrder !== undefined) {
    await db.update(folders).set({ sortOrder: nextSortOrder }).where(eq(folders.id, folderId)).run();
  }

  await db.update(spaces).set({ updatedAt: Date.now() }).where(eq(spaces.id, spaceId)).run();

  return json({
    ok: true,
    id: folderId,
    ...(nextName !== null ? { name: nextName } : {}),
    ...(nextParentId !== undefined ? { parentId: nextParentId } : {}),
    ...(nextSortOrder !== undefined ? { sortOrder: nextSortOrder } : {}),
  });
}

/** Collect folder id and all descendant folder ids within a space. */
async function collectFolderSubtree(
  env: ControlEnv,
  spaceId: string,
  rootId: string,
): Promise<string[]> {
  const rows = await orm(env)
    .select({ id: folders.id, parentId: folders.parentId })
    .from(folders)
    .where(eq(folders.spaceId, spaceId));

  const byParent = new Map<string | null, string[]>();
  for (const row of rows) {
    const key = row.parentId ?? null;
    const list = byParent.get(key);
    if (list) list.push(row.id);
    else byParent.set(key, [row.id]);
  }

  const ids: string[] = [];
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    ids.push(id);
    for (const childId of byParent.get(id) ?? []) stack.push(childId);
  }
  return ids;
}

/** DELETE /api/my/folders/:id — subtree removed; items inside become unfiled */
export async function deleteFolderRoute(
  request: Request,
  env: ControlEnv,
  folderId: string,
): Promise<Response> {
  const guard = await requireSession(request, env, true);
  if (!guard.ok) return guard.response;
  const access = await folderAccess(env, guard.user, folderId);
  if (access === null) return json({ ok: false, error: 'not-found' }, 404);
  if (!roleAtLeast(access.role, 'editor')) return json({ ok: false, error: 'forbidden' }, 403);

  const subtreeIds = await collectFolderSubtree(env, access.folder.spaceId, folderId);
  const db = orm(env);
  await db.batch([
    db.update(decks).set({ folderId: null }).where(inArray(decks.folderId, subtreeIds)),
    db.update(sessions).set({ folderId: null }).where(inArray(sessions.folderId, subtreeIds)),
    db.delete(folders).where(inArray(folders.id, subtreeIds)),
  ]);
  return json({ ok: true });
}

/**
 * POST /api/my/folders/:id/trash — recoverable subtree deletion.
 *
 * The folder takes its contents with it: every folder below it, and the decks
 * and sessions filed in any of them, get the same `deleted_at` marker. Restore
 * clears exactly that marker, so a deck that was already in Trash before the
 * folder stays there, and permanent deletion deletes the decks the marker covers.
 */
export async function trashFolderRoute(
  request: Request,
  env: ControlEnv,
  folderId: string,
): Promise<Response> {
  const guard = await requireSession(request, env, true);
  if (!guard.ok) return guard.response;
  const access = await folderAccess(env, guard.user, folderId, true);
  if (access === null) return json({ ok: false, error: 'not-found' }, 404);
  if (!roleAtLeast(access.role, 'editor')) return json({ ok: false, error: 'forbidden' }, 403);
  if (access.folder.deletedAt !== null) return json({ ok: true, recoverable: true });
  const subtreeIds = await collectFolderSubtree(env, access.folder.spaceId, folderId);
  const marker = Date.now();
  const db = orm(env);
  await db.batch([
    db
      .update(folders)
      .set({ deletedAt: marker })
      .where(and(inArray(folders.id, subtreeIds), isNull(folders.deletedAt))),
    db
      .update(decks)
      .set({ deletedAt: marker })
      .where(and(inArray(decks.folderId, subtreeIds), isNull(decks.deletedAt))),
    db
      .update(sessions)
      .set({ deletedAt: marker })
      .where(and(inArray(sessions.folderId, subtreeIds), isNull(sessions.deletedAt))),
  ]);
  return json({ ok: true, recoverable: true });
}

/** GET /api/my/folders/trash — top-level recoverable folder subtrees. */
export async function listTrashedFoldersRoute(
  request: Request,
  env: ControlEnv,
): Promise<Response> {
  const guard = await requireSession(request, env);
  if (!guard.ok) return guard.response;
  const parent = alias(folders, 'parent');
  const rows = await orm(env)
    .select({
      id: folders.id,
      name: folders.name,
      spaceId: folders.spaceId,
      parentId: folders.parentId,
      deletedAt: folders.deletedAt,
    })
    .from(folders)
    .innerJoin(spaceMembers, and(eq(spaceMembers.spaceId, folders.spaceId), eq(spaceMembers.userId, guard.user.id)))
    .leftJoin(parent, eq(parent.id, folders.parentId))
    .where(and(isNotNull(folders.deletedAt), or(isNull(parent.id), isNull(parent.deletedAt))))
    .orderBy(desc(folders.deletedAt));
  return json({ folders: rows.map((row) => ({
    id: row.id,
    name: row.name,
    spaceId: row.spaceId,
    parentId: row.parentId,
    deletedAt: row.deletedAt,
  })) });
}

/** POST /api/my/folders/:id/restore */
export async function restoreFolderRoute(
  request: Request,
  env: ControlEnv,
  folderId: string,
): Promise<Response> {
  const guard = await requireSession(request, env, true);
  if (!guard.ok) return guard.response;
  const access = await folderAccess(env, guard.user, folderId, true);
  if (access === null || access.folder.deletedAt === null) {
    return json({ ok: false, error: 'not-found' }, 404);
  }
  if (!roleAtLeast(access.role, 'editor')) return json({ ok: false, error: 'forbidden' }, 403);
  const subtreeIds = await collectFolderSubtree(env, access.folder.spaceId, folderId);
  const marker = access.folder.deletedAt;
  const db = orm(env);
  await db.batch([
    db
      .update(folders)
      .set({ deletedAt: null })
      .where(and(eq(folders.deletedAt, marker), inArray(folders.id, subtreeIds))),
    db
      .update(decks)
      .set({ deletedAt: null })
      .where(and(eq(decks.deletedAt, marker), inArray(decks.folderId, subtreeIds))),
    db
      .update(sessions)
      .set({ deletedAt: null })
      .where(and(eq(sessions.deletedAt, marker), inArray(sessions.folderId, subtreeIds))),
  ]);
  return json({ ok: true });
}

/** POST /api/my/folders/:id/permanent-deletion — browser confirmation URL only. */
export async function createFolderDeletionIntentRoute(
  request: Request,
  env: ControlEnv,
  folderId: string,
): Promise<Response> {
  const guard = await requireSession(request, env, true);
  if (!guard.ok) return guard.response;
  const access = await folderAccess(env, guard.user, folderId, true);
  if (access === null) return json({ ok: false, error: 'not-found' }, 404);
  if (!roleAtLeast(access.role, 'editor')) return json({ ok: false, error: 'forbidden' }, 403);
  if (access.folder.deletedAt === null) {
    return json({ ok: false, error: 'move-to-trash-first' }, 409);
  }
  const token = randomId(24);
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await orm(env)
    .insert(deletionIntents)
    .values({
      tokenHash,
      userId: guard.user.id,
      resourceType: 'folder',
      resourceId: folderId,
      resourceName: access.folder.name,
      createdAt: now,
      expiresAt: now + DELETION_INTENT_TTL_MS,
      usedAt: null,
    })
    .run();
  return json({
    ok: true,
    confirmationRequired: true,
    expiresAt: now + DELETION_INTENT_TTL_MS,
    confirmationUrl: `${new URL(request.url).origin}/confirm-deletion/${encodeURIComponent(token)}`,
  }, 202);
}

/** Whether a trashed folder's permanent deletion would keep a live deck (it moves to the space root). */
export async function folderKeepsLiveDecks(env: ControlEnv, folderId: string): Promise<boolean> {
  const db = orm(env);
  const folder = await db.select({ spaceId: folders.spaceId }).from(folders).where(eq(folders.id, folderId)).get();
  if (folder === undefined) return false;
  const subtreeIds = await collectFolderSubtree(env, folder.spaceId, folderId);
  const row = await db
    .select({ kept: sql`1` })
    .from(decks)
    .where(and(inArray(decks.folderId, subtreeIds), isNull(decks.deletedAt)))
    .limit(1)
    .get();
  return row !== undefined;
}

/**
 * The permanent deletion of a trashed folder: the folder, every folder below it,
 * and every deck in them that is in Trash, each deck with its sessions, Notes
 * and learner work (`deleteDeckPermanently`). That covers the decks that went with the
 * folder, with a subfolder trashed before it, or on their own.
 *
 * A live deck filed here (restored on its own since, or in a folder trashed
 * before decks went along) outlives the folder and goes to the space root, as
 * does a session whose deck lives elsewhere (out of Trash if the folder put it
 * there). The confirmation page says so (`folderKeepsLiveDecks`).
 *
 * `deleteDeckPermanently` is passed in so this module does not import the delivery layer,
 * which imports this one.
 */
export async function confirmFolderDeletion(
  env: ControlEnv,
  user: SessionUser,
  folderId: string,
  deleteDeckPermanently: (env: ControlEnv, deckId: string) => Promise<void>,
): Promise<boolean> {
  const access = await folderAccess(env, user, folderId, true);
  if (access === null || access.folder.deletedAt === null) return false;
  const subtreeIds = await collectFolderSubtree(env, access.folder.spaceId, folderId);
  const marker = access.folder.deletedAt;
  const db = orm(env);
  const trashedDecks = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(inArray(decks.folderId, subtreeIds), isNotNull(decks.deletedAt)));
  for (const deck of trashedDecks) await deleteDeckPermanently(env, deck.id);
  await db.batch([
    db.update(decks).set({ folderId: null }).where(inArray(decks.folderId, subtreeIds)),
    db
      .update(sessions)
      .set({
        folderId: null,
        deletedAt: sql`CASE WHEN ${sessions.deletedAt} = ${marker} THEN NULL ELSE ${sessions.deletedAt} END`,
      })
      .where(inArray(sessions.folderId, subtreeIds)),
    db.delete(folders).where(inArray(folders.id, subtreeIds)),
  ]);
  return true;
}

type FolderRow = Pick<typeof folders.$inferSelect, 'id' | 'spaceId' | 'parentId' | 'name' | 'sortOrder'>;

/** Order folder ids in a subtree: parent before children (BFS). */
function orderSubtreeFolders(rows: FolderRow[], rootId: string): FolderRow[] {
  const inSubtree = new Set(rows.map((f) => f.id));
  if (!inSubtree.has(rootId)) return [];

  const byParent = new Map<string | null, FolderRow[]>();
  for (const f of rows) {
    if (!inSubtree.has(f.id)) continue;
    const key = f.parentId ?? null;
    const list = byParent.get(key);
    if (list) list.push(f);
    else byParent.set(key, [f]);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  const ordered: FolderRow[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const row = rows.find((f) => f.id === id);
    if (row) ordered.push(row);
    for (const child of byParent.get(id) ?? []) queue.push(child.id);
  }
  return ordered;
}

function copyFolderName(source: string): string {
  const suffix = ' (copy)';
  const max = 120;
  if (source.length + suffix.length <= max) return `${source}${suffix}`;
  return `${source.slice(0, max - suffix.length)}${suffix}`;
}

/** POST /api/my/folders/:id/copy — duplicate the folder subtree itself */
export async function copyFolderRoute(
  request: Request,
  env: ControlEnv,
  folderId: string,
): Promise<Response> {
  const guard = await requireSession(request, env, true);
  if (!guard.ok) return guard.response;

  const access = await folderAccess(env, guard.user, folderId);
  if (access === null) return json({ ok: false, error: 'not-found' }, 404);
  if (!roleAtLeast(access.role, 'editor')) return json({ ok: false, error: 'forbidden' }, 403);

  const db = orm(env);
  const folderColumns = {
    id: folders.id,
    spaceId: folders.spaceId,
    parentId: folders.parentId,
    name: folders.name,
    sortOrder: folders.sortOrder,
  };
  const source = await db.select(folderColumns).from(folders).where(eq(folders.id, folderId)).get();
  if (source === undefined) return json({ ok: false, error: 'not-found' }, 404);

  const body = await readJson(request);
  const rootName =
    body !== null && typeof body.name === 'string' && body.name.trim() !== ''
      ? body.name.trim().slice(0, 120)
      : copyFolderName(source.name);

  const allFolders = await db.select(folderColumns).from(folders).where(eq(folders.spaceId, source.spaceId));

  const ordered = orderSubtreeFolders(allFolders, folderId);
  if (ordered.length === 0) return json({ ok: false, error: 'not-found' }, 404);

  const idMap = new Map<string, string>();
  const now = Date.now();
  const stmts: BatchItem<'sqlite'>[] = [];

  for (const f of ordered) {
    const newId = randomId();
    idMap.set(f.id, newId);
    const newParentId =
      f.id === folderId ? source.parentId : f.parentId ? (idMap.get(f.parentId) ?? null) : null;
    const name = f.id === folderId ? rootName : f.name;
    stmts.push(
      db
        .insert(folders)
        .values({ id: newId, spaceId: source.spaceId, parentId: newParentId, name, sortOrder: f.sortOrder, createdAt: now }),
    );
  }

  stmts.push(db.update(spaces).set({ updatedAt: now }).where(eq(spaces.id, source.spaceId)));
  // `ordered` is non-empty (checked above), so `stmts` always has a first statement.
  await db.batch(stmts as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

  const newRootId = idMap.get(folderId)!;
  return json({ id: newRootId, name: rootName, spaceId: source.spaceId }, 201);
}
