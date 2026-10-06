import { jsonHeaders } from './headers';

/** Liveness for the `status` link relation. */
export function healthRoute(method: string): Response {
  if (method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: { ...jsonHeaders(), 'cache-control': 'no-store' },
    });
  }
  if (method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method-not-allowed' }), {
      status: 405,
      headers: { ...jsonHeaders(), allow: 'GET, HEAD' },
    });
  }
  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: { ...jsonHeaders(), 'cache-control': 'no-store' },
  });
}
