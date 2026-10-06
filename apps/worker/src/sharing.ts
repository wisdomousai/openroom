import { json, type ControlEnv } from './auth';
import { acceptInviteRoute, createInviteRoute, listAllSpacesRoute, listMembersRoute, myInvitesRoute, patchMemberRoute, removeMemberRoute, revokeInviteRoute } from './members';
import { createSpaceRoute } from './workspace';

/** Browser, CLI and MCP dispatch to these same authenticated sharing operations. */
export async function sharingRoute(request: Request, env: ControlEnv, url: URL): Promise<Response | null> {
  const path = url.pathname, method = request.method;
  if (path === '/api/my/spaces') {
    if (method === 'GET') return listAllSpacesRoute(request, env);
    if (method === 'POST') return createSpaceRoute(request, env);
    return json({ error: 'method-not-allowed' }, 405);
  }
  if (path === '/api/my/invites') return method === 'GET' ? myInvitesRoute(request, env) : json({ error: 'method-not-allowed' }, 405);
  const invite = /^\/api\/my\/invites\/([^/]+)(\/accept)?$/.exec(path);
  if (invite) {
    const id = decodeURIComponent(invite[1]!);
    if (invite[2] && method === 'POST') return acceptInviteRoute(request, env, id);
    if (!invite[2] && method === 'DELETE') return revokeInviteRoute(request, env, id);
    return json({ error: 'method-not-allowed' }, 405);
  }
  const members = /^\/api\/my\/spaces\/([^/]+)\/members(?:\/([^/]+))?$/.exec(path);
  if (members) {
    const spaceId = decodeURIComponent(members[1]!), userId = members[2] ? decodeURIComponent(members[2]) : null;
    if (!userId && method === 'GET') return listMembersRoute(request, env, spaceId);
    if (userId && method === 'PATCH') return patchMemberRoute(request, env, spaceId, userId);
    if (userId && method === 'DELETE') return removeMemberRoute(request, env, spaceId, userId);
    return json({ error: 'method-not-allowed' }, 405);
  }
  const create = /^\/api\/my\/spaces\/([^/]+)\/invites$/.exec(path);
  if (create) return method === 'POST' ? createInviteRoute(request, env, decodeURIComponent(create[1]!)) : json({ error: 'method-not-allowed' }, 405);
  return null;
}
