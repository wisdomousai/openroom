import { normalizeSessionCode, type Command } from '@openroom/domain';
import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { readEntitlements } from './entitlements.js';
import { signToken } from './tokens.js';

type FacilitationEnv = ControlEnv & { SESSIONS: DurableObjectNamespace };
export interface FacilitatorAccess { id: string; name: string; canRecover: boolean }

/** Live host controls only. Participant ballots never call D1. */
export async function facilitatorAccess(env: ControlEnv, code: string, userId: string): Promise<FacilitatorAccess | null> {
  const row = await env.DB.prepare(
    `SELECT l.user_id AS creator_id, l.space_id, s.owner_user_id AS owner_id,
            m.role, u.name, l.collaboration_enabled
       FROM live_sessions l
       JOIN users u ON u.id = ?2
       LEFT JOIN spaces s ON s.id = l.space_id
       LEFT JOIN space_members m ON m.space_id = s.id AND m.user_id = u.id
      WHERE l.code = ?1`,
  ).bind(code, userId).first<{
    creator_id: string | null; space_id: string | null; owner_id: string | null;
    role: string | null; name: string | null; collaboration_enabled: number;
  }>();
  if (!row) return null;
  if (row.space_id === null) {
    if (row.creator_id !== userId) return null;
  } else {
    if (!['owner', 'editor', 'presenter'].includes(row.role ?? '')) return null;
    // Paid collaboration is retained for this session; membership is always current.
    if (row.owner_id !== userId && !row.collaboration_enabled && (!row.owner_id || !(await readEntitlements(env, row.owner_id)).team)) return null;
  }
  return { id: userId, name: row.name?.trim().slice(0, 200) || 'Facilitator', canRecover: row.creator_id === userId || row.owner_id === userId };
}

/** Rechecked per request: a retained token cannot outlive membership. */
export async function facilitatorCommandAllowed(env: ControlEnv, code: string, access: FacilitatorAccess, command: Command): Promise<boolean> {
  if (command.command === 'presentation.recover') return access.canRecover;
  if (command.command === 'presentation.handoff') {
    if (typeof command.facilitatorId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(command.facilitatorId)) return false;
    return await facilitatorAccess(env, code, command.facilitatorId) !== null;
  }
  return true;
}

export async function registerSessionFacilitator(env: FacilitationEnv, code: string, access: FacilitatorAccess): Promise<Response> {
  return env.SESSIONS.get(env.SESSIONS.idFromName(code)).fetch('https://session.internal/__facilitator', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(access),
  });
}

export async function facilitateSessionRoute(request: Request, env: FacilitationEnv, rawCode: string): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const code = normalizeSessionCode(rawCode);
  const access = await facilitatorAccess(env, code, guard.user.id);
  if (!access) return json({ error: 'session-not-found' }, 404);
  const registered = await registerSessionFacilitator(env, code, access);
  if (!registered.ok) return registered;
  const { facilitation } = await registered.json() as { facilitation: { presenterId: string; facilitators: Record<string, { id: string; name: string }> } };
  const [hostToken, stageToken] = await Promise.all([
    signToken(env.TOKEN_SECRET, { sessionCode: code, role: 'host', facilitatorId: access.id, userId: access.id, ...(guard.connectionId ? { connectionId: guard.connectionId } : {}) }),
    signToken(env.TOKEN_SECRET, { sessionCode: code, role: 'stage' }),
  ]);
  return json({ code, sessionCode: code, hostToken, stageToken, facilitation: { presenterId: facilitation.presenterId, facilitators: Object.values(facilitation.facilitators).map(({ id, name }) => ({ id, name })), yourId: access.id, canPresent: facilitation.presenterId === access.id, canRecover: access.canRecover } });
}
