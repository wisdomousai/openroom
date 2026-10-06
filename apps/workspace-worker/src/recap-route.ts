import { normalizeSessionCode } from '@openroom/domain';
import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { facilitatorAccess } from './facilitation.js';

type RecapEnv = ControlEnv & { SESSIONS: DurableObjectNamespace };

/** Called only after the caller's current session or control-plane authority is checked. */
export function forwardRecap(request: Request, env: RecapEnv, code: string): Promise<Response> {
  return env.SESSIONS.get(env.SESSIONS.idFromName(code)).fetch(new Request('https://session.internal/__recap', {
    method: request.method,
    ...(request.method === 'POST' ? { body: request.body, headers: { 'content-type': 'application/json' } } : {}),
  }));
}

/** Account API for peer clients; never accepts a live capability in place of an account. */
export async function accountRecapRoute(request: Request, env: RecapEnv, rawCode: string): Promise<Response> {
  const guard = await requireControlUser(request, env, request.method !== 'GET');
  if (!guard.ok) return guard.response;
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'method-not-allowed' }, 405);
  const code = normalizeSessionCode(decodeURIComponent(rawCode));
  if (!await facilitatorAccess(env, code, guard.user.id)) return json({ error: 'session-not-found' }, 404);
  return forwardRecap(request, env, code);
}
