/**
 * Learner writes and the tutor-side pickup read.
 *
 * Identity is a stable student-local learner id, never a users row and never the
 * raw `orlnk_…` token. Student id comes from the verified link. Teacher
 * responses never include due dates, ease, reps, or lapses.
 */
import {
  WRITING_BODY_MAX,
  canonicalJson,
  assessHomework,
  parseHomeworkPracticeAnswer,
  VOICE_TRASH_DAYS,
  homeworkItemId,
  parseHomeworkItemId,
  publishedHomeworkOf,
  homeworkForLearner,
  parseLearnerFeedback,
  practiceLocale,
  type PublishedHomeworkTask,
} from '@openroom/schema';
import { gradeSrs, newSrsState, type SrsGrade, type SrsState } from '@openroom/domain';
import { and, desc, eq, exists, isNotNull, isNull, ne, notExists, sql, type AnyColumn } from 'drizzle-orm';
import { alias, type SQLiteTable } from 'drizzle-orm/sqlite-core';

import { json, type ControlEnv, type SessionUser } from './auth.js';
import { sha256Hex } from './api-tokens.js';
import { requireControlUser } from './control-auth.js';
import { parseJson, readJson } from './control-utils.js';
import { orm } from './db/client.js';
import {
  learnerAudio,
  learnerFeedback,
  learnerPracticeAttempts,
  learnerSrs,
  learnerSubmissions,
  sessionRecords,
  sessions,
  spaceMembers,
  studentLearners,
  students,
} from './db/schema.js';
import { requireStudentLink } from './student-links.js';
import { roleAtLeast, spaceRole } from './members.js';
import { requireStudentContinuity } from './continuity-access.js';

type SrsRow = Pick<
  typeof learnerSrs.$inferSelect,
  'taskHash' | 'version' | 'ease' | 'intervalDays' | 'reps' | 'lapses' | 'dueAt' | 'lastGrade' | 'lastAnswer'
>;

/** A bound value as a named select column, for `insert … select`. */
const bound = <T>(name: string, value: T) => sql<T>`${value}`.as(name);

/** The value an upsert would have inserted, for `ON CONFLICT … DO UPDATE SET`. */
const excluded = (column: AnyColumn) => sql.raw(`excluded.${column.name}`);

/** SQLite's insertion-order key; it orders resubmissions of one task. */
const rowid = (table: SQLiteTable) => sql<number>`${table}.rowid`;

function asSrsState(row: SrsRow): SrsState {
  return {
    ease: row.ease,
    intervalDays: row.intervalDays,
    reps: row.reps,
    lapses: row.lapses,
    dueAt: row.dueAt,
  };
}

export async function publishedForStudent(
  env: ControlEnv,
  studentId: string,
  learnerId?: string,
): Promise<{ sessionId: string; revision: number; tasks: PublishedHomeworkTask[] }[]> {
  const results = await orm(env)
    .select({
      sessionId: sessions.id,
      homeworkJson: sessionRecords.homeworkJson,
      homeworkRevision: sessionRecords.homeworkRevision,
      homeworkAudienceJson: sessionRecords.homeworkAudienceJson,
    })
    .from(sessions)
    .innerJoin(sessionRecords, eq(sessionRecords.sessionId, sessions.id))
    .where(and(eq(sessions.studentId, studentId), isNull(sessions.deletedAt), ne(sessions.status, 'draft')));
  return results.map((row) => ({
    sessionId: row.sessionId,
    revision: row.homeworkRevision,
    tasks: learnerId === undefined ? publishedHomeworkOf(parseJson(row.homeworkJson, []))
      : homeworkForLearner(publishedHomeworkOf(parseJson(row.homeworkJson, [])), parseJson(row.homeworkAudienceJson, null), learnerId),
  }));
}

function quizCard(sessionId: string, revision: number, task: Extract<PublishedHomeworkTask, { kind: 'quiz' }>) {
  const locale = practiceLocale(task.interaction);
  return {
    itemId: homeworkItemId(sessionId, task.id), assignmentRevision: revision,
    ...(task.title !== undefined ? { title: task.title } : {}),
    ...(locale !== undefined ? { locale } : {}),
    interaction: task.interaction,
  };
}

/** Current assigned exercises, without exposing scheduling state. A selected item may be revisited. */
async function practiceItems(env: ControlEnv, studentId: string, learnerId: string, selected?: string) {
  const published = await publishedForStudent(env, studentId, learnerId);
  const results = await orm(env)
    .select({ itemId: learnerSrs.itemId, dueAt: learnerSrs.dueAt, taskHash: learnerSrs.taskHash })
    .from(learnerSrs)
    .where(eq(learnerSrs.learnerId, learnerId));
  const scheduled = new Map(results.map((row) => [row.itemId, row]));
  const items = [];
  for (const row of published) for (const task of row.tasks) {
    if (task.kind !== 'quiz') continue;
    const itemId = homeworkItemId(row.sessionId, task.id);
    if (selected !== undefined && selected !== itemId) continue;
    const state = scheduled.get(itemId);
    // A new question/key is fresh practice. Editing unrelated homework preserves progress.
    if (selected === undefined && state && state.dueAt > Date.now() && state.taskHash === await sha256Hex(canonicalJson(task))) continue;
    items.push(quizCard(row.sessionId, row.revision, task));
  }
  return items;
}

export async function learnerPracticeGet(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireStudentLink(request, env);
  if (!guard.ok) return guard.response;
  const selected = new URL(request.url).searchParams.get('itemId') ?? undefined;
  return json({ items: await practiceItems(env, guard.link.studentId, guard.link.learnerId, selected) });
}

export async function learnerPracticePost(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireStudentLink(request, env);
  if (!guard.ok) return guard.response;
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  const itemId = typeof body.itemId === 'string' ? body.itemId : '';
  const parsed = parseHomeworkItemId(itemId);
  if (!parsed) return json({ error: 'not-found' }, 404);
  const grade = body.grade;
  if (grade !== 'again' && grade !== 'good') return json({ error: 'invalid-grade' }, 422);
  const attemptId = typeof body.attemptId === 'string' ? body.attemptId : '';
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(attemptId)) return json({ error: 'invalid-attempt-id' }, 422);
  if (!Number.isInteger(body.assignmentRevision) || Number(body.assignmentRevision) < 1) return json({ error: 'invalid-assignment-revision' }, 422);
  const receipt = async () => {
    const remaining = (await practiceItems(env, guard.link.studentId, guard.link.learnerId)).filter((item) => item.itemId !== itemId);
    return json({ attemptId, ...(remaining.length ? { item: remaining[0] } : { done: true }) });
  };
  const db = orm(env);
  const prior = await db
    .select({
      id: learnerPracticeAttempts.id,
      learnerId: learnerPracticeAttempts.learnerId,
      studentId: learnerPracticeAttempts.studentId,
      itemId: learnerPracticeAttempts.itemId,
      taskJson: learnerPracticeAttempts.taskJson,
      answerJson: learnerPracticeAttempts.answerJson,
      grade: learnerPracticeAttempts.grade,
      assignmentRevision: learnerPracticeAttempts.assignmentRevision,
    })
    .from(learnerPracticeAttempts)
    .innerJoin(
      sessions,
      and(
        eq(sessions.id, learnerPracticeAttempts.sessionId),
        eq(sessions.studentId, learnerPracticeAttempts.studentId),
        isNull(sessions.deletedAt),
      ),
    )
    .where(eq(learnerPracticeAttempts.id, attemptId))
    .get();
  if (prior) {
    // A lost response can be retried even after the assignment changes. It never grades twice.
    if (prior.learnerId !== guard.link.learnerId || prior.studentId !== guard.link.studentId || prior.itemId !== itemId || prior.assignmentRevision !== body.assignmentRevision || prior.grade !== grade) return json({ error: 'attempt-conflict' }, 409);
    const original = publishedHomeworkOf([parseJson(prior.taskJson, null)])[0];
    const answer = original?.kind === 'quiz' ? parseHomeworkPracticeAnswer(original.interaction, body.answer) : null;
    return answer && canonicalJson(answer) === prior.answerJson ? receipt() : json({ error: 'attempt-conflict' }, 409);
  }
  const published = await publishedForStudent(env, guard.link.studentId, guard.link.learnerId);
  const session = published.find((row) => row.sessionId === parsed.sessionId);
  const task = session?.tasks.find((candidate) => candidate.id === parsed.taskId);
  if (!session || task?.kind !== 'quiz') return json({ error: 'not-found' }, 404);
  if (body.assignmentRevision !== session.revision) return json({ error: 'assignment-revised' }, 409);
  const answer = parseHomeworkPracticeAnswer(task.interaction, body.answer);
  if (!answer) return json({ error: 'invalid-answer' }, 422);
  const assessment = assessHomework(task.interaction, answer).result;
  if (assessment === 'incorrect' && grade === 'good') return json({ error: 'incorrect-answer' }, 422);
  const taskJson = canonicalJson(task); const taskHash = await sha256Hex(taskJson); const answerJson = canonicalJson(answer);
  const now = Date.now();
  const existing = await db
    .select({
      taskHash: learnerSrs.taskHash,
      version: learnerSrs.version,
      ease: learnerSrs.ease,
      intervalDays: learnerSrs.intervalDays,
      reps: learnerSrs.reps,
      lapses: learnerSrs.lapses,
      dueAt: learnerSrs.dueAt,
      lastGrade: learnerSrs.lastGrade,
      lastAnswer: learnerSrs.lastAnswer,
    })
    .from(learnerSrs)
    .where(and(eq(learnerSrs.learnerId, guard.link.learnerId), eq(learnerSrs.itemId, itemId)))
    .get();
  const previousVersion = existing?.version ?? 0;
  const next = gradeSrs(existing?.taskHash === taskHash ? asSrsState(existing) : newSrsState(now), grade as SrsGrade, now);
  // The record revision covers content and recipients. Compare it at the actual write,
  // together with the SRS version, then commit the immutable attempt and scheduling state atomically.
  await db.batch([
    db.insert(learnerPracticeAttempts).select((qb) => qb.select({
      id: bound('id', attemptId), learnerId: bound('learnerId', guard.link.learnerId), studentId: bound('studentId', guard.link.studentId),
      sessionId: bound('sessionId', parsed.sessionId), itemId: bound('itemId', itemId), taskJson: bound('taskJson', taskJson),
      taskHash: bound('taskHash', taskHash), answerJson: bound('answerJson', answerJson), grade: bound('grade', grade),
      assessment: bound('assessment', assessment), assignmentRevision: bound('assignmentRevision', session.revision),
      srsVersion: sql<number>`${previousVersion} + 1`.as('srsVersion'), createdAt: bound('createdAt', now),
    }).from(sessionRecords).innerJoin(sessions, eq(sessions.id, sessionRecords.sessionId))
      .where(and(
        eq(sessionRecords.sessionId, parsed.sessionId), eq(sessionRecords.homeworkRevision, session.revision),
        eq(sessions.studentId, guard.link.studentId), isNull(sessions.deletedAt), ne(sessions.status, 'draft'),
        sql`COALESCE(${db.select({ version: learnerSrs.version }).from(learnerSrs)
          .where(and(eq(learnerSrs.learnerId, guard.link.learnerId), eq(learnerSrs.itemId, itemId)))}, 0) = ${previousVersion}`,
      )))
      .onConflictDoNothing({ target: learnerPracticeAttempts.id }),
    db.insert(learnerSrs).select((qb) => qb.select({
      learnerId: learnerPracticeAttempts.learnerId, studentId: learnerPracticeAttempts.studentId, itemId: learnerPracticeAttempts.itemId,
      taskHash: learnerPracticeAttempts.taskHash, version: learnerPracticeAttempts.srsVersion, lastAttemptId: learnerPracticeAttempts.id,
      ease: bound('ease', next.ease), intervalDays: bound('intervalDays', next.intervalDays), reps: bound('reps', next.reps),
      lapses: bound('lapses', next.lapses), dueAt: bound('dueAt', next.dueAt), lastGrade: learnerPracticeAttempts.grade,
      lastAnswer: learnerPracticeAttempts.answerJson, updatedAt: learnerPracticeAttempts.createdAt,
    }).from(learnerPracticeAttempts)
      .where(and(
        eq(learnerPracticeAttempts.id, attemptId), eq(learnerPracticeAttempts.learnerId, guard.link.learnerId),
        eq(learnerPracticeAttempts.answerJson, answerJson), eq(learnerPracticeAttempts.grade, grade),
        eq(learnerPracticeAttempts.assignmentRevision, session.revision), sql`${learnerPracticeAttempts.srsVersion} = ${previousVersion} + 1`,
        eq(learnerPracticeAttempts.itemId, itemId), eq(learnerPracticeAttempts.taskHash, taskHash),
        eq(learnerPracticeAttempts.studentId, guard.link.studentId),
      )))
      .onConflictDoUpdate({
        target: [learnerSrs.learnerId, learnerSrs.itemId],
        set: {
          taskHash: excluded(learnerSrs.taskHash), version: excluded(learnerSrs.version), lastAttemptId: excluded(learnerSrs.lastAttemptId),
          ease: excluded(learnerSrs.ease), intervalDays: excluded(learnerSrs.intervalDays), reps: excluded(learnerSrs.reps),
          lapses: excluded(learnerSrs.lapses), dueAt: excluded(learnerSrs.dueAt), lastGrade: excluded(learnerSrs.lastGrade),
          lastAnswer: excluded(learnerSrs.lastAnswer), updatedAt: excluded(learnerSrs.updatedAt),
        },
        setWhere: eq(learnerSrs.version, previousVersion),
      }),
  ]);
  const saved = await db
    .select({ id: learnerPracticeAttempts.id })
    .from(learnerPracticeAttempts)
    .where(and(
      eq(learnerPracticeAttempts.id, attemptId), eq(learnerPracticeAttempts.learnerId, guard.link.learnerId),
      eq(learnerPracticeAttempts.studentId, guard.link.studentId), eq(learnerPracticeAttempts.itemId, itemId),
      eq(learnerPracticeAttempts.answerJson, answerJson), eq(learnerPracticeAttempts.grade, grade),
      eq(learnerPracticeAttempts.assignmentRevision, session.revision),
    ))
    .get();
  return saved ? receipt() : json({ error: 'practice-conflict' }, 409);
}

export async function learnerWritingPut(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireStudentLink(request, env);
  if (!guard.ok) return guard.response;
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  const taskId = typeof body.taskId === 'string' ? body.taskId : '';
  const text = typeof body.body === 'string' ? body.body : '';
  if (!text.trim()) return json({ error: 'writing-empty' }, 422);
  if (sessionId === '' || taskId === '') return json({ error: 'not-found' }, 404);
  if (text.length > WRITING_BODY_MAX) return json({ error: 'writing-too-long' }, 422);

  const published = await publishedForStudent(env, guard.link.studentId, guard.link.learnerId);
  const session = published.find((row) => row.sessionId === sessionId);
  const task = session?.tasks.find((candidate) => candidate.id === taskId);
  if (session === undefined || task === undefined || task.kind !== 'writing') {
    return json({ error: 'not-found' }, 404);
  }
  if (body.assignmentRevision !== session.revision) return json({ error: 'assignment-revised' }, 409);
  const submissionId = typeof body.submissionId === 'string' ? body.submissionId : crypto.randomUUID();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(submissionId)) return json({ error: 'invalid-submission-id' }, 422);
  const now = Date.now();
  const db = orm(env);
  await db
    .insert(learnerSubmissions)
    .select((qb) => qb.select({
      id: bound('id', submissionId), learnerId: bound('learnerId', guard.link.learnerId), studentId: bound('studentId', guard.link.studentId),
      sessionId: bound('sessionId', sessionId), taskId: bound('taskId', taskId), taskJson: bound('taskJson', JSON.stringify(task)),
      assignmentRevision: bound('assignmentRevision', session.revision), body: bound('body', text), createdAt: bound('createdAt', now),
    }).from(sessionRecords).innerJoin(sessions, eq(sessions.id, sessionRecords.sessionId))
      .where(and(
        eq(sessionRecords.sessionId, sessionId), eq(sessionRecords.homeworkRevision, session.revision),
        eq(sessions.studentId, guard.link.studentId), isNull(sessions.deletedAt), ne(sessions.status, 'draft'),
      )))
    .onConflictDoNothing({ target: learnerSubmissions.id })
    .run();
  const saved = await db
    .select({ id: learnerSubmissions.id })
    .from(learnerSubmissions)
    .where(and(
      eq(learnerSubmissions.id, submissionId), eq(learnerSubmissions.learnerId, guard.link.learnerId),
      eq(learnerSubmissions.sessionId, sessionId), eq(learnerSubmissions.taskId, taskId),
      eq(learnerSubmissions.body, text), eq(learnerSubmissions.assignmentRevision, session.revision),
    ))
    .get();
  if (!saved) return json({ error: 'submission-conflict' }, 409);
  return json({ ok: true, submissionId });
}

export async function submissionsForLearner(
  env: ControlEnv,
  learnerId: string,
): Promise<Map<string, { body: string; audio?: { submissionId: string; durationMs: number; available: boolean; recoverable: boolean } }>> {
  const results = await orm(env)
    .select({
      id: learnerSubmissions.id,
      sessionId: learnerSubmissions.sessionId,
      taskId: learnerSubmissions.taskId,
      body: learnerSubmissions.body,
      durationMs: learnerAudio.durationMs,
      objectKey: learnerAudio.objectKey,
      expiresAt: learnerAudio.expiresAt,
      removedAt: learnerAudio.removedAt,
    })
    .from(learnerSubmissions)
    .leftJoin(learnerAudio, eq(learnerAudio.submissionId, learnerSubmissions.id))
    .where(eq(learnerSubmissions.learnerId, learnerId))
    .orderBy(desc(rowid(learnerSubmissions)));
  const map = new Map<string, { body: string; audio?: { submissionId: string; durationMs: number; available: boolean; recoverable: boolean } }>();
  for (const row of results) if (!map.has(`${row.sessionId}:${row.taskId}`)) map.set(`${row.sessionId}:${row.taskId}`, {
    body: row.body,
    ...(row.durationMs === null ? {} : { audio: { submissionId: row.id, durationMs: row.durationMs, available: Boolean(row.objectKey && row.expiresAt && row.expiresAt > Date.now() && row.removedAt === null), recoverable: Boolean(row.objectKey && row.expiresAt && row.expiresAt > Date.now() && row.removedAt !== null && row.removedAt > Date.now() - VOICE_TRASH_DAYS * 86_400_000) } }),
  });
  return map;
}

export async function studentReturnedRoute(
  request: Request,
  env: ControlEnv,
  studentId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, false);
  if (!guard.ok) return guard.response;
  const db = orm(env);
  const row = await db
    .select({ spaceId: students.spaceId, nextNote: students.nextNote })
    .from(students)
    .innerJoin(spaceMembers, and(eq(spaceMembers.spaceId, students.spaceId), eq(spaceMembers.userId, guard.user.id)))
    .where(eq(students.id, studentId))
    .get();
  if (row === undefined) return json({ error: 'not-found' }, 404);
  const access = await spaceRole(env, guard.user as SessionUser, row.spaceId);
  if (access === null || !roleAtLeast(access.role, 'editor')) {
    return json({ error: 'forbidden' }, 403);
  }
  const blocked = await requireStudentContinuity(env, studentId);
  if (blocked) return blocked;

  const newer = alias(learnerSubmissions, 'newer');
  const writings = await db
    .select({
      sessionId: learnerSubmissions.sessionId,
      taskId: learnerSubmissions.taskId,
      body: learnerSubmissions.body,
      taskJson: learnerSubmissions.taskJson,
      learnerId: learnerSubmissions.learnerId,
      displayName: studentLearners.displayName,
    })
    .from(learnerSubmissions)
    .innerJoin(
      studentLearners,
      and(eq(studentLearners.id, learnerSubmissions.learnerId), eq(studentLearners.studentId, learnerSubmissions.studentId)),
    )
    .where(and(
      eq(learnerSubmissions.studentId, studentId),
      sql`json_extract(${learnerSubmissions.taskJson}, '$.kind') = 'writing'`,
      notExists(db.select({ one: sql`1` }).from(newer).where(and(
        eq(newer.learnerId, learnerSubmissions.learnerId), eq(newer.sessionId, learnerSubmissions.sessionId),
        eq(newer.taskId, learnerSubmissions.taskId), sql`${rowid(newer)} > ${rowid(learnerSubmissions)}`))),
      exists(db.select({ one: sql`1` }).from(sessions).where(and(
        eq(sessions.id, learnerSubmissions.sessionId), eq(sessions.studentId, learnerSubmissions.studentId), isNull(sessions.deletedAt)))),
    ));

  const writing = writings.map((item) => {
    const task = publishedHomeworkOf([parseJson(item.taskJson, null)])[0];
    const title =
      task?.kind === 'writing'
        ? (task.title ?? task.prompt)
        : task?.kind === 'reading'
          ? (task.title ?? task.body)
          : task?.title;
    return {
      learnerId: item.learnerId,
      displayName: item.displayName,
      sessionId: item.sessionId,
      taskId: item.taskId,
      ...(title !== undefined ? { title } : {}),
      body: item.body,
    };
  });

  const missedRows = await db
    .select({
      itemId: learnerSrs.itemId,
      lastAnswer: learnerSrs.lastAnswer,
      learnerId: learnerSrs.learnerId,
      taskJson: learnerPracticeAttempts.taskJson,
      displayName: studentLearners.displayName,
    })
    .from(learnerSrs)
    .innerJoin(learnerPracticeAttempts, eq(learnerPracticeAttempts.id, learnerSrs.lastAttemptId))
    .innerJoin(
      sessions,
      and(
        eq(sessions.id, learnerPracticeAttempts.sessionId),
        eq(sessions.studentId, learnerPracticeAttempts.studentId),
        isNull(sessions.deletedAt),
      ),
    )
    .innerJoin(
      studentLearners,
      and(eq(studentLearners.id, learnerSrs.learnerId), eq(studentLearners.studentId, learnerSrs.studentId)),
    )
    .where(and(eq(learnerSrs.studentId, studentId), eq(learnerSrs.lastGrade, 'again')));

  const missed = missedRows.flatMap((item) => {
    const task = publishedHomeworkOf([parseJson(item.taskJson, null)])[0];
    if (task === undefined || task.kind !== 'quiz') return [];
    const lastAnswer = parseHomeworkPracticeAnswer(task.interaction, parseJson(item.lastAnswer ?? 'null', null));
    if (!lastAnswer) return [];
    return [
      {
        learnerId: item.learnerId,
        displayName: item.displayName,
        itemId: item.itemId,
        exercise: { ...(task.title === undefined ? {} : { title: task.title }), interaction: task.interaction },
        lastAnswer,
      },
    ];
  });

  const feedbackRows = await db
    .select({
      id: learnerSubmissions.id,
      learnerId: learnerSubmissions.learnerId,
      displayName: studentLearners.displayName,
      publishedJson: learnerFeedback.publishedJson,
    })
    .from(learnerSubmissions)
    .innerJoin(learnerFeedback, and(eq(learnerFeedback.submissionId, learnerSubmissions.id), isNotNull(learnerFeedback.publishedJson)))
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
      ),
    )
    .where(eq(learnerSubmissions.studentId, studentId))
    .orderBy(desc(rowid(learnerSubmissions)))
    .limit(50);
  const corrections = feedbackRows.flatMap((item) => {
    const feedback = parseLearnerFeedback(parseJson(item.publishedJson ?? 'null', null));
    return (feedback?.corrections ?? []).map((correction, index) => ({ id: `${item.id}:${index}`, learnerId: item.learnerId, displayName: item.displayName, ...correction }));
  });
  return json({
    nextNote: row.nextNote ?? '',
    writing,
    missed,
    corrections,
  });
}
