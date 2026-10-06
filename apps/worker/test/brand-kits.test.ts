import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { defaultDeckDesign, type BrandKit } from '@openroom/schema';
import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import { signCookieValue } from '../src/tokens.js';
import worker from '../src/index.js';
import { BASE } from './helpers.js';

async function account(paid = false) {
  const id = crypto.randomUUID(), session = crypto.randomUUID(), now = Date.now();
  await env.DB.prepare('INSERT INTO users (id,google_sub,email,name,created_at,entitlements) VALUES (?1,?1,?2,?3,?4,?5)').bind(id, `${id}@example.test`, 'Brand author', now, JSON.stringify({ branding: paid, team: paid })).run();
  await env.DB.prepare('INSERT INTO auth_sessions (id,user_id,created_at,expires_at) VALUES (?1,?2,?3,?4)').bind(session, id, now, now + 3600000).run();
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(await signCookieValue('test-secret', session))}`;
  const call = (path: string, method = 'GET', body?: object) => worker.fetch(new Request(`${BASE}${path}`, {
    method, headers: { cookie, [CSRF_HEADER]: '1', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  }), env as never);
  const spaces = await (await call('/api/my/spaces')).json() as { spaces: { id: string }[] };
  return { id, spaceId: spaces.spaces[0]!.id, call };
}

describe('shared brand kits', () => {
  it('uses the owner’s entitlement, permits member reads, limits writes to editors and hides another space', async () => {
    const owner = await account(true), editor = await account(), presenter = await account(), outsider = await account(true);
    for (const [user, role] of [[editor, 'editor'], [presenter, 'presenter']] as const) await env.DB.prepare('INSERT INTO space_members (space_id,user_id,role,created_at) VALUES (?1,?2,?3,?4)').bind(owner.spaceId, user.id, role, Date.now()).run();
    const path = `/api/tutoring/spaces/${owner.spaceId}/brand-kits`, document = { name: 'Company', design: defaultDeckDesign('business') };
    expect((await presenter.call(path, 'POST', document)).status).toBe(403);
    expect((await outsider.call(path, 'POST', document)).status).toBe(404);
    const created = await editor.call(path, 'POST', document);
    expect(created.status).toBe(201);
    const { brandKit } = await created.json() as { brandKit: BrandKit };
    const item = `/api/tutoring/brand-kits/${brandKit.id}`;
    expect((await presenter.call(item)).status).toBe(200);
    expect((await outsider.call(item)).status).toBe(404);
    expect((await editor.call(item, 'PATCH', { ...document, name: 'Updated', baseRevision: 1 })).status).toBe(200);
    expect((await owner.call(item, 'PATCH', { ...document, baseRevision: 1 })).status).toBe(409);
    await env.DB.prepare('UPDATE users SET entitlements = ?1 WHERE id = ?2').bind('{}', owner.id).run();
    expect((await editor.call(item, 'PATCH', { ...document, baseRevision: 2 })).status).toBe(403);
    expect((await editor.call(item)).status).toBe(200);
    expect((await editor.call(item, 'DELETE')).status).toBe(200);
    expect(await (await owner.call(path)).json()).toMatchObject({ brandKits: [] });
    expect(await (await owner.call(`${path}?trashed=1`)).json()).toMatchObject({ brandKits: [{ id: brandKit.id, trashed: true }] });
    expect((await editor.call(`${item}/restore`, 'POST')).status).toBe(200);
    expect(await (await owner.call(item)).json()).toMatchObject({ brandKit: { name: 'Updated', trashed: false, revision: 4 } });
  });

  it('rejects unreadable palettes, file-local images and assets outside the saving space', async () => {
    const owner = await account(true), other = await account(true);
    const path = `/api/tutoring/spaces/${owner.spaceId}/brand-kits`;
    const design = defaultDeckDesign(); design.theme.colors.muted = '#EEEEEE';
    expect(await (await owner.call(path, 'POST', { name: 'Poor contrast', design })).json()).toMatchObject({ error: 'brand-palette-contrast' });
    design.theme.colors.muted = '#526473';
    design.masters[0]!.logo = { resourceId: crypto.randomUUID(), alt: 'Local logo' };
    expect(await (await owner.call(path, 'POST', { name: 'Local', design })).json()).toMatchObject({ error: 'brand-image-needs-upload' });
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO media_assets (id,space_id,owner_id,key,content_type,size,name,created_at) VALUES (?1,?2,?3,?4,?5,1,?6,?7)').bind(id, other.spaceId, other.id, `assets/${id}`, 'image/png', 'Logo', Date.now()).run();
    design.masters[0]!.logo = { assetId: id, url: `/api/assets/${id}`, alt: 'Other logo' };
    expect(await (await owner.call(path, 'POST', { name: 'Other space', design })).json()).toMatchObject({ error: 'brand-image-not-in-space' });
    await env.DB.prepare('UPDATE media_assets SET space_id = ?1 WHERE id = ?2').bind(owner.spaceId, id).run();
    expect((await owner.call(path, 'POST', { name: 'Company', design })).status).toBe(201);
  });

  it('shares the same validation and access rules with personal-token and MCP clients', async () => {
    const owner = await account(true);
    const minted = await (await owner.call('/api/my/tokens', 'POST', { name: 'Brand author' })).json() as { token: string };
    const path = `/api/tutoring/spaces/${owner.spaceId}/brand-kits`;
    const response = await worker.fetch(new Request(`${BASE}/api/mcp`, { method: 'POST', headers: { authorization: `Bearer ${minted.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'openroom_api', arguments: { method: 'POST', path, body: { name: 'Agent kit', design: defaultDeckDesign() } } } }) }), env as never);
    const rpc = await response.json() as { result: { content: { text: string }[]; isError?: boolean } };
    expect(rpc.result.isError).not.toBe(true);
    const result = JSON.parse(rpc.result.content[0]!.text);
    expect(result).toMatchObject({ status: 201, body: { brandKit: { name: 'Agent kit' } } });
    const listed = await worker.fetch(new Request(`${BASE}${path}`, { headers: { authorization: `Bearer ${minted.token}` } }), env as never);
    expect(await listed.json()).toMatchObject({ brandKits: [{ name: 'Agent kit' }] });
  });
});
