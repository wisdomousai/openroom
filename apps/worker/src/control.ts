/**
 * Control-plane routes: the live-session directory.
 *
 * Everything here is session-cookie authenticated and D1 backed. None of it is
 * on the ballot hot path — the only D1 write during a session is one INSERT at
 * session creation.
 */

import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { facilitatorAccess } from './facilitation.js';
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
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM live_sessions WHERE user_id = ?1 AND created_at > ?2',
  )
    .bind(userId, now - SESSION_QUOTA_WINDOW_MS)
    .first<{ n: number }>();
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
  const space = opts.spaceId ? await env.DB.prepare('SELECT owner_user_id FROM spaces WHERE id=?1').bind(opts.spaceId).first<{ owner_user_id: string }>() : null;
  const collaborationEnabled = space ? (await readEntitlements(env, space.owner_user_id)).team : false;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO live_sessions
       (code, user_id, title, created_at, ended, space_id,
        deck_id, deck_version, session_id, collaboration_enabled)
     VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      code,
      userId,
      title,
      now,
      opts.spaceId ?? null,
      opts.deckId ?? null,
      opts.deckVersion ?? null,
      opts.sessionId ?? null,
      collaborationEnabled ? 1 : 0,
    )
    .run();
}

/**
 * GET /api/my/sessions — the cross-device recovery path (LIVE-11).
 *
 * Tokens are minted *optimistically*: we do not ask the SessionDO whether the session
 * is still alive, because that would mean one cross-DO round trip per listed
 * session on every page load. A session that has ended, been auto-expired or been
 * wiped simply 404s the moment the console tries to use its token — the same
 * path an uninitialised session takes. `ended` in D1 is therefore advisory (we
 * never write it back from the DO); the DO stays the single authority.
 */
export async function mySessionsRoute(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireControlUser(request, env);
  if (!guard.ok) return guard.response;
  const now = Date.now();

  const { results } = await env.DB.prepare(
    `SELECT l.code, l.title, l.created_at, l.ended, l.user_id FROM live_sessions l
      WHERE l.user_id = ?1 OR EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = l.space_id AND m.user_id = ?1)
      ORDER BY l.created_at DESC LIMIT 100`,
  )
    .bind(guard.user.id)
    .all<{ code: string; title: string | null; created_at: number; ended: number; user_id: string | null }>();

  const sessions = await Promise.all(
    (results ?? []).map(async (row) => {
      const access = await facilitatorAccess(env, row.code, guard.user.id);
      if (!access) return null;
      const shared = row.user_id !== guard.user.id;
      const recoverable = row.ended === 0 && now - row.created_at < RECOVERY_WINDOW_MS;
      if (!recoverable || shared) {
        return {
          code: row.code,
          sessionCode: row.code,
          title: row.title,
          createdAt: row.created_at,
          ended: row.ended === 1,
          recoverable,
          shared,
        };
      }
      const [hostToken, stageToken] = await Promise.all([
        signToken(env.TOKEN_SECRET, { sessionCode: row.code, role: 'host', facilitatorId: guard.user.id, userId: guard.user.id, ...(guard.connectionId ? { connectionId: guard.connectionId } : {}) }),
        signToken(env.TOKEN_SECRET, { sessionCode: row.code, role: 'stage' }),
      ]);
      return {
        code: row.code,
        sessionCode: row.code,
        title: row.title,
        createdAt: row.created_at,
        ended: false,
        recoverable: true as const,
        hostToken,
        stageToken,
      };
    }),
  );

  return json({ sessions: sessions.filter((session) => session !== null) });
}
