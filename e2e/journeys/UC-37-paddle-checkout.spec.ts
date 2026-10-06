import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { facilitatorAccounts } from '../fixtures/facilitators';
import { waitForWorker } from '../fixtures/session';

// Billing API and Paddle.js are deterministic fixtures here. Worker tests verify
// provider ownership, signatures and durable writes; this journey proves the UI.
const priceId = 'pri_01gsz8x8sawmvhz1pv30nge1ke', transactionId = 'txn_01hv8xbtmb6zc7c264ycteehth';
const subscriptionId = 'sub_01h04vsc0qhwtsbsxh3422wjs4';
const sdk = `window.__paddle = {opens:[],initializations:0}; window.Paddle = {
  Environment:{set:value=>window.__paddle.environment=value},
  Initialize:options=>{window.__paddle.initializations++;window.__paddle.token=options.token;window.__paddle.event=options.eventCallback;},
  Checkout:{open:options=>window.__paddle.opens.push(options)}
};`;
const emit = (page: Page, name: string) => page.evaluate((event) => (window as any).__paddle.event({ name: event }), name);
async function fixture(context: BrowserContext) {
  const state = { pending: false, paid: false, granted: false, authorized: true, sdkLoads: 0, syncCalls: 0, failSync: false, failSdk: false, order: [] as string[] };
  await context.route('https://cdn.paddle.com/paddle/v2/paddle.js', async (route) => {
    state.sdkLoads++; state.order.push('sdk');
    if (state.failSdk) { state.failSdk = false; await route.abort(); } else await route.fulfill({ contentType: 'application/javascript', body: sdk });
  });
  await context.route('**/api/my/billing**', async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const answer = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'cache-control': 'no-store' } });
    if (url.pathname.endsWith('/sync')) {
      expect(request.headers()['x-openroom-csrf']).toBe('1'); expect(request.postDataJSON()).toEqual({}); state.syncCalls++;
      return state.failSync ? answer({ error: 'billing-provider-unavailable' }, 503) : answer({ state: 'updated', checkoutIssue: null });
    }
    if (url.pathname.endsWith('/plans')) return answer({ plans: [{ priceId, name: 'Tutoring monthly', capabilities: ['team', 'keep'], currency: 'CHF', amount: '2400', interval: 'month', frequency: 1, hasTrial: false }] });
    if (url.pathname.endsWith('/portal')) return answer({ portalUrl: 'https://sandbox-customer-portal.paddle.com/cpl_fixture?token=temporary-fixture' });
    if (url.pathname.endsWith('/checkout')) {
      if (method === 'GET') {
        state.order.push('ownership');
        if (!state.authorized) return answer({ error: 'unauthorized' }, 401);
        return answer({ transactionId, status: state.paid ? 'completed' : 'draft', subscriptionId: state.paid ? subscriptionId : null, environment: 'sandbox', clientToken: 'test_fixture' });
      }
      expect(request.headers()['x-openroom-csrf']).toBe('1');
      if (method === 'DELETE') { expect(request.postDataJSON()).toEqual({ attemptId: 'fixture-attempt' }); state.pending = false; return answer({ canceled: true }); }
      expect(request.postDataJSON()).toEqual({ priceId }); state.pending = true;
      return answer({ checkoutUrl: `${url.origin}/billing/pay?_ptxn=${transactionId}`, attemptId: 'fixture-attempt' });
    }
    return answer({ available: true, environment: 'sandbox', canManage: state.pending || state.paid, syncState: state.failSync ? 'attention' : 'checked', pendingCheckout: state.pending && !state.paid ? { id: 'fixture-attempt', priceId, name: 'Tutoring monthly' } : null,
      subscriptions: state.paid ? [{ id: subscriptionId, name: 'Tutoring monthly', status: 'active', hasAccess: state.granted, scheduledStop: false }] : [] });
  });
  return state;
}
test.beforeAll(async () => { await waitForWorker(); });
test('chooses and cancels a plan, completes checkout only after verified access, and opens billing management', async ({ page }, testInfo) => {
  const accounts = facilitatorAccounts(), state = await fixture(page.context());
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  try {
    await accounts.owner.signIn(page.context());
    await page.goto('/host/#/settings'); await page.getByRole('link', { name: 'Open billing', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Choose a plan' })).toBeVisible();
    await expect(page.getByText('CHF', { exact: false }).first()).toContainText('24.00');
    await page.screenshot({ path: testInfo.outputPath('billing-plans.png'), fullPage: true });
    await page.getByRole('button', { name: 'Choose Tutoring monthly' }).click();
    await expect(page.getByRole('link', { name: 'Continue to secure checkout', exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel unfinished checkout' }).click();
    await expect(page.getByRole('button', { name: 'Choose Tutoring monthly' })).toBeVisible();
    await page.getByRole('button', { name: 'Choose Tutoring monthly' }).click();
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('link', { name: 'Continue to secure checkout', exact: false }).click();
    const checkout = await popupPromise;
    checkout.on('pageerror', (error) => errors.push(error.message));
    await expect(checkout.getByRole('heading', { name: 'Sandbox checkout' })).toBeVisible();
    expect(state.order.slice(0, 2)).toEqual(['ownership', 'sdk']);
    expect(new URL(checkout.url()).search).toBe('');
    expect(new URL(checkout.url()).hash).toBe(`#transaction=${transactionId}`);
    expect(await checkout.evaluate(() => ({ ...(window as any).__paddle, event: undefined }))).toMatchObject({ initializations: 1, token: 'test_fixture', environment: 'sandbox', opens: [{ transactionId, settings: { allowLogout: false, showAddTaxId: true, displayMode: 'overlay' } }] });
    const checkoutResponse = await checkout.request.get('/billing/pay');
    expect(checkoutResponse.status()).toBe(200); expect(checkoutResponse.headers()['cache-control']).toBe('no-store');
    expect(checkoutResponse.headers()['content-security-policy']).toContain('https://cdn.paddle.com');
    await emit(checkout, 'checkout.completed');
    await expect(checkout.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
    await expect(checkout.getByRole('heading', { name: 'Your subscription is ready' })).toHaveCount(0);
    state.paid = true;
    await expect.poll(() => state.order.filter((call) => call === 'ownership').length).toBeGreaterThan(2);
    await expect(checkout.getByRole('heading', { name: 'Your subscription is ready' })).toHaveCount(0);
    await expect.poll(() => state.syncCalls).toBe(1);
    state.granted = true;
    await expect(checkout.getByRole('heading', { name: 'Your subscription is ready' })).toBeVisible();
    await checkout.setViewportSize({ width: 360, height: 780 });
    await checkout.screenshot({ path: testInfo.outputPath('checkout-confirmed-mobile.png'), fullPage: true });
    expect(await checkout.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    state.failSync = true;
    await page.getByRole('button', { name: 'Refresh billing' }).click();
    await expect(page.getByRole('alert')).toContainText('Billing could not be reached');
    await expect(page.getByText('Part of your billing update is still pending.', { exact: false })).toBeVisible();
    state.failSync = false;
    await page.getByRole('button', { name: 'Refresh billing' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('Paid features are available.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Manage billing', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Open secure billing portal', exact: false })).toHaveAttribute('href', 'https://sandbox-customer-portal.paddle.com/cpl_fixture?token=temporary-fixture');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('billing-active-mobile.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { accounts.cleanup(); }
});
test('checks account access before loading Paddle, retries SDK failure, and reopens a closed checkout', async ({ page }, testInfo) => {
  const state = await fixture(page.context()); state.authorized = false;
  await page.goto(`/billing/pay?_ptxn=${transactionId}`);
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible(); expect(state.sdkLoads).toBe(0);
  state.authorized = true; state.failSdk = true;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout could not open' })).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Sandbox checkout' })).toBeVisible();
  await emit(page, 'checkout.closed');
  await expect(page.getByRole('heading', { name: 'Checkout is still open' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue payment' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__paddle.opens.length)).toBe(2);
  expect(await page.evaluate(() => (window as any).__paddle.initializations)).toBe(1);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.screenshot({ path: testInfo.outputPath('checkout-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
