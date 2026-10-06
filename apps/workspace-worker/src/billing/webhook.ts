import { billingHash, recordBillingEvent } from './state';
import { json, type ControlEnv } from '../auth';
import { paddleCatalog, parseBillingEvent, verifyPaddleSignature } from './paddle';

const MAX_BODY = 256 * 1024;
async function rawBody(request: Request): Promise<Uint8Array | null> {
  if (!request.body || Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return null;
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BODY) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** No cookie, account token, redirect parameter or custom_data can grant payment access. */
export async function paddleWebhookRoute(request: Request, env: ControlEnv): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  const catalog = paddleCatalog(env);
  if (!catalog || !env.PADDLE_WEBHOOK_SECRET) return json({ error: 'billing-not-configured' }, 503);
  const body = await rawBody(request);
  if (!body) return json({ error: 'payload-too-large' }, 413);
  if (!await verifyPaddleSignature(body, request.headers.get('paddle-signature'), env.PADDLE_WEBHOOK_SECRET)) return json({ error: 'invalid-signature' }, 401);
  let data: unknown;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body)); } catch { return json({ error: 'invalid-event' }, 400); }
  const event = parseBillingEvent(data);
  if (!event) return json({ error: 'invalid-event' }, 400);
  try {
    const result = await recordBillingEvent(env, catalog, event, await billingHash(body), 'webhook');
    if (result === 'unlinked') return json({ error: 'billing-customer-unlinked' }, 503);
  } catch { return json({ error: 'billing-processing-failed' }, 503); }
  return json({ received: true });
}
