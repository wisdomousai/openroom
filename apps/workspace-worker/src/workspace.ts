/**
 * Workspace hierarchy: spaces and folders.
 * Bootstrap creates the Personal space.
 */
import { isWorkspaceExperience, parseSpaceSettings, readSpaceSettings, type SpaceSettings } from '@openroom/schema';

import { sha256Hex } from './api-tokens.js';
import { json, requireSession, type ControlEnv, type SessionUser } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { DELETION_INTENT_TTL_MS, linkContext } from './control-utils.js';
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

/** Counts what is *in* the file. Never returns the outline itself. */
function summarizeDeckContents(contentJson: string | null): {
  slides: number;
  askTheClass: number;
  homework: boolean;
  recap: boolean;
  minutes: number | null;
} {
  if (!contentJson) {
    return { slides: 0, askTheClass: 0, homework: false, recap: false, minutes: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contentJson);
  } catch {
    return { slides: 0, askTheClass: 0, homework: false, recap: false, minutes: null };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { slides: 0, askTheClass: 0, homework: false, recap: false, minutes: null };
  }
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

export interface WorkspaceHome {
  spaceId: string;
  spaceName: string;
}

/**
 * Ensure the user has at least one space. Idempotent.
 */
export async function ensureWorkspace(
  env: ControlEnv,
  user: SessionUser,
  now = Date.now(),
): Promise<WorkspaceHome> {
  const existing = await env.DB.prepare(
    `SELECT id, name FROM spaces
      WHERE owner_user_id = ?1
      ORDER BY created_at ASC
      LIMIT 1`,
  )
    .bind(user.id)
    .first<{ id: string; name: string }>();

  if (existing) {
    return { spaceId: existing.id, spaceName: existing.name };
  }

  const spaceId = randomId();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO spaces (id, owner_user_id, name, created_at, updated_at, settings)
       VALUES (?1, ?2, ?3, ?4, ?4, '{"experience":"classroom"}')`,
    ).bind(spaceId, user.id, 'Personal', now),
    env.DB.prepare(
      `INSERT INTO space_members (space_id, user_id, role, invited_by, created_at)
       VALUES (?1, ?2, 'owner', NULL, ?3)`,
    ).bind(spaceId, user.id, now),
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

  /*
   * `contextId` reuses an existing context in the new space — the other half of
   * "a space holds one context". The same student taught a second language is
   * one context in two spaces, because the language pair is a space setting;
   * duplicating the person to carry a second pair would make two people out of
   * one, and their goals and notes would drift apart.
   *
   * Membership on a space the context is already in is the gate: reuse must not
   * be a way to reach a context you could not otherwise see.
   */
  let reuse: string | null = null;
  if (typeof body.contextId === 'string' && body.contextId !== '') {
    const row = await env.DB.prepare(
      `SELECT c.id AS id FROM contexts c
        JOIN space_members m ON m.space_id = c.space_id AND m.user_id = ?2
       WHERE c.id = ?1 AND c.deleted_at IS NULL`,
    )
      .bind(body.contextId, guard.user.id)
      .first<{ id: string }>();
    if (row === null) return json({ ok: false, error: 'not-found' }, 404);
    reuse = row.id;
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO spaces (id, owner_user_id, name, created_at, updated_at, settings)
       VALUES (?1, ?2, ?3, ?4, ?4, ?5)`,
    ).bind(spaceId, guard.user.id, name, now, JSON.stringify(settings)),
    env.DB.prepare(
      `INSERT INTO space_members (space_id, user_id, role, invited_by, created_at)
       VALUES (?1, ?2, 'owner', NULL, ?3)`,
    ).bind(spaceId, guard.user.id, now),
  ]);
  if (reuse !== null) await linkContext(env, spaceId, reuse, now);
  return json({ id: spaceId, name, settings, ...(reuse === null ? {} : { contextId: reuse }) }, 201);
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
  await env.DB.prepare('UPDATE spaces SET settings = json_patch(settings, ?1), updated_at = ?2 WHERE id = ?3')
    .bind(JSON.stringify(patch), Date.now(), spaceId)
    .run();
  const settings = await spaceSettings(env, spaceId);
  return json({ ok: true, settings });
}

/** The stored settings of a space, narrowed. Unreadable JSON reads as unset. */
export async function spaceSettings(env: ControlEnv, spaceId: string): Promise<SpaceSettings> {
  const row = await env.DB.prepare('SELECT settings FROM spaces WHERE id = ?1')
    .bind(spaceId)
    .first<{ settings: string | null }>();
  return readSpaceSettings(row?.settings ?? null);
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

  const { results: folders } = await env.DB.prepare(
    `SELECT id, name, parent_id, sort_order, created_at FROM folders
      WHERE space_id = ?1 AND deleted_at IS NULL ORDER BY sort_order ASC, name ASC`,
  )
    .bind(spaceId)
    .all<{
      id: string;
      name: string;
      parent_id: string | null;
      sort_order: number;
      created_at: number;
    }>();

  const { results: liveSessions } = await env.DB.prepare(
    `SELECT code, title, created_at, ended
       FROM live_sessions
      WHERE space_id = ?1
      ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(spaceId)
    .all<{
      code: string;
      title: string | null;
      created_at: number;
      ended: number;
    }>();

  // Folder-scoped decks (content) and sessions (when/who/launch).
  let deckQuery = `
    SELECT d.id AS id, d.title AS title, d.shape AS shape, d.current_version AS current_version,
           d.folder_id AS folder_id, d.context_id AS context_id, d.updated_at AS updated_at,
           v.content_json AS content_json
      FROM decks d
      LEFT JOIN deck_versions v ON v.deck_id = d.id AND v.version = d.current_version
     WHERE d.space_id = ?1 AND d.deleted_at IS NULL`;
  const deckBinds: (string | number)[] = [spaceId];
  if (folderFilter === 'root' || folderFilter === '') {
    deckQuery += ' AND (d.folder_id IS NULL OR d.folder_id = \'\')';
  } else if (folderFilter !== null) {
    deckQuery += ' AND d.folder_id = ?2';
    deckBinds.push(folderFilter);
  }
  deckQuery += ' ORDER BY d.updated_at DESC LIMIT 200';
  const { results: decks } = await env.DB.prepare(deckQuery)
    .bind(...deckBinds)
    .all<{
      id: string;
      title: string;
      shape: string;
      current_version: number;
      folder_id: string | null;
      context_id: string | null;
      updated_at: number;
      content_json: string | null;
    }>();

  let sessionQuery = `
    SELECT id, title, shape, status, deck_id, deck_version, folder_id, context_id,
           updated_at
      FROM sessions
     WHERE space_id = ?1 AND deleted_at IS NULL`;
  const sessionBinds: (string | number)[] = [spaceId];
  if (folderFilter === 'root' || folderFilter === '') {
    sessionQuery += ' AND (folder_id IS NULL OR folder_id = \'\')';
  } else if (folderFilter !== null) {
    sessionQuery += ' AND folder_id = ?2';
    sessionBinds.push(folderFilter);
  }
  sessionQuery += ' ORDER BY updated_at DESC LIMIT 200';
  const { results: durableSessions } = await env.DB.prepare(sessionQuery)
    .bind(...sessionBinds)
    .all<{
      id: string;
      title: string;
      shape: string;
      status: string;
      deck_id: string;
      deck_version: number;
      folder_id: string | null;
      context_id: string | null;
      updated_at: number;
    }>();

  /*
   * Records are browsable rows now (`AGENTS.md` §Naming), but a record has no
   * place of its own — it inherits the session's folder, which is why the filter
   * below is applied to `r.folder_id` and not to anything on `session_records`.
   * `notes` is deliberately absent: it is tutor-private prose, and a list row
   * has no use for it.
   */
  let recordQuery = `
    SELECT rr.id AS id, rr.session_id AS session_id, rr.context_id AS context_id,
           rr.deck_version AS deck_version, rr.created_at AS created_at,
           rr.updated_at AS updated_at, r.title AS session_title, r.folder_id AS folder_id
      FROM session_records rr
      JOIN sessions r ON r.id = rr.session_id
     WHERE r.space_id = ?1 AND r.deleted_at IS NULL`;
  const recordBinds: (string | number)[] = [spaceId];
  if (folderFilter === 'root' || folderFilter === '') {
    recordQuery += ' AND (r.folder_id IS NULL OR r.folder_id = \'\')';
  } else if (folderFilter !== null) {
    recordQuery += ' AND r.folder_id = ?2';
    recordBinds.push(folderFilter);
  }
  recordQuery += ' ORDER BY rr.updated_at DESC LIMIT 200';
  const { results: records } = await env.DB.prepare(recordQuery)
    .bind(...recordBinds)
    .all<{
      id: string;
      session_id: string;
      context_id: string | null;
      deck_version: number;
      created_at: number;
      updated_at: number;
      session_title: string;
      folder_id: string | null;
    }>();

  /*
   * Tags are space-wide, not folder-scoped: the facet list under the tree rail
   * is "every tag in this space", and filtering by a tag must be able to say
   * how many matches live outside the folder you are standing in. One read of
   * the whole space is cheaper than a second round trip per navigation.
   */
  const itemTags = await readSpaceItemTags(env, spaceId);

  /*
   * Settings ride on the space, not on a sibling endpoint: the edit page and
   * the dictionary both need the language pair, and neither has anywhere else
   * to learn it. An unset pair is an absent key, not a null — a space that is
   * not a language-tutoring space carries no language state at all.
   */
  const settings = await spaceSettings(env, spaceId);

  return json({
    space: { id: space.id, name: space.name, role: access.role, settings },
    itemTags,
    records: (records ?? []).map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      title: r.session_title,
      contextId: r.context_id,
      deckVersion: r.deck_version,
      folderId: r.folder_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    folders: (folders ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parent_id,
      sortOrder: f.sort_order,
      createdAt: f.created_at,
    })),
    decks: (decks ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      shape: d.shape,
      currentVersion: d.current_version,
      folderId: d.folder_id,
      contextId: d.context_id,
      updatedAt: d.updated_at,
      contents: summarizeDeckContents(d.content_json),
    })),
    sessions: (durableSessions ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      shape: r.shape,
      status: r.status,
      deckId: r.deck_id,
      deckVersion: r.deck_version,
      folderId: r.folder_id,
      contextId: r.context_id,
      updatedAt: r.updated_at,
    })),
    liveSessions: (liveSessions ?? []).map((r) => ({
      code: r.code,
      sessionCode: r.code,
      title: r.title,
      createdAt: r.created_at,
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
    if (parent === null || parent.folder.space_id !== spaceId) {
      return json({ ok: false, error: 'not-found' }, 404);
    }
    parentId = parent.folder.id;
  }

  const id = randomId();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO folders (id, space_id, parent_id, name, sort_order, created_at)
     VALUES (?1, ?2, ?3, ?4, 0, ?5)`,
  )
    .bind(id, spaceId, parentId, name, now)
    .run();
  await env.DB.prepare('UPDATE spaces SET updated_at = ?1 WHERE id = ?2')
    .bind(now, spaceId)
    .run();

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

  const spaceId = access.folder.space_id;
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
      if (parent === null || parent.folder.space_id !== spaceId) {
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

  if (nextName !== null) {
    await env.DB.prepare('UPDATE folders SET name = ?1 WHERE id = ?2')
      .bind(nextName, folderId)
      .run();
  }
  if (nextParentId !== undefined) {
    await env.DB.prepare('UPDATE folders SET parent_id = ?1 WHERE id = ?2')
      .bind(nextParentId, folderId)
      .run();
  }
  if (nextSortOrder !== undefined) {
    await env.DB.prepare('UPDATE folders SET sort_order = ?1 WHERE id = ?2')
      .bind(nextSortOrder, folderId)
      .run();
  }

  await env.DB.prepare('UPDATE spaces SET updated_at = ?1 WHERE id = ?2')
    .bind(Date.now(), spaceId)
    .run();

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
  const { results } = await env.DB.prepare(
    'SELECT id, parent_id FROM folders WHERE space_id = ?1',
  )
    .bind(spaceId)
    .all<{ id: string; parent_id: string | null }>();

  const byParent = new Map<string | null, string[]>();
  for (const row of results ?? []) {
    const key = row.parent_id ?? null;
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

  const subtreeIds = await collectFolderSubtree(env, access.folder.space_id, folderId);
  const placeholders = subtreeIds.map((_, i) => `?${i + 1}`).join(', ');
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE decks SET folder_id = NULL WHERE folder_id IN (${placeholders})`,
    ).bind(...subtreeIds),
    env.DB.prepare(
      `UPDATE sessions SET folder_id = NULL WHERE folder_id IN (${placeholders})`,
    ).bind(...subtreeIds),
    env.DB.prepare(`DELETE FROM folders WHERE id IN (${placeholders})`).bind(...subtreeIds),
  ]);
  return json({ ok: true });
}

/** POST /api/my/folders/:id/trash — recoverable subtree deletion. */
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
  if (access.folder.deleted_at !== null) return json({ ok: true, recoverable: true });
  const subtreeIds = await collectFolderSubtree(env, access.folder.space_id, folderId);
  const marker = Date.now();
  const placeholders = subtreeIds.map((_, i) => `?${i + 2}`).join(', ');
  await env.DB.prepare(
    `UPDATE folders SET deleted_at = ?1 WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
  ).bind(marker, ...subtreeIds).run();
  return json({ ok: true, recoverable: true });
}

/** GET /api/my/folders/trash — top-level recoverable folder subtrees. */
export async function listTrashedFoldersRoute(
  request: Request,
  env: ControlEnv,
): Promise<Response> {
  const guard = await requireSession(request, env);
  if (!guard.ok) return guard.response;
  const { results } = await env.DB.prepare(
    `SELECT f.id, f.name, f.space_id, f.parent_id, f.deleted_at
       FROM folders f
       JOIN space_members sm ON sm.space_id = f.space_id AND sm.user_id = ?1
       LEFT JOIN folders parent ON parent.id = f.parent_id
      WHERE f.deleted_at IS NOT NULL
        AND (parent.id IS NULL OR parent.deleted_at IS NULL)
      ORDER BY f.deleted_at DESC`,
  ).bind(guard.user.id).all<{
    id: string;
    name: string;
    space_id: string;
    parent_id: string | null;
    deleted_at: number;
  }>();
  return json({ folders: (results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    spaceId: row.space_id,
    parentId: row.parent_id,
    deletedAt: row.deleted_at,
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
  if (access === null || access.folder.deleted_at === null) {
    return json({ ok: false, error: 'not-found' }, 404);
  }
  if (!roleAtLeast(access.role, 'editor')) return json({ ok: false, error: 'forbidden' }, 403);
  const subtreeIds = await collectFolderSubtree(env, access.folder.space_id, folderId);
  const placeholders = subtreeIds.map((_, i) => `?${i + 2}`).join(', ');
  await env.DB.prepare(
    `UPDATE folders SET deleted_at = NULL WHERE deleted_at = ?1 AND id IN (${placeholders})`,
  ).bind(access.folder.deleted_at, ...subtreeIds).run();
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
  if (access.folder.deleted_at === null) {
    return json({ ok: false, error: 'move-to-trash-first' }, 409);
  }
  const token = randomId(24);
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO deletion_intents
       (token_hash, user_id, resource_type, resource_id, resource_name, created_at, expires_at, used_at)
     VALUES (?1, ?2, 'folder', ?3, ?4, ?5, ?6, NULL)`,
  ).bind(tokenHash, guard.user.id, folderId, access.folder.name, now, now + DELETION_INTENT_TTL_MS).run();
  return json({
    ok: true,
    confirmationRequired: true,
    expiresAt: now + DELETION_INTENT_TTL_MS,
    confirmationUrl: `${new URL(request.url).origin}/confirm-deletion/${encodeURIComponent(token)}`,
  }, 202);
}

export async function confirmFolderDeletion(
  env: ControlEnv,
  user: SessionUser,
  folderId: string,
): Promise<boolean> {
  const access = await folderAccess(env, user, folderId, true);
  if (access === null || access.folder.deleted_at === null) return false;
  const subtreeIds = await collectFolderSubtree(env, access.folder.space_id, folderId);
  const placeholders = subtreeIds.map((_, i) => `?${i + 1}`).join(', ');
  await env.DB.batch([
    env.DB.prepare(`UPDATE decks SET folder_id = NULL WHERE folder_id IN (${placeholders})`).bind(...subtreeIds),
    env.DB.prepare(`UPDATE sessions SET folder_id = NULL WHERE folder_id IN (${placeholders})`).bind(...subtreeIds),
    env.DB.prepare(`DELETE FROM folders WHERE id IN (${placeholders})`).bind(...subtreeIds),
  ]);
  return true;
}

interface FolderRow {
  id: string;
  space_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
}

/** Order folder ids in a subtree: parent before children (BFS). */
function orderSubtreeFolders(folders: FolderRow[], rootId: string): FolderRow[] {
  const inSubtree = new Set(folders.map((f) => f.id));
  if (!inSubtree.has(rootId)) return [];

  const byParent = new Map<string | null, FolderRow[]>();
  for (const f of folders) {
    if (!inSubtree.has(f.id)) continue;
    const key = f.parent_id ?? null;
    const list = byParent.get(key);
    if (list) list.push(f);
    else byParent.set(key, [f]);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }

  const ordered: FolderRow[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const row = folders.find((f) => f.id === id);
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

  const source = await env.DB.prepare(
    `SELECT id, space_id, parent_id, name, sort_order FROM folders WHERE id = ?1`,
  )
    .bind(folderId)
    .first<FolderRow>();
  if (source === null) return json({ ok: false, error: 'not-found' }, 404);

  const body = await readJson(request);
  const rootName =
    body !== null && typeof body.name === 'string' && body.name.trim() !== ''
      ? body.name.trim().slice(0, 120)
      : copyFolderName(source.name);

  const { results: allFolders } = await env.DB.prepare(
    `SELECT id, space_id, parent_id, name, sort_order FROM folders WHERE space_id = ?1`,
  )
    .bind(source.space_id)
    .all<FolderRow>();

  const ordered = orderSubtreeFolders(allFolders ?? [], folderId);
  if (ordered.length === 0) return json({ ok: false, error: 'not-found' }, 404);

  const idMap = new Map<string, string>();
  const now = Date.now();
  const stmts: ReturnType<ControlEnv['DB']['prepare']>[] = [];

  for (const f of ordered) {
    const newId = randomId();
    idMap.set(f.id, newId);
    const newParentId =
      f.id === folderId ? source.parent_id : f.parent_id ? (idMap.get(f.parent_id) ?? null) : null;
    const name = f.id === folderId ? rootName : f.name;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO folders (id, space_id, parent_id, name, sort_order, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(newId, source.space_id, newParentId, name, f.sort_order, now),
    );
  }

  stmts.push(
    env.DB.prepare('UPDATE spaces SET updated_at = ?1 WHERE id = ?2').bind(now, source.space_id),
  );

  await env.DB.batch(stmts);

  const newRootId = idMap.get(folderId)!;
  return json({ id: newRootId, name: rootName, spaceId: source.space_id }, 201);
}
