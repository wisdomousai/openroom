import { VOICE_MAX_RECORDINGS_PER_TASK, VOICE_RETENTION_DAYS, VOICE_TRASH_DAYS, VOICE_WAV_MAX_BYTES, voiceWavDuration } from '@openroom/schema';
import { and, count, eq, getTableColumns, gt, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { json, type ControlEnv } from './auth.js';
import { orm } from './db/client.js';
import { learnerAudio, learnerSubmissions, sessionRecords, sessions } from './db/schema.js';
import { requireStudentLink } from './student-links.js';
import { publishedForStudent } from './learner-practice.js';

/** A bound value as a named select column, for `insert … select`. */
const bound = <T>(name: string, value: T) => sql<T>`${value}`.as(name);

/** The submission column a permanent deletion is scoped by. */
const SCOPE_COLUMN = { student_id: learnerSubmissions.studentId, session_id: learnerSubmissions.sessionId } as const;

async function readBoundedAudio(request: Request): Promise<Uint8Array | null> {
  if (!request.body || Number(request.headers.get('content-length') ?? 0) > VOICE_WAV_MAX_BYTES) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > VOICE_WAV_MAX_BYTES) { await reader.cancel(); return null; }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function learnerVoiceUpload(request: Request, env: ControlEnv, url: URL): Promise<Response> {
  const guard = await requireStudentLink(request, env);
  if (!guard.ok) return guard.response;
  const sessionId = url.searchParams.get('sessionId') ?? '';
  const taskId = url.searchParams.get('taskId') ?? '';
  const submissionId = url.searchParams.get('submissionId') ?? '';
  const revision = Number(url.searchParams.get('assignmentRevision'));
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(submissionId) || !Number.isSafeInteger(revision) || revision < 1) return json({ error: 'invalid-submission' }, 422);
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'audio/wav') return json({ error: 'unsupported-audio' }, 415);
  const published = await publishedForStudent(env, guard.link.studentId, guard.link.learnerId);
  const session = published.find((row) => row.sessionId === sessionId);
  const task = session?.tasks.find((row) => row.id === taskId && row.kind === 'voice');
  if (!session || !task) return json({ error: 'not-found' }, 404);
  if (revision !== session.revision) return json({ error: 'assignment-revised' }, 409);
  const bytes = await readBoundedAudio(request);
  if (!bytes) return json({ error: 'audio-too-large' }, 413);
  const durationMs = voiceWavDuration(bytes);
  if (durationMs === null) return json({ error: 'invalid-audio' }, 422);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const db = orm(env);
  const owned = and(
    eq(learnerSubmissions.id, submissionId), eq(learnerSubmissions.learnerId, guard.link.learnerId), eq(learnerSubmissions.studentId, guard.link.studentId),
    eq(learnerSubmissions.sessionId, sessionId), eq(learnerSubmissions.taskId, taskId), eq(learnerSubmissions.assignmentRevision, revision));
  const prior = await db.select(getTableColumns(learnerAudio)).from(learnerAudio)
    .innerJoin(learnerSubmissions, eq(learnerSubmissions.id, learnerAudio.submissionId)).where(owned).get();
  if (prior) {
    if (!prior.objectKey || prior.removedAt !== null || prior.expiresAt <= Date.now()) return json({ error: 'recording-unavailable' }, 410);
    if (prior.sha256 !== hash) return json({ error: 'submission-conflict' }, 409);
    return json({ ok: true, submissionId, durationMs: prior.durationMs });
  }
  const now = Date.now();
  // Recordings this learner still holds for the task. Counted again inside the insert below, at write time.
  const retainedCount = () => db.select({ total: count() }).from(learnerAudio)
    .innerJoin(learnerSubmissions, eq(learnerSubmissions.id, learnerAudio.submissionId))
    .where(and(eq(learnerSubmissions.learnerId, guard.link.learnerId), eq(learnerSubmissions.sessionId, sessionId), eq(learnerSubmissions.taskId, taskId),
      isNotNull(learnerAudio.objectKey), gt(learnerAudio.expiresAt, now)));
  const retained = await retainedCount().get();
  if ((retained?.total ?? 0) >= VOICE_MAX_RECORDINGS_PER_TASK) return json({ error: 'recording-limit' }, 429);
  const key = `learner-audio/${crypto.randomUUID()}`;
  const taskJson = JSON.stringify(task);
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: 'audio/wav' } });
  try {
    const results = await db.batch([
      db.insert(learnerSubmissions).select((qb) => qb.select({
        id: bound('id', submissionId), learnerId: bound('learnerId', guard.link.learnerId), studentId: bound('studentId', guard.link.studentId),
        sessionId: bound('sessionId', sessionId), taskId: bound('taskId', taskId), taskJson: bound('taskJson', taskJson),
        assignmentRevision: bound('assignmentRevision', revision), body: bound('body', ''), createdAt: bound('createdAt', now),
      }).from(sessionRecords).innerJoin(sessions, eq(sessions.id, sessionRecords.sessionId))
        .where(and(eq(sessionRecords.sessionId, sessionId), eq(sessionRecords.homeworkRevision, revision), eq(sessions.studentId, guard.link.studentId),
          isNull(sessions.deletedAt), ne(sessions.status, 'draft'), lt(retainedCount(), VOICE_MAX_RECORDINGS_PER_TASK))))
        .onConflictDoNothing({ target: learnerSubmissions.id }),
      db.insert(learnerAudio).select((qb) => qb.select({
        submissionId: learnerSubmissions.id, objectKey: bound('objectKey', key), sha256: bound('sha256', hash), byteLength: bound('byteLength', bytes.length),
        durationMs: bound('durationMs', durationMs), expiresAt: bound('expiresAt', now + VOICE_RETENTION_DAYS * 86_400_000), removedAt: sql<null>`null`.as('removedAt'),
      }).from(learnerSubmissions)
        .where(and(owned, eq(learnerSubmissions.taskJson, taskJson), eq(learnerSubmissions.body, ''))))
        .onConflictDoNothing({ target: learnerAudio.submissionId }),
    ]);
    if ((results[1].meta.changes ?? 0) > 0) return json({ ok: true, submissionId, durationMs });
    await env.MEDIA.delete(key);
    const stored = await db.select({ objectKey: learnerAudio.objectKey, sha256: learnerAudio.sha256 }).from(learnerAudio)
      .innerJoin(learnerSubmissions, eq(learnerSubmissions.id, learnerAudio.submissionId)).where(owned).get();
    if (!stored?.objectKey || stored.sha256 !== hash) return json({ error: 'submission-conflict' }, 409);
    return json({ ok: true, submissionId, durationMs });
  } catch (error) { await env.MEDIA.delete(key); throw error; }
}

/** Caller must already prove ownership of this submission. No public media URL exists. */
export async function privateAudioResponse(request: Request, env: ControlEnv, submissionId: string): Promise<Response> {
  const db = orm(env);
  const row = await db.select(getTableColumns(learnerAudio)).from(learnerAudio).where(eq(learnerAudio.submissionId, submissionId)).get();
  if (!row) return json({ error: 'not-found' }, 404);
  const now = Date.now();
  if (request.method === 'DELETE') {
    await db.update(learnerAudio).set({ removedAt: sql`COALESCE(${learnerAudio.removedAt}, ${now})` }).where(eq(learnerAudio.submissionId, submissionId)).run();
    return json({ ok: true });
  }
  if (request.method === 'PATCH') {
    const restored = await db.update(learnerAudio).set({ removedAt: null })
      .where(and(eq(learnerAudio.submissionId, submissionId), isNotNull(learnerAudio.objectKey), gt(learnerAudio.expiresAt, now),
        or(isNull(learnerAudio.removedAt), gt(learnerAudio.removedAt, now - VOICE_TRASH_DAYS * 86_400_000)))).run();
    return restored.meta.changes ? json({ ok: true }) : json({ error: 'recording-unavailable' }, 410);
  }
  if (!row.objectKey || row.removedAt !== null || row.expiresAt <= now) return json({ error: 'recording-unavailable' }, 410);
  const rangeHeader = request.headers.get('range');
  let range: { offset: number; length: number } | undefined;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${row.byteLength}`, 'cache-control': 'no-store' } });
    const start = match[1] ? Number(match[1]) : Math.max(0, row.byteLength - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(row.byteLength - 1, Number(match[2])) : row.byteLength - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= row.byteLength) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${row.byteLength}`, 'cache-control': 'no-store' } });
    range = { offset: start, length: end - start + 1 };
  }
  const object = await env.MEDIA.get(row.objectKey, range ? { range } : undefined);
  if (!object) return json({ error: 'recording-unavailable' }, 410);
  const headers = new Headers({ 'content-type': 'audio/wav', 'content-length': String(range?.length ?? row.byteLength),
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes',
    'content-security-policy': "default-src 'none'; sandbox", 'referrer-policy': 'no-referrer' });
  if (range) headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${row.byteLength}`);
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

export async function learnerAudioRoute(request: Request, env: ControlEnv, submissionId: string): Promise<Response> {
  const guard = await requireStudentLink(request, env);
  if (!guard.ok) return guard.response;
  const owned = await orm(env).select({ id: learnerSubmissions.id }).from(learnerSubmissions)
    .innerJoin(sessions, and(eq(sessions.id, learnerSubmissions.sessionId), eq(sessions.studentId, learnerSubmissions.studentId), isNull(sessions.deletedAt), ne(sessions.status, 'draft')))
    .where(and(eq(learnerSubmissions.id, submissionId), eq(learnerSubmissions.learnerId, guard.link.learnerId), eq(learnerSubmissions.studentId, guard.link.studentId))).get();
  if (!owned) return json({ error: 'not-found' }, 404);
  return privateAudioResponse(request, env, submissionId);
}

export async function expireLearnerAudio(env: ControlEnv, now = Date.now()): Promise<number> {
  const db = orm(env);
  const results = await db.select({ submissionId: learnerAudio.submissionId, objectKey: learnerAudio.objectKey }).from(learnerAudio)
    .where(and(or(lte(learnerAudio.expiresAt, now), lte(learnerAudio.removedAt, now - VOICE_TRASH_DAYS * 86_400_000)), isNotNull(learnerAudio.objectKey))).limit(100);
  for (const row of results) {
    if (row.objectKey === null) continue;
    await env.MEDIA.delete(row.objectKey);
    await db.update(learnerAudio).set({ objectKey: null }).where(and(eq(learnerAudio.submissionId, row.submissionId), eq(learnerAudio.objectKey, row.objectKey))).run();
  }
  return results.length;
}

/** Delete bytes before the control-plane permanent deletion removes their only index. */
export async function deleteLearnerAudioPermanently(env: ControlEnv, scope: 'student_id' | 'session_id', id: string): Promise<void> {
  const db = orm(env);
  const results = await db.select({ submissionId: learnerAudio.submissionId, objectKey: learnerAudio.objectKey }).from(learnerAudio)
    .innerJoin(learnerSubmissions, eq(learnerSubmissions.id, learnerAudio.submissionId)).where(eq(SCOPE_COLUMN[scope], id));
  for (const row of results) {
    if (row.objectKey) await env.MEDIA.delete(row.objectKey);
    await db.delete(learnerAudio).where(eq(learnerAudio.submissionId, row.submissionId)).run();
  }
}
