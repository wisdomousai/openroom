/**
 * `GET /api/my/home` — the one thing Home cannot derive from the lists it
 * already loads.
 *
 * Home builds "Next up" and "Recently touched" from `/api/sessions`,
 * `/api/decks` and `/api/tutoring/students`,
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
 * follows the DO through `delivery/session-status.ts`, but the DO's idle auto-end
 * reaches D1 only when someone next touches the session, so status alone can lag.)
 * That is what this query keys on.
 *
 * ## What is deliberately not counted
 *
 * Nothing is counted at all. Taught-counts, deliveries-per-week and similar
 * ledger figures are a non-goal (`contents-meta.ts`: never a date, never a
 * taught-count). Answers and their aggregates are deleted thirty minutes after
 * a session ends (`PRODUCT.md` §Operating Context), so per-learner numbers are
 * not derivable either — and the correct response is to not show them.
 */
import { and, desc, eq, exists, isNull, max, notExists, sql } from 'drizzle-orm';

import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { RECOVERY_WINDOW_MS } from './control.js';
import { ownerHasContinuity } from './continuity-access.js';
import { orm } from './db/client.js';
import { liveSessions, sessionRecords, sessions, spaceMembers, spaces, students } from './db/schema.js';

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

  const db = orm(env);
  const deliveredAt = max(liveSessions.createdAt);
  const rows = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      studentId: sessions.studentId,
      studentName: students.displayName,
      spaceId: sessions.spaceId,
      ownerUserId: spaces.ownerUserId,
      deliveredAt,
    })
    .from(sessions)
    .innerJoin(liveSessions, eq(liveSessions.sessionId, sessions.id))
    .innerJoin(spaces, eq(spaces.id, sessions.spaceId))
    .leftJoin(students, and(eq(students.id, sessions.studentId), isNull(students.deletedAt)))
    .where(
      and(
        isNull(sessions.deletedAt),
        notExists(db.select({ one: sql`1` }).from(sessionRecords).where(eq(sessionRecords.sessionId, sessions.id))),
        exists(
          db
            .select({ one: sql`1` })
            .from(spaceMembers)
            .where(and(eq(spaceMembers.spaceId, sessions.spaceId), eq(spaceMembers.userId, guard.user.id))),
        ),
      ),
    )
    .groupBy(sessions.id)
    .having(sql`(${deliveredAt} < ${settledBefore} OR max(${liveSessions.ended}) = 1)`)
    .orderBy(desc(deliveredAt))
    .limit(NEEDS_RECORD_LIMIT);

  // Notes are the space owner's paid `continuity`: never nudge toward a locked page.
  const continuity = new Map<string, boolean>();
  for (const owner of new Set(rows.map((row) => row.ownerUserId))) {
    continuity.set(owner, await ownerHasContinuity(env, owner));
  }

  return json({
    needsRecord: rows.filter((row) => continuity.get(row.ownerUserId) === true).map((row) => ({
      sessionId: row.id,
      title: row.title,
      studentId: row.studentId,
      studentName: row.studentName,
      spaceId: row.spaceId,
      deliveredAt: row.deliveredAt,
    })),
  });
}
