import { normalizeSessionCode, type Command } from '@openroom/domain';
import { and, eq } from 'drizzle-orm';

import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { orm } from './db/client.js';
import { liveSessions, spaceMembers, spaces, users } from './db/schema.js';
import { readEntitlements } from './entitlements.js';
import { signToken } from 'openroom-relay/tokens';
import { recordMissingSession, recordSessionTransition } from './delivery/session-status.js';

type HostingEnv = ControlEnv & { SESSIONS: DurableObjectNamespace };
export interface HostAccess { id: string; name: string; canRecover: boolean }

/** Live host controls only. Participant answers never call D1. */
export async function hostAccess(env: ControlEnv, code: string, userId: string): Promise<HostAccess | null> {
  const row = await orm(env)
    .select({
      creatorId: liveSessions.userId,
      spaceId: liveSessions.spaceId,
      ownerId: spaces.ownerUserId,
      role: spaceMembers.role,
      name: users.name,
      collaborationEnabled: liveSessions.collaborationEnabled,
    })
    .from(liveSessions)
    .innerJoin(users, eq(users.id, userId))
    .leftJoin(spaces, eq(spaces.id, liveSessions.spaceId))
    .leftJoin(spaceMembers, and(eq(spaceMembers.spaceId, spaces.id), eq(spaceMembers.userId, users.id)))
    .where(eq(liveSessions.code, code))
    .get();
  if (!row) return null;
  if (row.spaceId === null) {
    if (row.creatorId !== userId) return null;
  } else {
    if (!['owner', 'editor', 'presenter'].includes(row.role ?? '')) return null;
    // Paid collaboration is retained for this session; membership is always current.
    if (row.ownerId !== userId && !row.collaborationEnabled && (!row.ownerId || !(await readEntitlements(env, row.ownerId)).team)) return null;
  }
  return { id: userId, name: row.name?.trim().slice(0, 200) || 'Host', canRecover: row.creatorId === userId || row.ownerId === userId };
}

/** Rechecked per request: a retained token cannot outlive membership. */
export async function hostCommandAllowed(env: ControlEnv, code: string, access: HostAccess, command: Command): Promise<boolean> {
  if (command.command === 'presentation.recover') return access.canRecover;
  if (command.command === 'presentation.handoff') {
    if (typeof command.hostId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(command.hostId)) return false;
    return await hostAccess(env, code, command.hostId) !== null;
  }
  return true;
}

export async function registerSessionHost(env: HostingEnv, code: string, access: HostAccess): Promise<Response> {
  return env.SESSIONS.get(env.SESSIONS.idFromName(code)).fetch('https://session.internal/__host', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(access),
  });
}

export async function coHostSessionRoute(request: Request, env: HostingEnv, rawCode: string): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const code = normalizeSessionCode(rawCode);
  const access = await hostAccess(env, code, guard.user.id);
  if (!access) return json({ error: 'session-not-found' }, 404);
  const registered = await registerSessionHost(env, code, access);
  if (!registered.ok) {
    await recordRefusedHost(env, code, registered.clone());
    return registered;
  }
  const { hosting } = await registered.json() as { hosting: { presenterId: string; hosts: Record<string, { id: string; name: string }> } };
  const [hostToken, stageToken] = await Promise.all([
    signToken(env.TOKEN_SECRET, { sessionCode: code, role: 'host', hostId: access.id, userId: access.id, ...(guard.connectionId ? { connectionId: guard.connectionId } : {}) }),
    signToken(env.TOKEN_SECRET, { sessionCode: code, role: 'stage' }),
  ]);
  return json({ code, sessionCode: code, hostToken, stageToken, hosting: { presenterId: hosting.presenterId, hosts: Object.values(hosting.hosts).map(({ id, name }) => ({ id, name })), yourId: access.id, canPresent: hosting.presenterId === access.id, canRecover: access.canRecover } });
}

/**
 * The DO refuses a host once the session has ended (E_ENDED) and answers 404
 * after its retention wipe. Either way the D1 copy is brought up to date, which
 * is how an automatic idle end reaches the control plane.
 */
async function recordRefusedHost(env: HostingEnv, code: string, refused: Response): Promise<void> {
  if (refused.status === 404) {
    await recordMissingSession(env, code);
    return;
  }
  const body = await refused.json().catch(() => null) as { error?: { code?: unknown } } | null;
  if (body?.error?.code === 'E_ENDED') await recordSessionTransition(env, code, 'ended');
}
