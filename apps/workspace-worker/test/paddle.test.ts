import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/index';
import { FREE_ENTITLEMENTS, SELF_HOSTED_ENTITLEMENTS, readEntitlements } from '../src/entitlements';
import { paddleCatalog, paddleTime, verifyPaddleSignature } from '../src/billing/paddle';
import { recordLiveSession } from '../src/control';
import { facilitatorAccess } from '../src/facilitation';

const makeId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 26)}`;
const PRICE = 'pri_01gsz8x8sawmvhz1pv30nge1ke';
const SECRET = 'test-only-paddle-endpoint-secret';
const DAY = 86_400_000;
const configured = { ...env, PADDLE_ENVIRONMENT: 'sandbox', PADDLE_WEBHOOK_SECRET: SECRET,
  PADDLE_PRICE_CATALOG: JSON.stringify({ environment: 'sandbox', prices: { [PRICE]: { name: 'Test tutoring', capabilities: ['team', 'keep'] } } }) };
const iso = (ms: number) => new Date(ms).toISOString();

async function signature(raw: string, timestamp = Math.floor(Date.now() / 1000), secret = SECRET) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}:${raw}`));
  return `ts=${timestamp};h1=${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
async function send(value: unknown, target: Env = configured, header?: string) {
  const raw = JSON.stringify(value);
  return worker.fetch(new Request('https://openroom.test/api/billing/paddle/webhook', { method: 'POST', headers: { 'paddle-signature': header ?? await signature(raw) }, body: raw }), target);
}
async function account() {
  const userId = crypto.randomUUID(), customerId = makeId('ctm'), subscriptionId = makeId('sub');
  await env.DB.prepare('INSERT INTO users (id,google_sub,email,created_at,entitlements) VALUES (?1,?1,?2,?3,?4)').bind(userId, `${userId}@example.test`, Date.now(), JSON.stringify({ branding: true })).run();
  await env.DB.prepare('INSERT INTO billing_customers (environment,customer_id,user_id,created_at) VALUES (\'sandbox\',?1,?2,?3)').bind(customerId, userId, Date.now()).run();
  const event = (status: string, at = Date.now(), changes: Record<string, unknown> = {}) => ({
    event_id: makeId('evt'), event_type: status === 'past_due' ? 'subscription.past_due' : 'subscription.updated', occurred_at: iso(at),
    data: { id: subscriptionId, customer_id: customerId, status, updated_at: iso(at),
      current_billing_period: { starts_at: iso(at), ends_at: iso(Date.now() + 30 * DAY) }, scheduled_change: null,
      items: [{ status: 'active', recurring: true, quantity: 1, price: { id: PRICE } }], ...changes },
  });
  return { userId, customerId, subscriptionId, event, access: () => readEntitlements(configured, userId) };
}

describe('Paddle trust and configuration', () => {
  it('requires an explicit environment and valid price-to-capability catalog', () => {
    expect(paddleCatalog(configured)?.prices[PRICE]?.capabilities).toEqual(['team', 'keep']);
    expect(paddleCatalog({ ...configured, PADDLE_PRICE_CATALOG: JSON.stringify({ environment: 'sandbox', prices: { [PRICE]: { name: 'Company', capabilities: ['largeSessions'] } } }) })?.prices[PRICE]?.capabilities).toEqual(['largeSessions']);
    expect(paddleCatalog({})).toBeNull();
    expect(paddleCatalog({ ...configured, PADDLE_ENVIRONMENT: 'live' })).toBeNull();
    expect(paddleCatalog({ ...configured, PADDLE_PRICE_CATALOG: JSON.stringify({ environment: 'sandbox', prices: { [PRICE]: { name: 'Unavailable workflow', capabilities: ['connectors'] } } }) })).toBeNull();
    for (const prices of [{}, { [PRICE]: { name: 'Bad', capabilities: ['administrator'] } }, { [PRICE]: { name: 'Bad', capabilities: ['team', 'team'] } }, { arbitrary: { name: 'Bad', capabilities: ['team'] } }]) {
      expect(paddleCatalog({ ...configured, PADDLE_PRICE_CATALOG: JSON.stringify({ environment: 'sandbox', prices }) })).toBeNull();
    }
  });
  it('authenticates exact bytes, timestamp and endpoint key, including rotated signatures', async () => {
    const raw = '{ "test": 1 }', bytes = new TextEncoder().encode(raw), header = await signature(raw);
    expect(await verifyPaddleSignature(bytes, header, SECRET)).toBe(true);
    expect(await verifyPaddleSignature(new TextEncoder().encode('{"test":1}'), header, SECRET)).toBe(false);
    expect(await verifyPaddleSignature(bytes, header, 'another-environment-secret')).toBe(false);
    expect(await verifyPaddleSignature(bytes, await signature(raw, Math.floor(Date.now() / 1000) - 6), SECRET)).toBe(false);
    expect(await verifyPaddleSignature(bytes, await signature(raw, Math.floor(Date.now() / 1000) + 6), SECRET)).toBe(false);
    expect(await verifyPaddleSignature(bytes, `${header};h1=${'0'.repeat(64)}`, SECRET)).toBe(true);
    expect(await verifyPaddleSignature(bytes, `${header};ts=1`, SECRET)).toBe(false);
  });
  it('rejects unsigned, oversized and unlinked events without allowing custom_data to identify a user', async () => {
    const a = await account(), value = a.event('active');
    expect((await send(value, configured, 'ts=1;h1=0')).status).toBe(401);
    expect((await send(value, { ...configured, PADDLE_PRICE_CATALOG: undefined })).status).toBe(503);
    expect((await send(value, { ...configured, PADDLE_ENVIRONMENT: 'live' })).status).toBe(503);
    expect((await send('x'.repeat(256 * 1024))).status).toBe(413);
    value.data.customer_id = makeId('ctm');
    Object.assign(value.data, { custom_data: { user_id: a.userId, entitlements: { team: true } } });
    expect((await send(value)).status).toBe(503);
    expect(await a.access()).toEqual(FREE_ENTITLEMENTS);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM billing_events WHERE subscription_id=?1').bind(a.subscriptionId).first<{ n: number }>())!.n).toBe(0);
  });
});

describe('Paddle subscription access', () => {
  it('grants only configured capabilities, deduplicates concurrent deliveries and excludes another environment', async () => {
    const a = await account(), value = a.event('active');
    expect((await Promise.all([send(value), send(value), send(value)])).map((result) => result.status)).toEqual([200, 200, 200]);
    expect(await a.access()).toEqual({ ...FREE_ENTITLEMENTS, team: true, keep: true });
    expect(await readEntitlements({ ...configured, PADDLE_ENVIRONMENT: 'live' }, a.userId)).toEqual(FREE_ENTITLEMENTS);
    // No billing at all is a self-hosted deployment, not a lapsed customer.
    expect(await readEntitlements({ ...configured, PADDLE_ENVIRONMENT: undefined }, a.userId)).toEqual(SELF_HOSTED_ENTITLEMENTS);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM billing_events WHERE event_id=?1').bind(value.event_id).first<{ n: number }>())!.n).toBe(1);
  });
  it('orders events at full Paddle precision and cannot revive a canceled subscription with an older update', async () => {
    const a = await account(), at = iso(Date.now() - 1000).slice(0, 19);
    const active = { ...a.event('active'), occurred_at: `${at}.123100Z` }, canceled = { ...a.event('canceled'), occurred_at: `${at}.123900Z` };
    active.data.updated_at = active.occurred_at; canceled.data.updated_at = canceled.occurred_at;
    expect(paddleTime(active.occurred_at)!.ms).toBe(paddleTime(canceled.occurred_at)!.ms);
    expect((await send(canceled)).status).toBe(200); expect((await send(active)).status).toBe(200);
    expect(await a.access()).toEqual(FREE_ENTITLEMENTS);
    expect((await env.DB.prepare('SELECT event_id FROM billing_subscriptions WHERE id=?1').bind(a.subscriptionId).first<{ event_id: string }>())!.event_id).toBe(canceled.event_id);
  });
  it('honors paid/trial periods and scheduled cancellation without requiring another event', async () => {
    const a = await account(), now = Date.now();
    await send(a.event('trialing', now - 3000)); expect((await a.access()).team).toBe(true);
    await send(a.event('active', now - 2000, { scheduled_change: { action: 'cancel', effective_at: iso(now + DAY) } })); expect((await a.access()).team).toBe(true);
    await send(a.event('active', now - 1000, { scheduled_change: { action: 'cancel', effective_at: iso(now - 500) } })); expect(await a.access()).toEqual(FREE_ENTITLEMENTS);
    await send(a.event('active', now, { current_billing_period: { starts_at: iso(now - DAY), ends_at: iso(now - 1) } })); expect(await a.access()).toEqual(FREE_ENTITLEMENTS);
  });
  it('does not extend recovery grace on repeated updates or late earlier failures, and resets after recovery', async () => {
    const a = await account(), now = Date.now();
    await send(a.event('active', now - 12 * DAY));
    await send(a.event('past_due', now - 2 * DAY)); expect((await a.access()).team).toBe(true);
    await send(a.event('past_due', now - DAY)); expect((await a.access()).team).toBe(true);
    // A delayed original failure must shorten the grace, despite being older than current state.
    await send(a.event('past_due', now - 8 * DAY)); expect(await a.access()).toEqual(FREE_ENTITLEMENTS);
    await send(a.event('active', now - 10000)); expect((await a.access()).team).toBe(true);
    await send(a.event('past_due', now - 5000)); expect((await a.access()).team).toBe(true);
    await send(a.event('past_due', now - 10 * DAY)); expect((await a.access()).team).toBe(true);
    await send(a.event('paused', now)); expect(await a.access()).toEqual(FREE_ENTITLEMENTS);
  });
  it('fails closed on an unknown price, unions separate paid subscriptions, and ignores transaction-success metadata', async () => {
    const a = await account(), now = Date.now();
    await send(a.event('active', now - 2000));
    await send(a.event('active', now - 1000, { items: [{ status: 'active', recurring: true, quantity: 1, price: { id: makeId('pri') } }] }));
    expect(await a.access()).toEqual(FREE_ENTITLEMENTS);
    const second = a.event('active', now); second.data.id = makeId('sub');
    await send(second); expect((await a.access()).team).toBe(true);
    await send({ ...a.event('active', now + 1), event_type: 'transaction.completed' });
    await send({ ...a.event('canceled', now + 2), data: { ...second.data, status: 'canceled', updated_at: iso(now + 2) } });
    expect(await a.access()).toEqual(FREE_ENTITLEMENTS);
  });
  it('rolls the delivery receipt back if the subscription write fails, so a retry can apply it', async () => {
    const a = await account(), value = a.event('active');
    await env.DB.exec("CREATE TRIGGER billing_test_failure BEFORE INSERT ON billing_subscriptions BEGIN SELECT RAISE(ABORT,'test failure'); END");
    try {
      expect((await send(value)).status).toBe(503);
      expect(await env.DB.prepare('SELECT event_id FROM billing_events WHERE event_id=?1').bind(value.event_id).first()).toBeNull();
    } finally { await env.DB.exec('DROP TRIGGER billing_test_failure'); }
    expect((await send(value)).status).toBe(200); expect((await a.access()).team).toBe(true);
  });
  it('uses the paid space owner for collaboration, retains an existing session and revokes removed members', async () => {
    const a = await account(), helper = await account(), space = crypto.randomUUID(), code = crypto.randomUUID();
    await send(a.event('active', Date.now() - 1000));
    await env.DB.prepare('INSERT INTO spaces (id,owner_user_id,name,created_at) VALUES (?1,?2,\'Workshop\',?3)').bind(space, a.userId, Date.now()).run();
    await env.DB.prepare('INSERT INTO space_members (space_id,user_id,role,created_at) VALUES (?1,?2,\'presenter\',?3)').bind(space, helper.userId, Date.now()).run();
    await recordLiveSession(configured, code, a.userId, 'Workshop', Date.now(), { spaceId: space });
    expect(await facilitatorAccess(configured, code, helper.userId)).not.toBeNull();
    await send(a.event('canceled'));
    expect(await a.access()).toEqual(FREE_ENTITLEMENTS);
    expect(await facilitatorAccess(configured, code, helper.userId)).not.toBeNull();
    const next = crypto.randomUUID();
    await recordLiveSession(configured, next, a.userId, 'Next workshop', Date.now(), { spaceId: space });
    expect(await facilitatorAccess(configured, next, helper.userId)).toBeNull();
    await env.DB.prepare('DELETE FROM space_members WHERE space_id=?1 AND user_id=?2').bind(space, helper.userId).run();
    expect(await facilitatorAccess(configured, code, helper.userId)).toBeNull();
  });
});
