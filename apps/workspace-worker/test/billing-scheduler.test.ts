import { env } from 'cloudflare:test';
import { afterEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { readEntitlements } from '../src/entitlements';

const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 26)}`;
afterEach(() => vi.restoreAllMocks());
it('runs current-state repair through cron, continues after an event-stream failure and reports only redacted diagnostics', async () => {
  const user = crypto.randomUUID(), customer = id('ctm'), sub = id('sub'), price = id('pri'), now = Date.now();
  const configured = { ...env, PADDLE_ENVIRONMENT: 'sandbox', PADDLE_WEBHOOK_SECRET: 'fixture-secret', PADDLE_API_KEY: 'PRIVATE_KEY', PADDLE_CLIENT_TOKEN: 'test_fixture',
    PADDLE_PRICE_CATALOG: JSON.stringify({ environment: 'sandbox', prices: { [price]: { name: 'Fixture plan', capabilities: ['team'] } } }) };
  await env.DB.prepare('INSERT INTO users (id,google_sub,email,created_at) VALUES (?1,?1,?2,?3)').bind(user, `${user}@example.test`, now).run();
  await env.DB.prepare('INSERT INTO billing_customers (environment,customer_id,user_id,created_at) VALUES (\'sandbox\',?1,?2,?3)').bind(customer, user, now).run();
  let failed = false;
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input)); expect(url.origin).toBe('https://sandbox-api.paddle.com');
    if (url.pathname === '/events') return failed ? Response.json({ error: 'PRIVATE_PROVIDER_BODY' }, { status: 403 }) : Response.json({ data: [], meta: { pagination: { has_more: false } } });
    expect(url.pathname).toBe('/subscriptions'); expect(url.searchParams.get('customer_id')).toBe(customer);
    return Response.json({ data: [{ id: sub, customer_id: customer, status: failed ? 'canceled' : 'active', updated_at: new Date(now + (failed ? 1000 : 0)).toISOString(), scheduled_change: null,
      current_billing_period: { ends_at: new Date(now + 86_400_000).toISOString() }, items: [{ status: 'active', recurring: true, quantity: 1, price: { id: price } }] }], meta: { pagination: { has_more: false } } });
  });
  const controller = { cron: '*/5 * * * *', scheduledTime: now, noRetry() {} };
  await worker.scheduled(controller, configured); expect((await readEntitlements(configured, user)).team).toBe(true);
  failed = true; await env.DB.prepare('UPDATE billing_account_sync SET next_at=0 WHERE user_id=?1').bind(user).run();
  await expect(worker.scheduled(controller, configured)).rejects.toThrow('reconciliation needs attention');
  expect((await readEntitlements(configured, user)).team).toBe(false);
  expect(warnings.mock.calls).toHaveLength(1);
  const logged = JSON.stringify(warnings.mock.calls); expect(logged).toContain('billing-provider-auth'); expect(logged).not.toContain('PRIVATE_');
});
