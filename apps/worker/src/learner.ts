/**
 * `/api/learner/*` — the learner capability plane.
 *
 * Reads are the curated record. Writes (practice grades, writing) are keyed by
 * the stable context-local learner id, never a users row or credential id.
 *
 * Authenticated ONLY by a context access link (`Authorization: Bearer orlnk_…`,
 * see context-links.ts). Every route here serves exactly one context's
 * learner-visible records; nothing folder-, template-, deck-, space-, or
 * user-scoped is reachable, by construction rather than by filtering.
 *
 * Everything else in the tutoring control plane joins `space_members` to decide
 * what a caller may read. These routes cannot: the caller has no user row at
 * all. The equivalent discipline is that the context id comes from the verified
 * credential and is never read from the request — no path parameter, no query
 * string, no body field. A caller therefore has no vocabulary in which to ask
 * for someone else's context, which is why context B returns 401/empty by
 * absence of a request shape rather than by an access check that could be
 * mis-ordered later.
 *
 * The same discipline covers the per-client throttle: it sits inside
 * `requireContextLink` (learner-rate-limit.ts), so every route here and every
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
 *   template is tutor IP and is shared across contexts.
 * - `sessions.space_id`, `folder_id` — filing structure of someone else's workspace.
 * - `sessions.created_by` — the tutor's user id.
 * - `sessions.metadata_json` — free-form tutor metadata with no learner contract.
 * - draft sessions and trashed sessions — unpublished tutor planning.
 */

import { json, type ControlEnv } from './auth.js';
import { parseJson } from './control-utils.js';
import { requireContextLink } from './context-links.js';
import {
  learnerPracticeGet,
  learnerPracticePost,
  learnerWritingPut,
  submissionsForLearner,
} from './learner-practice.js';
import { homeworkForLearner, publishedHomeworkOf } from '@openroom/schema';
import { learnerFeedbackRoute } from './learner-work.js';
import { learnerAudioRoute, learnerVoiceUpload } from './learner-audio.js';

interface LearnerSessionRow {
  id: string;
  title: string;
  status: string;
  outcomes_json: string | null;
  homework_json: string | null;
  homework_revision: number | null;
  homework_audience_json: string | null;
  artifacts_json: string | null;
}

function jsonArray(value: string | null): unknown[] {
  if (value === null) return [];
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

/** GET /api/learner/me */
export async function learnerMeRoute(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireContextLink(request, env);
  if (!guard.ok) return guard.response;
  return json({ contextId: guard.link.contextId, displayName: guard.link.displayName });
}

/** GET /api/learner/sessions */
export async function learnerSessionsRoute(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireContextLink(request, env);
  if (!guard.ok) return guard.response;

  // Column list is an allowlist, not a `SELECT *` with deletions afterwards:
  // a future column added to `sessions` or `session_records` must be opted in here
  // explicitly rather than leaking the moment the migration lands.
  const { results } = await env.DB.prepare(
    `SELECT r.id AS id, r.title AS title, r.status AS status,
            rec.outcomes_json AS outcomes_json, rec.homework_json AS homework_json, rec.homework_revision, rec.homework_audience_json,
            rec.artifacts_json AS artifacts_json
       FROM sessions r
       LEFT JOIN session_records rec ON rec.session_id = r.id
      WHERE r.context_id = ?1
        AND r.deleted_at IS NULL
        AND r.status <> 'draft'
      ORDER BY r.created_at DESC
      LIMIT 200`,
  )
    .bind(guard.link.contextId)
    .all<LearnerSessionRow>();

  const submissions = await submissionsForLearner(env, guard.link.learnerId);
  return json({
    sessions: (results ?? []).map((row) => {
      const homework = homeworkForLearner(publishedHomeworkOf(parseJson(row.homework_json ?? '[]', [])), parseJson(row.homework_audience_json ?? '{}', null), guard.link.learnerId);
      const withWriting = homework.map((task) => {
        if (task.kind !== 'writing' && task.kind !== 'voice') return { ...task, assignmentRevision: row.homework_revision };
        const submitted = submissions.get(`${row.id}:${task.id}`);
        return { ...task, assignmentRevision: row.homework_revision,
          ...(submitted === undefined ? {} : task.kind === 'voice' ? { audio: submitted.audio } : { submitted: submitted.body }) };
      });
      return {
        id: row.id,
        title: row.title,
        status: row.status,
        ...(row.outcomes_json === null && row.homework_json === null && row.artifacts_json === null
          ? {}
          : {
              record: {
                outcomes: jsonArray(row.outcomes_json),
                homework: withWriting,
                artifacts: jsonArray(row.artifacts_json),
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
