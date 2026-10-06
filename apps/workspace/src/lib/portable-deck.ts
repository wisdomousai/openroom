import {
  mapOutlineResourceSources, openRoomResourceBytesMatch, OPENROOM_RESOURCE_CONTENT_TYPES,
  OPENROOM_RESOURCE_EXTENSIONS, OPENROOM_RESOURCE_MAX_BYTES, OPENROOM_RESOURCE_TOTAL_MAX_BYTES,
  OPENROOM_RESOURCE_MAX_COUNT, type OpenRoomFileResourceV1, type OpenRoomResourceContentType,
  type Outline, type OutlineResourceSource,
} from '@openroom/schema';

async function readBounded(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel(); throw new Error('The deck exceeds its portable media size limit.');
  }
  if (!response.body) throw new Error('The media download was empty.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('The deck exceeds its portable media size limit.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Fetch visible document media before publishing a version or starting a download. */
export async function portableDeck(outline: Outline, origin: string, fetcher: typeof fetch = fetch): Promise<{
  outline: Outline; resources: Record<string, OpenRoomFileResourceV1>; entries: Record<string, Uint8Array>;
}> {
  const references = new Map<string, { url: string; kind: string; assetId?: string }>();
  const keyFor = (source: OutlineResourceSource) => source.assetId ? `/api/assets/${encodeURIComponent(source.assetId)}` : source.url;
  mapOutlineResourceSources(outline, (source, path) => {
    const kind = path.includes('/design/') ? 'image' : (source as { type?: string }).type ?? 'image';
    // Video players and embedded web pages are intentionally online content.
    if (kind === 'video') return source;
    const key = keyFor(source);
    // Unfilled picture/audio slots remain editable in a downloaded starter deck.
    if (!source.resourceId && (!key || key === 'https://local.openroom.invalid/openroom-pending-audio')) return source;
    if (!key || source.resourceId) throw new Error('This deck contains unresolved local media. Save its copy in Desktop.');
    const url = new URL(key, origin);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('A media address cannot be downloaded.');
    if (references.has(key) && references.get(key)!.kind !== kind) throw new Error('The same media is used with incompatible formats. Replace its incorrect reference.');
    if (!references.has(key)) references.set(key, { url: url.href, kind, ...(source.assetId ? { assetId: source.assetId } : {}) });
    return source;
  });
  if (references.size > OPENROOM_RESOURCE_MAX_COUNT) throw new Error(`A portable deck can contain at most ${OPENROOM_RESOURCE_MAX_COUNT} media files.`);
  const resources: Record<string, OpenRoomFileResourceV1> = {};
  const entries: Record<string, Uint8Array> = {};
  const ids = new Map<string, string>();
  let total = 0;
  for (const [key, reference] of references) {
    let response: Response;
    try { response = await fetcher(reference.url, { credentials: 'same-origin', signal: AbortSignal.timeout(30_000) }); }
    catch { throw new Error('A linked image or recording could not be included. Upload it into this space and try again.'); }
    if (!response.ok) throw new Error(`A media file could not be included (HTTP ${response.status}). Replace it or upload it again.`);
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() as OpenRoomResourceContentType;
    if (!(OPENROOM_RESOURCE_CONTENT_TYPES as readonly string[]).includes(contentType)
      || (reference.kind === 'image' && !contentType.startsWith('image/'))
      || (reference.kind === 'audio' && !contentType.startsWith('audio/'))
      || (reference.kind === 'pdf' && contentType !== 'application/pdf')) {
      await response.body?.cancel();
      throw new Error('A media file has an unsupported format. Use PNG, JPEG, WebP, GIF, AVIF, MP3, WAV, M4A or PDF.');
    }
    const bytes = await readBounded(response, Math.min(OPENROOM_RESOURCE_MAX_BYTES, OPENROOM_RESOURCE_TOTAL_MAX_BYTES - total));
    if (!openRoomResourceBytesMatch(bytes, contentType)) throw new Error('A media file does not match its declared format. Replace it before saving a copy.');
    total += bytes.byteLength;
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const id = crypto.randomUUID();
    const path = `resources/${id}${OPENROOM_RESOURCE_EXTENSIONS[contentType]}`;
    const filename = new URL(reference.url).pathname.split('/').pop() || 'media';
    resources[id] = { path, name: filename.slice(0, 160), contentType, size: bytes.byteLength, sha256,
      ...(reference.assetId ? { online: { kind: 'openroom-asset', assetId: reference.assetId, sha256 } } : {}),
    };
    entries[path] = bytes; ids.set(key, id);
  }
  return { resources, entries, outline: mapOutlineResourceSources(outline, (source) => {
    if ((source as { type?: string }).type === 'video') return source;
    const id = ids.get(keyFor(source) ?? '');
    if (!id) return source;
    const { url: _url, assetId: _asset, ...content } = source;
    return { ...content, resourceId: id } as typeof source;
  }) };
}
