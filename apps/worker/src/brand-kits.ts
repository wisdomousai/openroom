import { validateBrandKit, type BrandKit, type DeckDesign } from '@openroom/schema';
import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { readEntitlements } from './entitlements.js';
import { roleAtLeast, spaceRole } from './members.js';

interface KitRow { id: string; space_id: string; name: string; design_json: string; revision: number; deleted_at: number | null }
const columns = 'id, space_id, name, design_json, revision, deleted_at';
const view = (row: KitRow): BrandKit => ({ id: row.id, spaceId: row.space_id, name: row.name, design: JSON.parse(row.design_json) as DeckDesign, revision: row.revision, trashed: row.deleted_at !== null });

async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  const source = await request.text();
  if (new TextEncoder().encode(source).length > 128 * 1024) return null;
  try { const value: unknown = JSON.parse(source); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
  catch { return null; }
}

async function ownsImages(env: ControlEnv, spaceId: string, design: DeckDesign): Promise<boolean> {
  const ids = [...new Set(design.masters.flatMap((master) => [master.logo?.assetId, master.background?.kind === 'image' ? master.background.assetId : undefined]).filter((id): id is string => !!id))];
  if (!ids.length) return true;
  const { results } = await env.DB.prepare(`SELECT id FROM media_assets WHERE space_id = ? AND content_type LIKE 'image/%' AND id IN (${ids.map(() => '?').join(',')})`).bind(spaceId, ...ids).all();
  return results.length === ids.length;
}

export async function handleBrandKits(request: Request, env: ControlEnv, url: URL): Promise<Response | null> {
  const collection = /^\/api\/tutoring\/spaces\/([^/]+)\/brand-kits$/.exec(url.pathname);
  const item = /^\/api\/tutoring\/brand-kits\/([^/]+)(\/restore)?$/.exec(url.pathname);
  if (!collection && !item) return null;
  const guard = await requireControlUser(request, env, request.method !== 'GET');
  if (!guard.ok) return guard.response;
  const row = item ? await env.DB.prepare(`SELECT ${columns} FROM brand_kits WHERE id = ?1`).bind(decodeURIComponent(item[1]!)).first<KitRow>() : null;
  if (item && !row) return json({ error: 'brand-kit-not-found' }, 404);
  const spaceId = row?.space_id ?? decodeURIComponent(collection![1]!);
  const access = await spaceRole(env, guard.user, spaceId);
  if (!access) return json({ error: 'not-found' }, 404);
  const entitlements = await readEntitlements(env, access.space.owner_user_id);
  const permissions = { canEdit: roleAtLeast(access.role, 'editor'), brandingEnabled: entitlements.branding };
  if (request.method === 'GET' && !item?.[2]) {
    if (row) return json({ brandKit: view(row), ...permissions });
    const trashed = url.searchParams.get('trashed') === '1';
    const { results } = await env.DB.prepare(`SELECT ${columns} FROM brand_kits WHERE space_id = ?1 AND deleted_at IS ${trashed ? 'NOT ' : ''}NULL ORDER BY name COLLATE NOCASE, id`).bind(spaceId).all<KitRow>();
    return json({ brandKits: results.map(view), ...permissions });
  }
  if (!permissions.canEdit) return json({ error: 'forbidden' }, 403);
  if (row && request.method === 'DELETE' && !item?.[2]) {
    await env.DB.prepare('UPDATE brand_kits SET deleted_at = ?1, updated_at = ?1, revision = revision + 1 WHERE id = ?2 AND deleted_at IS NULL').bind(Date.now(), row.id).run();
    return json({ ok: true });
  }
  if (row && item?.[2] && request.method === 'POST') {
    await env.DB.prepare('UPDATE brand_kits SET deleted_at = NULL, updated_at = ?1, revision = revision + 1 WHERE id = ?2 AND deleted_at IS NOT NULL').bind(Date.now(), row.id).run();
    const restored = await env.DB.prepare(`SELECT ${columns} FROM brand_kits WHERE id = ?1`).bind(row.id).first<KitRow>();
    return json({ brandKit: view(restored!) });
  }
  if (!((collection && request.method === 'POST') || (row && !item?.[2] && request.method === 'PATCH'))) return json({ error: 'method-not-allowed' }, 405);
  if (!permissions.brandingEnabled) return json({ error: 'branding-required' }, 403);
  if (row?.deleted_at != null) return json({ error: 'brand-kit-in-trash' }, 409);
  const body = await bodyOf(request);
  const validated = validateBrandKit(body);
  if (!validated.ok) return json({ error: validated.error, ...(validated.issues ? { issues: validated.issues } : {}) }, 422);
  const { name, design } = validated.document;
  if (!await ownsImages(env, spaceId, design)) return json({ error: 'brand-image-not-in-space' }, 422);
  const now = Date.now();
  if (row) {
    if (!Number.isInteger(body?.baseRevision)) return json({ error: 'base-revision-required' }, 400);
    const result = await env.DB.prepare('UPDATE brand_kits SET name = ?1, design_json = ?2, revision = revision + 1, updated_at = ?3 WHERE id = ?4 AND revision = ?5 AND deleted_at IS NULL')
      .bind(name, JSON.stringify(design), now, row.id, body!.baseRevision).run();
    if (!result.meta.changes) return json({ error: 'brand-kit-conflict' }, 409);
    return json({ brandKit: { ...view(row), name, design, revision: (body!.baseRevision as number) + 1 } });
  }
  const id = crypto.randomUUID();
  const result = await env.DB.prepare(`INSERT INTO brand_kits (id,space_id,name,design_json,revision,created_by,created_at,updated_at)
    SELECT ?1,?2,?3,?4,1,?5,?6,?6 WHERE (SELECT COUNT(*) FROM brand_kits WHERE space_id = ?2) < 100`)
    .bind(id, spaceId, name, JSON.stringify(design), guard.user.id, now).run();
  if (!result.meta.changes) return json({ error: 'brand-kit-limit' }, 409);
  return json({ brandKit: { id, spaceId, name, design, revision: 1, trashed: false } satisfies BrandKit }, 201);
}
