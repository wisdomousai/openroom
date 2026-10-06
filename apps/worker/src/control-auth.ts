import { verifyApiToken } from './api-tokens.js';
import {
  CSRF_HEADER,
  getSession,
  json,
  type ControlEnv,
  type SessionUser,
} from './auth.js';
import { verifyMcpAccessToken } from './mcp-oauth.js';

export type ControlAuthKind = 'session' | 'pat' | 'oauth';

export type ControlUserGuard =
  | { ok: true; user: SessionUser; authKind: ControlAuthKind; connectionId?: string }
  | { ok: false; response: Response };

async function userById(env: ControlEnv, userId: string): Promise<SessionUser | null> {
  const row = await env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?1')
    .bind(userId)
    .first<{ id: string; email: string; name: string | null }>();
  return row === null ? null : { id: row.id, email: row.email, name: row.name };
}

/**
 * Authenticate one business-application caller.
 *
 * Browser requests use the normal session + CSRF rule. Agent requests use a
 * user-scoped PAT or OAuth token and therefore do not need a browser CSRF
 * header. Deployment-wide ADMIN_KEY credentials deliberately have no tutoring
 * identity and are rejected.
 */
export async function requireControlUser(
  request: Request,
  env: ControlEnv,
  mutating = false,
): Promise<ControlUserGuard> {
  const auth = request.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ')) {
    const bearer = auth.slice('Bearer '.length);
    const pat = await verifyApiToken(env, bearer);
    if (pat !== null) return { ok: true, user: pat.user, authKind: 'pat' };

    const oauth = await verifyMcpAccessToken(env as never, bearer);
    if (oauth?.userId !== null && oauth?.userId !== undefined) {
      const user = await userById(env, oauth.userId);
      if (user !== null) return { ok: true, user, authKind: 'oauth', connectionId: oauth.connectionId };
    }
    return { ok: false, response: json({ error: 'unauthorized' }, 401) };
  }

  const user = await getSession(request, env);
  if (user === null) return { ok: false, response: json({ error: 'unauthorized' }, 401) };
  if (mutating && request.headers.get(CSRF_HEADER) !== '1') {
    return { ok: false, response: json({ error: 'csrf-required' }, 403) };
  }
  return { ok: true, user, authKind: 'session' };
}
