/**
 * Folder-scoped decks (content) and sessions (delivery instances).
 * Contexts stay in tutoring.ts. Live sessions are launched from a session.
 */
import {
  canonicalOutlineJson,
  clipNextNote,
  compileRecordHomework,
  parseHomeworkAudience,
  validateOutline,
  isPresentationPosition,
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
import { purgeLearnerAudio } from '../learner-audio.js';
import { requireSpaceContinuity } from '../continuity-access.js';

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
  type DeliveryResourceType,
  type SessionLaunchInput,
  type SessionLauncher,
} from './shared.js';

export async function sessionsCollectionRoute(
  request: Request,
  env: ControlEnv,
  url: URL,
): Promise<Response> {
  const guard = await requireControlUser(request, env, request.method === 'POST');
  if (!guard.ok) return guard.response;

  if (request.method === 'GET') {
    await ensureWorkspace(env, guard.user);
    const trashed = url.searchParams.get('trash') === '1';
    const deckId = url.searchParams.get('deckId');
    const contextId = url.searchParams.get('contextId');
    const folderId = url.searchParams.get('folderId');
    const spaceId = url.searchParams.get('spaceId');
    const binds: string[] = [guard.user.id];
    let where = trashed ? 'r.deleted_at IS NOT NULL' : 'r.deleted_at IS NULL';
    let n = 2;
    if (deckId !== null) {
      where += ` AND r.deck_id = ?${n}`;
      binds.push(deckId);
      n += 1;
    }
    if (contextId !== null) {
      where += ` AND r.context_id = ?${n}`;
      binds.push(contextId);
      n += 1;
    }
    if (spaceId !== null && spaceId !== '') {
      where += ` AND r.space_id = ?${n}`;
      binds.push(spaceId);
      n += 1;
    }
    if (folderId === 'root' || folderId === '') {
      where += ' AND (r.folder_id IS NULL OR r.folder_id = \'\')';
    } else if (folderId !== null) {
      where += ` AND r.folder_id = ?${n}`;
      binds.push(folderId);
    }
    const { results } = await env.DB.prepare(
      `SELECT r.* FROM sessions r
       WHERE EXISTS (SELECT 1 FROM space_members sm
                      WHERE sm.space_id = r.space_id AND sm.user_id = ?1)
         AND ${where}
       ORDER BY r.updated_at DESC LIMIT 500`,
    ).bind(...binds).all<SessionRow>();
    return json({ sessions: (results ?? []).map(sessionJson) });
  }

  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  if (typeof body.deckId !== 'string' || body.deckId === '') {
    return json({ error: 'deck-id-required' }, 422);
  }
  const deck = await deckAccess(env, guard.user.id, body.deckId);
  if (deck === null || deck.deleted_at !== null) return json({ error: 'deck-not-found' }, 404);
  if (!(await mutationAllowed(env, guard.user, deck.space_id))) {
    return json({ error: 'forbidden' }, 403);
  }

  let contextId = deck.context_id;
  if (body.contextId === null) contextId = null;
  if (typeof body.contextId === 'string') {
    const ctx = await contextAccess(env, guard.user.id, body.contextId);
    if (ctx === null || ctx.deleted_at !== null || ctx.space_id !== deck.space_id) {
      return json({ error: 'context-not-found' }, 404);
    }
    contextId = ctx.id;
  }

  const deckVersion = typeof body.deckVersion === 'number' && Number.isInteger(body.deckVersion)
    ? body.deckVersion
    : deck.current_version;
  if (deckVersion < 0 || deckVersion > deck.current_version) {
    return json({ error: 'invalid-deck-version' }, 422);
  }

  const title = (typeof body.title === 'string' && body.title.trim() !== ''
    ? body.title.trim()
    : deck.title).slice(0, 200);
  const shape = parseShape(body.shape, deck.shape);
  // 'live' and 'ended' are server-owned transitions (launch / session end).
  if (typeof body.status === 'string' && SESSION_STATUSES_SERVER_OWNED.has(body.status)) {
    return json({ error: 'status-server-owned' }, 422);
  }
  const location = await resolveFolder(env, guard.user, deck.space_id, body, deck.folder_id);
  if (!location.ok) return location.response;
  const { folderId } = location;
  const id = randomId();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO sessions
       (id, space_id, folder_id, deck_id, deck_version, context_id,
        created_by, title, shape, status,
        metadata_json, created_at, updated_at, deleted_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'draft', '{}', ?10, ?10, NULL)`,
  ).bind(
    id, deck.space_id, folderId, deck.id, deckVersion, contextId,
    guard.user.id, title, shape, now,
  ).run();
  return json({ session: sessionJson((await sessionAccess(env, guard.user.id, id))!) }, 201);
}

export async function sessionItemRoute(
  request: Request,
  env: ControlEnv,
  sessionId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, request.method !== 'GET');
  if (!guard.ok) return guard.response;
  const row = await sessionAccess(env, guard.user.id, sessionId);
  if (row === null) return json({ error: 'not-found' }, 404);

  if (request.method === 'GET') return json({
    session: sessionJson(row),
    canEdit: row.deleted_at === null && await mutationAllowed(env, guard.user, row.space_id),
  });
  if (!(await mutationAllowed(env, guard.user, row.space_id))) {
    return json({ error: 'forbidden' }, 403);
  }
  if (request.method === 'DELETE') {
    if (row.deleted_at === null) {
      const now = Date.now();
      await env.DB.prepare('UPDATE sessions SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2')
        .bind(now, sessionId).run();
    }
    return json({ ok: true, recoverable: true });
  }
  if (request.method !== 'PATCH') return json({ error: 'method-not-allowed' }, 405);
  if (row.deleted_at !== null) return json({ error: 'resource-in-trash' }, 409);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);

  let contextId = row.context_id;
  if (body.contextId === null) contextId = null;
  if (typeof body.contextId === 'string') {
    const ctx = await contextAccess(env, guard.user.id, body.contextId);
    if (ctx === null || ctx.deleted_at !== null || ctx.space_id !== row.space_id) {
      return json({ error: 'context-not-found' }, 404);
    }
    contextId = ctx.id;
  }
  const title = body.title === undefined
    ? row.title
    : typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
  if (title === '') return json({ error: 'title-required' }, 422);
  if (typeof body.status === 'string' && SESSION_STATUSES_SERVER_OWNED.has(body.status)) {
    return json({ error: 'status-server-owned' }, 422);
  }
  const status = body.status === undefined ? row.status : body.status;
  if (status !== 'draft' && status !== row.status) {
    return json({ error: 'invalid-status' }, 422);
  }
  const location = await resolveFolder(env, guard.user, row.space_id, body, row.folder_id);
  if (!location.ok) return location.response;
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE sessions SET context_id = ?1, title = ?2, status = ?3,
       folder_id = ?4, updated_at = ?5 WHERE id = ?6`,
  ).bind(contextId, title, status, location.folderId, now, sessionId).run();
  return json({
    session: sessionJson({
      ...row,
      context_id: contextId,
      title,
      status,
      folder_id: location.folderId,
      updated_at: now,
    }),
  });
}

export async function restoreSessionRoute(
  request: Request,
  env: ControlEnv,
  sessionId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const row = await sessionAccess(env, guard.user.id, sessionId);
  if (row === null) return json({ error: 'not-found' }, 404);
  if (!(await mutationAllowed(env, guard.user, row.space_id))) {
    return json({ error: 'forbidden' }, 403);
  }
  await env.DB.prepare('UPDATE sessions SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2')
    .bind(Date.now(), sessionId).run();
  return json({ ok: true });
}

export async function sessionRecordRoute(
  request: Request,
  env: ControlEnv,
  sessionId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, request.method === 'PUT');
  if (!guard.ok) return guard.response;
  const session = await sessionAccess(env, guard.user.id, sessionId);
  if (session === null) return json({ error: 'not-found' }, 404);
  // Notes are part of `continuity`, billed to the session's space owner. They are
  // retained while access is lapsed and removed with the session's own deletion.
  if (request.method === 'GET' || request.method === 'PUT') {
    const blocked = await requireSpaceContinuity(env, session.space_id);
    if (blocked) return blocked;
  }
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT * FROM session_records WHERE session_id = ?1')
      .bind(sessionId)
      .first<Record<string, string | number | null>>();
    if (row === null) return json({ record: null });
    return json({
      record: {
        id: row['id'],
        sessionId,
        contextId: row['context_id'],
        sessionCode: row['session_code'],
        deckVersion: row['deck_version'],
        outcomes: parseJson(String(row['outcomes_json']), []),
        notes: row['notes'],
        nextNote: typeof row['next_note'] === 'string' ? row['next_note'] : '',
        homework: parseJson(String(row['homework_json']), []),
        homeworkAudience: parseJson(String(row['homework_audience_json']), {}),
        homeworkRevision: row['homework_revision'],
        artifacts: parseJson(String(row['artifacts_json']), []),
        createdAt: row['created_at'],
        updatedAt: row['updated_at'],
      },
    });
  }
  if (request.method !== 'PUT') return json({ error: 'method-not-allowed' }, 405);
  if (!(await mutationAllowed(env, guard.user, session.space_id))) {
    return json({ error: 'forbidden' }, 403);
  }
  if (session.deleted_at !== null) return json({ error: 'resource-in-trash' }, 409);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  const outcomes = compactArray(body.outcomes ?? []);
  const homework = compileRecordHomework(body.homework ?? []);
  const artifacts = compactArray(body.artifacts ?? []);
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 10_000) : '';
  const nextNoteProvided = Object.prototype.hasOwnProperty.call(body, 'nextNote');
  const nextNote = nextNoteProvided ? clipNextNote(body.nextNote) : null;
  if (outcomes === null || homework === null || artifacts === null) {
    return json({ error: 'record-arrays-too-large' }, 422);
  }
  const deckVersion = typeof body.deckVersion === 'number' && Number.isInteger(body.deckVersion)
    ? body.deckVersion
    : session.deck_version;
  const deck = await env.DB.prepare('SELECT current_version FROM decks WHERE id = ?1')
    .bind(session.deck_id)
    .first<{ current_version: number }>();
  const currentVersion = deck?.current_version ?? session.deck_version;
  // Decks without content keep current_version = 0; allow recording against 0.
  if (
    deckVersion < 0 ||
    deckVersion > currentVersion ||
    (currentVersion > 0 && deckVersion < 1)
  ) {
    return json({ error: 'invalid-deck-version' }, 422);
  }
  const sessionCode = typeof body.sessionCode === 'string' ? body.sessionCode.slice(0, 64) : null;
  const now = Date.now();
  const existing = await env.DB.prepare('SELECT id, created_at, next_note, homework_json, homework_audience_json, homework_revision FROM session_records WHERE session_id = ?1')
    .bind(sessionId).first<{ id: string; created_at: number; next_note: string | null; homework_json: string; homework_audience_json: string; homework_revision: number }>();
  const taskIds = homework.map((task) => task.id);
  const storedAudience = parseJson(existing?.homework_audience_json ?? '{}', null);
  if (body.homeworkAudience === undefined && !plainObject(storedAudience)) return json({ error: 'invalid-homework-audience' }, 422);
  // Omitting this field preserves restrictions on surviving tasks. Sharing is deliberate.
  const audienceInput = body.homeworkAudience === undefined
    ? Object.fromEntries(Object.entries(storedAudience as Record<string, unknown>).filter(([id]) => taskIds.includes(id))) : body.homeworkAudience;
  const people = session.context_id === null ? [] : (await env.DB.prepare('SELECT id FROM context_learners WHERE context_id = ?1').bind(session.context_id).all<{ id: string }>()).results ?? [];
  const audience = parseHomeworkAudience(audienceInput, taskIds, people.map((person) => person.id));
  if (audience === null) return json({ error: 'invalid-homework-audience' }, 422);
  const homeworkJson = JSON.stringify(homework);
  const audienceJson = JSON.stringify(audience);
  const changedHomework = existing !== null && (homeworkJson !== existing.homework_json || audienceJson !== existing.homework_audience_json);
  if (changedHomework && body.homeworkRevision !== existing.homework_revision) return json({ error: 'homework-revision-conflict' }, 409);
  const homeworkRevision = existing === null ? 1 : existing.homework_revision + (changedHomework ? 1 : 0);
  const storedNextNote = nextNote ?? existing?.next_note ?? '';
  const saved = await env.DB.prepare(
    `INSERT INTO session_records
       (id, session_id, context_id, session_code, deck_version, outcomes_json, notes, next_note, homework_json, artifacts_json, created_at, updated_at, homework_revision, homework_audience_json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?15)
     ON CONFLICT(session_id) DO UPDATE SET
       context_id = excluded.context_id, session_code = excluded.session_code,
       deck_version = excluded.deck_version, outcomes_json = excluded.outcomes_json,
       notes = excluded.notes, next_note = excluded.next_note, homework_json = excluded.homework_json,
       artifacts_json = excluded.artifacts_json, updated_at = excluded.updated_at,
       homework_revision = excluded.homework_revision, homework_audience_json = excluded.homework_audience_json
     WHERE session_records.homework_revision = ?14`,
  ).bind(
    existing?.id ?? randomId(), sessionId, session.context_id, sessionCode, deckVersion,
    JSON.stringify(outcomes), notes, storedNextNote, homeworkJson, JSON.stringify(artifacts),
    existing?.created_at ?? now, now, homeworkRevision, existing?.homework_revision ?? 0, audienceJson,
  ).run();
  if (!saved.meta.changes) return json({ error: 'homework-revision-conflict' }, 409);
  if (nextNote !== null && session.context_id) {
    await env.DB.prepare('UPDATE contexts SET next_note = ?1, updated_at = ?2 WHERE id = ?3')
      .bind(nextNote, now, session.context_id)
      .run();
  }
  return json({ ok: true, sessionId, updatedAt: now, homeworkRevision });
}

/**
 * The other half of the session lifecycle: `launchSessionForUser` writes
 * `sessions.status = 'live'`, and this writes `'ended'` when the session ends.
 *
 * Nothing wrote it before, which is why Home had to infer "this was delivered"
 * from `sessions` rows. The Durable Object owns liveness but has no D1 binding, so
 * the writeback lives on the command path the host actually takes: the Worker
 * sees a successful `session.end` and closes the control-plane record.
 *
 * Deliberately narrow and deliberately quiet:
 *  - only a session that is `live` moves, so a re-sent end (idempotent in the DO)
 *    cannot overwrite a status someone set afterwards;
 *  - `sessions.ended` is still advisory (`mySessionsRoute`), just no longer always 0;
 *  - a failed write is swallowed. The session has ended either way, and a lost
 *    bookkeeping row must not turn that into an error for the host.
 *
 * Not covered, knowingly: the DO's own 12 h idle auto-end never passes through
 * the Worker, so such a session keeps its previous status.
 */
export async function endSessionForCode(env: ControlEnv, sessionCode: string): Promise<void> {
  try {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('UPDATE live_sessions SET ended = 1 WHERE code = ?1').bind(sessionCode),
      env.DB.prepare(
        `UPDATE sessions SET status = 'ended', updated_at = ?1
          WHERE deleted_at IS NULL
            AND status = 'live'
            AND id = (SELECT session_id FROM live_sessions WHERE code = ?2)`,
      ).bind(now, sessionCode),
    ]);
  } catch {
    // advisory bookkeeping only
  }
}

export async function launchSessionRoute(
  request: Request,
  env: ControlEnv,
  sessionId: string,
  launch: SessionLauncher,
): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const session = await sessionAccess(env, guard.user.id, sessionId);
  if (session === null || session.deleted_at !== null) return json({ error: 'not-found' }, 404);
  if (session.status === 'live') return json({ error: 'session-already-live' }, 409);
  const body = (await readJson(request)) ?? {};
  const requested = typeof body.version === 'number' && Number.isInteger(body.version)
    ? body.version
    : session.deck_version > 0 ? session.deck_version : undefined;
  if (session.source_outline_json && requested !== session.deck_version) return json({ error: 'session-version-conflict' }, 409);
  const content = session.source_outline_json
    ? { version: session.deck_version, outline: JSON.parse(session.source_outline_json) as import('@openroom/schema').Outline }
    : await latestContent(env, session.deck_id, requested);
  if (content === null) return json({ error: 'deck-content-not-found' }, 409);
  if (body.cursor !== undefined) {
    if (!isPresentationPosition(content.outline, body.cursor)) {
      return json({ error: 'invalid-presentation-cursor' }, 422);
    }
  }
  return launch({
    ...(guard.connectionId ? { connectionId: guard.connectionId } : {}),
    sessionId: session.id,
    deckId: session.deck_id,
    contextId: session.context_id,
    title: session.title,
    version: content.version,
    outline: content.outline,
    start: body.start === true,
    ...(body.cursor === undefined ? {} : { cursor: body.cursor as PresentationPosition }),
  }, guard.user);
}

export async function createDeliveryDeletionIntentRoute(
  request: Request,
  env: ControlEnv,
  resourceType: DeliveryResourceType,
  resourceId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const resource = resourceType === 'deck'
    ? await deckAccess(env, guard.user.id, resourceId)
    : await sessionAccess(env, guard.user.id, resourceId);
  if (resource === null) return json({ error: 'not-found' }, 404);
  if (!(await mutationAllowed(env, guard.user, resource.space_id))) {
    return json({ error: 'forbidden' }, 403);
  }
  if (resource.deleted_at === null) return json({ error: 'move-to-trash-first' }, 409);
  const name = resource.title;
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO deletion_intents
       (token_hash, user_id, resource_type, resource_id, resource_name, created_at, expires_at, used_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)`,
  ).bind(tokenHash, guard.user.id, resourceType, resourceId, name, now, now + DELETION_INTENT_TTL_MS).run();
  const origin = new URL(request.url).origin;
  return json({
    ok: true,
    confirmationRequired: true,
    expiresAt: now + DELETION_INTENT_TTL_MS,
    confirmationUrl: `${origin}/confirm-deletion/${encodeURIComponent(token)}`,
  }, 202);
}

export async function purgeDeck(env: ControlEnv, deckId: string): Promise<void> {
  const { results: sessions } = await env.DB.prepare('SELECT id FROM sessions WHERE deck_id = ?1')
    .bind(deckId).all<{ id: string }>();
  for (const session of sessions ?? []) await purgeSession(env, session.id);
  await env.DB.batch([
    // Detach sessions that recorded this deck so no row points at a purged deck.
    env.DB.prepare('UPDATE live_sessions SET deck_id = NULL, deck_version = NULL WHERE deck_id = ?1').bind(deckId),
    env.DB.prepare('DELETE FROM deck_versions WHERE deck_id = ?1').bind(deckId),
    env.DB.prepare('DELETE FROM deck_drafts WHERE deck_id = ?1').bind(deckId),
    // Tags have no life of their own: a purged item takes its tags with it,
    // otherwise the space facet list keeps counting rows nothing can reach.
    env.DB.prepare("DELETE FROM item_tags WHERE item_type = 'deck' AND item_id = ?1").bind(deckId),
    env.DB.prepare('DELETE FROM decks WHERE id = ?1').bind(deckId),
  ]);
}

async function purgeSession(env: ControlEnv, sessionId: string): Promise<void> {
  await purgeLearnerAudio(env, 'session_id', sessionId);
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE live_sessions SET session_id = NULL, deck_id = NULL, deck_version = NULL WHERE session_id = ?1',
    ).bind(sessionId),
    env.DB.prepare(
      `DELETE FROM item_tags WHERE item_type = 'record'
         AND item_id IN (SELECT id FROM session_records WHERE session_id = ?1)`,
    ).bind(sessionId),
    env.DB.prepare("DELETE FROM item_tags WHERE item_type = 'session' AND item_id = ?1").bind(sessionId),
    env.DB.prepare('DELETE FROM learner_feedback WHERE submission_id IN (SELECT id FROM learner_submissions WHERE session_id = ?1)').bind(sessionId),
    env.DB.prepare('DELETE FROM learner_submissions WHERE session_id = ?1').bind(sessionId),
    env.DB.prepare('DELETE FROM learner_srs WHERE substr(item_id, 1, length(?1) + 1) = ?1 || \':\'').bind(sessionId),
    env.DB.prepare('DELETE FROM learner_practice_attempts WHERE session_id = ?1').bind(sessionId),
    env.DB.prepare('DELETE FROM session_records WHERE session_id = ?1').bind(sessionId),
    env.DB.prepare('DELETE FROM sessions WHERE id = ?1').bind(sessionId),
  ]);
}

export async function confirmDeliveryDeletion(
  env: ControlEnv,
  userId: string,
  resourceType: string,
  resourceId: string,
): Promise<boolean> {
  if (resourceType === 'deck') {
    const resource = await deckAccess(env, userId, resourceId);
    if (resource === null || resource.deleted_at === null) return false;
    await purgeDeck(env, resource.id);
    return true;
  }
  if (resourceType === 'session') {
    const resource = await sessionAccess(env, userId, resourceId);
    if (resource === null || resource.deleted_at === null) return false;
    await purgeSession(env, resource.id);
    return true;
  }
  return false;
}
