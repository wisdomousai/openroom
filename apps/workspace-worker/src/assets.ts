/**
 * The media plane: real uploads for the deck editor media library.
 *
 * Bytes live in R2 (`MEDIA`), an index row lives in D1 (`media_assets`), and a
 * step points at the result by URL. Four routes:
 *
 *   POST   /api/tutoring/spaces/{spaceId}/assets?name=…&alt=…   upload (editor+)
 *   GET    /api/tutoring/spaces/{spaceId}/assets?query=…        list  (member)
 *   DELETE /api/tutoring/assets/{id}                            delete (owner/editor)
 *   GET    /api/assets/{id}                                     read  (public)
 *
 * **Why the read is public.** A picture on a slide is fetched by the stage, by
 * every participant phone, and by a learner holding an access link and no
 * session; several of those never authenticate at all. Rather than invent a
 * per-viewer signed-URL plane that can expire mid-session, the asset id *is* the
 * capability: it is a random UUID, never enumerable, and never listed except to
 * members of the owning space. That makes an uploaded file exactly as private
 * as an unguessable CDN path — appropriate for teaching material, and not a
 * place to put anything that must not leak if a URL is forwarded. The upload
 * response says so in `url`; the migration says so in prose.
 *
 * Upload bodies are the raw file bytes with the real `Content-Type`, not
 * multipart: the browser holds one `File`, `File.stream()` already is the body,
 * and the file name is metadata that belongs in the query string.
 */
import {
  MEDIA_ASSET_MAX_BYTES,
  isMediaAssetContentType,
  mediaAssetPath,
  type MediaAssetSummary,
} from '@openroom/schema';

import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { roleAtLeast, spaceRole } from './members.js';

export interface MediaEnv extends ControlEnv {
  MEDIA: R2Bucket;
}

interface AssetRow {
  id: string;
  space_id: string;
  owner_id: string;
  key: string;
  content_type: string;
  size: number;
  name: string;
  alt: string | null;
  created_at: number;
}

/** Long enough that a session never re-fetches; safe because ids never rebind. */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

function assetKind(contentType: string): 'image' | 'video' | 'audio' | 'pdf' {
  const type = contentType.toLowerCase();
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf') return 'pdf';
  return 'image';
}

function assetJson(row: AssetRow): MediaAssetSummary {
  return {
    id: row.id,
    spaceId: row.space_id,
    url: mediaAssetPath(row.id),
    name: row.name,
    contentType: row.content_type,
    size: row.size,
    alt: row.alt,
    kind: assetKind(row.content_type),
    createdAt: row.created_at,
    createdBy: row.owner_id,
  };
}

/** File names are display text, not paths: strip separators, keep it short. */
function cleanName(value: string | null, contentType: string): string {
  const raw = (value ?? '').replace(/[\\/\u0000-\u001f]/g, '').trim();
  if (raw !== '') return raw.slice(0, 200);
  const kind = assetKind(contentType);
  return kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : kind === 'pdf' ? 'PDF' : 'Picture';
}

/* --------------------------------------------------------------- upload */

async function uploadAssetRoute(
  request: Request,
  env: MediaEnv,
  url: URL,
  spaceId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const access = await spaceRole(env, guard.user, spaceId);
  if (access === null) return json({ error: 'not-found' }, 404);
  if (!roleAtLeast(access.role, 'editor')) return json({ error: 'forbidden' }, 403);

  const requestedType = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const contentType = requestedType === 'audio/x-wav' ? 'audio/wav' : requestedType;
  if (contentType === '') return json({ error: 'content-type-required' }, 400);
  if (!isMediaAssetContentType(contentType)) {
    return json({ error: 'unsupported-media-type' }, 415);
  }

  // Declared length is refused early so a 20MB+ body is never streamed into R2;
  // the real length is checked again below, because the header is a claim.
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MEDIA_ASSET_MAX_BYTES) {
    return json({ error: 'asset-too-large', maxBytes: MEDIA_ASSET_MAX_BYTES }, 413);
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return json({ error: 'empty-body' }, 400);
  if (bytes.byteLength > MEDIA_ASSET_MAX_BYTES) {
    return json({ error: 'asset-too-large', maxBytes: MEDIA_ASSET_MAX_BYTES }, 413);
  }

  const id = crypto.randomUUID();
  const key = `assets/${id}`;
  const name = cleanName(url.searchParams.get('name'), contentType);
  const altParam = (url.searchParams.get('alt') ?? '').trim();
  const alt = altParam === '' ? null : altParam.slice(0, 500);
  const now = Date.now();

  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType } });
  try {
    await env.DB.prepare(
      `INSERT INTO media_assets
         (id, space_id, owner_id, key, content_type, size, name, alt, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
      .bind(id, spaceId, guard.user.id, key, contentType, bytes.byteLength, name, alt, now)
      .run();
  } catch (error) {
    // An object with no row is invisible and unreclaimable; drop it rather than
    // leave the bucket carrying bytes nothing can name.
    await env.MEDIA.delete(key);
    throw error;
  }

  return json(
    {
      asset: assetJson({
        id,
        space_id: spaceId,
        owner_id: guard.user.id,
        key,
        content_type: contentType,
        size: bytes.byteLength,
        name,
        alt,
        created_at: now,
      }),
    },
    201,
  );
}

/* ----------------------------------------------------------------- list */

async function listAssetsRoute(
  request: Request,
  env: MediaEnv,
  url: URL,
  spaceId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, false);
  if (!guard.ok) return guard.response;
  const access = await spaceRole(env, guard.user, spaceId);
  if (access === null) return json({ error: 'not-found' }, 404);

  const query = (url.searchParams.get('query') ?? '').trim();
  const binds: (string | number)[] = [spaceId];
  let where = 'space_id = ?1';
  if (query !== '') {
    // LIKE wildcards in the caller's text would silently widen the filter.
    const needle = `%${query.replace(/[%_\\]/g, (ch) => `\\${ch}`).toLowerCase()}%`;
    where += " AND (lower(name) LIKE ?2 ESCAPE '\\' OR lower(coalesce(alt, '')) LIKE ?2 ESCAPE '\\')";
    binds.push(needle);
  }
  const { results } = await env.DB.prepare(
    `SELECT * FROM media_assets WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
  )
    .bind(...binds)
    .all<AssetRow>();
  return json({ assets: (results ?? []).map(assetJson) });
}

/* --------------------------------------------------------------- delete */

async function deleteAssetRoute(
  request: Request,
  env: MediaEnv,
  assetId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const row = await env.DB.prepare('SELECT * FROM media_assets WHERE id = ?1')
    .bind(assetId)
    .first<AssetRow>();
  if (row === null) return json({ error: 'not-found' }, 404);
  const access = await spaceRole(env, guard.user, row.space_id);
  // A non-member must not learn that the id exists.
  if (access === null) return json({ error: 'not-found' }, 404);
  if (row.owner_id !== guard.user.id && !roleAtLeast(access.role, 'editor')) {
    return json({ error: 'forbidden' }, 403);
  }

  await env.MEDIA.delete(row.key);
  await env.DB.prepare('DELETE FROM media_assets WHERE id = ?1').bind(assetId).run();
  // Steps that still point at the deleted asset keep their URL and render the
  // media placeholder with their alt text — the honest outcome of a missing
  // picture, and better than rewriting someone's deck content behind them.
  return json({ ok: true });
}

/* ----------------------------------------------------------------- read */

/**
 * `GET /api/assets/{id}` — public read, keyed by the unguessable id.
 *
 * Answers conditional requests so a projector reloading mid-session pays for
 * headers only, and streams the body rather than buffering it.
 */
export async function readAssetRoute(
  request: Request,
  env: MediaEnv,
  assetId: string,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method-not-allowed' }, 405);
  }
  const row = await env.DB.prepare(
    'SELECT key, content_type, size FROM media_assets WHERE id = ?1',
  )
    .bind(assetId)
    .first<{ key: string; content_type: string; size: number }>();
  if (row === null) return new Response('Not found', { status: 404 });

  const object = await env.MEDIA.get(row.key, {
    onlyIf: request.headers,
    range: request.headers,
  });
  if (object === null) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', row.content_type);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', IMMUTABLE_CACHE);
  headers.set('x-content-type-options', 'nosniff');
  // Uploaded bytes are served from the app's own origin, so a file that is not
  // what it claims must never be able to execute as a document here.
  headers.set('content-security-policy', "default-src 'none'; sandbox");
  headers.set('accept-ranges', 'bytes');

  // `onlyIf` misses produce a metadata-only object (no body): that is a 304.
  const body = 'body' in object ? object.body : null;
  if (body === null) return new Response(null, { status: 304, headers });
  if (request.method === 'HEAD') {
    headers.set('content-length', String(row.size));
    return new Response(null, { status: 200, headers });
  }
  // Only a request that asked for a range gets a 206; R2 reports `range` on
  // full gets too, and a bare GET answered as partial content breaks players.
  const range = object.range;
  if (range !== undefined && request.headers.has('range')) {
    const offset =
      'offset' in range && range.offset !== undefined
        ? range.offset
        : 'suffix' in range
          ? Math.max(0, row.size - range.suffix)
          : 0;
    const length =
      'length' in range && range.length !== undefined ? range.length : row.size - offset;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${row.size}`);
    headers.set('content-length', String(length));
    return new Response(body, { status: 206, headers });
  }
  return new Response(body, { status: 200, headers });
}

/**
 * Router for the media plane. Returns null when the path is something else.
 * Wired ahead of the tutoring control plane in index.ts.
 */
export async function handleAssetApi(
  request: Request,
  env: MediaEnv,
  url: URL,
): Promise<Response | null> {
  const path = url.pathname;

  const publicRead = /^\/api\/assets\/([^/]+)$/.exec(path);
  if (publicRead !== null) {
    return readAssetRoute(request, env, decodeURIComponent(publicRead[1] as string));
  }

  const collection = /^\/api\/tutoring\/spaces\/([^/]+)\/assets$/.exec(path);
  if (collection !== null) {
    const spaceId = decodeURIComponent(collection[1] as string);
    if (request.method === 'GET') return listAssetsRoute(request, env, url, spaceId);
    if (request.method === 'POST') return uploadAssetRoute(request, env, url, spaceId);
    return json({ error: 'method-not-allowed' }, 405);
  }

  const item = /^\/api\/tutoring\/assets\/([^/]+)$/.exec(path);
  if (item !== null) {
    if (request.method !== 'DELETE') return json({ error: 'method-not-allowed' }, 405);
    return deleteAssetRoute(request, env, decodeURIComponent(item[1] as string));
  }

  return null;
}
