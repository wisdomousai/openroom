/**
 * Folder-scoped decks (content) and sessions (delivery instances).
 * Students stay in tutoring.ts. Live sessions are launched from a session.
 */
import {
  canonicalOutlineJson,
  validateOutline,
  parseOutline,
  DECK_DRAFT_MAX_CHARS,
  type OutlineValidateResult,
} from '@openroom/schema';
import { and, desc, eq, exists, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import { sha256Hex } from '../api-tokens.js';
import { json, type ControlEnv, type SessionUser } from '../auth.js';
import { requireControlUser } from '../control-auth.js';
import { parseJson, plainObject, randomId, readJson } from '../control-utils.js';
import { orm } from '../db/client.js';
import {
  deckDrafts,
  deckFileLinks,
  deckFileLocations,
  deckVersions,
  decks,
  folders,
  sessions,
  spaceMembers,
  spaces,
} from '../db/schema.js';
import { ensureWorkspace } from '../workspace.js';

import {
  parseShape,
  resolveFolder,
  deckAccess,
  sessionAccess,
  studentAccess,
  mutationAllowed,
  targetSpace,
  requestedLocationEditable,
  deckJson,
  sessionJson,
  latestContent,
  deckFileLocationJson,
  FILE_ID_PATTERN,
  CONTENT_HASH_PATTERN,
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
    const studentId = url.searchParams.get('studentId');
    const conditions: SQL[] = [
      exists(
        orm(env)
          .select({ one: sql`1` })
          .from(spaceMembers)
          .where(and(eq(spaceMembers.spaceId, decks.spaceId), eq(spaceMembers.userId, guard.user.id))),
      ),
      trashed ? isNotNull(decks.deletedAt) : isNull(decks.deletedAt),
    ];
    if (spaceId !== null && spaceId !== '') conditions.push(eq(decks.spaceId, spaceId));
    if (folderId === 'root' || folderId === '') {
      conditions.push(or(isNull(decks.folderId), eq(decks.folderId, ''))!);
    } else if (folderId !== null) {
      conditions.push(eq(decks.folderId, folderId));
    }
    if (studentId !== null && studentId !== '') conditions.push(eq(decks.studentId, studentId));
    const results = await orm(env)
      .select()
      .from(decks)
      .where(and(...conditions))
      .orderBy(desc(decks.updatedAt))
      .limit(500);
    return json({ decks: results.map(deckJson) });
  }

  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  const requestedAccess = await requestedLocationEditable(env, guard.user, body);
  if (requestedAccess !== 'editable') {
    return json({ error: requestedAccess }, requestedAccess === 'forbidden' ? 403 : 404);
  }

  // Filing and student association are independent. Standalone decks have no student.
  const spaceId = await targetSpace(env, guard.user, body);
  if (spaceId === null) return json({ error: 'not-found' }, 404);
  let linkedStudent: { id: string; spaceId: string; deletedAt: number | null } | null = null;
  if (typeof body.studentId === 'string' && body.studentId.trim() !== '') {
    linkedStudent = await studentAccess(env, guard.user.id, body.studentId);
    if (linkedStudent === null || linkedStudent.deletedAt !== null || linkedStudent.spaceId !== spaceId) {
      return json({ error: 'student-not-found' }, 404);
    }
  } else if (body.studentId !== undefined && body.studentId !== null) {
    return json({ error: 'invalid-student-id' }, 422);
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
    const existingFile = await orm(env)
      .select({ deckId: deckFileLinks.deckId })
      .from(deckFileLinks)
      .where(eq(deckFileLinks.fileId, fileId))
      .get();
    if (existingFile !== undefined) return json({ error: 'file-already-linked' }, 409);
  }

  const deckId = randomId();
  const now = Date.now();
  const version = outlineValidation?.ok ? 1 : 0;
  const initialHash = outlineValidation?.ok
    ? await sha256Hex(canonicalOutlineJson(outlineValidation.outline))
    : null;
  const db = orm(env);
  const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
    db.insert(decks).values({
      id: deckId,
      spaceId,
      folderId,
      studentId: linkedStudent?.id ?? null,
      createdBy: guard.user.id,
      title,
      shape,
      currentVersion: version,
      metadataJson: JSON.stringify(metadata),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }),
  ];
  if (outlineValidation?.ok) {
    statements.push(db.insert(deckVersions).values({
      id: randomId(),
      deckId,
      version: 1,
      contentJson: JSON.stringify(outlineValidation.outline),
      contentHash: initialHash,
      sourceKind: fileId === undefined ? (guard.authKind === 'session' ? 'browser' : 'api') : 'desktop',
      sourceFileId: fileId ?? null,
      sourceLocalRevision: fileId === undefined ? null : 0,
      createdAt: now,
      createdBy: guard.user.id,
    }));
  }
  if (typeof fileId === 'string') {
    statements.push(db.insert(deckFileLinks).values({
      fileId,
      deckId,
      createdBy: guard.user.id,
      createdAt: now,
    }));
  }

  // Opt-in convenience: also create a draft session in the same folder. Off by
  // default so a collection POST writes exactly one resource.
  const createSession = body.createSession === true;
  let sessionId: string | null = null;
  if (createSession) {
    sessionId = randomId();
    statements.push(db.insert(sessions).values({
      id: sessionId,
      spaceId,
      folderId,
      deckId,
      deckVersion: version,
      studentId: linkedStudent?.id ?? null,
      createdBy: guard.user.id,
      title,
      shape,
      status: 'draft',
      metadataJson: '{}',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }));
  }

  await db.batch(statements);
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
    const place = await orm(env)
      // The deck editor shows "{Folder} / {Title}" and links back to the shelf
      // the deck lives on, so the detail read carries the names of its place
      // rather than making the editor fetch the folder tree to print two words.
      .select({ spaceName: spaces.name, folderName: folders.name })
      .from(spaces)
      .leftJoin(folders, sql`${folders.id} = ${row.folderId}`)
      .where(eq(spaces.id, row.spaceId))
      .get();
    return json({
      deck: deckJson(row),
      spaceName: place?.spaceName ?? null,
      folderName: place?.folderName ?? null,
      contentVersion: content?.version ?? null,
      contentHash: content?.contentHash ?? null,
      content: content?.outline ?? null,
    }, 200, { etag });
  }
  if (!(await mutationAllowed(env, guard.user, row.spaceId))) {
    return json({ error: 'forbidden' }, 403);
  }
  if (request.method === 'DELETE') {
    if (row.deletedAt === null) {
      const now = Date.now();
      await orm(env).update(decks).set({ deletedAt: now, updatedAt: now }).where(eq(decks.id, deckId)).run();
    }
    return json({ ok: true, recoverable: true });
  }
  if (request.method !== 'PATCH') return json({ error: 'method-not-allowed' }, 405);
  if (row.deletedAt !== null) return json({ error: 'resource-in-trash' }, 409);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  const title = body.title === undefined
    ? row.title
    : typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
  if (title === '') return json({ error: 'title-required' }, 422);
  const shape = body.shape === undefined ? row.shape : parseShape(body.shape, row.shape);
  let studentId = row.studentId;
  if (body.studentId === null) {
    studentId = null;
  }
  if (typeof body.studentId === 'string') {
    const ctx = await studentAccess(env, guard.user.id, body.studentId);
    if (ctx === null || ctx.deletedAt !== null || ctx.spaceId !== row.spaceId) {
      return json({ error: 'student-not-found' }, 404);
    }
    studentId = ctx.id;
  }
  const location = await resolveFolder(env, guard.user, row.spaceId, body, row.folderId);
  if (!location.ok) return location.response;
  const metadata = body.metadata === undefined
    ? parseJson(row.metadataJson, {})
    : plainObject(body.metadata);
  if (metadata === null) return json({ error: 'metadata-must-be-object' }, 422);
  const now = Date.now();
  await orm(env).update(decks).set({
    title,
    shape,
    studentId,
    folderId: location.folderId,
    metadataJson: JSON.stringify(metadata),
    updatedAt: now,
  }).where(eq(decks.id, deckId)).run();
  return json({
    deck: deckJson({
      ...row, title, shape, studentId, folderId: location.folderId,
      metadataJson: JSON.stringify(metadata), updatedAt: now,
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
    const results = await orm(env)
      .select({
        version: deckVersions.version,
        createdAt: deckVersions.createdAt,
        createdBy: deckVersions.createdBy,
        contentHash: deckVersions.contentHash,
        sourceKind: deckVersions.sourceKind,
        sourceFileId: deckVersions.sourceFileId,
        sourceLocalRevision: deckVersions.sourceLocalRevision,
      })
      .from(deckVersions)
      .where(eq(deckVersions.deckId, deckId))
      .orderBy(desc(deckVersions.version));
    return json({
      deckId,
      versions: results,
    });
  }
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  if (!(await mutationAllowed(env, guard.user, deck.spaceId))) {
    return json({ error: 'forbidden' }, 403);
  }
  if (deck.deletedAt !== null) return json({ error: 'resource-in-trash' }, 409);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  const validation = validateOutline(body.content ?? body.outline);
  if (!validation.ok) return json({ error: 'invalid-content', errors: validation.errors }, 422);
  const baseVersion = body.baseVersion;
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 0) {
    return json({ error: 'base-version-required' }, 400);
  }
  if (baseVersion !== deck.currentVersion) {
    return json({ error: 'version-conflict', latestVersion: deck.currentVersion }, 409);
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
    const link = await orm(env)
      .select({ fileId: deckFileLinks.fileId })
      .from(deckFileLinks)
      .where(and(eq(deckFileLinks.fileId, fileSync.fileId), eq(deckFileLinks.deckId, deckId)))
      .get();
    if (link === undefined) return json({ error: 'file-link-not-found' }, 409);
    sourceFileId = fileSync.fileId;
    sourceLocalRevision = fileSync.localRevision as number;
  }
  const previous = await latestContent(env, deckId);
  if (previous !== null && previous.contentHash === contentHash) {
    // No new version, but the working text now matches what is already stamped,
    // so the draft has nothing left to recover: drop it as a real save would.
    await orm(env).delete(deckDrafts).where(eq(deckDrafts.deckId, deckId)).run();
    return json({ deckId, version: previous.version, contentHash, unchanged: true });
  }
  const now = Date.now();
  try {
    const db = orm(env);
    await db.batch([
      db.insert(deckVersions).values({
        id: randomId(),
        deckId,
        version,
        contentJson: serialized,
        contentHash,
        sourceKind: sourceFileId === null ? (guard.authKind === 'session' ? 'browser' : guard.authKind === 'oauth' ? 'mcp' : 'api') : 'desktop',
        sourceFileId,
        sourceLocalRevision,
        createdAt: now,
        createdBy: guard.user.id,
      }),
      db.update(decks)
        .set({ currentVersion: version, title: validation.outline.meta.title.slice(0, 200), updatedAt: now })
        .where(eq(decks.id, deckId)),
      // Stamping a version is what the draft was working towards; leaving it
      // behind would make the next open offer to restore work already saved.
      db.delete(deckDrafts).where(eq(deckDrafts.deckId, deckId)),
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
    const link = await orm(env).select().from(deckFileLinks).where(eq(deckFileLinks.deckId, deckId)).get();
    if (link === undefined) return json({ linked: false, fileId: null, locations: [] });
    const results = await orm(env)
      .select()
      .from(deckFileLocations)
      .where(and(eq(deckFileLocations.fileId, link.fileId), eq(deckFileLocations.userId, guard.user.id)))
      .orderBy(desc(deckFileLocations.lastSeenAt));
    return json({
      linked: true,
      fileId: link.fileId,
      locations: results.map(deckFileLocationJson),
    });
  }
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  if (!(await mutationAllowed(env, guard.user, deck.spaceId))) {
    return json({ error: 'forbidden' }, 403);
  }
  const body = await readJson(request);
  if (body === null || typeof body.fileId !== 'string' || !FILE_ID_PATTERN.test(body.fileId)) {
    return json({ error: 'invalid-file-id' }, 422);
  }
  const existing = await orm(env)
    .select()
    .from(deckFileLinks)
    .where(or(eq(deckFileLinks.fileId, body.fileId), eq(deckFileLinks.deckId, deckId)))
    .get();
  if (existing !== undefined) {
    if (existing.fileId === body.fileId && existing.deckId === deckId) {
      return json({ linked: true, fileId: body.fileId, unchanged: true });
    }
    return json({ error: existing.deckId === deckId ? 'deck-already-linked' : 'file-already-linked' }, 409);
  }
  await orm(env)
    .insert(deckFileLinks)
    .values({ fileId: body.fileId, deckId, createdBy: guard.user.id, createdAt: Date.now() })
    .run();
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

  const link = await orm(env)
    .select({ fileId: deckFileLinks.fileId })
    .from(deckFileLinks)
    .where(eq(deckFileLinks.deckId, deckId))
    .get();
  if (link === undefined) return json({ error: 'file-link-not-found' }, 404);

  if (request.method === 'GET') {
    const row = await orm(env)
      .select()
      .from(deckFileLocations)
      .where(and(
        eq(deckFileLocations.fileId, link.fileId),
        eq(deckFileLocations.userId, guard.user.id),
        eq(deckFileLocations.deviceId, deviceId),
      ))
      .get();
    return row === undefined ? json({ error: 'not-found' }, 404) : json({ location: deckFileLocationJson(row) });
  }
  if (request.method === 'DELETE') {
    await orm(env)
      .delete(deckFileLocations)
      .where(and(
        eq(deckFileLocations.fileId, link.fileId),
        eq(deckFileLocations.userId, guard.user.id),
        eq(deckFileLocations.deviceId, deviceId),
      ))
      .run();
    return json({ ok: true });
  }
  if (request.method !== 'PUT') return json({ error: 'method-not-allowed' }, 405);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  if (
    body.fileId !== link.fileId
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
  const location = {
    deviceName: body.deviceName.trim(),
    path: body.path,
    localRevision: body.localRevision as number,
    contentHash: body.contentHash,
    syncedVersion: body.syncedVersion as number,
    syncedHash: body.syncedHash,
    lastSeenAt: now,
  };
  await orm(env)
    .insert(deckFileLocations)
    .values({ fileId: link.fileId, userId: guard.user.id, deviceId, ...location })
    .onConflictDoUpdate({
      target: [deckFileLocations.fileId, deckFileLocations.userId, deckFileLocations.deviceId],
      set: location,
    })
    .run();
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
    const row = await orm(env)
      .select({
        baseVersion: deckDrafts.baseVersion,
        contentYaml: deckDrafts.contentYaml,
        updatedAt: deckDrafts.updatedAt,
        updatedBy: deckDrafts.updatedBy,
      })
      .from(deckDrafts)
      .where(eq(deckDrafts.deckId, deckId))
      .get();
    if (row === undefined) return json({ error: 'not-found' }, 404);
    return json({
      deckId,
      source: row.contentYaml,
      baseVersion: row.baseVersion,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    });
  }

  if (!(await mutationAllowed(env, guard.user, deck.spaceId))) {
    return json({ error: 'forbidden' }, 403);
  }

  if (request.method === 'DELETE') {
    await orm(env).delete(deckDrafts).where(eq(deckDrafts.deckId, deckId)).run();
    return new Response(null, { status: 204 });
  }

  if (request.method !== 'PUT') return json({ error: 'method-not-allowed' }, 405);
  if (deck.deletedAt !== null) return json({ error: 'resource-in-trash' }, 409);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  const source = body.source;
  if (typeof source !== 'string') return json({ error: 'source-required' }, 400);
  if (source.length > DECK_DRAFT_MAX_CHARS) return json({ error: 'draft-too-large' }, 413);
  const baseVersion = body.baseVersion;
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 0) {
    return json({ error: 'base-version-required' }, 400);
  }
  if (baseVersion !== deck.currentVersion) return json({ error: 'version-conflict', currentVersion: deck.currentVersion }, 409);
  const savedAt = Date.now();
  const draft = { baseVersion, contentYaml: source, updatedAt: savedAt, updatedBy: guard.user.id };
  await orm(env)
    .insert(deckDrafts)
    .values({ deckId, ...draft })
    .onConflictDoUpdate({ target: deckDrafts.deckId, set: draft })
    .run();
  const parsed = parseOutline(source, 'yaml');
  if (parsed.ok) {
    await orm(env)
      .update(decks)
      .set({ title: parsed.outline.meta.title })
      .where(and(eq(decks.id, deckId), eq(decks.currentVersion, baseVersion)))
      .run();
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
  if (!(await mutationAllowed(env, guard.user, row.spaceId))) {
    return json({ error: 'forbidden' }, 403);
  }
  await orm(env).update(decks).set({ deletedAt: null, updatedAt: Date.now() }).where(eq(decks.id, deckId)).run();
  return json({ ok: true });
}
