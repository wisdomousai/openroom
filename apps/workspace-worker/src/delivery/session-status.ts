/**
 * The control plane's copy of a session's lifecycle.
 *
 * The session Durable Object owns liveness (`lobby`, `live`, `ended`). D1 keeps
 * two copies for readers that cannot ask the DO on every request:
 * `sessions.status` (the vocabulary in `SESSION_STATUSES`) and
 * `live_sessions.ended`. Every Worker path that sees the DO start or end calls
 * `recordSessionTransition`; nothing else writes either column after the row
 * is created as `draft`.
 *
 * Writers:
 *  - launch (`launchSessionForUser`) records the DO snapshot it reads;
 *  - an accepted `session.start` or `session.end` through the shared command
 *    route (`LiveAuthority.sessionChanged`) or MCP `session_command`;
 *  - a launch, resume or co-host request that finds the DO ended, or gone past
 *    the initialisation window, records `ended`. That is how the DO's own idle
 *    auto-end reaches D1: the next time anyone touches the session.
 *
 * The status only moves forward. A re-sent end, a stale snapshot or a lobby
 * read after a start never moves a row back.
 */
import type { SessionStatus } from '@openroom/schema';

import type { ControlEnv } from '../auth.js';

/** The Durable Object's lifecycle as a snapshot or an accepted command reports it. */
export type LiveStatus = 'lobby' | 'live' | 'ended';

/** The moves `sessions.status` may make. `draft -> ended` covers a lobby ended without a start. */
export const SESSION_STATUS_MOVES: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = {
  draft: ['live', 'ended'],
  live: ['ended'],
  ended: [],
};

/**
 * A DO that answers 404 inside this window may still be initialising for a
 * launch in flight; past it, a missing DO has been wiped and the session is over.
 */
export const SESSION_INIT_WINDOW_MS = 10 * 60_000;

export function storedSessionStatus(live: LiveStatus): SessionStatus {
  return live === 'lobby' ? 'draft' : live;
}

/**
 * Record what the DO reported for this session code. A failed write is
 * swallowed: the DO has already moved, and the next launch, resume or co-host
 * request reconciles the copy.
 */
export async function recordSessionTransition(env: ControlEnv, sessionCode: string, live: LiveStatus): Promise<void> {
  const target = storedSessionStatus(live);
  const from = (Object.keys(SESSION_STATUS_MOVES) as SessionStatus[])
    .filter((status) => SESSION_STATUS_MOVES[status].includes(target));
  const statements: D1PreparedStatement[] = [];
  if (target === 'ended') {
    statements.push(env.DB.prepare('UPDATE live_sessions SET ended = 1 WHERE code = ?1').bind(sessionCode));
  }
  if (from.length > 0) {
    const fromList = from.map((_, index) => `?${String(index + 4)}`).join(', ');
    statements.push(env.DB.prepare(
      `UPDATE sessions SET status = ?1, updated_at = ?2
        WHERE id = (SELECT session_id FROM live_sessions WHERE code = ?3)
          AND status IN (${fromList})`,
    ).bind(target, Date.now(), sessionCode, ...from));
  }
  if (statements.length === 0) return;
  try {
    await env.DB.batch(statements);
  } catch {
    // The DO stays the authority; see above.
  }
}

/**
 * The DO answered 404 for this code. Past the initialisation window that means
 * it was wiped after its retention period, so the session is recorded as ended.
 */
export async function recordMissingSession(env: ControlEnv, sessionCode: string, now = Date.now()): Promise<void> {
  const row = await env.DB.prepare('SELECT created_at FROM live_sessions WHERE code = ?1')
    .bind(sessionCode)
    .first<{ created_at: number }>();
  if (row && now - row.created_at > SESSION_INIT_WINDOW_MS) {
    await recordSessionTransition(env, sessionCode, 'ended');
  }
}
