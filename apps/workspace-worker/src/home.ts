/**
 * `GET /api/my/home` — the one thing Home cannot derive from the lists it
 * already loads.
 *
 * Home builds "Next up" and "Recently touched" from `/api/sessions`,
 * `/api/decks` and `/api/tutoring/contexts`,
 * which it loads anyway. One zone needs a join those endpoints do not do:
 *
 *   * **Needs a record** — sessions that were delivered and never written up.
 *
 * It hangs off the `sessions` × `live_sessions` × `session_records` join, done here
 * once rather than as an N+1 of `/sessions/:id/record` calls from the browser.
 *
 * ## What "delivered" means here, and why it is not `sessions.status`
 *
 * The durable fact that a session *happened* is the existence of a `live_sessions`
 * row pointing at it, which is written by the launch path in D1. (`sessions.status`
 * does reach `ended` on a clean `session.end` — see `endSessionForCode` in
 * `delivery.ts` — but the DO's idle auto-end never passes through the Worker,
 * so status alone under-counts.) That is what this query keys on.
 *
 * ## What is deliberately not counted
 *
 * Nothing is counted at all. Taught-counts, deliveries-per-week and similar
 * ledger figures are a non-goal (`contents-meta.ts`: never a date, never a
 * taught-count). Ballots and their aggregates are purged thirty minutes after
 * a session ends (`PRODUCT.md` §Operating Context), so per-learner numbers are
 * not derivable either — and the correct response is to not show them.
 */
import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { RECOVERY_WINDOW_MS } from './control.js';
import { ownerHasContinuity } from './continuity-access.js';

/** Most rows the nudge list carries. A nudge is a short list or it is a backlog. */
const NEEDS_RECORD_LIMIT = 6;

export async function homeRoute(request: Request, env: ControlEnv): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
  const guard = await requireControlUser(request, env, false);
  if (!guard.ok) return guard.response;

  const now = Date.now();
  // A session is over once it has been marked ended or has aged past the
  // recovery window — the same test `mySessionsRoute` uses to decide whether a
  // session is still resumable. Nudging a tutor to write up a session they are
  // still teaching would be the one moment the nudge is wrong.
  const settledBefore = now - RECOVERY_WINDOW_MS;

  const needsRecord = await env.DB.prepare(
    `SELECT r.id            AS id,
            r.title         AS title,
            r.context_id    AS context_id,
            r.space_id      AS space_id,
            sp.owner_user_id AS owner_user_id,
            MAX(ro.created_at) AS delivered_at
       FROM sessions r
       JOIN live_sessions ro ON ro.session_id = r.id
       JOIN spaces sp ON sp.id = r.space_id
      WHERE r.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM session_records rr WHERE rr.session_id = r.id)
        AND EXISTS (SELECT 1 FROM space_members sm
                     WHERE sm.space_id = r.space_id AND sm.user_id = ?1)
      GROUP BY r.id
     HAVING (MAX(ro.created_at) < ?2 OR MAX(ro.ended) = 1)
      ORDER BY delivered_at DESC
      LIMIT ?3`,
  )
    .bind(guard.user.id, settledBefore, NEEDS_RECORD_LIMIT)
    .all<{
      id: string;
      title: string;
      context_id: string | null;
      space_id: string;
      owner_user_id: string;
      delivered_at: number;
    }>();

  // Notes are the space owner's paid `continuity`: never nudge toward a locked page.
  const rows = needsRecord.results ?? [];
  const continuity = new Map<string, boolean>();
  for (const owner of new Set(rows.map((row) => row.owner_user_id))) {
    continuity.set(owner, await ownerHasContinuity(env, owner));
  }

  return json({
    needsRecord: rows.filter((row) => continuity.get(row.owner_user_id) === true).map((row) => ({
      sessionId: row.id,
      title: row.title,
      contextId: row.context_id,
      spaceId: row.space_id,
      deliveredAt: row.delivered_at,
    })),
  });
}
