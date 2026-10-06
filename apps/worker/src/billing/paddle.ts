import { ENTITLEMENT_FLAGS, FREE_ENTITLEMENTS, type Entitlements } from '../entitlements';

export interface PaddleEnv {
  PADDLE_ENVIRONMENT?: string;
  PADDLE_WEBHOOK_SECRET?: string;
  PADDLE_PRICE_CATALOG?: string;
  PADDLE_API_KEY?: string;
  PADDLE_CLIENT_TOKEN?: string;
}
export type PaddleEnvironment = 'sandbox' | 'live';
export interface Price { name: string; capabilities: (typeof ENTITLEMENT_FLAGS)[number][] }
export interface Catalog { environment: PaddleEnvironment; prices: Record<string, Price> }
export const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const paddleId = (value: unknown, prefix: string): value is string => typeof value === 'string' && new RegExp(`^${prefix}_[a-z0-9]{26}$`).test(value);
const id = paddleId;

/** Configuration is trusted deployment input; mistakes must never expand a paid grant. */
export function paddleCatalog(env: PaddleEnv): Catalog | null {
  if (!['sandbox', 'live'].includes(env.PADDLE_ENVIRONMENT ?? '') || !env.PADDLE_PRICE_CATALOG) return null;
  try {
    const value: unknown = JSON.parse(env.PADDLE_PRICE_CATALOG);
    if (!record(value) || value.environment !== env.PADDLE_ENVIRONMENT || !record(value.prices)) return null;
    const entries = Object.entries(value.prices);
    if (!entries.length || entries.length > 100) return null;
    const prices: Catalog['prices'] = {};
    for (const [key, price] of entries) {
      if (!id(key, 'pri') || !record(price) || typeof price.name !== 'string' || !price.name.trim() || price.name.length > 100 || !Array.isArray(price.capabilities)
        || price.capabilities.some((flag) => !ENTITLEMENT_FLAGS.includes(flag) || flag === 'connectors') || new Set(price.capabilities).size !== price.capabilities.length) return null;
      prices[key] = { name: price.name.trim(), capabilities: price.capabilities as Price['capabilities'] };
    }
    return { environment: env.PADDLE_ENVIRONMENT as PaddleEnvironment, prices };
  } catch { return null; }
}

/** Keep sub-millisecond event ordering; Date.parse alone loses Paddle's precision. */
export function paddleTime(value: unknown): { ms: number; order: string } | null {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  const ms = Date.parse(value);
  if (!parts || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== parts[1]) return null;
  return { ms, order: `${parts[1]}.${(parts[2] ?? '').padEnd(9, '0')}Z` };
}

export interface BillingSubscription {
  id: string; customerId: string; status: 'active' | 'trialing' | 'past_due' | 'paused' | 'canceled';
  priceIds: string[]; periodEnd: number | null; scheduledEnd: number | null;
  updatedAt: number; order: string;
}
export interface BillingEvent {
  id: string; type: string; occurredAt: number; order: string;
  subscription: BillingSubscription | null;
}
export const SUBSCRIPTION_EVENTS = ['subscription.created', 'subscription.activated', 'subscription.updated', 'subscription.trialing', 'subscription.past_due', 'subscription.paused', 'subscription.resumed', 'subscription.canceled'] as const;

/** Webhook and API snapshots share the same provider revision, never our read time. */
export function parseBillingSubscription(data: unknown): BillingSubscription | null {
  if (!record(data) || !id(data.id, 'sub') || !id(data.customer_id, 'ctm') || typeof data.status !== 'string' || !['active', 'trialing', 'past_due', 'paused', 'canceled'].includes(data.status) || !Array.isArray(data.items) || data.items.length > 100) return null;
  const updated = paddleTime(data.updated_at);
  if (!updated) return null;
  const priceIds: string[] = [];
  for (const item of data.items) {
    if (!record(item) || !record(item.price) || !id(item.price.id, 'pri') || !Number.isSafeInteger(item.quantity) || Number(item.quantity) < 1) return null;
    if (item.status === 'active' && item.recurring === true) priceIds.push(item.price.id);
  }
  const period = data.current_billing_period;
  const periodEnd = record(period) ? paddleTime(period.ends_at)?.ms ?? null : null;
  if (['active', 'trialing'].includes(data.status) && periodEnd === null) return null;
  let scheduledEnd: number | null = null;
  if (data.scheduled_change !== null && data.scheduled_change !== undefined) {
    const change = data.scheduled_change;
    if (!record(change) || typeof change.action !== 'string' || !['cancel', 'pause', 'resume'].includes(change.action)) return null;
    const effective = paddleTime(change.effective_at);
    if (!effective) return null;
    if (change.action !== 'resume') scheduledEnd = effective.ms;
  }
  return { id: data.id, customerId: data.customer_id, status: data.status as BillingSubscription['status'], priceIds: [...new Set(priceIds)].sort(), periodEnd, scheduledEnd, updatedAt: updated.ms, order: updated.order };
}

export function parseBillingEvent(value: unknown): BillingEvent | null {
  if (!record(value) || !id(value.event_id, 'evt') || typeof value.event_type !== 'string' || value.event_type.length > 100) return null;
  const time = paddleTime(value.occurred_at);
  if (!time) return null;
  const subscription = (SUBSCRIPTION_EVENTS as readonly string[]).includes(value.event_type) ? parseBillingSubscription(value.data) : null;
  if ((SUBSCRIPTION_EVENTS as readonly string[]).includes(value.event_type) && !subscription) return null;
  return { id: value.event_id, type: value.event_type, occurredAt: time.ms, order: time.order, subscription };
}

export function priceEntitlements(catalog: Catalog, priceIds: string[]): { entitlements: Entitlements; known: boolean } {
  const entitlements = { ...FREE_ENTITLEMENTS };
  // A mixed known/unknown bundle needs review, rather than a partial paid grant.
  if (!priceIds.length || priceIds.some((priceId) => !catalog.prices[priceId])) return { entitlements, known: false };
  for (const priceId of priceIds) for (const flag of catalog.prices[priceId]!.capabilities) entitlements[flag] = true;
  return { entitlements, known: true };
}

/** Raw bytes are authenticated before JSON decoding. Multiple h1 values support key rotation. */
export async function verifyPaddleSignature(body: Uint8Array, header: string | null, secret: string, now = Date.now()): Promise<boolean> {
  if (!header || header.length > 2048 || !secret) return false;
  const fields = header.split(';').map((part) => part.trim().split('='));
  const timestamps = fields.filter(([key]) => key === 'ts'), signatures = fields.filter(([key]) => key === 'h1');
  const timestamp = timestamps[0]?.[1];
  if (timestamps.length !== 1 || timestamps[0]?.length !== 2 || !timestamp || !/^\d{10}$/.test(timestamp) || Math.abs(now - Number(timestamp) * 1000) > 5000 || !signatures.length) return false;
  const prefix = new TextEncoder().encode(`${timestamp}:`), payload = new Uint8Array(prefix.length + body.length);
  payload.set(prefix); payload.set(body, prefix.length);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  for (const [, hex, extra] of signatures) {
    if (extra !== undefined || !hex || !/^[a-fA-F0-9]{64}$/.test(hex)) continue;
    const signature = Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16));
    if (await crypto.subtle.verify('HMAC', key, signature, payload)) return true;
  }
  return false;
}
