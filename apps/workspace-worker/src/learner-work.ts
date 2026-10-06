import { VOICE_TRASH_DAYS, parseLearnerFeedback, publishedHomeworkOf } from '@openroom/schema';
import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { parseJson, readJson } from './control-utils.js';
import { requireContextLink } from './context-links.js';
import { roleAtLeast, spaceRole } from './members.js';
import { privateAudioResponse } from './learner-audio.js';
import { requireContextContinuity } from './continuity-access.js';

interface WorkRow {
  id: string; learner_id: string; display_name: string; session_id: string;
  task_id: string; task_json: string; body: string; assignment_revision: number;
  draft_json: string | null; published_json: string | null; version: number | null;
  duration_ms: number | null; object_key: string | null; expires_at: number | null; removed_at: number | null;
}

const WORK_COLUMNS = `w.id, w.learner_id, person.display_name, w.session_id, w.task_id,
  w.task_json, w.body, w.assignment_revision, f.draft_json, f.published_json, f.version,
  a.duration_ms, a.object_key, a.expires_at, a.removed_at`;
const WORK_JOIN = `FROM learner_submissions w
  JOIN context_learners person ON person.id = w.learner_id AND person.context_id = w.context_id
  JOIN sessions s ON s.id = w.session_id AND s.context_id = w.context_id AND s.deleted_at IS NULL AND s.status <> 'draft'
  LEFT JOIN learner_feedback f ON f.submission_id = w.id
  LEFT JOIN learner_audio a ON a.submission_id = w.id`;

export function audioJson(row: { duration_ms: number | null; object_key: string | null; expires_at: number | null; removed_at: number | null }) {
  if (row.duration_ms === null) return undefined;
  const retained = Boolean(row.object_key && row.expires_at && row.expires_at > Date.now());
  return { durationMs: row.duration_ms, available: retained && row.removed_at === null,
    recoverable: retained && row.removed_at !== null && row.removed_at > Date.now() - VOICE_TRASH_DAYS * 86_400_000 };
}

function workJson(row: WorkRow) {
  return {
    id: row.id, learnerId: row.learner_id, displayName: row.display_name,
    sessionId: row.session_id, taskId: row.task_id,
    task: publishedHomeworkOf([parseJson(row.task_json, null)])[0],
    body: row.body, assignmentRevision: row.assignment_revision,
    audio: audioJson(row),
  };
}

/** All tutor review reads and writes require editor access to this context. */
export async function contextWorkRoute(request: Request, env: ControlEnv, contextId: string, submissionId?: string, leaf?: 'feedback' | 'audio'): Promise<Response> {
  const guard = await requireControlUser(request, env, request.method !== 'GET');
  if (!guard.ok) return guard.response;
  const context = await env.DB.prepare('SELECT space_id FROM contexts WHERE id = ?1 AND deleted_at IS NULL').bind(contextId).first<{ space_id: string }>();
  if (!context) return json({ error: 'not-found' }, 404);
  const access = await spaceRole(env, guard.user, context.space_id);
  if (!access) return json({ error: 'not-found' }, 404);
  if (!roleAtLeast(access.role, 'editor')) return json({ error: 'forbidden' }, 403);
  // Moving a recording to trash (DELETE) and restoring it (PATCH) are never paid.
  if (!(leaf === 'audio' && (request.method === 'DELETE' || request.method === 'PATCH'))) {
    const blocked = await requireContextContinuity(env, contextId);
    if (blocked) return blocked;
  }
  if (!submissionId) {
    if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
    const { results } = await env.DB.prepare(`SELECT ${WORK_COLUMNS} ${WORK_JOIN}
      WHERE w.context_id = ?1 AND NOT EXISTS (SELECT 1 FROM learner_submissions newer
        WHERE newer.learner_id = w.learner_id AND newer.session_id = w.session_id
          AND newer.task_id = w.task_id AND newer.rowid > w.rowid)
      ORDER BY person.display_name, w.rowid DESC`).bind(contextId).all<WorkRow>();
    return json({ work: (results ?? []).map(workJson) });
  }
  const row = await env.DB.prepare(`SELECT ${WORK_COLUMNS} ${WORK_JOIN} WHERE w.context_id = ?1 AND w.id = ?2`).bind(contextId, submissionId).first<WorkRow>();
  if (!row) return json({ error: 'not-found' }, 404);
  if (leaf === 'audio') {
    if (request.method !== 'GET' && request.method !== 'DELETE' && request.method !== 'PATCH') return json({ error: 'method-not-allowed' }, 405);
    return privateAudioResponse(request, env, submissionId);
  }
  if (leaf !== 'feedback') {
    if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
    const { results: earlier } = await env.DB.prepare(`SELECT ${WORK_COLUMNS} ${WORK_JOIN}
      WHERE w.learner_id = ?1 AND w.session_id = ?2 AND w.task_id = ?3 AND w.id <> ?4
      ORDER BY w.rowid DESC`).bind(row.learner_id, row.session_id, row.task_id, row.id).all<WorkRow>();
    return json({ work: workJson(row), earlier: (earlier ?? []).map(workJson),
      feedback: { draft: parseJson(row.draft_json ?? 'null', null), published: parseJson(row.published_json ?? 'null', null), version: row.version ?? 0 } });
  }
  if (request.method !== 'PUT') return json({ error: 'method-not-allowed' }, 405);
  const body = await readJson(request);
  const value = parseLearnerFeedback(body?.feedback);
  if (!value || (body?.action !== 'save' && body?.action !== 'publish') || !Number.isInteger(body.version) || Number(body.version) < 0) return json({ error: 'invalid-feedback' }, 422);
  if (body.action === 'publish' && !value.message.trim() && value.corrections.length === 0 && !value.audioComments?.length) return json({ error: 'empty-feedback' }, 422);
  if (value.audioComments?.some((note) => row.duration_ms === null || note.atMs > row.duration_ms)) return json({ error: 'invalid-audio-comment' }, 422);
  // A correction must point to this submitted text, not a later resubmission.
  if (value.corrections.some((correction) => !row.body.includes(correction.original))) return json({ error: 'correction-not-in-submission' }, 422);
  if (body.version !== (row.version ?? 0)) return json({ error: 'feedback-conflict' }, 409);
  const draft = JSON.stringify(value);
  const published = body.action === 'publish' ? draft : row.published_json;
  const version = Number(body.version) + 1;
  const saved = await env.DB.prepare(`INSERT INTO learner_feedback (submission_id, draft_json, published_json, version, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(submission_id) DO UPDATE SET draft_json = excluded.draft_json,
      published_json = excluded.published_json, version = excluded.version, updated_at = excluded.updated_at
    WHERE learner_feedback.version = ?6`).bind(submissionId, draft, published, version, Date.now(), body.version).run();
  if (!saved.meta.changes) return json({ error: 'feedback-conflict' }, 409);
  return json({ ok: true, version, published: parseJson(published ?? 'null', null) });
}

/** The learner projection never selects a draft or another learner's response. */
export async function learnerFeedbackRoute(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireContextLink(request, env);
  if (!guard.ok) return guard.response;
  const { results } = await env.DB.prepare(`SELECT w.id, w.task_json, w.body, f.published_json, a.duration_ms, a.object_key, a.expires_at, a.removed_at
    FROM learner_submissions w
    JOIN sessions s ON s.id = w.session_id AND s.context_id = w.context_id AND s.deleted_at IS NULL AND s.status <> 'draft'
    JOIN learner_feedback f ON f.submission_id = w.id AND f.published_json IS NOT NULL
    LEFT JOIN learner_audio a ON a.submission_id = w.id
    WHERE w.learner_id = ?1 AND w.context_id = ?2 ORDER BY w.rowid DESC`)
    .bind(guard.link.learnerId, guard.link.contextId).all<{ id: string; task_json: string; body: string; published_json: string; duration_ms: number | null; object_key: string | null; expires_at: number | null; removed_at: number | null }>();
  return json({ feedback: (results ?? []).map((row) => ({ submissionId: row.id,
    task: publishedHomeworkOf([parseJson(row.task_json, null)])[0], body: row.body,
    audio: audioJson(row),
    feedback: parseLearnerFeedback(parseJson(row.published_json, null)),
  })) });
}
