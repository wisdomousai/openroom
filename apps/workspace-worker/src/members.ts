/**
 * Space-level collaboration: effective roles, membership, and invites.
 *
 * The Space is the sharing boundary, so the effective role is exactly the
 * caller's `space_members` row — one lookup, no two-tier resolution. "Shared
 * with me" is "a space I am a member of but do not own".
 */
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { json, type ControlEnv, type SessionUser } from './auth.js';
import { readSpaceSettings } from '@openroom/schema';
import { requireControlUser } from './control-auth.js';
import { orm } from './db/client.js';
import { folders, spaceInvites, spaceMembers, spaces, users } from './db/schema.js';
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
  const row = await orm(env)
    .select({ id: spaces.id, name: spaces.name, ownerUserId: spaces.ownerUserId, role: spaceMembers.role })
    .from(spaces)
    .innerJoin(spaceMembers, and(eq(spaceMembers.spaceId, spaces.id), eq(spaceMembers.userId, user.id)))
    .where(eq(spaces.id, spaceId))
    .get();
  if (row === undefined || !isSpaceRole(row.role)) return null;
  return {
    role: row.role,
    space: { id: row.id, name: row.name, owner_user_id: row.ownerUserId },
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
  const row = await orm(env)
    .select({
      id: folders.id,
      spaceId: folders.spaceId,
      name: folders.name,
      parentId: folders.parentId,
      deletedAt: folders.deletedAt,
    })
    .from(folders)
    .where(includeDeleted ? eq(folders.id, folderId) : and(eq(folders.id, folderId), isNull(folders.deletedAt)))
    .get();
  if (row === undefined) return null;
  const access = await spaceRole(env, user, row.spaceId);
  if (access === null) return null;
  return {
    role: access.role,
    folder: {
      id: row.id,
      space_id: row.spaceId,
      name: row.name,
      parent_id: row.parentId,
      deleted_at: row.deletedAt,
    },
  };
}

/* ----------------------------------------------------------------- spaces */

/** GET /api/my/spaces — every space the caller can open (owned + shared). */
export async function listAllSpacesRoute(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireControlUser(request, env);
  if (!guard.ok) return guard.response;
  await ensureWorkspace(env, guard.user);

  const rows = await orm(env)
    .select({
      id: spaces.id,
      name: spaces.name,
      createdAt: spaces.createdAt,
      updatedAt: spaces.updatedAt,
      role: spaceMembers.role,
      shared: sql<number>`(${spaces.ownerUserId} <> ${guard.user.id})`,
      settings: spaces.settings,
    })
    .from(spaces)
    .innerJoin(spaceMembers, and(eq(spaceMembers.spaceId, spaces.id), eq(spaceMembers.userId, guard.user.id)))
    .orderBy(desc(spaces.updatedAt));

  return json({
    spaces: rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      shared: r.shared === 1,
      settings: readSpaceSettings(r.settings),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
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

  const memberRows = await orm(env)
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: spaceMembers.role,
      invitedBy: spaceMembers.invitedBy,
    })
    .from(spaceMembers)
    .innerJoin(users, eq(users.id, spaceMembers.userId))
    .where(eq(spaceMembers.spaceId, spaceId))
    .orderBy(asc(spaceMembers.createdAt));

  const members = memberRows.map((m) => ({
    userId: m.userId,
    email: m.email,
    name: m.name,
    role: m.role,
    invitedBy: m.invitedBy,
  }));

  if (access.role !== 'owner') return json({ role: access.role, members });

  const inviteRows = await orm(env)
    .select({
      id: spaceInvites.id,
      email: spaceInvites.email,
      role: spaceInvites.role,
      createdAt: spaceInvites.createdAt,
      inviterName: users.name,
    })
    .from(spaceInvites)
    .leftJoin(users, eq(users.id, spaceInvites.invitedBy))
    .where(and(eq(spaceInvites.spaceId, spaceId), isNull(spaceInvites.acceptedAt), isNull(spaceInvites.revokedAt)))
    .orderBy(desc(spaceInvites.createdAt));

  return json({
    role: access.role,
    members,
    invites: inviteRows.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      createdAt: i.createdAt,
      inviterName: i.inviterName,
    })),
  });
}

/** True when a user with this (lowercased) email already has access to the space. */
async function emailIsMember(env: ControlEnv, spaceId: string, email: string): Promise<boolean> {
  const row = await orm(env)
    .select({ ok: sql`1` })
    .from(users)
    .innerJoin(spaceMembers, and(eq(spaceMembers.userId, users.id), eq(spaceMembers.spaceId, spaceId)))
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1)
    .get();
  return row !== undefined;
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
    await orm(env)
      .insert(spaceInvites)
      .values({ id, spaceId, email, role, invitedBy: guard.user.id, createdAt: now })
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
  const row = await orm(env)
    .select({ role: spaceMembers.role })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, access.space.id), eq(spaceMembers.userId, targetUserId)))
    .get();
  if (row !== undefined) return { ok: true };
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
  // A space has one owner (spaces.owner_user_id); a colleague is an editor or a presenter.
  if (body.role !== 'editor' && body.role !== 'presenter') return json({ ok: false, error: 'invalid-role' }, 400);

  const target = await managedMember(env, access, targetUserId);
  if (!target.ok) return target.response;

  await orm(env)
    .update(spaceMembers)
    .set({ role: body.role })
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, targetUserId)))
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

  await orm(env)
    .delete(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, targetUserId)))
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

  const rows = await orm(env)
    .select({
      id: spaceInvites.id,
      role: spaceInvites.role,
      createdAt: spaceInvites.createdAt,
      spaceId: spaces.id,
      spaceName: spaces.name,
      inviterName: users.name,
    })
    .from(spaceInvites)
    .innerJoin(spaces, eq(spaces.id, spaceInvites.spaceId))
    .leftJoin(users, eq(users.id, spaceInvites.invitedBy))
    .where(and(eq(spaceInvites.email, email), isNull(spaceInvites.acceptedAt), isNull(spaceInvites.revokedAt)))
    .orderBy(desc(spaceInvites.createdAt));

  return json({
    invites: rows.map((i) => ({
      id: i.id,
      role: i.role,
      createdAt: i.createdAt,
      spaceId: i.spaceId,
      spaceName: i.spaceName,
      inviterName: i.inviterName,
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

  const db = orm(env);
  const invite = await db
    .select({
      id: spaceInvites.id,
      spaceId: spaceInvites.spaceId,
      email: spaceInvites.email,
      role: spaceInvites.role,
      invitedBy: spaceInvites.invitedBy,
      acceptedAt: spaceInvites.acceptedAt,
      revokedAt: spaceInvites.revokedAt,
    })
    .from(spaceInvites)
    .where(eq(spaceInvites.id, inviteId))
    .get();
  if (invite === undefined || invite.revokedAt !== null) {
    return json({ ok: false, error: 'not-found' }, 404);
  }
  if (invite.acceptedAt !== null) return json({ ok: false, error: 'already-accepted' }, 409);
  if (guard.user.email.toLowerCase() !== invite.email) {
    return json({ ok: false, error: 'forbidden' }, 403);
  }

  const space = await db.select({ ownerUserId: spaces.ownerUserId }).from(spaces).where(eq(spaces.id, invite.spaceId)).get();
  if (!space) return json({ ok: false, error: 'not-found' }, 404);
  if (!(await readEntitlements(env, space.ownerUserId)).team) return json({ ok: false, error: 'team-required' }, 403);

  const now = Date.now();
  await db.batch([
    db
      .insert(spaceMembers)
      .values({ spaceId: invite.spaceId, userId: guard.user.id, role: invite.role, invitedBy: invite.invitedBy, createdAt: now })
      .onConflictDoNothing(),
    db.update(spaceInvites).set({ acceptedAt: now, acceptedBy: guard.user.id }).where(eq(spaceInvites.id, inviteId)),
  ]);
  return json({ ok: true, spaceId: invite.spaceId, role: invite.role });
}

/** DELETE /api/my/invites/:id — revoke (space owner only). */
export async function revokeInviteRoute(
  request: Request,
  env: ControlEnv,
  inviteId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;

  const invite = await orm(env)
    .select({
      id: spaceInvites.id,
      spaceId: spaceInvites.spaceId,
      revokedAt: spaceInvites.revokedAt,
      acceptedAt: spaceInvites.acceptedAt,
    })
    .from(spaceInvites)
    .where(eq(spaceInvites.id, inviteId))
    .get();
  if (invite === undefined) return json({ ok: false, error: 'not-found' }, 404);

  const access = await spaceRole(env, guard.user, invite.spaceId);
  if (access === null) return json({ ok: false, error: 'not-found' }, 404);
  if (access.role !== 'owner') return json({ ok: false, error: 'forbidden' }, 403);
  if (invite.acceptedAt !== null) return json({ ok: false, error: 'already-accepted' }, 409);

  if (invite.revokedAt === null) {
    await orm(env).update(spaceInvites).set({ revokedAt: Date.now() }).where(eq(spaceInvites.id, inviteId)).run();
  }
  return json({ ok: true });
}
