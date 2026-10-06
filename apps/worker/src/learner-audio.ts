import { VOICE_MAX_RECORDINGS_PER_TASK, VOICE_RETENTION_DAYS, VOICE_TRASH_DAYS, VOICE_WAV_MAX_BYTES, voiceWavDuration } from '@openroom/schema';
import { json, type ControlEnv } from './auth.js';
import { requireContextLink } from './context-links.js';
import { publishedForContext } from './learner-practice.js';

interface AudioRow { submission_id: string; object_key: string | null; sha256: string; byte_length: number; duration_ms: number; expires_at: number; removed_at: number | null }

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
  const guard = await requireContextLink(request, env);
  if (!guard.ok) return guard.response;
  const sessionId = url.searchParams.get('sessionId') ?? '';
  const taskId = url.searchParams.get('taskId') ?? '';
  const submissionId = url.searchParams.get('submissionId') ?? '';
  const revision = Number(url.searchParams.get('assignmentRevision'));
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(submissionId) || !Number.isSafeInteger(revision) || revision < 1) return json({ error: 'invalid-submission' }, 422);
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'audio/wav') return json({ error: 'unsupported-audio' }, 415);
  const published = await publishedForContext(env, guard.link.contextId, guard.link.learnerId);
  const session = published.find((row) => row.sessionId === sessionId);
  const task = session?.tasks.find((row) => row.id === taskId && row.kind === 'voice');
  if (!session || !task) return json({ error: 'not-found' }, 404);
  if (revision !== session.revision) return json({ error: 'assignment-revised' }, 409);
  const bytes = await readBoundedAudio(request);
  if (!bytes) return json({ error: 'audio-too-large' }, 413);
  const durationMs = voiceWavDuration(bytes);
  if (durationMs === null) return json({ error: 'invalid-audio' }, 422);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const prior = await env.DB.prepare(`SELECT a.* FROM learner_audio a JOIN learner_submissions w ON w.id = a.submission_id
    WHERE w.id = ?1 AND w.learner_id = ?2 AND w.context_id = ?3 AND w.session_id = ?4 AND w.task_id = ?5 AND w.assignment_revision = ?6`)
    .bind(submissionId, guard.link.learnerId, guard.link.contextId, sessionId, taskId, revision).first<AudioRow>();
  if (prior) {
    if (!prior.object_key || prior.removed_at !== null || prior.expires_at <= Date.now()) return json({ error: 'recording-unavailable' }, 410);
    if (prior.sha256 !== hash) return json({ error: 'submission-conflict' }, 409);
    return json({ ok: true, submissionId, durationMs: prior.duration_ms });
  }
  const now = Date.now();
  const retained = await env.DB.prepare(`SELECT COUNT(*) AS total FROM learner_audio a JOIN learner_submissions w ON w.id = a.submission_id
    WHERE w.learner_id = ?1 AND w.session_id = ?2 AND w.task_id = ?3 AND a.object_key IS NOT NULL AND a.expires_at > ?4`)
    .bind(guard.link.learnerId, sessionId, taskId, now).first<{ total: number }>();
  if ((retained?.total ?? 0) >= VOICE_MAX_RECORDINGS_PER_TASK) return json({ error: 'recording-limit' }, 429);
  const key = `learner-audio/${crypto.randomUUID()}`;
  const taskJson = JSON.stringify(task);
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: 'audio/wav' } });
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO learner_submissions (id, learner_id, context_id, session_id, task_id, task_json, assignment_revision, body, created_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, '', ?8 FROM session_records rec JOIN sessions s ON s.id = rec.session_id
        WHERE rec.session_id = ?4 AND rec.homework_revision = ?7 AND s.context_id = ?3 AND s.deleted_at IS NULL AND s.status <> 'draft'
        AND (SELECT COUNT(*) FROM learner_audio a JOIN learner_submissions w ON w.id = a.submission_id
          WHERE w.learner_id = ?2 AND w.session_id = ?4 AND w.task_id = ?5 AND a.object_key IS NOT NULL AND a.expires_at > ?8) < ?9
        ON CONFLICT(id) DO NOTHING`).bind(submissionId, guard.link.learnerId, guard.link.contextId, sessionId, taskId, taskJson, revision, now, VOICE_MAX_RECORDINGS_PER_TASK),
      env.DB.prepare(`INSERT INTO learner_audio (submission_id, object_key, sha256, byte_length, duration_ms, expires_at)
        SELECT id, ?2, ?3, ?4, ?5, ?6 FROM learner_submissions
        WHERE id = ?1 AND learner_id = ?7 AND context_id = ?8 AND session_id = ?9 AND task_id = ?10 AND assignment_revision = ?11 AND task_json = ?12 AND body = ''
        ON CONFLICT(submission_id) DO NOTHING`).bind(submissionId, key, hash, bytes.length, durationMs, now + VOICE_RETENTION_DAYS * 86_400_000, guard.link.learnerId, guard.link.contextId, sessionId, taskId, revision, taskJson),
    ]);
    if ((results[1]?.meta.changes ?? 0) > 0) return json({ ok: true, submissionId, durationMs });
    await env.MEDIA.delete(key);
    const stored = await env.DB.prepare(`SELECT a.object_key, a.sha256 FROM learner_audio a JOIN learner_submissions w ON w.id = a.submission_id
      WHERE w.id = ?1 AND w.learner_id = ?2 AND w.context_id = ?3 AND w.session_id = ?4 AND w.task_id = ?5 AND w.assignment_revision = ?6`)
      .bind(submissionId, guard.link.learnerId, guard.link.contextId, sessionId, taskId, revision).first<{ object_key: string | null; sha256: string }>();
    if (!stored?.object_key || stored.sha256 !== hash) return json({ error: 'submission-conflict' }, 409);
    return json({ ok: true, submissionId, durationMs });
  } catch (error) { await env.MEDIA.delete(key); throw error; }
}

/** Caller must already prove ownership of this submission. No public media URL exists. */
export async function privateAudioResponse(request: Request, env: ControlEnv, submissionId: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT submission_id, object_key, sha256, byte_length, duration_ms, expires_at, removed_at FROM learner_audio WHERE submission_id = ?1').bind(submissionId).first<AudioRow>();
  if (!row) return json({ error: 'not-found' }, 404);
  const now = Date.now();
  if (request.method === 'DELETE') {
    await env.DB.prepare('UPDATE learner_audio SET removed_at = COALESCE(removed_at, ?2) WHERE submission_id = ?1').bind(submissionId, now).run();
    return json({ ok: true });
  }
  if (request.method === 'PATCH') {
    const restored = await env.DB.prepare(`UPDATE learner_audio SET removed_at = NULL
      WHERE submission_id = ?1 AND object_key IS NOT NULL AND expires_at > ?2
        AND (removed_at IS NULL OR removed_at > ?3)`).bind(submissionId, now, now - VOICE_TRASH_DAYS * 86_400_000).run();
    return restored.meta.changes ? json({ ok: true }) : json({ error: 'recording-unavailable' }, 410);
  }
  if (!row.object_key || row.removed_at !== null || row.expires_at <= now) return json({ error: 'recording-unavailable' }, 410);
  const rangeHeader = request.headers.get('range');
  let range: { offset: number; length: number } | undefined;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${row.byte_length}`, 'cache-control': 'no-store' } });
    const start = match[1] ? Number(match[1]) : Math.max(0, row.byte_length - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(row.byte_length - 1, Number(match[2])) : row.byte_length - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= row.byte_length) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${row.byte_length}`, 'cache-control': 'no-store' } });
    range = { offset: start, length: end - start + 1 };
  }
  const object = await env.MEDIA.get(row.object_key, range ? { range } : undefined);
  if (!object) return json({ error: 'recording-unavailable' }, 410);
  const headers = new Headers({ 'content-type': 'audio/wav', 'content-length': String(range?.length ?? row.byte_length),
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes',
    'content-security-policy': "default-src 'none'; sandbox", 'referrer-policy': 'no-referrer' });
  if (range) headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${row.byte_length}`);
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

export async function learnerAudioRoute(request: Request, env: ControlEnv, submissionId: string): Promise<Response> {
  const guard = await requireContextLink(request, env);
  if (!guard.ok) return guard.response;
  const owned = await env.DB.prepare(`SELECT w.id FROM learner_submissions w
    JOIN sessions s ON s.id = w.session_id AND s.context_id = w.context_id AND s.deleted_at IS NULL AND s.status <> 'draft'
    WHERE w.id = ?1 AND w.learner_id = ?2 AND w.context_id = ?3`).bind(submissionId, guard.link.learnerId, guard.link.contextId).first();
  if (!owned) return json({ error: 'not-found' }, 404);
  return privateAudioResponse(request, env, submissionId);
}

export async function expireLearnerAudio(env: ControlEnv, now = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare('SELECT submission_id, object_key FROM learner_audio WHERE (expires_at <= ?1 OR removed_at <= ?2) AND object_key IS NOT NULL LIMIT 100')
    .bind(now, now - VOICE_TRASH_DAYS * 86_400_000).all<{ submission_id: string; object_key: string }>();
  for (const row of results ?? []) {
    await env.MEDIA.delete(row.object_key);
    await env.DB.prepare('UPDATE learner_audio SET object_key = NULL WHERE submission_id = ?1 AND object_key = ?2').bind(row.submission_id, row.object_key).run();
  }
  return results?.length ?? 0;
}

/** Delete bytes before the control-plane purge removes their only index. */
export async function purgeLearnerAudio(env: ControlEnv, scope: 'context_id' | 'session_id', id: string): Promise<void> {
  const { results } = await env.DB.prepare(`SELECT a.submission_id, a.object_key FROM learner_audio a JOIN learner_submissions w ON w.id = a.submission_id WHERE w.${scope} = ?1`)
    .bind(id).all<{ submission_id: string; object_key: string | null }>();
  for (const row of results ?? []) {
    if (row.object_key) await env.MEDIA.delete(row.object_key);
    await env.DB.prepare('DELETE FROM learner_audio WHERE submission_id = ?1').bind(row.submission_id).run();
  }
}
