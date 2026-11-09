import { validateBrandKit, type BrandKit, type DeckDesign } from '@openroom/schema';
import { and, asc, count, eq, inArray, isNotNull, isNull, like, sql } from 'drizzle-orm';
import { sha256Hex } from './api-tokens.js';
import { json, type ControlEnv, type SessionUser } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { DELETION_INTENT_TTL_MS, randomToken } from './control-utils.js';
import { orm } from './db/client.js';
import { brandKits, deletionIntents, mediaAssets } from './db/schema.js';
import { nocase } from './db/sql.js';
import { readEntitlements } from './entitlements.js';
import { roleAtLeast, spaceRole } from './members.js';

const columns = {
  id: brandKits.id,
  spaceId: brandKits.spaceId,
  name: brandKits.name,
  designJson: brandKits.designJson,
  revision: brandKits.revision,
  deletedAt: brandKits.deletedAt,
};
type KitRow = { id: string; spaceId: string; name: string; designJson: string; revision: number; deletedAt: number | null };
/** A space keeps at most this many live kits; kits in Trash do not count. */
export const BRAND_KIT_LIMIT = 100;
const view = (row: KitRow): BrandKit => ({ id: row.id, spaceId: row.spaceId, name: row.name, design: JSON.parse(row.designJson) as DeckDesign, revision: row.revision, trashed: row.deletedAt !== null });

async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  const source = await request.text();
  if (new TextEncoder().encode(source).length > 128 * 1024) return null;
  try { const value: unknown = JSON.parse(source); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
  catch { return null; }
}

async function ownsImages(env: ControlEnv, spaceId: string, design: DeckDesign): Promise<boolean> {
  const ids = [...new Set(design.masters.flatMap((master) => [master.logo?.assetId, master.background?.kind === 'image' ? master.background.assetId : undefined]).filter((id): id is string => !!id))];
  if (!ids.length) return true;
  const results = await orm(env).select({ id: mediaAssets.id }).from(mediaAssets)
    .where(and(eq(mediaAssets.spaceId, spaceId), like(mediaAssets.contentType, 'image/%'), inArray(mediaAssets.id, ids)));
  return results.length === ids.length;
}

export async function handleBrandKits(request: Request, env: ControlEnv, url: URL): Promise<Response | null> {
  const collection = /^\/api\/tutoring\/spaces\/([^/]+)\/brand-kits$/.exec(url.pathname);
  const item = /^\/api\/tutoring\/brand-kits\/([^/]+)(?:\/(restore|permanent-deletion))?$/.exec(url.pathname);
  if (!collection && !item) return null;
  const guard = await requireControlUser(request, env, request.method !== 'GET');
  if (!guard.ok) return guard.response;
  const row = item ? await orm(env).select(columns).from(brandKits).where(eq(brandKits.id, decodeURIComponent(item[1]!))).get() ?? null : null;
  if (item && !row) return json({ error: 'brand-kit-not-found' }, 404);
  const spaceId = row?.spaceId ?? decodeURIComponent(collection![1]!);
  const access = await spaceRole(env, guard.user, spaceId);
  if (!access) return json({ error: 'not-found' }, 404);
  const entitlements = await readEntitlements(env, access.space.owner_user_id);
  const permissions = { canEdit: roleAtLeast(access.role, 'editor'), brandingEnabled: entitlements.branding };
  if (request.method === 'GET' && !item?.[2]) {
    if (row) return json({ brandKit: view(row), ...permissions });
    const trashed = url.searchParams.get('trashed') === '1';
    const results = await orm(env).select(columns).from(brandKits)
      .where(and(eq(brandKits.spaceId, spaceId), trashed ? isNotNull(brandKits.deletedAt) : isNull(brandKits.deletedAt)))
      .orderBy(nocase(brandKits.name), asc(brandKits.id));
    return json({ brandKits: results.map(view), ...permissions });
  }
  if (!permissions.canEdit) return json({ error: 'forbidden' }, 403);
  if (row && request.method === 'DELETE' && !item?.[2]) {
    const now = Date.now();
    await orm(env).update(brandKits).set({ deletedAt: now, updatedAt: now, revision: sql`${brandKits.revision} + 1` })
      .where(and(eq(brandKits.id, row.id), isNull(brandKits.deletedAt))).run();
    return json({ ok: true });
  }
  if (row && item?.[2] === 'permanent-deletion' && request.method === 'POST') {
    if (row.deletedAt === null) return json({ error: 'move-to-trash-first' }, 409);
    const token = randomToken();
    const now = Date.now();
    await orm(env).insert(deletionIntents).values({
      tokenHash: await sha256Hex(token),
      userId: guard.user.id,
      resourceType: 'brand_kit',
      resourceId: row.id,
      resourceName: row.name,
      createdAt: now,
      expiresAt: now + DELETION_INTENT_TTL_MS,
      usedAt: null,
    }).run();
    return json({
      ok: true,
      confirmationRequired: true,
      expiresAt: now + DELETION_INTENT_TTL_MS,
      confirmationUrl: `${url.origin}/confirm-deletion/${encodeURIComponent(token)}`,
    }, 202);
  }
  if (row && item?.[2] === 'restore' && request.method === 'POST') {
    await orm(env).update(brandKits).set({ deletedAt: null, updatedAt: Date.now(), revision: sql`${brandKits.revision} + 1` })
      .where(and(eq(brandKits.id, row.id), isNotNull(brandKits.deletedAt))).run();
    const restored = await orm(env).select(columns).from(brandKits).where(eq(brandKits.id, row.id)).get();
    return json({ brandKit: view(restored!) });
  }
  if (!((collection && request.method === 'POST') || (row && !item?.[2] && request.method === 'PATCH'))) return json({ error: 'method-not-allowed' }, 405);
  if (!permissions.brandingEnabled) return json({ error: 'branding-required' }, 403);
  if (row?.deletedAt != null) return json({ error: 'brand-kit-in-trash' }, 409);
  const body = await bodyOf(request);
  const validated = validateBrandKit(body);
  if (!validated.ok) return json({ error: validated.error, ...(validated.issues ? { issues: validated.issues } : {}) }, 422);
  const { name, design } = validated.document;
  if (!await ownsImages(env, spaceId, design)) return json({ error: 'brand-image-not-in-space' }, 422);
  const now = Date.now();
  if (row) {
    if (!Number.isInteger(body?.baseRevision)) return json({ error: 'base-revision-required' }, 400);
    const result = await orm(env).update(brandKits)
      .set({ name, designJson: JSON.stringify(design), revision: sql`${brandKits.revision} + 1`, updatedAt: now })
      .where(and(eq(brandKits.id, row.id), eq(brandKits.revision, body!.baseRevision as number), isNull(brandKits.deletedAt))).run();
    if (!result.meta.changes) return json({ error: 'brand-kit-conflict' }, 409);
    return json({ brandKit: { ...view(row), name, design, revision: (body!.baseRevision as number) + 1 } });
  }
  const id = crypto.randomUUID();
  // The limit check and the insert are one statement, so two racing creates cannot both pass it.
  const liveKits = orm(env).select({ n: count() }).from(brandKits)
    .where(and(eq(brandKits.spaceId, spaceId), isNull(brandKits.deletedAt)));
  const result = await orm(env).insert(brandKits).select(
    sql`SELECT ${id}, ${spaceId}, ${name}, ${JSON.stringify(design)}, 1, ${guard.user.id}, ${now}, ${now}, NULL
         WHERE ${liveKits} < ${BRAND_KIT_LIMIT}`,
  ).run();
  if (!result.meta.changes) return json({ error: 'brand-kit-limit' }, 409);
  return json({ brandKit: { id, spaceId, name, design, revision: 1, trashed: false } satisfies BrandKit }, 201);
}

/** The space a kit belongs to, for the confirmation page's links back to its Trash. */
export async function brandKitSpaceId(env: ControlEnv, kitId: string): Promise<string | null> {
  const row = await orm(env).select({ spaceId: brandKits.spaceId }).from(brandKits).where(eq(brandKits.id, kitId)).get();
  return row?.spaceId ?? null;
}

/**
 * Confirms a brand-kit deletion intent. The kit must still be in Trash and the
 * person must still be an editor of its space; otherwise nothing is deleted.
 * Decks hold copies of a kit's design, never a reference, so no deck changes.
 */
export async function confirmBrandKitDeletion(env: ControlEnv, user: SessionUser, kitId: string): Promise<boolean> {
  const spaceId = await brandKitSpaceId(env, kitId);
  if (spaceId === null) return false;
  const access = await spaceRole(env, user, spaceId);
  if (!access || !roleAtLeast(access.role, 'editor')) return false;
  const result = await orm(env).delete(brandKits).where(and(eq(brandKits.id, kitId), isNotNull(brandKits.deletedAt))).run();
  return result.meta.changes > 0;
}
