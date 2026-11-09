import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { orm } from './db/client.js';
import { oauthConnections as c } from './db/schema.js';

export async function connectionsRoute(request: Request, env: ControlEnv, id?: string): Promise<Response> {
  const guard = await requireControlUser(request, env, request.method !== 'GET');
  if (!guard.ok) return guard.response;
  if (!id && request.method === 'GET') {
    const results = await orm(env).select({ id: c.id, clientName: c.clientName, redirectUri: c.redirectUri, expiresAt: c.expiresAt }).from(c)
      .where(and(eq(c.userId, guard.user.id), isNull(c.revokedAt), gt(c.expiresAt, Date.now()))).orderBy(desc(c.createdAt));
    return json({ connections: results.map((row) => ({ id: row.id, name: row.clientName, origin: new URL(row.redirectUri).origin, expiresAt: row.expiresAt })) });
  }
  if (id && request.method === 'DELETE') {
    const revoked = await orm(env).update(c).set({ revokedAt: Date.now() }).where(and(eq(c.id, id), eq(c.userId, guard.user.id))).returning({ id: c.id }).get();
    return revoked ? json({ ok: true }) : json({ error: 'connection-not-found' }, 404);
  }
  return json({ error: 'method-not-allowed' }, 405);
}
