/**
 * Folder-scoped decks (content) and sessions (delivery instances).
 * Contexts stay in tutoring.ts. Live sessions are launched from a session.
 */
import {
  blankDeck,
  canonicalOutlineJson,
  clipNextNote,
  deckSource,
  compileRecordHomework,
  validateOutline,
  parseOutline,
  DECK_DRAFT_MAX_CHARS,
  DECK_SHAPES,
  SESSION_STATUSES,
  SESSION_STATUSES_CLIENT_WRITABLE,
  type Outline,
  type OutlineValidateResult,
} from '@openroom/schema';

import { sha256Hex } from '../api-tokens.js';
import { json, type ControlEnv, type SessionUser } from '../auth.js';
import { requireControlUser } from '../control-auth.js';
import { DELETION_INTENT_TTL_MS, compactArray, memberOfSpace, parseJson, plainObject, randomId, randomToken, readJson, resolveSpace } from '../control-utils.js';
import { folderAccess, spaceRole, roleAtLeast } from '../members.js';
import { ensureWorkspace } from '../workspace.js';

import {
  parseShape,
  resolveFolder,
  deckAccess,
  sessionAccess,
  contextAccess,
  mutationAllowed,
  targetSpace,
  requestedLocationEditable,
  deckJson,
  sessionJson,
  latestContent,
  deckFileLocationJson,
  FILE_ID_PATTERN,
  CONTENT_HASH_PATTERN,
  SESSION_STATUSES_SERVER_OWNED,
  type DeckRow,
  type SessionRow,
  type DeckFileLinkRow,
  type DeckFileLocationRow,
} from './shared.js';

export async function decksCollectionRoute(
  request: Request,
  env: ControlEnv,
  url: URL,
): Promise<Response> {
  const guard = await requireControlUser(request, env, request.method === 'POST');
  if (!guard.ok) return guard.response;

  if (request.method === 'GET') {
    await ensureWorkspace(env, guard.user);
    const trashed = url.searchParams.get('trash') === '1';
    const folderId = url.searchParams.get('folderId');
    const spaceId = url.searchParams.get('spaceId');
    const contextId = url.searchParams.get('contextId');
    const binds: string[] = [guard.user.id];
    let where = trashed ? 'd.deleted_at IS NOT NULL' : 'd.deleted_at IS NULL';
    let n = 2;
    if (spaceId !== null && spaceId !== '') {
      where += ` AND d.space_id = ?${n}`;
      binds.push(spaceId);
      n += 1;
    }
    if (folderId === 'root' || folderId === '') {
      where += ' AND (d.folder_id IS NULL OR d.folder_id = \'\')';
    } else if (folderId !== null) {
      where += ` AND d.folder_id = ?${n}`;
      binds.push(folderId);
      n += 1;
    }
    if (contextId !== null && contextId !== '') {
      where += ` AND d.context_id = ?${n}`;
      binds.push(contextId);
    }
    const { results } = await env.DB.prepare(
      `SELECT d.* FROM decks d
       WHERE EXISTS (SELECT 1 FROM space_members sm
                      WHERE sm.space_id = d.space_id AND sm.user_id = ?1)
         AND ${where} ORDER BY d.updated_at DESC LIMIT 500`,
    ).bind(...binds).all<DeckRow>();
    return json({ decks: (results ?? []).map(deckJson) });
  }

  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  const requestedAccess = await requestedLocationEditable(env, guard.user, body);
  if (requestedAccess !== 'editable') {
    return json({ error: requestedAccess }, requestedAccess === 'forbidden' ? 403 : 404);
  }

  // Filing and student association are independent. Standalone decks have no context.
  const spaceId = await targetSpace(env, guard.user, body);
  if (spaceId === null) return json({ error: 'not-found' }, 404);
  let linkedContext: { id: string; space_id: string; deleted_at: number | null } | null = null;
  if (typeof body.contextId === 'string' && body.contextId.trim() !== '') {
    linkedContext = await contextAccess(env, guard.user.id, body.contextId);
    if (linkedContext === null || linkedContext.deleted_at !== null || linkedContext.space_id !== spaceId) {
      return json({ error: 'context-not-found' }, 404);
    }
  } else if (body.contextId !== undefined && body.contextId !== null) {
    return json({ error: 'invalid-context-id' }, 422);
  }

  const outlineValidation: OutlineValidateResult | null = body.content === undefined && body.outline === undefined
    ? null
    : validateOutline(body.content ?? body.outline);
  if (outlineValidation !== null && !outlineValidation.ok) {
    return json({ error: 'invalid-content', errors: outlineValidation.errors }, 422);
  }

  const titleInput = typeof body.title === 'string' ? body.title.trim() : '';
  const title = (titleInput || (outlineValidation?.ok ? outlineValidation.outline.meta.title : '') || 'Untitled').slice(0, 200);
  const shape = parseShape(body.shape);
  const location = await resolveFolder(env, guard.user, spaceId, body, null);
  if (!location.ok) return location.response;
  const { folderId } = location;
  if (!(await mutationAllowed(env, guard.user, spaceId))) {
    return json({ error: 'forbidden' }, 403);
  }
  const metadata = body.metadata === undefined ? {} : plainObject(body.metadata);
  if (metadata === null) return json({ error: 'metadata-must-be-object' }, 422);
  const fileId = body.fileId;
  if (fileId !== undefined && (typeof fileId !== 'string' || !FILE_ID_PATTERN.test(fileId))) {
    return json({ error: 'invalid-file-id' }, 422);
  }
  if (typeof fileId === 'string') {
    const existingFile = await env.DB.prepare(
      'SELECT deck_id FROM deck_file_links WHERE file_id = ?1',
    ).bind(fileId).first<{ deck_id: string }>();
    if (existingFile !== null) return json({ error: 'file-already-linked' }, 409);
  }

  const deckId = randomId();
  const now = Date.now();
  const version = outlineValidation?.ok ? 1 : 0;
  const initialHash = outlineValidation?.ok
    ? await sha256Hex(canonicalOutlineJson(outlineValidation.outline))
    : null;
  const statements = [
    env.DB.prepare(
      `INSERT INTO decks
         (id, space_id, folder_id, context_id, created_by, title, shape,
          current_version, metadata_json, created_at, updated_at, deleted_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, NULL)`,
    ).bind(
      deckId, spaceId, folderId, linkedContext?.id ?? null, guard.user.id,
      title, shape, version, JSON.stringify(metadata), now,
    ),
  ];
  if (outlineValidation?.ok) {
    statements.push(env.DB.prepare(
      `INSERT INTO deck_versions
         (id, deck_id, version, content_json, content_hash, source_kind,
          source_file_id, source_local_revision, created_at, created_by)
       VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).bind(
      randomId(), deckId, JSON.stringify(outlineValidation.outline), initialHash,
      fileId === undefined ? (guard.authKind === 'session' ? 'browser' : 'api') : 'desktop',
      fileId ?? null,
      fileId === undefined ? null : 0,
      now,
      guard.user.id,
    ));
  }
  if (typeof fileId === 'string') {
    statements.push(env.DB.prepare(
      `INSERT INTO deck_file_links (file_id, deck_id, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4)`,
    ).bind(fileId, deckId, guard.user.id, now));
  }

  // Opt-in convenience: also create a draft session in the same folder. Off by
  // default so a collection POST writes exactly one resource.
  const createSession = body.createSession === true;
  let sessionId: string | null = null;
  if (createSession) {
    sessionId = randomId();
    statements.push(env.DB.prepare(
      `INSERT INTO sessions
         (id, space_id, folder_id, deck_id, deck_version, context_id,
          created_by, title, shape, status,
          metadata_json, created_at, updated_at, deleted_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'draft', '{}', ?10, ?10, NULL)`,
    ).bind(
      sessionId, spaceId, folderId, deckId, version, linkedContext?.id ?? null,
      guard.user.id, title, shape, now,
    ));
  }

  await env.DB.batch(statements);
  const deck = await deckAccess(env, guard.user.id, deckId);
  const session = sessionId === null ? null : await sessionAccess(env, guard.user.id, sessionId);
  return json({
    deck: deckJson(deck!),
    session: session === null ? null : sessionJson(session),
  }, 201);
}

export async function deckItemRoute(
  request: Request,
  env: ControlEnv,
  deckId: string,
  url: URL,
): Promise<Response> {
  const guard = await requireControlUser(request, env, request.method !== 'GET');
  if (!guard.ok) return guard.response;
  const row = await deckAccess(env, guard.user.id, deckId);
  if (row === null) return json({ error: 'not-found' }, 404);

  if (request.method === 'GET') {
    const wanted = url.searchParams.get('version');
    const content = await latestContent(env, deckId, wanted === null ? undefined : Number(wanted));
    const etag = content === null
      ? `W/"deck-${deckId}-0"`
      : `W/"deck-${deckId}-${content.version}-${content.contentHash}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { etag, 'cache-control': 'no-store' } });
    }
    const place = await (
      // The deck editor shows "{Folder} / {Title}" and links back to the shelf
      // the deck lives on, so the detail read carries the names of its place
      // rather than making the editor fetch the folder tree to print two words.
      env.DB.prepare(
        `SELECT s.name AS space_name, f.name AS folder_name
           FROM spaces s
           LEFT JOIN folders f ON f.id = ?2
          WHERE s.id = ?1`,
      ).bind(row.space_id, row.folder_id).first<{ space_name: string; folder_name: string | null }>()
    );
    return json({
      deck: deckJson(row),
      spaceName: place?.space_name ?? null,
      folderName: place?.folder_name ?? null,
      contentVersion: content?.version ?? null,
      contentHash: content?.contentHash ?? null,
      content: content?.outline ?? null,
    }, 200, { etag });
  }
  if (!(await mutationAllowed(env, guard.user, row.space_id))) {
    return json({ error: 'forbidden' }, 403);
  }
  if (request.method === 'DELETE') {
    if (row.deleted_at === null) {
      const now = Date.now();
      await env.DB.prepare('UPDATE decks SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2')
        .bind(now, deckId).run();
    }
    return json({ ok: true, recoverable: true });
  }
  if (request.method !== 'PATCH') return json({ error: 'method-not-allowed' }, 405);
  if (row.deleted_at !== null) return json({ error: 'resource-in-trash' }, 409);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  const title = body.title === undefined
    ? row.title
    : typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
  if (title === '') return json({ error: 'title-required' }, 422);
  const shape = body.shape === undefined ? row.shape : parseShape(body.shape, row.shape);
  let contextId = row.context_id;
  if (body.contextId === null) {
    contextId = null;
  }
  if (typeof body.contextId === 'string') {
    const ctx = await contextAccess(env, guard.user.id, body.contextId);
    if (ctx === null || ctx.deleted_at !== null || ctx.space_id !== row.space_id) {
      return json({ error: 'context-not-found' }, 404);
    }
    contextId = ctx.id;
  }
  const location = await resolveFolder(env, guard.user, row.space_id, body, row.folder_id);
  if (!location.ok) return location.response;
  const metadata = body.metadata === undefined
    ? parseJson(row.metadata_json, {})
    : plainObject(body.metadata);
  if (metadata === null) return json({ error: 'metadata-must-be-object' }, 422);
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE decks SET title = ?1, shape = ?2, context_id = ?3, folder_id = ?4,
       metadata_json = ?5, updated_at = ?6 WHERE id = ?7`,
  ).bind(title, shape, contextId, location.folderId, JSON.stringify(metadata), now, deckId).run();
  return json({
    deck: deckJson({
      ...row, title, shape, context_id: contextId, folder_id: location.folderId,
      metadata_json: JSON.stringify(metadata), updated_at: now,
    }),
  });
}

export async function deckVersionsRoute(
  request: Request,
  env: ControlEnv,
  deckId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, request.method === 'POST');
  if (!guard.ok) return guard.response;
  const deck = await deckAccess(env, guard.user.id, deckId);
  if (deck === null) return json({ error: 'not-found' }, 404);
  if (request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT version, created_at, created_by, content_hash, source_kind,
              source_file_id, source_local_revision FROM deck_versions
        WHERE deck_id = ?1 ORDER BY version DESC`,
    ).bind(deckId).all<{
      version: number;
      created_at: number;
      created_by: string;
      content_hash: string | null;
      source_kind: string;
      source_file_id: string | null;
      source_local_revision: number | null;
    }>();
    return json({
      deckId,
      versions: (results ?? []).map((row) => ({
        version: row.version,
        createdAt: row.created_at,
        createdBy: row.created_by,
        contentHash: row.content_hash,
        sourceKind: row.source_kind,
        sourceFileId: row.source_file_id,
        sourceLocalRevision: row.source_local_revision,
      })),
    });
  }
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  if (!(await mutationAllowed(env, guard.user, deck.space_id))) {
    return json({ error: 'forbidden' }, 403);
  }
  if (deck.deleted_at !== null) return json({ error: 'resource-in-trash' }, 409);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  const validation = validateOutline(body.content ?? body.outline);
  if (!validation.ok) return json({ error: 'invalid-content', errors: validation.errors }, 422);
  const baseVersion = body.baseVersion;
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 0) {
    return json({ error: 'base-version-required' }, 400);
  }
  if (baseVersion !== deck.current_version) {
    return json({ error: 'version-conflict', latestVersion: deck.current_version }, 409);
  }
  const version = baseVersion + 1;
  const serialized = JSON.stringify(validation.outline);
  const contentHash = await sha256Hex(canonicalOutlineJson(validation.outline));
  const fileSync = plainObject(body.fileSync);
  if (body.fileSync !== undefined && fileSync === null) {
    return json({ error: 'invalid-file-sync' }, 422);
  }
  let sourceFileId: string | null = null;
  let sourceLocalRevision: number | null = null;
  if (fileSync !== null) {
    if (
      typeof fileSync.fileId !== 'string' || !FILE_ID_PATTERN.test(fileSync.fileId)
      || !Number.isInteger(fileSync.localRevision) || (fileSync.localRevision as number) < 0
      || typeof fileSync.baseContentHash !== 'string' || !CONTENT_HASH_PATTERN.test(fileSync.baseContentHash)
    ) {
      return json({ error: 'invalid-file-sync' }, 422);
    }
    const link = await env.DB.prepare(
      'SELECT file_id FROM deck_file_links WHERE file_id = ?1 AND deck_id = ?2',
    ).bind(fileSync.fileId, deckId).first<{ file_id: string }>();
    if (link === null) return json({ error: 'file-link-not-found' }, 409);
    sourceFileId = fileSync.fileId;
    sourceLocalRevision = fileSync.localRevision as number;
  }
  const previous = await latestContent(env, deckId);
  if (previous !== null && previous.contentHash === contentHash) {
    // No new version, but the working text now matches what is already stamped,
    // so the draft has nothing left to recover: drop it as a real save would.
    await env.DB.prepare('DELETE FROM deck_drafts WHERE deck_id = ?1').bind(deckId).run();
    return json({ deckId, version: previous.version, contentHash, unchanged: true });
  }
  const now = Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO deck_versions
           (id, deck_id, version, content_json, content_hash, source_kind,
            source_file_id, source_local_revision, created_at, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      ).bind(
        randomId(), deckId, version, serialized, contentHash,
        sourceFileId === null ? (guard.authKind === 'session' ? 'browser' : guard.authKind === 'oauth' ? 'mcp' : 'api') : 'desktop',
        sourceFileId, sourceLocalRevision, now, guard.user.id,
      ),
      env.DB.prepare(
        'UPDATE decks SET current_version = ?1, title = ?2, updated_at = ?3 WHERE id = ?4',
      ).bind(version, validation.outline.meta.title.slice(0, 200), now, deckId),
      // Stamping a version is what the draft was working towards; leaving it
      // behind would make the next open offer to restore work already saved.
      env.DB.prepare('DELETE FROM deck_drafts WHERE deck_id = ?1').bind(deckId),
    ]);
  } catch (err) {
    // Only the (deck_id, version) uniqueness race is a conflict; anything
    // else is a real database failure and must surface as one.
    if (String(err).includes('UNIQUE constraint')) return json({ error: 'version-conflict' }, 409);
    throw err;
  }
  return json({ deckId, version, contentHash }, 201);
}

export async function deckFileLinkRoute(
  request: Request,
  env: ControlEnv,
  deckId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, request.method === 'POST');
  if (!guard.ok) return guard.response;
  const deck = await deckAccess(env, guard.user.id, deckId);
  if (deck === null) return json({ error: 'not-found' }, 404);

  if (request.method === 'GET') {
    const link = await env.DB.prepare(
      'SELECT file_id, deck_id, created_by, created_at FROM deck_file_links WHERE deck_id = ?1',
    ).bind(deckId).first<DeckFileLinkRow>();
    if (link === null) return json({ linked: false, fileId: null, locations: [] });
    const { results } = await env.DB.prepare(
      `SELECT * FROM deck_file_locations
        WHERE file_id = ?1 AND user_id = ?2 ORDER BY last_seen_at DESC`,
    ).bind(link.file_id, guard.user.id).all<DeckFileLocationRow>();
    return json({
      linked: true,
      fileId: link.file_id,
      locations: (results ?? []).map(deckFileLocationJson),
    });
  }
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  if (!(await mutationAllowed(env, guard.user, deck.space_id))) {
    return json({ error: 'forbidden' }, 403);
  }
  const body = await readJson(request);
  if (body === null || typeof body.fileId !== 'string' || !FILE_ID_PATTERN.test(body.fileId)) {
    return json({ error: 'invalid-file-id' }, 422);
  }
  const existing = await env.DB.prepare(
    'SELECT file_id, deck_id, created_by, created_at FROM deck_file_links WHERE file_id = ?1 OR deck_id = ?2',
  ).bind(body.fileId, deckId).first<DeckFileLinkRow>();
  if (existing !== null) {
    if (existing.file_id === body.fileId && existing.deck_id === deckId) {
      return json({ linked: true, fileId: body.fileId, unchanged: true });
    }
    return json({ error: existing.deck_id === deckId ? 'deck-already-linked' : 'file-already-linked' }, 409);
  }
  await env.DB.prepare(
    `INSERT INTO deck_file_links (file_id, deck_id, created_by, created_at)
     VALUES (?1, ?2, ?3, ?4)`,
  ).bind(body.fileId, deckId, guard.user.id, Date.now()).run();
  return json({ linked: true, fileId: body.fileId }, 201);
}

export async function deckFileLocationRoute(
  request: Request,
  env: ControlEnv,
  deckId: string,
  deviceId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, request.method !== 'GET');
  if (!guard.ok) return guard.response;
  const deck = await deckAccess(env, guard.user.id, deckId);
  if (deck === null) return json({ error: 'not-found' }, 404);
  if (deviceId === '' || deviceId.length > 200) return json({ error: 'invalid-device-id' }, 422);

  const link = await env.DB.prepare(
    'SELECT file_id FROM deck_file_links WHERE deck_id = ?1',
  ).bind(deckId).first<{ file_id: string }>();
  if (link === null) return json({ error: 'file-link-not-found' }, 404);

  if (request.method === 'GET') {
    const row = await env.DB.prepare(
      `SELECT * FROM deck_file_locations
        WHERE file_id = ?1 AND user_id = ?2 AND device_id = ?3`,
    ).bind(link.file_id, guard.user.id, deviceId).first<DeckFileLocationRow>();
    return row === null ? json({ error: 'not-found' }, 404) : json({ location: deckFileLocationJson(row) });
  }
  if (request.method === 'DELETE') {
    await env.DB.prepare(
      'DELETE FROM deck_file_locations WHERE file_id = ?1 AND user_id = ?2 AND device_id = ?3',
    ).bind(link.file_id, guard.user.id, deviceId).run();
    return json({ ok: true });
  }
  if (request.method !== 'PUT') return json({ error: 'method-not-allowed' }, 405);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  if (
    body.fileId !== link.file_id
    || typeof body.deviceName !== 'string' || body.deviceName.trim() === '' || body.deviceName.length > 120
    || typeof body.path !== 'string' || body.path === '' || body.path.length > 4096
    || !Number.isInteger(body.localRevision) || (body.localRevision as number) < 0
    || typeof body.contentHash !== 'string' || !CONTENT_HASH_PATTERN.test(body.contentHash)
    || !Number.isInteger(body.syncedVersion) || (body.syncedVersion as number) < 0
    || typeof body.syncedHash !== 'string' || !CONTENT_HASH_PATTERN.test(body.syncedHash)
  ) {
    return json({ error: 'invalid-file-location' }, 422);
  }
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO deck_file_locations
       (file_id, user_id, device_id, device_name, path, local_revision,
        content_hash, synced_version, synced_hash, last_seen_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(file_id, user_id, device_id) DO UPDATE SET
       device_name = excluded.device_name,
       path = excluded.path,
       local_revision = excluded.local_revision,
       content_hash = excluded.content_hash,
       synced_version = excluded.synced_version,
       synced_hash = excluded.synced_hash,
       last_seen_at = excluded.last_seen_at`,
  ).bind(
    link.file_id, guard.user.id, deviceId, body.deviceName.trim(), body.path,
    body.localRevision, body.contentHash, body.syncedVersion, body.syncedHash, now,
  ).run();
  return json({
    location: {
      deviceId,
      deviceName: body.deviceName.trim(),
      path: body.path,
      localRevision: body.localRevision,
      contentHash: body.contentHash,
      syncedVersion: body.syncedVersion,
      syncedHash: body.syncedHash,
      lastSeenAt: now,
    },
  });
}

/**
 * The rolling draft for one deck — the other half of hybrid save.
 *
 * Deliberately **not** validated: this is the tutor's working text, saved every
 * few seconds while they type, and half-typed YAML is the normal state of it.
 * Refusing it would turn auto-save off exactly when it is needed. Only
 * `POST .../versions` validates, because only a version can launch a session.
 *
 * PUT upserts and answers `{ savedAt }`; GET answers the draft or 404; DELETE
 * discards it. Auth and role are the version route's, unchanged.
 */
export async function deckDraftRoute(
  request: Request,
  env: ControlEnv,
  deckId: string,
): Promise<Response> {
  const mutating = request.method !== 'GET';
  const guard = await requireControlUser(request, env, mutating);
  if (!guard.ok) return guard.response;
  const deck = await deckAccess(env, guard.user.id, deckId);
  if (deck === null) return json({ error: 'not-found' }, 404);

  if (request.method === 'GET') {
    const row = await env.DB.prepare(
      'SELECT base_version, content_yaml, updated_at, updated_by FROM deck_drafts WHERE deck_id = ?1',
    ).bind(deckId).first<{
      base_version: number;
      content_yaml: string;
      updated_at: number;
      updated_by: string;
    }>();
    // Every save clears the draft, so "nothing unsaved" is the normal state.
    // Answer it with the draft zero: the current version as editor text.
    if (row === null) {
      const latest = await latestContent(env, deckId);
      return json({
        deckId,
        source: deckSource(latest?.outline ?? blankDeck(deck.title)),
        baseVersion: deck.current_version,
        updatedAt: null,
        updatedBy: null,
      });
    }
    return json({
      deckId,
      source: row.content_yaml,
      baseVersion: row.base_version,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    });
  }

  if (!(await mutationAllowed(env, guard.user, deck.space_id))) {
    return json({ error: 'forbidden' }, 403);
  }

  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM deck_drafts WHERE deck_id = ?1').bind(deckId).run();
    return new Response(null, { status: 204 });
  }

  if (request.method !== 'PUT') return json({ error: 'method-not-allowed' }, 405);
  if (deck.deleted_at !== null) return json({ error: 'resource-in-trash' }, 409);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  const source = body.source;
  if (typeof source !== 'string') return json({ error: 'source-required' }, 400);
  if (source.length > DECK_DRAFT_MAX_CHARS) return json({ error: 'draft-too-large' }, 413);
  const baseVersion = body.baseVersion;
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 0) {
    return json({ error: 'base-version-required' }, 400);
  }
  if (baseVersion !== deck.current_version) return json({ error: 'version-conflict', currentVersion: deck.current_version }, 409);
  const savedAt = Date.now();
  await env.DB.prepare(
    `INSERT INTO deck_drafts (deck_id, base_version, content_yaml, updated_at, updated_by)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(deck_id) DO UPDATE SET
       base_version = excluded.base_version,
       content_yaml = excluded.content_yaml,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  ).bind(deckId, baseVersion, source, savedAt, guard.user.id).run();
  const parsed = parseOutline(source, 'yaml');
  if (parsed.ok) {
    await env.DB.prepare('UPDATE decks SET title = ?1 WHERE id = ?2 AND current_version = ?3')
      .bind(parsed.outline.meta.title, deckId, baseVersion).run();
  }
  return json({ deckId, savedAt });
}

export async function restoreDeckRoute(
  request: Request,
  env: ControlEnv,
  deckId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const row = await deckAccess(env, guard.user.id, deckId);
  if (row === null) return json({ error: 'not-found' }, 404);
  if (!(await mutationAllowed(env, guard.user, row.space_id))) {
    return json({ error: 'forbidden' }, 403);
  }
  await env.DB.prepare('UPDATE decks SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2')
    .bind(Date.now(), deckId).run();
  return json({ ok: true });
}
