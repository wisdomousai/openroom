/**
 * Space-level collaboration: effective roles, membership, and invites.
 *
 * The Space is the sharing boundary, so the effective role is exactly the
 * caller's `space_members` row — one lookup, no two-tier resolution. "Shared
 * with me" is "a space I am a member of but do not own".
 */
import { json, type ControlEnv, type SessionUser } from './auth.js';
import { readSpaceSettings } from '@openroom/schema';
import { requireControlUser } from './control-auth.js';
import { readEntitlements } from './entitlements.js';
import { ensureWorkspace } from './workspace.js';

function randomId(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let binary = '';
  for (const b of buf) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type SpaceRole = 'owner' | 'editor' | 'presenter';

const ROLE_RANK: Record<SpaceRole, number> = { presenter: 1, editor: 2, owner: 3 };

export function roleAtLeast(role: SpaceRole, min: SpaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

function isSpaceRole(value: unknown): value is SpaceRole {
  return value === 'owner' || value === 'editor' || value === 'presenter';
}

export interface SpaceAccess {
  role: SpaceRole;
  space: { id: string; name: string; owner_user_id: string };
}

/** Effective role of `user` on a space, or null when they cannot see it. */
export async function spaceRole(
  env: ControlEnv,
  user: SessionUser,
  spaceId: string,
): Promise<SpaceAccess | null> {
  const row = await env.DB.prepare(
    `SELECT s.id AS id, s.name AS name, s.owner_user_id AS owner_user_id, m.role AS role
       FROM spaces s
       JOIN space_members m ON m.space_id = s.id AND m.user_id = ?2
      WHERE s.id = ?1`,
  )
    .bind(spaceId, user.id)
    .first<{ id: string; name: string; owner_user_id: string; role: string }>();
  if (row === null || !isSpaceRole(row.role)) return null;
  return {
    role: row.role,
    space: { id: row.id, name: row.name, owner_user_id: row.owner_user_id },
  };
}

export interface FolderAccess {
  role: SpaceRole;
  folder: {
    id: string;
    space_id: string;
    name: string;
    parent_id: string | null;
    deleted_at: number | null;
  };
}

/** Effective role of `user` on a folder, via its space. */
export async function folderAccess(
  env: ControlEnv,
  user: SessionUser,
  folderId: string,
  includeDeleted = false,
): Promise<FolderAccess | null> {
  const folder = await env.DB.prepare(
    `SELECT id, space_id, name, parent_id, deleted_at FROM folders
      WHERE id = ?1${includeDeleted ? '' : ' AND deleted_at IS NULL'}`,
  )
    .bind(folderId)
    .first<FolderAccess['folder']>();
  if (folder === null) return null;
  const access = await spaceRole(env, user, folder.space_id);
  if (access === null) return null;
  return { role: access.role, folder };
}

/* ----------------------------------------------------------------- spaces */

/** GET /api/my/spaces — every space the caller can open (owned + shared). */
export async function listAllSpacesRoute(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireControlUser(request, env);
  if (!guard.ok) return guard.response;
  await ensureWorkspace(env, guard.user);

  const { results } = await env.DB.prepare(
    `SELECT s.id AS id, s.name AS name, s.created_at AS created_at, s.updated_at AS updated_at,
            m.role AS role, (s.owner_user_id <> ?1) AS shared, s.settings AS settings
       FROM spaces s
       JOIN space_members m ON m.space_id = s.id AND m.user_id = ?1
      ORDER BY s.updated_at DESC`,
  )
    .bind(guard.user.id)
    .all<{
      id: string;
      name: string;
      created_at: number;
      updated_at: number;
      role: string;
      shared: number;
      settings: string;
    }>();

  return json({
    spaces: (results ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      shared: r.shared === 1,
      settings: readSpaceSettings(r.settings),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
}

/* ---------------------------------------------------------------- members */

/** GET /api/my/spaces/:id/members — member list; invites included for owners. */
export async function listMembersRoute(
  request: Request,
  env: ControlEnv,
  spaceId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env);
  if (!guard.ok) return guard.response;
  const access = await spaceRole(env, guard.user, spaceId);
  if (access === null) return json({ ok: false, error: 'not-found' }, 404);

  const { results: memberRows } = await env.DB.prepare(
    `SELECT u.id AS user_id, u.email AS email, u.name AS name, m.role AS role,
            m.invited_by AS invited_by
       FROM space_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.space_id = ?1
      ORDER BY m.created_at ASC`,
  )
    .bind(spaceId)
    .all<{
      user_id: string;
      email: string | null;
      name: string | null;
      role: string;
      invited_by: string | null;
    }>();

  const members = (memberRows ?? []).map((m) => ({
    userId: m.user_id,
    email: m.email,
    name: m.name,
    role: m.role,
    invitedBy: m.invited_by,
  }));

  if (access.role !== 'owner') return json({ role: access.role, members });

  const { results: inviteRows } = await env.DB.prepare(
    `SELECT i.id AS id, i.email AS email, i.role AS role, i.created_at AS created_at,
            u.name AS inviter_name
       FROM space_invites i
       LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.space_id = ?1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
      ORDER BY i.created_at DESC`,
  )
    .bind(spaceId)
    .all<{ id: string; email: string; role: string; created_at: number; inviter_name: string | null }>();

  return json({
    role: access.role,
    members,
    invites: (inviteRows ?? []).map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      createdAt: i.created_at,
      inviterName: i.inviter_name,
    })),
  });
}

/** True when a user with this (lowercased) email already has access to the space. */
async function emailIsMember(env: ControlEnv, spaceId: string, email: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM users u
       JOIN space_members m ON m.user_id = u.id AND m.space_id = ?1
      WHERE lower(u.email) = ?2
      LIMIT 1`,
  )
    .bind(spaceId, email)
    .first();
  return row !== null;
}

/** POST /api/my/spaces/:id/invites  body { email, role: 'editor'|'presenter' } */
export async function createInviteRoute(
  request: Request,
  env: ControlEnv,
  spaceId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const access = await spaceRole(env, guard.user, spaceId);
  if (access === null) return json({ ok: false, error: 'not-found' }, 404);
  if (access.role !== 'owner') return json({ ok: false, error: 'forbidden' }, 403);
  const entitlements = await readEntitlements(env, guard.user.id);
  if (!entitlements.team) return json({ ok: false, error: 'team-required' }, 403);

  const body = await readJson(request);
  if (body === null) return json({ ok: false, error: 'invalid-json' }, 400);

  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 320) : '';
  if (email === '' || !email.includes('@')) {
    return json({ ok: false, error: 'invalid-email' }, 400);
  }
  const role = body.role;
  if (role !== 'editor' && role !== 'presenter') {
    return json({ ok: false, error: 'invalid-role' }, 400);
  }
  if (email === guard.user.email.toLowerCase()) {
    return json({ ok: false, error: 'self-invite' }, 400);
  }
  if (await emailIsMember(env, spaceId, email)) {
    return json({ ok: false, error: 'already-member' }, 409);
  }

  const id = randomId();
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO space_invites (id, space_id, email, role, invited_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
      .bind(id, spaceId, email, role, guard.user.id, now)
      .run();
  } catch {
    // Partial unique index: one pending invite per (space, email).
    return json({ ok: false, error: 'already-invited' }, 409);
  }
  return json({ id, spaceId, email, role, createdAt: now }, 201);
}

/**
 * Resolve a member row the owner may manage. The space owner is structural —
 * their membership follows `spaces.owner_user_id` and cannot be edited here.
 */
async function managedMember(
  env: ControlEnv,
  access: SpaceAccess,
  targetUserId: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (targetUserId === access.space.owner_user_id) {
    return { ok: false, response: json({ ok: false, error: 'space-owner' }, 400) };
  }
  const row = await env.DB.prepare(
    'SELECT role FROM space_members WHERE space_id = ?1 AND user_id = ?2',
  )
    .bind(access.space.id, targetUserId)
    .first<{ role: string }>();
  if (row !== null) return { ok: true };
  return { ok: false, response: json({ ok: false, error: 'not-found' }, 404) };
}

/** PATCH /api/my/spaces/:id/members/:userId  body { role } */
export async function patchMemberRoute(
  request: Request,
  env: ControlEnv,
  spaceId: string,
  targetUserId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const access = await spaceRole(env, guard.user, spaceId);
  if (access === null) return json({ ok: false, error: 'not-found' }, 404);
  if (access.role !== 'owner') return json({ ok: false, error: 'forbidden' }, 403);

  const body = await readJson(request);
  if (body === null) return json({ ok: false, error: 'invalid-json' }, 400);
  if (!isSpaceRole(body.role)) return json({ ok: false, error: 'invalid-role' }, 400);

  const target = await managedMember(env, access, targetUserId);
  if (!target.ok) return target.response;

  await env.DB.prepare('UPDATE space_members SET role = ?1 WHERE space_id = ?2 AND user_id = ?3')
    .bind(body.role, spaceId, targetUserId)
    .run();
  return json({ ok: true, userId: targetUserId, role: body.role });
}

/** DELETE /api/my/spaces/:id/members/:userId */
export async function removeMemberRoute(
  request: Request,
  env: ControlEnv,
  spaceId: string,
  targetUserId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const access = await spaceRole(env, guard.user, spaceId);
  if (access === null) return json({ ok: false, error: 'not-found' }, 404);
  if (access.role !== 'owner') return json({ ok: false, error: 'forbidden' }, 403);

  const target = await managedMember(env, access, targetUserId);
  if (!target.ok) return target.response;

  await env.DB.prepare('DELETE FROM space_members WHERE space_id = ?1 AND user_id = ?2')
    .bind(spaceId, targetUserId)
    .run();
  return json({ ok: true });
}

/* ---------------------------------------------------------------- invites */

/** GET /api/my/invites — pending invites addressed to my email. */
export async function myInvitesRoute(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireControlUser(request, env);
  if (!guard.ok) return guard.response;
  const email = guard.user.email.toLowerCase();
  if (email === '') return json({ invites: [] });

  const { results } = await env.DB.prepare(
    `SELECT i.id AS id, i.role AS role, i.created_at AS created_at,
            s.id AS space_id, s.name AS space_name, u.name AS inviter_name
       FROM space_invites i
       JOIN spaces s ON s.id = i.space_id
       LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.email = ?1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
      ORDER BY i.created_at DESC`,
  )
    .bind(email)
    .all<{
      id: string;
      role: string;
      created_at: number;
      space_id: string;
      space_name: string;
      inviter_name: string | null;
    }>();

  return json({
    invites: (results ?? []).map((i) => ({
      id: i.id,
      role: i.role,
      createdAt: i.created_at,
      spaceId: i.space_id,
      spaceName: i.space_name,
      inviterName: i.inviter_name,
    })),
  });
}

/** POST /api/my/invites/:id/accept */
export async function acceptInviteRoute(
  request: Request,
  env: ControlEnv,
  inviteId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;

  const invite = await env.DB.prepare(
    `SELECT id, space_id, email, role, invited_by, accepted_at, revoked_at
       FROM space_invites WHERE id = ?1`,
  )
    .bind(inviteId)
    .first<{
      id: string;
      space_id: string;
      email: string;
      role: string;
      invited_by: string;
      accepted_at: number | null;
      revoked_at: number | null;
    }>();
  if (invite === null || invite.revoked_at !== null) {
    return json({ ok: false, error: 'not-found' }, 404);
  }
  if (invite.accepted_at !== null) return json({ ok: false, error: 'already-accepted' }, 409);
  if (guard.user.email.toLowerCase() !== invite.email) {
    return json({ ok: false, error: 'forbidden' }, 403);
  }

  const space = await env.DB.prepare('SELECT owner_user_id FROM spaces WHERE id = ?1').bind(invite.space_id).first<{ owner_user_id: string }>();
  if (!space) return json({ ok: false, error: 'not-found' }, 404);
  if (!(await readEntitlements(env, space.owner_user_id)).team) return json({ ok: false, error: 'team-required' }, 403);

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO space_members (space_id, user_id, role, invited_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(invite.space_id, guard.user.id, invite.role, invite.invited_by, now),
    env.DB.prepare(
      'UPDATE space_invites SET accepted_at = ?1, accepted_by = ?2 WHERE id = ?3',
    ).bind(now, guard.user.id, inviteId),
  ]);
  return json({ ok: true, spaceId: invite.space_id, role: invite.role });
}

/** DELETE /api/my/invites/:id — revoke (space owner only). */
export async function revokeInviteRoute(
  request: Request,
  env: ControlEnv,
  inviteId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;

  const invite = await env.DB.prepare(
    'SELECT id, space_id, revoked_at, accepted_at FROM space_invites WHERE id = ?1',
  )
    .bind(inviteId)
    .first<{ id: string; space_id: string; revoked_at: number | null; accepted_at: number | null }>();
  if (invite === null) return json({ ok: false, error: 'not-found' }, 404);

  const access = await spaceRole(env, guard.user, invite.space_id);
  if (access === null) return json({ ok: false, error: 'not-found' }, 404);
  if (access.role !== 'owner') return json({ ok: false, error: 'forbidden' }, 403);
  if (invite.accepted_at !== null) return json({ ok: false, error: 'already-accepted' }, 409);

  if (invite.revoked_at === null) {
    await env.DB.prepare('UPDATE space_invites SET revoked_at = ?1 WHERE id = ?2')
      .bind(Date.now(), inviteId)
      .run();
  }
  return json({ ok: true });
}
