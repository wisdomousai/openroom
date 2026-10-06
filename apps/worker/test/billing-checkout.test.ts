import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { sha256Hex } from '../src/api-tokens';
import { signCookieValue } from '../src/tokens';
import { billingRetrySql, prepareBillingRetry } from '../src/billing/support-retry';

const PRICE = 'pri_01gsz8x8sawmvhz1pv30nge1ke', OTHER = 'pri_01gsz91wy9k1yn7kx82aafwvea';
const config = { ...env, PADDLE_ENVIRONMENT: 'sandbox', PADDLE_WEBHOOK_SECRET: 'fixture-webhook', PADDLE_API_KEY: 'fixture-api-key', PADDLE_CLIENT_TOKEN: 'test_fixture',
  PADDLE_PRICE_CATALOG: JSON.stringify({ environment: 'sandbox', prices: { [PRICE]: { name: 'Tutoring monthly', capabilities: ['team'] }, [OTHER]: { name: 'Training annual', capabilities: ['team', 'branding'] } } }) };
afterEach(() => vi.unstubAllGlobals());

async function fixture() {
  const id = crypto.randomUUID(), session = crypto.randomUUID(), email = `${id}@example.test`;
  await env.DB.prepare('INSERT INTO users (id,google_sub,email,name,created_at) VALUES (?1,?1,?2,\'Alex\',?3)').bind(id, email, Date.now()).run();
  await env.DB.prepare('INSERT INTO auth_sessions (id,user_id,created_at,expires_at) VALUES (?1,?2,?3,?4)').bind(session, id, Date.now(), Date.now() + 3600000).run();
  const cookie = `or_session=${encodeURIComponent(await signCookieValue('test-secret', session))}`;
  const call = (path = '', method = 'GET', body?: object, csrf = true) => worker.fetch(new Request(`https://openroom.test/api/my/billing${path}`, { method,
    headers: { cookie, ...(csrf ? { 'x-openroom-csrf': '1' } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), config);
  return { id, email, call };
}
function provider(email: string) {
  const customerId = `ctm_${crypto.randomUUID().replaceAll('-', '').slice(0, 26)}`;
  let transactionId = '';
  let customer: Record<string, unknown> | null = null, txn: Record<string, unknown> | null = null;
  let subscriptions: Record<string, unknown>[] = [], lostCustomer = false, lostTransaction = false, rejectTransaction = false;
  let failedCreate: 'customer' | 'transaction' | null = null;
  const calls: { method: string; url: URL; body: Record<string, unknown> }[] = [];
  let hold: (() => Promise<void>) | undefined;
  let portalHost = 'sandbox-customer-portal.paddle.com', recurring = true;
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    const url = new URL(input), method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : {};
    expect(url.origin).toBe('https://sandbox-api.paddle.com'); expect(new Headers(init.headers).get('authorization')).toBe('Bearer fixture-api-key');
    calls.push({ method, url, body });
    const answer = (data: unknown, status = 200) => Response.json({ data, meta: { pagination: { has_more: false } } }, { status });
    if (url.pathname === '/customers' && method === 'GET') return answer(customer ? [customer] : []);
    if (url.pathname === '/customers' && method === 'POST') {
      if (hold) await hold();
      if (failedCreate === 'customer') { failedCreate = null; throw new Error('request lost before creation'); }
      customer = { ...body, id: customerId, status: 'active' };
      if (lostCustomer) { lostCustomer = false; throw new Error('reply lost'); }
      return answer(customer, 201);
    }
    if (url.pathname === '/subscriptions') return answer(subscriptions);
    if (url.pathname === '/transactions' && method === 'GET') return answer(txn ? [txn] : []);
    if (url.pathname === '/transactions' && method === 'POST') {
      if (failedCreate === 'transaction') { failedCreate = null; throw new Error('request lost before creation'); }
      if (rejectTransaction) { rejectTransaction = false; return Response.json({ error: 'configuration' }, { status: 422 }); }
      transactionId = `txn_${crypto.randomUUID().replaceAll('-', '').slice(0, 26)}`;
      txn = { ...body, id: transactionId, status: 'draft', items: [{ quantity: 1, price: { id: body.items[0].price_id } }] };
      if (lostTransaction) { lostTransaction = false; throw new Error('reply lost'); }
      return answer(txn, 201);
    }
    if (url.pathname === `/transactions/${transactionId}` && method === 'GET') return answer(txn);
    if (url.pathname === `/transactions/${transactionId}` && method === 'PATCH') { txn = { ...txn!, status: body.status }; return answer(txn); }
    if (url.pathname === `/customers/${customerId}/portal-sessions`) return answer({ customer_id: customerId, urls: { general: { overview: `https://${portalHost}/cpl_fixture?action=overview&token=temporary-fixture` } } });
    if (url.pathname === '/prices') return answer([PRICE, OTHER].map((id) => ({ id, status: 'active', unit_price: { amount: '2400', currency_code: 'CHF' }, billing_cycle: recurring ? { interval: 'month', frequency: 1 } : null, quantity: { minimum: 1, maximum: 1 }, trial_period: null })));
    throw new Error(`Unexpected fixture request: ${method} ${url.pathname}`);
  });
  return { calls, customerId, wrongPortal: () => { portalHost = 'untrusted.example'; }, oneTime: () => { recurring = false; }, get transactionId() { return transactionId; }, loseCustomer: () => { lostCustomer = true; }, loseTransaction: () => { lostTransaction = true; }, rejectTransaction: () => { rejectTransaction = true; },
    hold: (work: () => Promise<void>) => { hold = work; }, foreignCustomer: () => { customer = { id: customerId, email, status: 'active', custom_data: { openroom_customer_reference: 'someone-else' } }; },
    paid: () => { txn!.status = 'completed'; }, subscribe: () => { subscriptions = [{ customer_id: customerId, status: 'active' }]; },
    failBeforeCreate: (kind: 'customer' | 'transaction') => { failedCreate = kind; },
  };
}

describe('account-owned Paddle checkout', () => {
  it('uses only approved prices and the authenticated account; links before payment without granting access', async () => {
    const a = await fixture(), p = provider(a.email);
    expect((await a.call('/checkout', 'POST', { priceId: PRICE }, false)).status).toBe(403);
    expect((await a.call('/checkout', 'POST', { priceId: 'unknown' })).status).toBe(422);
    expect((await a.call('/checkout', 'POST', { priceId: PRICE, userId: 'someone-else' })).status).toBe(422);
    expect(p.calls).toHaveLength(0);
    const started = await a.call('/checkout', 'POST', { priceId: PRICE }); expect(started.status).toBe(200);
    const link = await started.json() as { checkoutUrl: string; attemptId: string };
    expect(link.checkoutUrl).toBe(`https://openroom.test/billing/pay?_ptxn=${p.transactionId}`);
    const body = p.calls.find((call) => call.method === 'POST' && call.url.pathname === '/transactions')!.body;
    expect(body).toMatchObject({ customer_id: p.customerId, collection_mode: 'automatic', items: [{ price_id: PRICE, quantity: 1 }], checkout: { url: 'https://openroom.test/billing/pay' } });
    const status = await (await a.call()).json() as { subscriptions: unknown[]; pendingCheckout: { id: string } };
    expect(status.subscriptions).toEqual([]); expect(status.pendingCheckout.id).toBe(link.attemptId);
    expect((await env.DB.prepare('SELECT customer_id FROM billing_customers WHERE user_id=?1').bind(a.id).first<{ customer_id: string }>())!.customer_id).toBe(p.customerId);
    expect((await a.call('/checkout', 'POST', { priceId: PRICE })).status).toBe(200);
    expect(p.calls.filter((call) => call.method === 'POST' && call.url.pathname === '/transactions')).toHaveLength(1);
  });
  it.each(['customer', 'transaction'])('recovers a lost %s reply using its durable reference', async (kind) => {
    const a = await fixture(), p = provider(a.email);
    if (kind === 'customer') p.loseCustomer(); else p.loseTransaction();
    expect((await a.call('/checkout', 'POST', { priceId: PRICE })).status).toBe(503);
    expect((await a.call('/checkout', 'POST', { priceId: PRICE })).status).toBe(200);
    expect(p.calls.filter((call) => call.method === 'POST' && call.url.pathname === '/customers')).toHaveLength(1);
    expect(p.calls.filter((call) => call.method === 'POST' && call.url.pathname === '/transactions')).toHaveLength(1);
  });
  it.each(['customer', 'transaction'])('recovers an uncertain %s write from authenticated refresh without making another purchase', async (kind) => {
    const a = await fixture(), p = provider(a.email);
    if (kind === 'customer') p.loseCustomer(); else p.loseTransaction();
    expect((await a.call('/checkout', 'POST', { priceId: PRICE })).status).toBe(503);
    const before = p.calls.filter((call) => call.method === 'POST').length;
    expect((await a.call('/sync', 'POST', {}, false)).status).toBe(403);
    expect((await a.call('/sync', 'POST', { userId: 'someone-else' })).status).toBe(422);
    const synced = await a.call('/sync', 'POST', {}); expect(synced.status).toBe(200);
    expect(await synced.json()).toEqual({ state: 'updated', checkoutIssue: null });
    expect(p.calls.filter((call) => call.method === 'POST')).toHaveLength(before);
    expect((await env.DB.prepare('SELECT customer_id FROM billing_customers WHERE user_id=?1').bind(a.id).first<{ customer_id: string }>())!.customer_id).toBe(p.customerId);
    const calls = p.calls.length;
    expect(await (await a.call('/sync', 'POST', {})).json()).toEqual({ state: 'recent', checkoutIssue: null });
    expect(p.calls).toHaveLength(calls);
    expect((await a.call('/checkout', 'POST', { priceId: PRICE })).status).toBe(200);
    expect(p.calls.filter((call) => call.method === 'POST' && call.url.pathname === '/transactions')).toHaveLength(1);
  });
  it.each(['customer', 'transaction'] as const)('resumes an uncommitted %s write only after an exact support repair, without granting access', async (kind) => {
    const a = await fixture(), p = provider(a.email); p.failBeforeCreate(kind);
    expect((await a.call('/checkout', 'POST', { priceId: PRICE })).status).toBe(503);
    const checkout = (await env.DB.prepare('SELECT id,attempted_at FROM billing_checkouts WHERE user_id=?1').bind(a.id).first<{ id: string; attempted_at: number | null }>())!;
    const intent = (await env.DB.prepare('SELECT reference,attempted_at FROM billing_customer_intents WHERE user_id=?1').bind(a.id).first<{ reference: string; attempted_at: number }>())!;
    const support = { kind, environment: 'sandbox', userId: a.id, checkoutId: checkout.id,
      attemptedAt: kind === 'customer' ? intent.attempted_at : checkout.attempted_at, confirmedAt: Date.now(), supportCase: 'fixture-case-123', conclusion: 'not-created',
      ...(kind === 'customer' ? { customerReference: intent.reference } : { customerId: p.customerId, priceId: PRICE }) };
    const writes = () => p.calls.filter((call) => call.method === 'POST').length;
    const before = writes();
    expect((await a.call('/checkout', 'POST', { priceId: PRICE })).status).toBe(503);
    expect(await (await a.call('/sync', 'POST', {})).json()).toEqual({ state: 'updated', checkoutIssue: 'billing-checkout-pending' });
    expect(writes()).toBe(before);
    expect(() => prepareBillingRetry({ ...support, conclusion: 'not-found-in-list' })).toThrow('inconclusive');
    expect(() => prepareBillingRetry({ ...support, confirmedAt: Date.now() + 60_000 })).toThrow('future');
    expect(() => prepareBillingRetry({ ...support, apiKey: 'do-not-export' })).toThrow('omit emails');
    const prepared = prepareBillingRetry(support);
    const repair = () => env.DB.prepare(prepared.sql).bind(...prepared.values).run();
    // A live checkout lease, wrong environment and stale attempted-write evidence cannot be reset.
    await env.DB.prepare('UPDATE billing_checkouts SET lease_until=?1 WHERE id=?2').bind(Date.now() + 60_000, checkout.id).run();
    expect((await repair()).meta.changes).toBe(0);
    await env.DB.prepare('UPDATE billing_checkouts SET lease_until=0 WHERE id=?1').bind(checkout.id).run();
    for (const altered of [{ environment: 'live' }, { attemptedAt: Number(support.attemptedAt) - 1 }, { userId: crypto.randomUUID() }, { checkoutId: crypto.randomUUID() },
      ...(kind === 'customer' ? [{ customerReference: crypto.randomUUID() }] : [{ customerId: 'ctm_00000000000000000000000000' }, { priceId: OTHER }])]) {
      const other = prepareBillingRetry({ ...support, ...altered });
      expect((await env.DB.prepare(other.sql).bind(...other.values).run()).meta.changes).toBe(0);
    }
    await env.DB.prepare('UPDATE billing_checkouts SET closed_at=?1 WHERE id=?2').bind(Date.now(), checkout.id).run();
    expect((await repair()).meta.changes).toBe(0);
    await env.DB.prepare('UPDATE billing_checkouts SET closed_at=NULL WHERE id=?1').bind(checkout.id).run();
    if (kind === 'customer') {
      await env.DB.prepare('INSERT INTO billing_customers (environment,customer_id,user_id,created_at) VALUES (\'sandbox\',?1,?2,?3)').bind(p.customerId, a.id, Date.now()).run();
      expect((await repair()).meta.changes).toBe(0);
      await env.DB.prepare('DELETE FROM billing_customers WHERE environment=\'sandbox\' AND user_id=?1').bind(a.id).run();
    } else {
      await env.DB.prepare('UPDATE billing_checkouts SET transaction_id=?1 WHERE id=?2').bind('txn_00000000000000000000000000', checkout.id).run();
      expect((await repair()).meta.changes).toBe(0);
      await env.DB.prepare('UPDATE billing_checkouts SET transaction_id=NULL WHERE id=?1').bind(checkout.id).run();
    }
    // Execute the exact standalone SQL generated for operators, including its changed-row result.
    const statements = billingRetrySql(support).split(';').map((sql) => sql.trim()).filter(Boolean);
    const result = await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
    expect(result.at(-1)!.results).toEqual([{ retry_enabled: 1 }]);
    expect((await repair()).meta.changes).toBe(0);
    expect(writes()).toBe(before);
    expect((await a.call('/checkout', 'POST', { priceId: PRICE })).status).toBe(200);
    expect((await repair()).meta.changes).toBe(0);
    expect(p.calls.filter((call) => call.method === 'POST' && call.url.pathname === '/customers')).toHaveLength(kind === 'customer' ? 2 : 1);
    expect(p.calls.filter((call) => call.method === 'POST' && call.url.pathname === '/transactions')).toHaveLength(kind === 'transaction' ? 2 : 1);
    expect((await (await a.call()).json() as { subscriptions: unknown[] }).subscriptions).toEqual([]);
  });
  it('serializes competing tabs and permits retry after a definite provider rejection', async () => {
    const a = await fixture(), p = provider(a.email);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }), ready = new Promise<void>((resolve) => { entered = resolve; });
    p.hold(async () => { entered(); await gate; }); p.rejectTransaction();
    const first = a.call('/checkout', 'POST', { priceId: PRICE }); await ready;
    expect((await a.call('/checkout', 'POST', { priceId: PRICE })).status).toBe(409);
    release(); expect((await first).status).toBe(503);
    expect((await a.call('/checkout', 'POST', { priceId: PRICE })).status).toBe(200);
  });
  it('never links a customer on an email match alone', async () => {
    const a = await fixture(), p = provider(a.email); p.foreignCustomer();
    expect((await a.call('/checkout', 'POST', { priceId: PRICE })).status).toBe(409);
    expect(await env.DB.prepare('SELECT customer_id FROM billing_customers WHERE user_id=?1').bind(a.id).first()).toBeNull();
    expect(p.calls.some((call) => call.method === 'POST')).toBe(false);
  });
  it('checks transaction ownership and generates temporary portal links for the current account only', async () => {
    const a = await fixture(), p = provider(a.email);
    await a.call('/checkout', 'POST', { priceId: PRICE });
    const another = await fixture();
    expect((await another.call(`/checkout?transactionId=${p.transactionId}`)).status).toBe(404);
    expect((await another.call('/portal', 'POST', {})).status).toBe(404);
    const details = await a.call(`/checkout?transactionId=${p.transactionId}`);
    expect(await details.json()).toMatchObject({ clientToken: 'test_fixture', transactionId: p.transactionId, environment: 'sandbox', status: 'draft' });
    expect((await a.call('/portal', 'POST', { customerId: 'another-customer' })).status).toBe(422);
    const portal = await a.call('/portal', 'POST', {});
    expect(portal.headers.get('cache-control')).toBe('no-store');
    expect(await portal.json()).toEqual({ portalUrl: 'https://sandbox-customer-portal.paddle.com/cpl_fixture?action=overview&token=temporary-fixture' });
    expect(p.calls.filter((call) => call.url.pathname.endsWith('/portal-sessions'))).toHaveLength(1);
    p.wrongPortal(); expect((await a.call('/portal', 'POST', {})).status).toBe(503);
  });
  it('cancels only the current unfinished checkout and rejects a paid transaction', async () => {
    const a = await fixture(), p = provider(a.email);
    const started = await (await a.call('/checkout', 'POST', { priceId: PRICE })).json() as { attemptId: string };
    expect((await a.call('/checkout', 'POST', { priceId: OTHER })).status).toBe(409);
    expect((await a.call('/checkout', 'DELETE', { attemptId: 'old-attempt' })).status).toBe(409);
    expect((await a.call('/checkout', 'DELETE', { attemptId: started.attemptId })).status).toBe(200);
    expect((await (await a.call()).json() as { pendingCheckout: unknown }).pendingCheckout).toBeNull();
    const next = await (await a.call('/checkout', 'POST', { priceId: OTHER })).json() as { attemptId: string };
    p.paid(); expect((await a.call('/checkout', 'DELETE', { attemptId: next.attemptId })).status).toBe(409);
    expect(p.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });
  it('rejects a configured price that is not recurring before creating a transaction', async () => {
    const a = await fixture(), p = provider(a.email); p.oneTime();
    expect((await a.call('/checkout', 'POST', { priceId: PRICE })).status).toBe(422);
    expect(p.calls.some((call) => call.url.pathname === '/transactions')).toBe(false);
  });
  it('uses the same account-owned billing service through MCP with a personal token', async () => {
    const a = await fixture(), p = provider(a.email), token = `orpat_${crypto.randomUUID()}_${crypto.randomUUID()}`;
    await env.DB.prepare('INSERT INTO api_tokens (id,user_id,name,token_hash,token_prefix,created_at) VALUES (?1,?2,?3,?4,?5,?6)').bind(crypto.randomUUID(), a.id, 'Billing test', await sha256Hex(token), token.slice(0, 12), Date.now()).run();
    const response = await worker.fetch(new Request('https://openroom.test/api/mcp', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'openroom_api', arguments: { method: 'POST', path: '/api/my/billing/checkout', body: { priceId: PRICE } } } }) }), config);
    expect(response.status).toBe(200);
    const result = await response.json() as { result: { isError?: boolean; content: { text: string }[] } };
    expect(result.result.isError, result.result.content[0]!.text).not.toBe(true);
    expect(result.result.content[0]!.text).toContain(`/billing/pay?_ptxn=${p.transactionId}`);
    expect((await env.DB.prepare('SELECT customer_id FROM billing_customers WHERE user_id=?1').bind(a.id).first<{ customer_id: string }>())!.customer_id).toBe(p.customerId);
  });
  it('prevents a second subscription and returns provider-sourced prices', async () => {
    const a = await fixture(), p = provider(a.email); p.subscribe();
    expect((await a.call('/checkout', 'POST', { priceId: PRICE })).status).toBe(409);
    expect(p.calls.some((call) => call.url.pathname === '/transactions')).toBe(false);
    expect((await (await a.call()).json() as { pendingCheckout: unknown }).pendingCheckout).toBeNull();
    expect(await (await a.call('/plans')).json()).toMatchObject({ plans: [{ priceId: PRICE, name: 'Tutoring monthly', capabilities: ['team'], amount: '2400', currency: 'CHF', interval: 'month', frequency: 1, hasTrial: false }, { priceId: OTHER, name: 'Training annual' }] });
  });
});
