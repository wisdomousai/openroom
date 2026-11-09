/**
 * `/api/learner/*` — the learner capability plane.
 *
 * Reads are the curated record. Writes (practice grades, writing) are keyed by
 * the stable student-local learner id, never a users row or credential id.
 *
 * Authenticated ONLY by a student access link (`Authorization: Bearer orlnk_…`,
 * see student-links.ts). Every route here serves exactly one student's
 * learner-visible records; nothing folder-, template-, deck-, space-, or
 * user-scoped is reachable, by construction rather than by filtering.
 *
 * Everything else in the tutoring control plane joins `space_members` to decide
 * what a caller may read. These routes cannot: the caller has no user row at
 * all. The equivalent discipline is that the student id comes from the verified
 * credential and is never read from the request — no path parameter, no query
 * string, no body field. A caller therefore has no vocabulary in which to ask
 * for someone else's student, which is why student B returns 401/empty by
 * absence of a request shape rather than by an access check that could be
 * mis-ordered later.
 *
 * The same discipline covers the per-client throttle: it sits inside
 * `requireStudentLink` (learner-rate-limit.ts), so every route here and every
 * route added later is budgeted by construction rather than by remembering to
 * call it. Over budget is `429 learner-rate-limited`, reached identically for an
 * absent, malformed, unknown, expired or revoked credential.
 *
 * ## What is deliberately withheld from every learner response
 *
 * - `session_records.notes` — tutor-private assessment prose. Never selected.
 * - `session_records.session_code` — a live-session join code. Handing a past session code
 *   to a link holder would turn a records credential into a session credential.
 * - `sessions.deck_id` / `deck_version`, `session_records.deck_version` — the
 *   template is tutor IP and is shared across students.
 * - `sessions.space_id`, `folder_id` — filing structure of someone else's workspace.
 * - `sessions.created_by` — the tutor's user id.
 * - `sessions.metadata_json` — free-form tutor metadata with no learner contract.
 * - draft sessions and trashed sessions — unpublished tutor planning.
 */

import { and, desc, eq, isNull, ne } from 'drizzle-orm';

import { json, type ControlEnv } from './auth.js';
import { parseJson } from './control-utils.js';
import { orm } from './db/client.js';
import { sessionRecords, sessions } from './db/schema.js';
import { requireStudentLink } from './student-links.js';
import {
  learnerPracticeGet,
  learnerPracticePost,
  learnerWritingPut,
  submissionsForLearner,
} from './learner-practice.js';
import { homeworkForLearner, publishedHomeworkOf } from '@openroom/schema';
import { learnerFeedbackRoute } from './learner-work.js';
import { learnerAudioRoute, learnerVoiceUpload } from './learner-audio.js';

function jsonArray(value: string | null): unknown[] {
  if (value === null) return [];
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

/** GET /api/learner/me */
export async function learnerMeRoute(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireStudentLink(request, env);
  if (!guard.ok) return guard.response;
  return json({ studentId: guard.link.studentId, displayName: guard.link.displayName });
}

/** GET /api/learner/sessions */
export async function learnerSessionsRoute(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireStudentLink(request, env);
  if (!guard.ok) return guard.response;

  // Column list is an allowlist, not a `SELECT *` with deletions afterwards:
  // a future column added to `sessions` or `session_records` must be opted in here
  // explicitly rather than leaking the moment the migration lands.
  const results = await orm(env)
    .select({
      id: sessions.id,
      title: sessions.title,
      status: sessions.status,
      outcomesJson: sessionRecords.outcomesJson,
      homeworkJson: sessionRecords.homeworkJson,
      homeworkRevision: sessionRecords.homeworkRevision,
      homeworkAudienceJson: sessionRecords.homeworkAudienceJson,
      artifactsJson: sessionRecords.artifactsJson,
    })
    .from(sessions)
    .leftJoin(sessionRecords, eq(sessionRecords.sessionId, sessions.id))
    .where(and(eq(sessions.studentId, guard.link.studentId), isNull(sessions.deletedAt), ne(sessions.status, 'draft')))
    .orderBy(desc(sessions.createdAt))
    .limit(200);

  const submissions = await submissionsForLearner(env, guard.link.learnerId);
  return json({
    sessions: results.map((row) => {
      const homework = homeworkForLearner(publishedHomeworkOf(parseJson(row.homeworkJson ?? '[]', [])), parseJson(row.homeworkAudienceJson ?? '{}', null), guard.link.learnerId);
      const withWriting = homework.map((task) => {
        if (task.kind !== 'writing' && task.kind !== 'voice') return { ...task, assignmentRevision: row.homeworkRevision };
        const submitted = submissions.get(`${row.id}:${task.id}`);
        return { ...task, assignmentRevision: row.homeworkRevision,
          ...(submitted === undefined ? {} : task.kind === 'voice' ? { audio: submitted.audio } : { submitted: submitted.body }) };
      });
      return {
        id: row.id,
        title: row.title,
        status: row.status,
        ...(row.outcomesJson === null && row.homeworkJson === null && row.artifactsJson === null
          ? {}
          : {
              record: {
                outcomes: jsonArray(row.outcomesJson),
                homework: withWriting,
                artifacts: jsonArray(row.artifactsJson),
              },
            }),
      };
    }),
  });
}

/** Router for `/api/learner/*`; returns null when the path is not ours. */
export async function handleLearnerApi(
  request: Request,
  env: ControlEnv,
  url: URL,
): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith('/api/learner/')) return null;
  if (path === '/api/learner/me') {
    if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
    return learnerMeRoute(request, env);
  }
  if (path === '/api/learner/sessions') {
    if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
    return learnerSessionsRoute(request, env);
  }
  if (path === '/api/learner/practice') {
    if (request.method === 'GET') return learnerPracticeGet(request, env);
    if (request.method === 'POST') return learnerPracticePost(request, env);
    return json({ error: 'method-not-allowed' }, 405);
  }
  if (path === '/api/learner/writing') {
    if (request.method !== 'PUT') return json({ error: 'method-not-allowed' }, 405);
    return learnerWritingPut(request, env);
  }
  if (path === '/api/learner/feedback') {
    if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
    return learnerFeedbackRoute(request, env);
  }
  if (path === '/api/learner/voice') {
    if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
    return learnerVoiceUpload(request, env, url);
  }
  const audio = /^\/api\/learner\/submissions\/([^/]+)\/audio$/.exec(path);
  if (audio) {
    if (request.method !== 'GET' && request.method !== 'DELETE' && request.method !== 'PATCH') return json({ error: 'method-not-allowed' }, 405);
    return learnerAudioRoute(request, env, decodeURIComponent(audio[1]!));
  }
  // An unknown /api/learner/* path must still not be authenticated by anything
  // else further down the router.
  return json({ error: 'not-found' }, 404);
}
