import { paddleCatalog, record, type Catalog, type PaddleEnv } from './paddle';

export class BillingError extends Error {
  constructor(readonly code: string, readonly status = 503, readonly rejected = false) { super(code); }
}
export interface PaddleConfig { catalog: Catalog; apiKey: string; clientToken: string; origin: string; deadline?: number; budget?: { remaining: number } }
export function paddleConfig(env: PaddleEnv): PaddleConfig | null {
  const catalog = paddleCatalog(env);
  if (!catalog || !env.PADDLE_API_KEY || !env.PADDLE_WEBHOOK_SECRET || !env.PADDLE_CLIENT_TOKEN?.startsWith(catalog.environment === 'sandbox' ? 'test_' : 'live_')) return null;
  return { catalog, apiKey: env.PADDLE_API_KEY, clientToken: env.PADDLE_CLIENT_TOKEN, origin: catalog.environment === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com' };
}

export function spendBillingBudget(config: PaddleConfig, operations = 1): void {
  if (!config.budget) return;
  if (config.budget.remaining < operations) throw new BillingError('billing-sync-budget-exhausted');
  config.budget.remaining -= operations;
}

/** Fixed provider origin, bounded responses and no credentials/provider bodies in errors. */
export async function paddleRequest(config: PaddleConfig, path: string, method = 'GET', body?: unknown): Promise<{ data: unknown; meta: Record<string, unknown> }> {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('#') || path.includes('\\')) throw new BillingError('billing-invalid-provider-path');
  spendBillingBudget(config);
  const timeout = Math.min(10_000, (config.deadline ?? Infinity) - Date.now());
  if (timeout <= 0) throw new BillingError('billing-sync-budget-exhausted');
  let response: Response;
  try {
    response = await fetch(config.origin + path, { method, redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: { authorization: `Bearer ${config.apiKey}`, 'paddle-version': '1', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch { throw new BillingError('billing-provider-unavailable'); }
  if (!response.ok) { await response.body?.cancel(); throw new BillingError([401, 403].includes(response.status) ? 'billing-provider-auth' : response.status === 429 ? 'billing-provider-rate-limited' : 'billing-provider-unavailable', 503, response.status >= 400 && response.status < 500 && ![408, 409].includes(response.status)); }
  const reader = response.body?.getReader();
  if (!reader) throw new BillingError('billing-provider-response-invalid');
  let text = '', size = 0; const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new BillingError('billing-provider-response-invalid'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    if (!record(value) || !('data' in value)) throw new BillingError('billing-provider-response-invalid');
    return { data: value.data, meta: record(value.meta) ? value.meta : {} };
  } catch (cause) { if (cause instanceof BillingError) throw cause; throw new BillingError('billing-provider-response-invalid'); }
  finally { reader.releaseLock(); }
}

/** Follow only a validated cursor, never the provider's URL with our bearer attached. */
export async function paddleList(config: PaddleConfig, pathname: string, query: Record<string, string>): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = []; let after = '';
  for (let page = 0; page < 10; page++) {
    const search = new URLSearchParams({ ...query, per_page: '200', ...(after ? { after } : {}) });
    const { data, meta } = await paddleRequest(config, `${pathname}?${search}`);
    if (!Array.isArray(data) || data.some((item) => !record(item))) throw new BillingError('billing-provider-response-invalid');
    items.push(...data as Record<string, unknown>[]);
    if (!record(meta.pagination) || meta.pagination.has_more !== true) return items;
    const next: unknown = data.at(-1)?.id;
    if (typeof next !== 'string' || !/^[a-z]+_[a-z0-9]{26}$/.test(next) || next === after) throw new BillingError('billing-provider-response-invalid');
    after = next;
  }
  throw new BillingError('billing-provider-page-limit');
}
