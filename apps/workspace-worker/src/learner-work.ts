import { VOICE_TRASH_DAYS, parseLearnerFeedback, publishedHomeworkOf } from '@openroom/schema';
import { alias, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { and, asc, desc, eq, isNotNull, isNull, ne, notExists, sql } from 'drizzle-orm';
import { json, type ControlEnv } from './auth.js';
import { orm, type Orm } from './db/client.js';
import { learnerAudio, learnerFeedback, learnerSubmissions, sessions, studentLearners, students } from './db/schema.js';
import { requireControlUser } from './control-auth.js';
import { parseJson, readJson } from './control-utils.js';
import { requireStudentLink } from './student-links.js';
import { roleAtLeast, spaceRole } from './members.js';
import { privateAudioResponse } from './learner-audio.js';
import { requireStudentContinuity } from './continuity-access.js';

/**
 * A submission with its learner, published session, feedback and recording.
 * Callers add the `where`/`orderBy`; the join keeps work of trashed or draft
 * sessions and of another student's learner out of every result.
 */
function selectWork(db: Orm) {
  return db
    .select({
      id: learnerSubmissions.id,
      learnerId: learnerSubmissions.learnerId,
      displayName: studentLearners.displayName,
      sessionId: learnerSubmissions.sessionId,
      taskId: learnerSubmissions.taskId,
      taskJson: learnerSubmissions.taskJson,
      body: learnerSubmissions.body,
      assignmentRevision: learnerSubmissions.assignmentRevision,
      draftJson: learnerFeedback.draftJson,
      publishedJson: learnerFeedback.publishedJson,
      version: learnerFeedback.version,
      durationMs: learnerAudio.durationMs,
      objectKey: learnerAudio.objectKey,
      expiresAt: learnerAudio.expiresAt,
      removedAt: learnerAudio.removedAt,
    })
    .from(learnerSubmissions)
    .innerJoin(
      studentLearners,
      and(eq(studentLearners.id, learnerSubmissions.learnerId), eq(studentLearners.studentId, learnerSubmissions.studentId)),
    )
    .innerJoin(
      sessions,
      and(
        eq(sessions.id, learnerSubmissions.sessionId),
        eq(sessions.studentId, learnerSubmissions.studentId),
        isNull(sessions.deletedAt),
        ne(sessions.status, 'draft'),
      ),
    )
    .leftJoin(learnerFeedback, eq(learnerFeedback.submissionId, learnerSubmissions.id))
    .leftJoin(learnerAudio, eq(learnerAudio.submissionId, learnerSubmissions.id));
}

type WorkRow = Awaited<ReturnType<typeof selectWork>>[number];

/** SQLite's insertion-order key; it orders resubmissions of one task. */
const rowid = (table: SQLiteTable) => sql<number>`${table}.rowid`;

export function audioJson(row: { durationMs: number | null; objectKey: string | null; expiresAt: number | null; removedAt: number | null }) {
  if (row.durationMs === null) return undefined;
  const retained = Boolean(row.objectKey && row.expiresAt && row.expiresAt > Date.now());
  return { durationMs: row.durationMs, available: retained && row.removedAt === null,
    recoverable: retained && row.removedAt !== null && row.removedAt > Date.now() - VOICE_TRASH_DAYS * 86_400_000 };
}

function workJson(row: WorkRow) {
  return {
    id: row.id, learnerId: row.learnerId, displayName: row.displayName,
    sessionId: row.sessionId, taskId: row.taskId,
    task: publishedHomeworkOf([parseJson(row.taskJson, null)])[0],
    body: row.body, assignmentRevision: row.assignmentRevision,
    audio: audioJson(row),
  };
}

/** All tutor review reads and writes require editor access to this student. */
export async function studentWorkRoute(request: Request, env: ControlEnv, studentId: string, submissionId?: string, leaf?: 'feedback' | 'audio'): Promise<Response> {
  const guard = await requireControlUser(request, env, request.method !== 'GET');
  if (!guard.ok) return guard.response;
  const db = orm(env);
  const student = await db.select({ spaceId: students.spaceId }).from(students).where(and(eq(students.id, studentId), isNull(students.deletedAt))).get();
  if (!student) return json({ error: 'not-found' }, 404);
  const access = await spaceRole(env, guard.user, student.spaceId);
  if (!access) return json({ error: 'not-found' }, 404);
  if (!roleAtLeast(access.role, 'editor')) return json({ error: 'forbidden' }, 403);
  // Moving a recording to trash (DELETE) and restoring it (PATCH) are never paid.
  if (!(leaf === 'audio' && (request.method === 'DELETE' || request.method === 'PATCH'))) {
    const blocked = await requireStudentContinuity(env, studentId);
    if (blocked) return blocked;
  }
  if (!submissionId) {
    if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
    const newer = alias(learnerSubmissions, 'newer');
    const results = await selectWork(db)
      .where(and(
        eq(learnerSubmissions.studentId, studentId),
        notExists(db.select({ one: sql`1` }).from(newer).where(and(
          eq(newer.learnerId, learnerSubmissions.learnerId), eq(newer.sessionId, learnerSubmissions.sessionId),
          eq(newer.taskId, learnerSubmissions.taskId), sql`${rowid(newer)} > ${rowid(learnerSubmissions)}`))),
      ))
      .orderBy(asc(studentLearners.displayName), desc(rowid(learnerSubmissions)));
    return json({ work: results.map(workJson) });
  }
  const row = await selectWork(db).where(and(eq(learnerSubmissions.studentId, studentId), eq(learnerSubmissions.id, submissionId))).get();
  if (!row) return json({ error: 'not-found' }, 404);
  if (leaf === 'audio') {
    if (request.method !== 'GET' && request.method !== 'DELETE' && request.method !== 'PATCH') return json({ error: 'method-not-allowed' }, 405);
    return privateAudioResponse(request, env, submissionId);
  }
  if (leaf !== 'feedback') {
    if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
    const earlier = await selectWork(db)
      .where(and(eq(learnerSubmissions.learnerId, row.learnerId), eq(learnerSubmissions.sessionId, row.sessionId),
        eq(learnerSubmissions.taskId, row.taskId), ne(learnerSubmissions.id, row.id)))
      .orderBy(desc(rowid(learnerSubmissions)));
    return json({ work: workJson(row), earlier: earlier.map(workJson),
      feedback: { draft: parseJson(row.draftJson ?? 'null', null), published: parseJson(row.publishedJson ?? 'null', null), version: row.version ?? 0 } });
  }
  if (request.method !== 'PUT') return json({ error: 'method-not-allowed' }, 405);
  const body = await readJson(request);
  const value = parseLearnerFeedback(body?.feedback);
  if (!value || (body?.action !== 'save' && body?.action !== 'publish') || !Number.isInteger(body.version) || Number(body.version) < 0) return json({ error: 'invalid-feedback' }, 422);
  if (body.action === 'publish' && !value.message.trim() && value.corrections.length === 0 && !value.audioComments?.length) return json({ error: 'empty-feedback' }, 422);
  if (value.audioComments?.some((note) => row.durationMs === null || note.atMs > row.durationMs)) return json({ error: 'invalid-audio-comment' }, 422);
  // Shared corrections must point to this submitted text, not a later resubmission. A private draft may hold one still being typed.
  if (body.action === 'publish' && value.corrections.some((correction) => !row.body.includes(correction.original))) return json({ error: 'correction-not-in-submission' }, 422);
  if (body.version !== (row.version ?? 0)) return json({ error: 'feedback-conflict' }, 409);
  const draft = JSON.stringify(value);
  const published = body.action === 'publish' ? draft : row.publishedJson;
  const version = Number(body.version) + 1;
  const now = Date.now();
  const saved = await db.insert(learnerFeedback)
    .values({ submissionId, draftJson: draft, publishedJson: published, version, updatedAt: now })
    .onConflictDoUpdate({
      target: learnerFeedback.submissionId,
      set: { draftJson: draft, publishedJson: published, version, updatedAt: now },
      setWhere: eq(learnerFeedback.version, version - 1),
    }).run();
  if (!saved.meta.changes) return json({ error: 'feedback-conflict' }, 409);
  return json({ ok: true, version, published: parseJson(published ?? 'null', null) });
}

/** The learner projection never selects a draft or another learner's response. */
export async function learnerFeedbackRoute(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireStudentLink(request, env);
  if (!guard.ok) return guard.response;
  const results = await orm(env)
    .select({
      id: learnerSubmissions.id,
      taskJson: learnerSubmissions.taskJson,
      body: learnerSubmissions.body,
      publishedJson: learnerFeedback.publishedJson,
      durationMs: learnerAudio.durationMs,
      objectKey: learnerAudio.objectKey,
      expiresAt: learnerAudio.expiresAt,
      removedAt: learnerAudio.removedAt,
    })
    .from(learnerSubmissions)
    .innerJoin(
      sessions,
      and(
        eq(sessions.id, learnerSubmissions.sessionId),
        eq(sessions.studentId, learnerSubmissions.studentId),
        isNull(sessions.deletedAt),
        ne(sessions.status, 'draft'),
      ),
    )
    .innerJoin(learnerFeedback, and(eq(learnerFeedback.submissionId, learnerSubmissions.id), isNotNull(learnerFeedback.publishedJson)))
    .leftJoin(learnerAudio, eq(learnerAudio.submissionId, learnerSubmissions.id))
    .where(and(eq(learnerSubmissions.learnerId, guard.link.learnerId), eq(learnerSubmissions.studentId, guard.link.studentId)))
    .orderBy(desc(rowid(learnerSubmissions)));
  return json({ feedback: results.map((row) => ({ submissionId: row.id,
    task: publishedHomeworkOf([parseJson(row.taskJson, null)])[0], body: row.body,
    audio: audioJson(row),
    feedback: parseLearnerFeedback(parseJson(row.publishedJson ?? 'null', null)),
  })) });
}
