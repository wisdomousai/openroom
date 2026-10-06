/**
 * The media plane: upload → read roundtrip, who may write, and what is refused.
 *
 * The read route is deliberately public, so the test that matters most is the
 * one asserting an anonymous client gets the bytes back — that is a product
 * decision (the stage and participant surfaces hold no session), not an
 * oversight, and it should fail loudly if someone "fixes" it.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { encodeVoiceWav } from '@openroom/schema';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import { signCookieValue } from '../src/cookies.js';
import worker from '../src/index.js';
import { BASE } from './helpers.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

/** A 1×1 GIF — small, real bytes with a real content type. */
const PIXEL = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
  0x44, 0x01, 0x00, 0x3b,
]);

async function seedSession(): Promise<{ userId: string; cookie: string }> {
  const userId = `user-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, created_at, entitlements)
     VALUES (?1, ?2, ?3, ?4, ?5, '{}')`,
  )
    .bind(userId, `sub-${userId}`, `${userId}@example.com`, 'Tutor', now)
    .run();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(sessionId, userId, now, now + 30 * 24 * 60 * 60 * 1000)
    .run();
  const signed = await signCookieValue(TOKEN_SECRET, sessionId);
  return { userId, cookie: `${SESSION_COOKIE}=${encodeURIComponent(signed)}` };
}

function asUser(cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set(CSRF_HEADER, '1');
  return worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env as never);
}

function anonymous(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`${BASE}${path}`, init), env as never);
}

/** A signed-in tutor with their personal space bootstrapped. */
async function seedTutor(): Promise<{ userId: string; cookie: string; spaceId: string }> {
  const { userId, cookie } = await seedSession();
  const res = await asUser(cookie, '/api/my/spaces');
  const body = (await res.json()) as { spaces: { id: string }[] };
  return { userId, cookie, spaceId: body.spaces[0]!.id };
}

interface AssetBody {
  asset: { id: string; url: string; name: string; size: number; kind: string; alt: string | null };
}

function upload(
  cookie: string,
  spaceId: string,
  options: { name?: string; alt?: string; contentType?: string; body?: BodyInit } = {},
): Promise<Response> {
  const query = new URLSearchParams();
  if (options.name !== undefined) query.set('name', options.name);
  if (options.alt !== undefined) query.set('alt', options.alt);
  const qs = query.toString();
  return asUser(cookie, `/api/tutoring/spaces/${spaceId}/assets${qs === '' ? '' : `?${qs}`}`, {
    method: 'POST',
    headers: { 'content-type': options.contentType ?? 'image/gif' },
    body: options.body ?? PIXEL,
  });
}

describe('media assets', () => {
  it('normalizes WAV upload aliases so the recording remains portable', async () => {
    const { cookie, spaceId } = await seedTutor();
    const bytes = encodeVoiceWav(new Float32Array(16000));
    const uploaded = await upload(cookie, spaceId, { name: 'appointment.wav', contentType: 'audio/x-wav', body: bytes });
    expect(uploaded.status).toBe(201);
    const { asset } = await uploaded.json() as AssetBody;
    expect(asset.kind).toBe('audio');
    const read = await anonymous(asset.url);
    expect(read.headers.get('content-type')).toBe('audio/wav');
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);
  });
  it('stores an upload and serves the same bytes back to anyone holding the id', async () => {
    const { cookie, spaceId } = await seedTutor();
    const res = await upload(cookie, spaceId, { name: 'gare.gif', alt: 'A station' });
    expect(res.status).toBe(201);
    const { asset } = (await res.json()) as AssetBody;
    expect(asset.url).toBe(`/api/assets/${asset.id}`);
    expect(asset.name).toBe('gare.gif');
    expect(asset.size).toBe(PIXEL.byteLength);
    expect(asset.kind).toBe('image');
    expect(asset.alt).toBe('A station');

    // No cookie: the stage and participant surfaces read exactly like this.
    const read = await anonymous(asset.url);
    expect(read.status).toBe(200);
    expect(read.headers.get('content-type')).toBe('image/gif');
    expect(read.headers.get('cache-control')).toContain('immutable');
    expect(read.headers.get('etag')).toBeTruthy();
    const bytes = new Uint8Array(await read.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(PIXEL));
  });

  it('keeps a hyphenated file name and strips separators and control characters', async () => {
    const { cookie, spaceId } = await seedTutor();
    const plain = (await (
      await upload(cookie, spaceId, { name: 'my-photo.jpg' })
    ).json()) as AssetBody;
    expect(plain.asset.name).toBe('my-photo.jpg');

    const hostile = (await (
      await upload(cookie, spaceId, { name: 'log\u0007path/na-me\\pic.gif' })
    ).json()) as AssetBody;
    expect(hostile.asset.name).toBe('logpathna-mepic.gif');
  });

  it('answers a conditional re-request with 304', async () => {
    const { cookie, spaceId } = await seedTutor();
    const { asset } = (await (await upload(cookie, spaceId)).json()) as AssetBody;
    const first = await anonymous(asset.url);
    const etag = first.headers.get('etag')!;
    const second = await anonymous(asset.url, { headers: { 'if-none-match': etag } });
    expect(second.status).toBe(304);
  });

  it('refuses an unknown asset id with 404 rather than a hint', async () => {
    const res = await anonymous(`/api/assets/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
  });

  it('requires a session to upload', async () => {
    const { spaceId } = await seedTutor();
    const res = await anonymous(`/api/tutoring/spaces/${spaceId}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'image/gif' },
      body: PIXEL,
    });
    expect(res.status).toBe(401);
  });

  it('hides a space the caller is not a member of', async () => {
    const { spaceId } = await seedTutor();
    const stranger = await seedTutor();
    const res = await upload(stranger.cookie, spaceId);
    expect(res.status).toBe(404);
  });

  it('accepts retained PDFs and still refuses unrelated document types', async () => {
    const { cookie, spaceId } = await seedTutor();
    const pdf = await upload(cookie, spaceId, {
      contentType: 'application/pdf',
      body: new TextEncoder().encode('%PDF-1.4\nhandout\n%%EOF'),
    });
    expect(pdf.status).toBe(201);
    const text = await upload(cookie, spaceId, {
      contentType: 'text/plain',
      body: new TextEncoder().encode('not an asset'),
    });
    expect(text.status).toBe(415);
  });

  it('refuses a body over the 20 MiB ceiling', async () => {
    const { cookie, spaceId } = await seedTutor();
    const res = await upload(cookie, spaceId, {
      contentType: 'image/png',
      body: new Uint8Array(20 * 1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
  });

  it('accepts mp4 video and reports it as video', async () => {
    const { cookie, spaceId } = await seedTutor();
    const res = await upload(cookie, spaceId, {
      contentType: 'video/mp4',
      name: 'clip.mp4',
      body: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
    });
    expect(res.status).toBe(201);
    const { asset } = (await res.json()) as AssetBody;
    expect(asset.kind).toBe('video');
  });

  it('lists the space files and filters on name and alt text', async () => {
    const { cookie, spaceId } = await seedTutor();
    await upload(cookie, spaceId, { name: 'gare.gif', alt: 'A station concourse' });
    await upload(cookie, spaceId, { name: 'marche.gif', alt: 'A market stall' });

    const all = (await (
      await asUser(cookie, `/api/tutoring/spaces/${spaceId}/assets`)
    ).json()) as { assets: { name: string }[] };
    expect(all.assets.map((a) => a.name).sort()).toEqual(['gare.gif', 'marche.gif']);

    const byName = (await (
      await asUser(cookie, `/api/tutoring/spaces/${spaceId}/assets?query=marche`)
    ).json()) as { assets: { name: string }[] };
    expect(byName.assets.map((a) => a.name)).toEqual(['marche.gif']);

    const byAlt = (await (
      await asUser(cookie, `/api/tutoring/spaces/${spaceId}/assets?query=concourse`)
    ).json()) as { assets: { name: string }[] };
    expect(byAlt.assets.map((a) => a.name)).toEqual(['gare.gif']);

    const none = (await (
      await asUser(cookie, `/api/tutoring/spaces/${spaceId}/assets?query=%25`)
    ).json()) as { assets: unknown[] };
    expect(none.assets).toHaveLength(0);
  });

  it('never lists another space files', async () => {
    const owner = await seedTutor();
    await upload(owner.cookie, owner.spaceId, { name: 'private.gif' });
    const stranger = await seedTutor();
    const res = await asUser(stranger.cookie, `/api/tutoring/spaces/${stranger.spaceId}/assets`);
    const body = (await res.json()) as { assets: unknown[] };
    expect(body.assets).toHaveLength(0);
  });

  it('deletes bytes and row together, and 404s afterwards', async () => {
    const { cookie, spaceId } = await seedTutor();
    const { asset } = (await (await upload(cookie, spaceId)).json()) as AssetBody;

    const del = await asUser(cookie, `/api/tutoring/assets/${asset.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await anonymous(asset.url).then((r) => r.status)).toBe(404);
    const list = (await (
      await asUser(cookie, `/api/tutoring/spaces/${spaceId}/assets`)
    ).json()) as { assets: unknown[] };
    expect(list.assets).toHaveLength(0);
  });

  it('will not let a stranger delete, and does not admit the asset exists', async () => {
    const owner = await seedTutor();
    const { asset } = (await (await upload(owner.cookie, owner.spaceId)).json()) as AssetBody;
    const stranger = await seedTutor();
    const res = await asUser(stranger.cookie, `/api/tutoring/assets/${asset.id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
    expect(await anonymous(asset.url).then((r) => r.status)).toBe(200);
  });
});
