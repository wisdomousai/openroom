/** Byte ranges let the native audio player seek inside a portable deck resource. */
export function localResourceResponse(request: Request, bytes: Uint8Array, contentType: string): Response {
  const size = bytes.byteLength;
  const headers = new Headers({ 'content-type': contentType, 'accept-ranges': 'bytes', 'content-length': String(size) });
  const range = request.headers.get('range');
  if (!range) return new Response(request.method === 'HEAD' ? null : Uint8Array.from(bytes), { headers });
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const start = match?.[1] ? Number(match[1]) : Math.max(0, size - Number(match?.[2]));
  const end = match?.[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
    headers.set('content-range', `bytes */${size}`); headers.set('content-length', '0');
    return new Response(null, { status: 416, headers });
  }
  headers.set('content-range', `bytes ${start}-${end}/${size}`);
  headers.set('content-length', String(end - start + 1));
  return new Response(request.method === 'HEAD' ? null : Uint8Array.from(bytes.subarray(start, end + 1)), { status: 206, headers });
}
