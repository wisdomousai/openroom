/**
 * Control-plane routes: the live-session directory.
 *
 * Everything here is session-cookie authenticated and D1 backed. None of it is
 * on the answer hot path — the only D1 write during a session is one INSERT at
 * session creation.
 */

import { and, count, desc, eq, exists, gt, or, sql } from 'drizzle-orm';

import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { orm } from './db/client.js';
import { liveSessions, sessions as sessionsTable, spaceMembers, spaces, students } from './db/schema.js';
import { hostAccess } from './hosting.js';
import { signToken } from 'openroom-relay/tokens';
import { readEntitlements } from './entitlements.js';

/** PRD-level guard rail: 20 sessions per rolling 24h per host. */
export const SESSION_QUOTA = 20;
export const SESSION_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Sessions younger than this get fresh capability tokens on /api/my/sessions. */
export const RECOVERY_WINDOW_MS = 12 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ sessions */

export async function sessionQuotaExceeded(
  env: ControlEnv,
  userId: string,
  now: number,
): Promise<boolean> {
  const row = await orm(env)
    .select({ n: count() })
    .from(liveSessions)
    .where(and(eq(liveSessions.userId, userId), gt(liveSessions.createdAt, now - SESSION_QUOTA_WINDOW_MS)))
    .get();
  return (row?.n ?? 0) >= SESSION_QUOTA;
}

export async function recordLiveSession(
  env: ControlEnv,
  code: string,
  userId: string | null,
  title: string | null,
  now: number,
  opts: {
    spaceId?: string | null;
    deckId?: string | null;
    deckVersion?: number | null;
    sessionId?: string | null;
  } = {},
): Promise<void> {
  const db = orm(env);
  const space = opts.spaceId
    ? await db.select({ ownerUserId: spaces.ownerUserId }).from(spaces).where(eq(spaces.id, opts.spaceId)).get()
    : undefined;
  const collaborationEnabled = space ? (await readEntitlements(env, space.ownerUserId)).team : false;
  // INSERT OR REPLACE rather than an upsert on `code`: a relaunch of the same
  // session id (`uidx_live_sessions_session`) must displace the old row too.
  const columns = [
    liveSessions.code,
    liveSessions.userId,
    liveSessions.title,
    liveSessions.createdAt,
    liveSessions.ended,
    liveSessions.spaceId,
    liveSessions.deckId,
    liveSessions.deckVersion,
    liveSessions.sessionId,
    liveSessions.collaborationEnabled,
  ].map((column) => sql.identifier(column.name));
  await db.run(
    sql`INSERT OR REPLACE INTO ${liveSessions} (${sql.join(columns, sql`, `)})
     VALUES (${code}, ${userId}, ${title}, ${now}, 0, ${opts.spaceId ?? null}, ${opts.deckId ?? null},
             ${opts.deckVersion ?? null}, ${opts.sessionId ?? null}, ${collaborationEnabled ? 1 : 0})`,
  );
}

/**
 * GET /api/my/sessions — the cross-device recovery path (LIVE-11).
 *
 * Tokens are minted *optimistically*: we do not ask the SessionDO whether the session
 * is still alive, because that would mean one cross-DO round trip per listed
 * session on every page load. A session that has ended, been auto-expired or been
 * wiped simply 404s the moment the console tries to use its token — the same
 * path an uninitialised session takes. `ended` in D1 is therefore advisory: the
 * Worker writes it on the paths it sees and reconciles it from the DO on launch,
 * resume and co-host (delivery/session-status.ts); the DO stays the single authority.
 */
export async function mySessionsRoute(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireControlUser(request, env);
  if (!guard.ok) return guard.response;
  const now = Date.now();

  const db = orm(env);
  const rows = await db
    .select({
      code: liveSessions.code,
      title: liveSessions.title,
      createdAt: liveSessions.createdAt,
      ended: liveSessions.ended,
      userId: liveSessions.userId,
      deckId: liveSessions.deckId,
      studentId: sessionsTable.studentId,
      studentName: students.displayName,
    })
    .from(liveSessions)
    .leftJoin(sessionsTable, eq(sessionsTable.id, liveSessions.sessionId))
    .leftJoin(students, eq(students.id, sessionsTable.studentId))
    .where(
      or(
        eq(liveSessions.userId, guard.user.id),
        exists(
          db
            .select({ one: sql`1` })
            .from(spaceMembers)
            .where(and(eq(spaceMembers.spaceId, liveSessions.spaceId), eq(spaceMembers.userId, guard.user.id))),
        ),
      ),
    )
    .orderBy(desc(liveSessions.createdAt))
    .limit(100);

  const sessions = await Promise.all(
    rows.map(async (row) => {
      const access = await hostAccess(env, row.code, guard.user.id);
      if (!access) return null;
      const shared = row.userId !== guard.user.id;
      const recoverable = row.ended === 0 && now - row.createdAt < RECOVERY_WINDOW_MS;
      // Which deck and which student: two live lessons of decks both called
      // "Untitled" are told apart by the student's name, never by a time.
      const subject = { deckId: row.deckId, studentId: row.studentId, studentName: row.studentName };
      if (!recoverable || shared) {
        return {
          code: row.code,
          sessionCode: row.code,
          title: row.title,
          ...subject,
          createdAt: row.createdAt,
          ended: row.ended === 1,
          recoverable,
          shared,
        };
      }
      const [hostToken, stageToken] = await Promise.all([
        signToken(env.TOKEN_SECRET, { sessionCode: row.code, role: 'host', hostId: guard.user.id, userId: guard.user.id, ...(guard.connectionId ? { connectionId: guard.connectionId } : {}) }),
        signToken(env.TOKEN_SECRET, { sessionCode: row.code, role: 'stage' }),
      ]);
      return {
        code: row.code,
        sessionCode: row.code,
        title: row.title,
        ...subject,
        createdAt: row.createdAt,
        ended: false,
        recoverable: true as const,
        hostToken,
        stageToken,
      };
    }),
  );

  return json({ sessions: sessions.filter((session) => session !== null) });
}
