import { json } from './http.js';

export const RESOURCE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Serve one stored session asset, byte-range aware. A pure request → Response
 * read over the DO's SQLite tables; nothing here mutates state.
 */
export function assetResponse(
  sql: SqlStorage,
  request: Request,
  resourceId: string,
): Response {
  if (!RESOURCE_ID_PATTERN.test(resourceId)) return json({ error: 'not-found' }, 404);
  const asset = sql.exec<{ content_type: string; size: number }>(
    'SELECT content_type, size FROM session_assets WHERE id = ?',
    resourceId,
  ).toArray()[0];
  if (asset === undefined) return json({ error: 'not-found' }, 404);
  const chunks = sql.exec<{ bytes: ArrayBuffer }>(
    'SELECT bytes FROM session_asset_chunks WHERE asset_id = ? ORDER BY chunk_index',
    resourceId,
  ).toArray();
  const full = new Uint8Array(asset.size);
  let offset = 0;
  for (const chunk of chunks) {
    const bytes = new Uint8Array(chunk.bytes);
    full.set(bytes, offset);
    offset += bytes.byteLength;
  }
  let start = 0;
  let end = Math.max(0, asset.size - 1);
  let status = 200;
  const range = request.headers.get('range');
  if (range !== null) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (match === null) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${String(asset.size)}` } });
    }
    start = Number(match[1]);
    end = match[2] === '' ? end : Math.min(end, Number(match[2]));
    if (start > end || start >= asset.size) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${String(asset.size)}` } });
    }
    status = 206;
  }
  return new Response(request.method === 'HEAD' ? null : full.slice(start, end + 1), {
    status,
    headers: {
      'content-type': asset.content_type,
      'content-length': String(end - start + 1),
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-store',
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      ...(status === 206 ? { 'content-range': `bytes ${String(start)}-${String(end)}/${String(asset.size)}` } : {}),
    },
  });
}
