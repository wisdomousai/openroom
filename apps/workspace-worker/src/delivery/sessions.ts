/**
 * Folder-scoped decks (content) and sessions (delivery instances).
 * Students stay in tutoring.ts. Live sessions are launched from a session.
 */
import {
  clipNextNote,
  compileRecordHomework,
  HOMEWORK_QUIZ_TYPES,
  HOMEWORK_TASK_MAX,
  parseHomeworkAudience,
  isPresentationPosition,
  SESSION_STATUSES,
  type PresentationPosition,
  type PublishedHomeworkTask,
} from '@openroom/schema';
import { and, desc, eq, exists, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';

import { sha256Hex } from '../api-tokens.js';
import { json, type ControlEnv, type SessionUser } from '../auth.js';
import { requireControlUser } from '../control-auth.js';
import { DELETION_INTENT_TTL_MS, compactArray, parseJson, plainObject, randomId, randomToken, readJson } from '../control-utils.js';
import { orm } from '../db/client.js';
import {
  deckDrafts,
  deckVersions,
  decks,
  deletionIntents,
  itemTags,
  learnerFeedback,
  learnerPracticeAttempts,
  learnerSrs,
  learnerSubmissions,
  liveSessions,
  sessionRecords,
  sessions,
  spaceMembers,
  studentLearners,
  students,
} from '../db/schema.js';
import { ensureWorkspace } from '../workspace.js';
import { deleteLearnerAudioPermanently } from '../learner-audio.js';
import { requireSpaceContinuity } from '../continuity-access.js';

import {
  parseShape,
  resolveFolder,
  deckAccess,
  sessionAccess,
  studentAccess,
  mutationAllowed,
  sessionJson,
  latestContent,
  SESSION_STATUSES_SERVER_OWNED,
  type DeliveryResourceType,
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
    const studentId = url.searchParams.get('studentId');
    const folderId = url.searchParams.get('folderId');
    const spaceId = url.searchParams.get('spaceId');
    const conditions: SQL[] = [
      exists(
        orm(env)
          .select({ one: sql`1` })
          .from(spaceMembers)
          .where(and(eq(spaceMembers.spaceId, sessions.spaceId), eq(spaceMembers.userId, guard.user.id))),
      ),
      trashed ? isNotNull(sessions.deletedAt) : isNull(sessions.deletedAt),
    ];
    if (deckId !== null) conditions.push(eq(sessions.deckId, deckId));
    if (studentId !== null) conditions.push(eq(sessions.studentId, studentId));
    if (spaceId !== null && spaceId !== '') conditions.push(eq(sessions.spaceId, spaceId));
    if (folderId === 'root' || folderId === '') {
      conditions.push(or(isNull(sessions.folderId), eq(sessions.folderId, ''))!);
    } else if (folderId !== null) {
      conditions.push(eq(sessions.folderId, folderId));
    }
    const results = await orm(env)
      .select()
      .from(sessions)
      .where(and(...conditions))
      .orderBy(desc(sessions.updatedAt))
      .limit(500);
    return json({ sessions: results.map(sessionJson) });
  }

  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  if (typeof body.deckId !== 'string' || body.deckId === '') {
    return json({ error: 'deck-id-required' }, 422);
  }
  const deck = await deckAccess(env, guard.user.id, body.deckId);
  if (deck === null || deck.deletedAt !== null) return json({ error: 'deck-not-found' }, 404);
  if (!(await mutationAllowed(env, guard.user, deck.spaceId))) {
    return json({ error: 'forbidden' }, 403);
  }

  let studentId = deck.studentId;
  if (body.studentId === null) studentId = null;
  if (typeof body.studentId === 'string') {
    const ctx = await studentAccess(env, guard.user.id, body.studentId);
    if (ctx === null || ctx.deletedAt !== null || ctx.spaceId !== deck.spaceId) {
      return json({ error: 'student-not-found' }, 404);
    }
    studentId = ctx.id;
  }

  const deckVersion = typeof body.deckVersion === 'number' && Number.isInteger(body.deckVersion)
    ? body.deckVersion
    : deck.currentVersion;
  if (deckVersion < 0 || deckVersion > deck.currentVersion) {
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
  const location = await resolveFolder(env, guard.user, deck.spaceId, body, deck.folderId);
  if (!location.ok) return location.response;
  const { folderId } = location;
  const id = randomId();
  const now = Date.now();
  await orm(env).insert(sessions).values({
    id,
    spaceId: deck.spaceId,
    folderId,
    deckId: deck.id,
    deckVersion,
    studentId,
    createdBy: guard.user.id,
    title,
    shape,
    status: 'draft',
    metadataJson: '{}',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }).run();
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
    canEdit: row.deletedAt === null && await mutationAllowed(env, guard.user, row.spaceId),
  });
  if (!(await mutationAllowed(env, guard.user, row.spaceId))) {
    return json({ error: 'forbidden' }, 403);
  }
  if (request.method === 'DELETE') {
    if (row.deletedAt === null) {
      const now = Date.now();
      await orm(env).update(sessions).set({ deletedAt: now, updatedAt: now }).where(eq(sessions.id, sessionId)).run();
    }
    return json({ ok: true, recoverable: true });
  }
  if (request.method !== 'PATCH') return json({ error: 'method-not-allowed' }, 405);
  if (row.deletedAt !== null) return json({ error: 'resource-in-trash' }, 409);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);

  let studentId = row.studentId;
  if (body.studentId === null) studentId = null;
  if (typeof body.studentId === 'string') {
    const ctx = await studentAccess(env, guard.user.id, body.studentId);
    if (ctx === null || ctx.deletedAt !== null || ctx.spaceId !== row.spaceId) {
      return json({ error: 'student-not-found' }, 404);
    }
    studentId = ctx.id;
  }
  const title = body.title === undefined
    ? row.title
    : typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
  if (title === '') return json({ error: 'title-required' }, 422);
  // Status moves are server-owned (delivery/session-status.ts). A client may
  // only repeat 'draft' on a session that is still a draft.
  if (body.status !== undefined && !(body.status === 'draft' && row.status === 'draft')) {
    const known = typeof body.status === 'string' && (SESSION_STATUSES as readonly string[]).includes(body.status);
    return json({ error: known ? 'status-server-owned' : 'invalid-status' }, 422);
  }
  const location = await resolveFolder(env, guard.user, row.spaceId, body, row.folderId);
  if (!location.ok) return location.response;
  const now = Date.now();
  await orm(env)
    .update(sessions)
    .set({ studentId, title, folderId: location.folderId, updatedAt: now })
    .where(eq(sessions.id, sessionId))
    .run();
  return json({
    session: sessionJson({
      ...row,
      studentId,
      title,
      folderId: location.folderId,
      updatedAt: now,
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
  if (!(await mutationAllowed(env, guard.user, row.spaceId))) {
    return json({ error: 'forbidden' }, 403);
  }
  await orm(env).update(sessions).set({ deletedAt: null, updatedAt: Date.now() }).where(eq(sessions.id, sessionId)).run();
  return json({ ok: true });
}

const RECORD_HOMEWORK_KINDS = 'reading, writing, voice or quiz';

/**
 * Why a homework list that is the right size failed to compile, naming the
 * first task at fault so an agent can correct it. Null for a size problem,
 * which keeps its own record-arrays-too-large answer.
 */
function recordHomeworkProblem(input: unknown): { index?: number; message: string } | null {
  if (!Array.isArray(input)) {
    return { message: `homework must be an array of tasks: a string (reading material) or a task object with kind ${RECORD_HOMEWORK_KINDS}` };
  }
  if (input.length > HOMEWORK_TASK_MAX) return null;
  for (const [index, item] of input.entries()) {
    if (compileRecordHomework([item]) !== null) continue;
    const at = `homework[${String(index)}]`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return { index, message: `${at} must be a string (reading material) or a task object with kind ${RECORD_HOMEWORK_KINDS}` };
    }
    const kind = (item as Record<string, unknown>).kind;
    if (kind === 'reading') return { index, message: `${at}.body is required for a reading task` };
    if (kind === 'writing' || kind === 'voice') {
      return { index, message: `${at}.prompt is required for a ${kind} task; prompt and guidance hold at most 2000 characters each` };
    }
    if (kind === 'quiz') {
      return { index, message: `${at}.interaction must be a complete ${HOMEWORK_QUIZ_TYPES.join(', ')} interaction with an id` };
    }
    return { index, message: `${at}.kind must be ${RECORD_HOMEWORK_KINDS}` };
  }
  return { message: 'homework task ids must be unique' };
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
    const blocked = await requireSpaceContinuity(env, session.spaceId);
    if (blocked) return blocked;
  }
  if (request.method === 'GET') {
    const row = await orm(env).select().from(sessionRecords).where(eq(sessionRecords.sessionId, sessionId)).get();
    if (row === undefined) return json({ record: null });
    return json({
      record: {
        id: row.id,
        sessionId,
        studentId: row.studentId,
        sessionCode: row.sessionCode,
        deckVersion: row.deckVersion,
        outcomes: parseJson(row.outcomesJson, []),
        notes: row.notes,
        nextNote: row.nextNote,
        homework: parseJson(row.homeworkJson, []),
        homeworkAudience: parseJson(row.homeworkAudienceJson, {}),
        homeworkRevision: row.homeworkRevision,
        artifacts: parseJson(row.artifactsJson, []),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    });
  }
  if (request.method !== 'PUT') return json({ error: 'method-not-allowed' }, 405);
  if (!(await mutationAllowed(env, guard.user, session.spaceId))) {
    return json({ error: 'forbidden' }, 403);
  }
  if (session.deletedAt !== null) return json({ error: 'resource-in-trash' }, 409);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  const existing = await orm(env)
    .select({
      id: sessionRecords.id,
      createdAt: sessionRecords.createdAt,
      sessionCode: sessionRecords.sessionCode,
      deckVersion: sessionRecords.deckVersion,
      outcomesJson: sessionRecords.outcomesJson,
      notes: sessionRecords.notes,
      nextNote: sessionRecords.nextNote,
      homeworkJson: sessionRecords.homeworkJson,
      homeworkAudienceJson: sessionRecords.homeworkAudienceJson,
      homeworkRevision: sessionRecords.homeworkRevision,
      artifactsJson: sessionRecords.artifactsJson,
    })
    .from(sessionRecords)
    .where(eq(sessionRecords.sessionId, sessionId))
    .get();
  // A field the body leaves out keeps its stored value; an explicit '' or []
  // clears it. Several writers share one record (the tutor's Notes in the
  // browser, an agent adding homework later), so a partial body must never
  // wipe what another writer saved.
  const provided = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const stored = (text: string | undefined): unknown[] => {
    const value = parseJson(text ?? '[]', []);
    return Array.isArray(value) ? value : [];
  };
  const outcomes = provided('outcomes') ? compactArray(body.outcomes ?? []) : stored(existing?.outcomesJson);
  const artifacts = provided('artifacts') ? compactArray(body.artifacts ?? []) : stored(existing?.artifactsJson);
  // Omitted homework is the stored snapshot itself, byte for byte, so it never
  // counts as a homework change that would need homeworkRevision.
  const homework = provided('homework')
    ? compileRecordHomework(body.homework ?? [])
    : stored(existing?.homeworkJson) as PublishedHomeworkTask[];
  const notes = provided('notes')
    ? typeof body.notes === 'string' ? body.notes.slice(0, 10_000) : ''
    : existing?.notes ?? '';
  const nextNote = provided('nextNote') ? clipNextNote(body.nextNote) : null;
  if (homework === null && provided('homework')) {
    const problem = recordHomeworkProblem(body.homework ?? []);
    if (problem !== null) return json({ error: 'invalid-homework', ...problem }, 422);
  }
  if (outcomes === null || homework === null || artifacts === null) {
    return json({ error: 'record-arrays-too-large' }, 422);
  }
  const deckVersion = typeof body.deckVersion === 'number' && Number.isInteger(body.deckVersion)
    ? body.deckVersion
    : existing?.deckVersion ?? session.deckVersion;
  const deck = await orm(env)
    .select({ currentVersion: decks.currentVersion })
    .from(decks)
    .where(eq(decks.id, session.deckId))
    .get();
  const currentVersion = deck?.currentVersion ?? session.deckVersion;
  // Decks without content keep current_version = 0; allow recording against 0.
  if (
    deckVersion < 0 ||
    deckVersion > currentVersion ||
    (currentVersion > 0 && deckVersion < 1)
  ) {
    return json({ error: 'invalid-deck-version' }, 422);
  }
  const sessionCode = provided('sessionCode')
    ? typeof body.sessionCode === 'string' ? body.sessionCode.slice(0, 64) : null
    : existing?.sessionCode ?? null;
  const now = Date.now();
  const taskIds = homework.map((task) => task.id);
  const storedAudience = parseJson(existing?.homeworkAudienceJson ?? '{}', null);
  if (body.homeworkAudience === undefined && !plainObject(storedAudience)) return json({ error: 'invalid-homework-audience' }, 422);
  // Omitting this field preserves restrictions on surviving tasks. Sharing is deliberate.
  const audienceInput = body.homeworkAudience === undefined
    ? Object.fromEntries(Object.entries(storedAudience as Record<string, unknown>).filter(([id]) => taskIds.includes(id))) : body.homeworkAudience;
  const people = session.studentId === null
    ? []
    : await orm(env).select({ id: studentLearners.id }).from(studentLearners).where(eq(studentLearners.studentId, session.studentId));
  const audience = parseHomeworkAudience(audienceInput, taskIds, people.map((person) => person.id));
  if (audience === null) return json({ error: 'invalid-homework-audience' }, 422);
  const homeworkJson = provided('homework') || existing === undefined ? JSON.stringify(homework) : existing.homeworkJson;
  const audienceJson = JSON.stringify(audience);
  const changedHomework = existing !== undefined && (homeworkJson !== existing.homeworkJson || audienceJson !== existing.homeworkAudienceJson);
  if (changedHomework && body.homeworkRevision !== existing.homeworkRevision) return json({ error: 'homework-revision-conflict' }, 409);
  const homeworkRevision = existing === undefined ? 1 : existing.homeworkRevision + (changedHomework ? 1 : 0);
  const storedNextNote = nextNote ?? existing?.nextNote ?? '';
  // An existing row takes only the columns this body names, so two writers
  // saving different fields at once never put back each other's old values.
  // Homework columns are always written, guarded by homework_revision.
  const values = {
    id: existing?.id ?? randomId(),
    sessionId,
    studentId: session.studentId,
    sessionCode,
    deckVersion,
    outcomesJson: JSON.stringify(outcomes),
    notes,
    nextNote: storedNextNote,
    homeworkJson,
    artifactsJson: JSON.stringify(artifacts),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    homeworkRevision,
    homeworkAudienceJson: audienceJson,
  };
  const set: Partial<typeof values> = {
    studentId: values.studentId,
    homeworkJson: values.homeworkJson,
    updatedAt: values.updatedAt,
    homeworkRevision: values.homeworkRevision,
    homeworkAudienceJson: values.homeworkAudienceJson,
  };
  if (provided('sessionCode')) set.sessionCode = values.sessionCode;
  if (provided('deckVersion')) set.deckVersion = values.deckVersion;
  if (provided('outcomes')) set.outcomesJson = values.outcomesJson;
  if (provided('notes')) set.notes = values.notes;
  if (provided('nextNote')) set.nextNote = values.nextNote;
  if (provided('artifacts')) set.artifactsJson = values.artifactsJson;
  const saved = await orm(env)
    .insert(sessionRecords)
    .values(values)
    .onConflictDoUpdate({
      target: sessionRecords.sessionId,
      set,
      setWhere: eq(sessionRecords.homeworkRevision, existing?.homeworkRevision ?? 0),
    })
    .run();
  if (!saved.meta.changes) return json({ error: 'homework-revision-conflict' }, 409);
  if (nextNote !== null && session.studentId) {
    await orm(env)
      .update(students)
      .set({ nextNote, updatedAt: now })
      .where(eq(students.id, session.studentId))
      .run();
  }
  return json({ ok: true, sessionId, updatedAt: now, homeworkRevision });
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
  if (session === null || session.deletedAt !== null) return json({ error: 'not-found' }, 404);
  const body = (await readJson(request)) ?? {};
  const requested = typeof body.version === 'number' && Number.isInteger(body.version)
    ? body.version
    : session.deckVersion > 0 ? session.deckVersion : undefined;
  if (session.sourceOutlineJson && requested !== session.deckVersion) return json({ error: 'session-version-conflict' }, 409);
  const content = session.sourceOutlineJson
    ? { version: session.deckVersion, outline: JSON.parse(session.sourceOutlineJson) as import('@openroom/schema').Outline }
    : await latestContent(env, session.deckId, requested);
  if (content === null) return json({ error: 'deck-content-not-found' }, 409);
  if (body.cursor !== undefined) {
    if (!isPresentationPosition(content.outline, body.cursor)) {
      return json({ error: 'invalid-presentation-cursor' }, 422);
    }
  }
  return launch({
    ...(guard.connectionId ? { connectionId: guard.connectionId } : {}),
    origin: new URL(request.url).origin,
    sessionId: session.id,
    deckId: session.deckId,
    studentId: session.studentId,
    title: session.title,
    version: content.version,
    outline: content.outline,
    start: body.start === true,
    // A launch of a running session is refused once the DO confirms it is live.
    refuseLive: session.status === 'live',
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
  if (!(await mutationAllowed(env, guard.user, resource.spaceId))) {
    return json({ error: 'forbidden' }, 403);
  }
  if (resource.deletedAt === null) return json({ error: 'move-to-trash-first' }, 409);
  const name = resource.title;
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await orm(env).insert(deletionIntents).values({
    tokenHash,
    userId: guard.user.id,
    resourceType,
    resourceId,
    resourceName: name,
    createdAt: now,
    expiresAt: now + DELETION_INTENT_TTL_MS,
    usedAt: null,
  }).run();
  const origin = new URL(request.url).origin;
  return json({
    ok: true,
    confirmationRequired: true,
    expiresAt: now + DELETION_INTENT_TTL_MS,
    confirmationUrl: `${origin}/confirm-deletion/${encodeURIComponent(token)}`,
  }, 202);
}

export async function deleteDeckPermanently(env: ControlEnv, deckId: string): Promise<void> {
  const db = orm(env);
  const deckSessions = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.deckId, deckId));
  for (const session of deckSessions) await deleteSessionPermanently(env, session.id);
  await db.batch([
    // Detach sessions that recorded this deck so no row points at a deleted deck.
    db.update(liveSessions).set({ deckId: null, deckVersion: null }).where(eq(liveSessions.deckId, deckId)),
    db.delete(deckVersions).where(eq(deckVersions.deckId, deckId)),
    db.delete(deckDrafts).where(eq(deckDrafts.deckId, deckId)),
    // Tags have no life of their own: a deleted item takes its tags with it,
    // otherwise the space facet list keeps counting rows nothing can reach.
    db.delete(itemTags).where(and(eq(itemTags.itemType, 'deck'), eq(itemTags.itemId, deckId))),
    db.delete(decks).where(eq(decks.id, deckId)),
  ]);
}

async function deleteSessionPermanently(env: ControlEnv, sessionId: string): Promise<void> {
  await deleteLearnerAudioPermanently(env, 'session_id', sessionId);
  const db = orm(env);
  await db.batch([
    db.update(liveSessions)
      .set({ sessionId: null, deckId: null, deckVersion: null })
      .where(eq(liveSessions.sessionId, sessionId)),
    db.delete(itemTags).where(and(
      eq(itemTags.itemType, 'record'),
      inArray(
        itemTags.itemId,
        db.select({ id: sessionRecords.id }).from(sessionRecords).where(eq(sessionRecords.sessionId, sessionId)),
      ),
    )),
    db.delete(itemTags).where(and(eq(itemTags.itemType, 'session'), eq(itemTags.itemId, sessionId))),
    db.delete(learnerFeedback).where(inArray(
      learnerFeedback.submissionId,
      db.select({ id: learnerSubmissions.id }).from(learnerSubmissions).where(eq(learnerSubmissions.sessionId, sessionId)),
    )),
    db.delete(learnerSubmissions).where(eq(learnerSubmissions.sessionId, sessionId)),
    db.delete(learnerSrs).where(sql`substr(${learnerSrs.itemId}, 1, length(${sessionId}) + 1) = ${sessionId} || ':'`),
    db.delete(learnerPracticeAttempts).where(eq(learnerPracticeAttempts.sessionId, sessionId)),
    db.delete(sessionRecords).where(eq(sessionRecords.sessionId, sessionId)),
    db.delete(sessions).where(eq(sessions.id, sessionId)),
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
    if (resource === null || resource.deletedAt === null) return false;
    await deleteDeckPermanently(env, resource.id);
    return true;
  }
  if (resourceType === 'session') {
    const resource = await sessionAccess(env, userId, resourceId);
    if (resource === null || resource.deletedAt === null) return false;
    await deleteSessionPermanently(env, resource.id);
    return true;
  }
  return false;
}
