import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEntitlements } from '../src/entitlements';
import { parseBillingEvent, parseBillingSubscription, paddleCatalog } from '../src/billing/paddle';
import { billingHash, compactBillingEvidence, recordBillingEvent, recordBillingSnapshot } from '../src/billing/state';
import { paddleConfig, paddleRequest } from '../src/billing/provider';
import { reconcileBillingAccount, reconcileEventStream } from '../src/billing/reconcile';

const DAY = 86_400_000, PRICE = 'pri_01gsz8x8sawmvhz1pv30nge1ke';
const configured = { ...env, PADDLE_ENVIRONMENT: 'sandbox', PADDLE_WEBHOOK_SECRET: 'fixture-webhook', PADDLE_API_KEY: 'fixture-key', PADDLE_CLIENT_TOKEN: 'test_fixture',
  PADDLE_PRICE_CATALOG: JSON.stringify({ environment: 'sandbox', prices: { [PRICE]: { name: 'Test plan', capabilities: ['team'] } } }) };
const config = paddleConfig(configured)!, catalog = paddleCatalog(configured)!;
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 26)}`;
const iso = (at: number) => new Date(at).toISOString();
afterEach(() => vi.unstubAllGlobals());

async function account(linked = true) {
  const user = { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test`, name: 'Alex' }, customerId = id('ctm'), subscriptionId = id('sub');
  await env.DB.prepare('INSERT INTO users (id,google_sub,email,name,created_at) VALUES (?1,?1,?2,?3,?4)').bind(user.id, user.email, user.name, Date.now()).run();
  const link = () => env.DB.prepare('INSERT INTO billing_customers (environment,customer_id,user_id,created_at) VALUES (\'sandbox\',?1,?2,?3)').bind(customerId, user.id, Date.now()).run();
  if (linked) await link();
  const data = (status = 'active', updated = Date.now()) => ({ id: subscriptionId, customer_id: customerId, status, updated_at: iso(updated),
    current_billing_period: { starts_at: iso(updated), ends_at: iso(Date.now() + 30 * DAY) }, scheduled_change: null,
    items: [{ status: 'active', recurring: true, quantity: 1, price: { id: PRICE } }] });
  const event = (status = 'active', at = Date.now(), eventId = id('evt'), type = status === 'past_due' ? 'subscription.past_due' : 'subscription.updated') => ({ event_id: eventId, event_type: type, occurred_at: iso(at), data: data(status, at) });
  const snapshot = (status = 'active', at = Date.now()) => recordBillingSnapshot(configured, catalog, parseBillingSubscription(data(status, at))!);
  const receive = async (value: ReturnType<typeof event>) => recordBillingEvent(configured, catalog, parseBillingEvent(value)!, await billingHash(new TextEncoder().encode(JSON.stringify(value))), 'webhook');
  return { user, customerId, subscriptionId, link, data, event, snapshot, receive, access: () => readEntitlements(configured, user.id) };
}
function provider(work: (url: URL) => unknown | Promise<unknown>) {
  const paths: string[] = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    const url = new URL(input); paths.push(url.pathname + url.search);
    expect(url.origin).toBe('https://sandbox-api.paddle.com'); expect(init.method).toBe('GET');
    const result = await work(url);
    return result instanceof Response ? result : Response.json({ data: result, meta: { pagination: { has_more: false } } });
  });
  return paths;
}
async function readyAgain(userId: string) {
  await env.DB.prepare('UPDATE billing_account_sync SET checked_at=0,next_at=0 WHERE user_id=?1').bind(userId).run();
}

describe('verified subscription reconciliation', () => {
  it('compares provider revisions, resolves equal revisions with an API snapshot, and never overwrites a newer event', async () => {
    const a = await account(), now = Date.now();
    await a.receive(a.event('active', now - 3000));
    await a.snapshot('canceled', now - 2000);
    const delayed = a.event('active', now - 3000); delayed.occurred_at = iso(now);
    await a.receive(delayed); expect((await a.access()).team).toBe(false);
    await a.receive(a.event('active', now - 2000)); expect((await a.access()).team).toBe(false);
    await a.receive(a.event('active', now - 1000)); expect((await a.access()).team).toBe(true);
    await a.snapshot('canceled', now - 2000); expect((await a.access()).team).toBe(true);
    await a.snapshot('canceled', now - 1000); expect((await a.access()).team).toBe(false);
  });
  it('does not manufacture grace from API reads or ordinary updates, and preserves the real failure through repeated checks and compaction', async () => {
    const a = await account(), now = Date.now();
    await a.snapshot('active', now - 12 * DAY);
    await a.snapshot('past_due', now - DAY); expect((await a.access()).team).toBe(false);
    await a.receive(a.event('past_due', now - 2 * DAY, id('evt'), 'subscription.updated')); expect((await a.access()).team).toBe(false);
    await a.receive(a.event('past_due', now - 3 * DAY)); expect((await a.access()).team).toBe(true);
    await a.snapshot('past_due', now); expect((await a.access()).team).toBe(true);
    await a.receive(a.event('past_due', now - 8 * DAY)); expect((await a.access()).team).toBe(false);
    await env.DB.prepare('UPDATE billing_events SET received_at=?1 WHERE subscription_id=?2').bind(now - 130 * DAY, a.subscriptionId).run();
    await compactBillingEvidence(configured, 'sandbox'); expect((await a.access()).team).toBe(false);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM billing_events WHERE subscription_id=?1').bind(a.subscriptionId).first<{ n: number }>())!.n).toBe(3);
    await a.snapshot('active', now + 1000); expect((await a.access()).team).toBe(true);
    await a.receive(a.event('past_due', now + 2000)); expect((await a.access()).team).toBe(true);
  });
  it('applies the current approved catalog without copying stale capabilities into subscription state', async () => {
    const a = await account(); await a.snapshot(); expect((await a.access()).team).toBe(true);
    const changed = { ...configured, PADDLE_PRICE_CATALOG: JSON.stringify({ environment: 'sandbox', prices: { [PRICE]: { name: 'Revised plan', capabilities: ['branding'] } } }) };
    const access = await readEntitlements(changed, a.user.id); expect(access.team).toBe(false); expect(access.branding).toBe(true);
    expect((await readEntitlements({ ...changed, PADDLE_PRICE_CATALOG: undefined }, a.user.id)).branding).toBe(false);
  });
  it('retains only normalized unlinked events and applies them after account ownership is established', async () => {
    const a = await account(false), failure = a.event('past_due', Date.now() - DAY);
    Object.assign(failure.data, { custom_data: { email: 'PRIVATE_EMAIL', card: 'PRIVATE_CARD' } });
    expect(await a.receive(failure)).toBe('unlinked'); expect((await a.access()).team).toBe(false);
    const pending = await env.DB.prepare('SELECT event_json FROM billing_pending_events WHERE event_id=?1').bind(failure.event_id).first<{ event_json: string }>();
    expect(pending!.event_json).not.toContain('PRIVATE_');
    await a.link(); provider(() => [a.data('past_due')]);
    await reconcileBillingAccount(configured, config, a.user, true);
    expect((await a.access()).team).toBe(true);
    expect(await env.DB.prepare('SELECT event_id FROM billing_pending_events WHERE event_id=?1').bind(failure.event_id).first()).toBeNull();
  });
  it('rejects another customer in provider results and records a safe retry diagnosis without changing access', async () => {
    const a = await account(); await a.snapshot();
    provider(() => [{ ...a.data('canceled'), customer_id: id('ctm'), secret: 'PRIVATE_PROVIDER_DATA' }]);
    await expect(reconcileBillingAccount(configured, config, a.user, true)).rejects.toThrow('billing-subscription-response-invalid');
    expect((await a.access()).team).toBe(true);
    const status = await env.DB.prepare('SELECT error,next_at FROM billing_account_sync WHERE user_id=?1').bind(a.user.id).first<{ error: string; next_at: number }>();
    expect(status!.error).toBe('billing-subscription-response-invalid'); expect(status!.next_at).toBeGreaterThan(Date.now());
  });
  it('serializes account refreshes and rate-limits successful and failed manual retries', async () => {
    const a = await account(); let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }), ready = new Promise<void>((resolve) => { entered = resolve; });
    const paths = provider(async () => { entered(); await gate; return [a.data()]; });
    const first = reconcileBillingAccount(configured, config, a.user, true); await ready;
    expect((await reconcileBillingAccount(configured, config, a.user, true)).state).toBe('busy');
    release(); expect((await first).state).toBe('updated');
    expect((await reconcileBillingAccount(configured, config, a.user, true)).state).toBe('recent'); expect(paths).toHaveLength(1);
    await readyAgain(a.user.id); provider(() => Response.json({ secret: 'PRIVATE_PROVIDER_DATA' }, { status: 401 }));
    await expect(reconcileBillingAccount(configured, config, a.user, true)).rejects.toThrow('billing-provider-auth');
    expect((await reconcileBillingAccount(configured, config, a.user, true)).state).toBe('recent');
  });
  it('checks missing subscriptions directly and does not treat an incomplete list as a cancellation', async () => {
    const a = await account(); await a.snapshot('active', Date.now() - 1000);
    let fail = true;
    const paths = provider((url) => url.pathname === '/subscriptions' ? [] : fail ? Response.json({}, { status: 503 }) : a.data('paused'));
    await expect(reconcileBillingAccount(configured, config, a.user, true)).rejects.toThrow('billing-provider-unavailable'); expect((await a.access()).team).toBe(true);
    await readyAgain(a.user.id); fail = false; await reconcileBillingAccount(configured, config, a.user, true); expect((await a.access()).team).toBe(false);
    expect(paths.some((path) => path === `/subscriptions/${a.subscriptionId}`)).toBe(true);
  });
});

describe('bounded event-stream recovery', () => {
  it('keeps its checkpoint on a malformed page, retries already-written events safely, then advances', async () => {
    // Each test owns a separate environment checkpoint while account IDs remain unique.
    await env.DB.prepare('DELETE FROM billing_sync WHERE environment=\'sandbox\'').run();
    const a = await account(), one = a.event('active', Date.now() - 1000, 'evt_00000000000000000000000001'), two = a.event('canceled', Date.now(), 'evt_00000000000000000000000002');
    let bad = true;
    const paths = provider((url) => {
      expect(url.pathname).toBe('/events'); expect(url.searchParams.get('order_by')).toBe('id[ASC]'); expect(url.searchParams.get('per_page')).toBe('50');
      return url.searchParams.has('after') ? [] : [one, bad ? { ...two, data: { ...two.data, updated_at: 'invalid' } } : two];
    });
    await expect(reconcileEventStream(configured, config)).rejects.toThrow('billing-event-page-invalid');
    expect((await env.DB.prepare('SELECT cursor FROM billing_sync WHERE environment=\'sandbox\'').first<{ cursor: string | null }>())!.cursor).toBeNull();
    bad = false; expect((await reconcileEventStream(configured, config)).processed).toBe(2); expect((await a.access()).team).toBe(false);
    expect(await env.DB.prepare('SELECT id FROM billing_subscriptions WHERE id=?1').bind(a.subscriptionId).first()).toBeNull();
    expect((await env.DB.prepare('SELECT next_at FROM billing_account_sync WHERE user_id=?1').bind(a.user.id).first<{ next_at: number }>())!.next_at).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM billing_events WHERE event_id=?1').bind(one.event_id).first<{ n: number }>())!.n).toBe(1);
    await reconcileEventStream(configured, config); expect(paths.at(-1)).toContain('after=evt_00000000000000000000000002');
  });
  it('stops after two pages and never follows an untrusted pagination URL', async () => {
    await env.DB.prepare('DELETE FROM billing_sync WHERE environment=\'sandbox\'').run();
    const a = await account(); let page = 0;
    const paths = provider(() => { page++; const value = a.event('active', Date.now(), `evt_${String(page + 10).padStart(26, '0')}`); return Response.json({ data: [value], meta: { pagination: { has_more: true, next: 'https://untrusted.example/steal-key' } } }); });
    const result = await reconcileEventStream(configured, config); expect(result.processed).toBe(2); expect(paths).toHaveLength(2);
    const never = vi.fn(); vi.stubGlobal('fetch', never);
    await expect(paddleRequest({ ...config, deadline: Date.now() - 1 }, '/events')).rejects.toThrow('billing-sync-budget-exhausted');
    await expect(reconcileEventStream(configured, { ...config, budget: { remaining: 0 } })).rejects.toThrow('billing-sync-budget-exhausted');
    expect(never).not.toHaveBeenCalled();
  });
});
