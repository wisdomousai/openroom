import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';

export async function connectionsRoute(request: Request, env: ControlEnv, id?: string): Promise<Response> {
  const guard = await requireControlUser(request, env, request.method !== 'GET');
  if (!guard.ok) return guard.response;
  if (!id && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id, client_name, redirect_uri, expires_at FROM oauth_connections WHERE user_id = ?1 AND revoked_at IS NULL AND expires_at > ?2 ORDER BY created_at DESC').bind(guard.user.id, Date.now()).all<{ id: string; client_name: string; redirect_uri: string; expires_at: number }>();
    return json({ connections: results.map((row) => ({ id: row.id, name: row.client_name, origin: new URL(row.redirect_uri).origin, expiresAt: row.expires_at })) });
  }
  if (id && request.method === 'DELETE') {
    const revoked = await env.DB.prepare('UPDATE oauth_connections SET revoked_at = ?1 WHERE id = ?2 AND user_id = ?3 RETURNING id').bind(Date.now(), id, guard.user.id).first();
    return revoked ? json({ ok: true }) : json({ error: 'connection-not-found' }, 404);
  }
  return json({ error: 'method-not-allowed' }, 405);
}
