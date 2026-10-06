/**
 * Learner writes and the tutor-side pickup read.
 *
 * Identity is a stable context-local learner id, never a users row and never the
 * raw `orlnk_…` token. Context id comes from the verified link. Teacher
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
  type PublishedHomeworkTask,
} from '@openroom/schema';
import { gradeSrs, newSrsState, type SrsGrade, type SrsState } from '@openroom/domain';

import { json, type ControlEnv, type SessionUser } from './auth.js';
import { sha256Hex } from './api-tokens.js';
import { requireControlUser } from './control-auth.js';
import { parseJson, readJson } from './control-utils.js';
import { requireContextLink } from './context-links.js';
import { roleAtLeast, spaceRole } from './members.js';
import { requireContextContinuity } from './continuity-access.js';

interface HomeworkRow {
  session_id: string;
  homework_json: string;
  homework_revision: number;
  homework_audience_json: string;
}

interface SrsRow {
  task_hash: string;
  version: number;
  ease: number;
  interval_days: number;
  reps: number;
  lapses: number;
  due_at: number;
  last_grade: string | null;
  last_answer: string | null;
}

interface WritingRow {
  learner_id?: string;
  display_name?: string;
  session_id: string;
  task_id: string;
  body: string;
  task_json?: string;
}

function asSrsState(row: SrsRow): SrsState {
  return {
    ease: row.ease,
    intervalDays: row.interval_days,
    reps: row.reps,
    lapses: row.lapses,
    dueAt: row.due_at,
  };
}

export async function publishedForContext(
  env: ControlEnv,
  contextId: string,
  learnerId?: string,
): Promise<{ sessionId: string; revision: number; tasks: PublishedHomeworkTask[] }[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.id AS session_id, rec.homework_json AS homework_json, rec.homework_revision, rec.homework_audience_json
       FROM sessions r
       JOIN session_records rec ON rec.session_id = r.id
      WHERE r.context_id = ?1
        AND r.deleted_at IS NULL
        AND r.status <> 'draft'`,
  )
    .bind(contextId)
    .all<HomeworkRow>();
  return (results ?? []).map((row) => ({
    sessionId: row.session_id,
    revision: row.homework_revision,
    tasks: learnerId === undefined ? publishedHomeworkOf(parseJson(row.homework_json, []))
      : homeworkForLearner(publishedHomeworkOf(parseJson(row.homework_json, [])), parseJson(row.homework_audience_json, null), learnerId),
  }));
}

function quizCard(sessionId: string, revision: number, task: Extract<PublishedHomeworkTask, { kind: 'quiz' }>) {
  return {
    itemId: homeworkItemId(sessionId, task.id), assignmentRevision: revision,
    ...(task.title !== undefined ? { title: task.title } : {}),
    interaction: task.interaction,
  };
}

/** Current assigned exercises, without exposing scheduling state. A selected item may be revisited. */
async function practiceItems(env: ControlEnv, contextId: string, learnerId: string, selected?: string) {
  const published = await publishedForContext(env, contextId, learnerId);
  const { results } = await env.DB.prepare('SELECT item_id, due_at, task_hash FROM learner_srs WHERE learner_id = ?1')
    .bind(learnerId).all<{ item_id: string; due_at: number; task_hash: string }>();
  const scheduled = new Map((results ?? []).map((row) => [row.item_id, row]));
  const items = [];
  for (const row of published) for (const task of row.tasks) {
    if (task.kind !== 'quiz') continue;
    const itemId = homeworkItemId(row.sessionId, task.id);
    if (selected !== undefined && selected !== itemId) continue;
    const state = scheduled.get(itemId);
    // A new question/key is fresh practice. Editing unrelated homework preserves progress.
    if (selected === undefined && state && state.due_at > Date.now() && state.task_hash === await sha256Hex(canonicalJson(task))) continue;
    items.push(quizCard(row.sessionId, row.revision, task));
  }
  return items;
}

export async function learnerPracticeGet(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireContextLink(request, env);
  if (!guard.ok) return guard.response;
  const selected = new URL(request.url).searchParams.get('itemId') ?? undefined;
  return json({ items: await practiceItems(env, guard.link.contextId, guard.link.learnerId, selected) });
}

interface PracticeAttemptRow {
  id: string; learner_id: string; context_id: string; item_id: string; task_json: string;
  answer_json: string; grade: string; assignment_revision: number;
}

export async function learnerPracticePost(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireContextLink(request, env);
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
    const remaining = (await practiceItems(env, guard.link.contextId, guard.link.learnerId)).filter((item) => item.itemId !== itemId);
    return json({ attemptId, ...(remaining.length ? { item: remaining[0] } : { done: true }) });
  };
  const prior = await env.DB.prepare(`SELECT a.id, a.learner_id, a.context_id, a.item_id, a.task_json, a.answer_json, a.grade, a.assignment_revision
    FROM learner_practice_attempts a JOIN sessions s ON s.id = a.session_id AND s.context_id = a.context_id AND s.deleted_at IS NULL WHERE a.id = ?1`).bind(attemptId).first<PracticeAttemptRow>();
  if (prior) {
    // A lost response can be retried even after the assignment changes. It never grades twice.
    if (prior.learner_id !== guard.link.learnerId || prior.context_id !== guard.link.contextId || prior.item_id !== itemId || prior.assignment_revision !== body.assignmentRevision || prior.grade !== grade) return json({ error: 'attempt-conflict' }, 409);
    const original = publishedHomeworkOf([parseJson(prior.task_json, null)])[0];
    const answer = original?.kind === 'quiz' ? parseHomeworkPracticeAnswer(original.interaction, body.answer) : null;
    return answer && canonicalJson(answer) === prior.answer_json ? receipt() : json({ error: 'attempt-conflict' }, 409);
  }
  const published = await publishedForContext(env, guard.link.contextId, guard.link.learnerId);
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
  const existing = await env.DB.prepare(`SELECT task_hash, version, ease, interval_days, reps, lapses, due_at, last_grade, last_answer
    FROM learner_srs WHERE learner_id = ?1 AND item_id = ?2`).bind(guard.link.learnerId, itemId).first<SrsRow>();
  const previousVersion = existing?.version ?? 0;
  const next = gradeSrs(existing?.task_hash === taskHash ? asSrsState(existing) : newSrsState(now), grade as SrsGrade, now);
  // The record revision covers content and recipients. Compare it at the actual write,
  // together with the SRS version, then commit the immutable attempt and scheduling state atomically.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO learner_practice_attempts
      (id, learner_id, context_id, session_id, item_id, task_json, task_hash, answer_json, grade, assessment, assignment_revision, srs_version, created_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12 + 1, ?13
      FROM session_records rec JOIN sessions s ON s.id = rec.session_id
      WHERE rec.session_id = ?4 AND rec.homework_revision = ?11 AND s.context_id = ?3 AND s.deleted_at IS NULL AND s.status <> 'draft'
        AND COALESCE((SELECT version FROM learner_srs WHERE learner_id = ?2 AND item_id = ?5), 0) = ?12
      ON CONFLICT(id) DO NOTHING`).bind(attemptId, guard.link.learnerId, guard.link.contextId, parsed.sessionId, itemId, taskJson, taskHash, answerJson, grade, assessment, session.revision, previousVersion, now),
    env.DB.prepare(`INSERT INTO learner_srs
      (learner_id, context_id, item_id, task_hash, version, last_attempt_id, ease, interval_days, reps, lapses, due_at, last_grade, last_answer, updated_at)
      SELECT learner_id, context_id, item_id, task_hash, srs_version, id, ?2, ?3, ?4, ?5, ?6, grade, answer_json, created_at
      FROM learner_practice_attempts WHERE id = ?1 AND learner_id = ?8 AND answer_json = ?9 AND grade = ?10
        AND assignment_revision = ?11 AND srs_version = ?7 + 1 AND item_id = ?12 AND task_hash = ?13 AND context_id = ?14
      ON CONFLICT(learner_id, item_id) DO UPDATE SET task_hash = excluded.task_hash, version = excluded.version,
        last_attempt_id = excluded.last_attempt_id, ease = excluded.ease, interval_days = excluded.interval_days,
        reps = excluded.reps, lapses = excluded.lapses, due_at = excluded.due_at, last_grade = excluded.last_grade,
        last_answer = excluded.last_answer, updated_at = excluded.updated_at
      WHERE learner_srs.version = ?7`).bind(attemptId, next.ease, next.intervalDays, next.reps, next.lapses, next.dueAt, previousVersion, guard.link.learnerId, answerJson, grade, session.revision, itemId, taskHash, guard.link.contextId),
  ]);
  const saved = await env.DB.prepare(`SELECT id FROM learner_practice_attempts WHERE id = ?1 AND learner_id = ?2
    AND context_id = ?3 AND item_id = ?4 AND answer_json = ?5 AND grade = ?6 AND assignment_revision = ?7`)
    .bind(attemptId, guard.link.learnerId, guard.link.contextId, itemId, answerJson, grade, session.revision).first();
  return saved ? receipt() : json({ error: 'practice-conflict' }, 409);
}

export async function learnerWritingPut(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireContextLink(request, env);
  if (!guard.ok) return guard.response;
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  const taskId = typeof body.taskId === 'string' ? body.taskId : '';
  const text = typeof body.body === 'string' ? body.body : '';
  if (!text.trim()) return json({ error: 'writing-empty' }, 422);
  if (sessionId === '' || taskId === '') return json({ error: 'not-found' }, 404);
  if (text.length > WRITING_BODY_MAX) return json({ error: 'writing-too-long' }, 422);

  const published = await publishedForContext(env, guard.link.contextId, guard.link.learnerId);
  const session = published.find((row) => row.sessionId === sessionId);
  const task = session?.tasks.find((candidate) => candidate.id === taskId);
  if (session === undefined || task === undefined || task.kind !== 'writing') {
    return json({ error: 'not-found' }, 404);
  }
  if (body.assignmentRevision !== session.revision) return json({ error: 'assignment-revised' }, 409);
  const submissionId = typeof body.submissionId === 'string' ? body.submissionId : crypto.randomUUID();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(submissionId)) return json({ error: 'invalid-submission-id' }, 422);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO learner_submissions (id, learner_id, context_id, session_id, task_id, body, task_json, assignment_revision, created_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
       FROM session_records rec JOIN sessions s ON s.id = rec.session_id
      WHERE rec.session_id = ?4 AND rec.homework_revision = ?8
        AND s.context_id = ?3 AND s.deleted_at IS NULL AND s.status <> 'draft'
     ON CONFLICT(id) DO NOTHING`,
  )
    .bind(submissionId, guard.link.learnerId, guard.link.contextId, sessionId, taskId, text, JSON.stringify(task), session.revision, now)
    .run();
  const saved = await env.DB.prepare('SELECT id FROM learner_submissions WHERE id = ?1 AND learner_id = ?2 AND session_id = ?3 AND task_id = ?4 AND body = ?5 AND assignment_revision = ?6')
    .bind(submissionId, guard.link.learnerId, sessionId, taskId, text, session.revision).first();
  if (!saved) return json({ error: 'submission-conflict' }, 409);
  return json({ ok: true, submissionId });
}

export async function submissionsForLearner(
  env: ControlEnv,
  learnerId: string,
): Promise<Map<string, { body: string; audio?: { submissionId: string; durationMs: number; available: boolean; recoverable: boolean } }>> {
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.session_id, w.task_id, w.body, a.duration_ms, a.object_key, a.expires_at, a.removed_at
     FROM learner_submissions w LEFT JOIN learner_audio a ON a.submission_id = w.id
     WHERE w.learner_id = ?1 ORDER BY w.rowid DESC`,
  )
    .bind(learnerId)
    .all<WritingRow & { id: string; duration_ms: number | null; object_key: string | null; expires_at: number | null; removed_at: number | null }>();
  const map = new Map<string, { body: string; audio?: { submissionId: string; durationMs: number; available: boolean; recoverable: boolean } }>();
  for (const row of results ?? []) if (!map.has(`${row.session_id}:${row.task_id}`)) map.set(`${row.session_id}:${row.task_id}`, {
    body: row.body,
    ...(row.duration_ms === null ? {} : { audio: { submissionId: row.id, durationMs: row.duration_ms, available: Boolean(row.object_key && row.expires_at && row.expires_at > Date.now() && row.removed_at === null), recoverable: Boolean(row.object_key && row.expires_at && row.expires_at > Date.now() && row.removed_at !== null && row.removed_at > Date.now() - VOICE_TRASH_DAYS * 86_400_000) } }),
  });
  return map;
}

export async function contextReturnedRoute(
  request: Request,
  env: ControlEnv,
  contextId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, false);
  if (!guard.ok) return guard.response;
  const row = await env.DB.prepare(
    `SELECT c.space_id AS space_id, c.next_note AS next_note
       FROM contexts c
       JOIN space_members m ON m.space_id = c.space_id AND m.user_id = ?2
      WHERE c.id = ?1`,
  )
    .bind(contextId, guard.user.id)
    .first<{ space_id: string; next_note: string }>();
  if (row === null) return json({ error: 'not-found' }, 404);
  const access = await spaceRole(env, guard.user as SessionUser, row.space_id);
  if (access === null || !roleAtLeast(access.role, 'editor')) {
    return json({ error: 'forbidden' }, 403);
  }
  const blocked = await requireContextContinuity(env, contextId);
  if (blocked) return blocked;

  const { results: writings } = await env.DB.prepare(
    `SELECT w.session_id AS session_id, w.task_id AS task_id, w.body AS body, w.task_json, w.learner_id, person.display_name
       FROM learner_submissions w
       JOIN context_learners person ON person.id = w.learner_id AND person.context_id = w.context_id
      WHERE w.context_id = ?1 AND json_extract(w.task_json, '$.kind') = 'writing' AND NOT EXISTS (
        SELECT 1 FROM learner_submissions newer WHERE newer.learner_id = w.learner_id
          AND newer.session_id = w.session_id AND newer.task_id = w.task_id AND newer.rowid > w.rowid)
        AND EXISTS (SELECT 1 FROM sessions s WHERE s.id = w.session_id AND s.context_id = w.context_id AND s.deleted_at IS NULL)`,
  )
    .bind(contextId)
    .all<WritingRow>();

  const writing = (writings ?? []).map((item) => {
    const task = publishedHomeworkOf([parseJson(item.task_json ?? 'null', null)])[0];
    const title =
      task?.kind === 'writing'
        ? (task.title ?? task.prompt)
        : task?.kind === 'reading'
          ? (task.title ?? task.body)
          : task?.title;
    return {
      learnerId: item.learner_id,
      displayName: item.display_name,
      sessionId: item.session_id,
      taskId: item.task_id,
      ...(title !== undefined ? { title } : {}),
      body: item.body,
    };
  });

  const { results: missedRows } = await env.DB.prepare(
    `SELECT s.item_id, s.last_answer, s.learner_id, a.task_json, person.display_name FROM learner_srs s
       JOIN learner_practice_attempts a ON a.id = s.last_attempt_id
       JOIN sessions lesson ON lesson.id = a.session_id AND lesson.context_id = a.context_id AND lesson.deleted_at IS NULL
       JOIN context_learners person ON person.id = s.learner_id AND person.context_id = s.context_id
      WHERE s.context_id = ?1 AND s.last_grade = 'again'`,
  )
    .bind(contextId)
    .all<{ item_id: string; last_answer: string | null; learner_id: string; display_name: string; task_json: string }>();

  const missed = (missedRows ?? []).flatMap((item) => {
    const task = publishedHomeworkOf([parseJson(item.task_json, null)])[0];
    if (task === undefined || task.kind !== 'quiz') return [];
    const lastAnswer = parseHomeworkPracticeAnswer(task.interaction, parseJson(item.last_answer ?? 'null', null));
    if (!lastAnswer) return [];
    return [
      {
        learnerId: item.learner_id,
        displayName: item.display_name,
        itemId: item.item_id,
        exercise: { ...(task.title === undefined ? {} : { title: task.title }), interaction: task.interaction },
        lastAnswer,
      },
    ];
  });

  const { results: feedbackRows } = await env.DB.prepare(`SELECT w.id, w.learner_id, person.display_name, f.published_json
    FROM learner_submissions w JOIN learner_feedback f ON f.submission_id = w.id AND f.published_json IS NOT NULL
    JOIN context_learners person ON person.id = w.learner_id AND person.context_id = w.context_id
    JOIN sessions s ON s.id = w.session_id AND s.context_id = w.context_id AND s.deleted_at IS NULL
    WHERE w.context_id = ?1 ORDER BY w.rowid DESC LIMIT 50`).bind(contextId)
    .all<{ id: string; learner_id: string; display_name: string; published_json: string }>();
  const corrections = (feedbackRows ?? []).flatMap((item) => {
    const feedback = parseLearnerFeedback(parseJson(item.published_json, null));
    return (feedback?.corrections ?? []).map((correction, index) => ({ id: `${item.id}:${index}`, learnerId: item.learner_id, displayName: item.display_name, ...correction }));
  });
  return json({
    nextNote: row.next_note ?? '',
    writing,
    missed,
    corrections,
  });
}
