import { reconcileBillingAccount } from './reconcile';
import { availablePlans } from './prices';
import { json, type ControlEnv } from '../auth';
import { requireControlUser } from '../control-auth';
import { readJson } from '../control-utils';
import { billingConfigured, parseEntitlements } from '../entitlements';
import { billingSubscriptions, subscriptionAccessUntil } from './access';
import { billingCustomer, cancelCheckout, checkoutDetails, currentCheckout, startCheckout } from './checkout';
import { record } from './paddle';
import { BillingError, paddleConfig, paddleRequest } from './provider';

/** All account clients use these routes; only completing payment takes place in Paddle Checkout. */
export async function billingRoute(request: Request, env: ControlEnv, url: URL): Promise<Response> {
  const leaf = url.pathname.slice('/api/my/billing'.length), method = request.method;
  const allowed = leaf === '' || leaf === '/plans' ? ['GET'] : leaf === '/checkout' ? ['GET', 'POST', 'DELETE'] : leaf === '/portal' || leaf === '/sync' ? ['POST'] : [];
  if (!allowed.length) return json({ error: 'not-found' }, 404);
  if (!allowed.includes(method)) return json({ error: 'method-not-allowed' }, 405);
  const guard = await requireControlUser(request, env, method !== 'GET');
  if (!guard.ok) return guard.response;
  const config = paddleConfig(env);
  if (!config) return leaf === '' ? json({ available: false, selfHosted: !billingConfigured(env), subscriptions: [], pendingCheckout: null, canManage: false }) : json({ error: 'billing-not-configured' }, 503);
  try {
    if (leaf === '') {
      const [customer, rows, pending, sync] = await Promise.all([billingCustomer(env, config, guard.user.id), billingSubscriptions(env, guard.user.id), currentCheckout(env, config, guard.user.id), env.DB.prepare('SELECT error,checked_at FROM billing_account_sync WHERE environment=?1 AND user_id=?2').bind(config.catalog.environment, guard.user.id).first<{ error: string | null; checked_at: number | null }>()]);
      return json({ available: true, environment: config.catalog.environment, canManage: Boolean(customer), syncState: sync?.error ? 'attention' : sync?.checked_at ? 'checked' : 'pending',
        subscriptions: rows.map((row) => {
          let ids: string[] = []; try { const value: unknown = JSON.parse(row.price_ids); if (Array.isArray(value)) ids = value.filter((id): id is string => typeof id === 'string'); } catch { /* unknown plan */ }
          return { id: row.id, name: ids.map((id) => config.catalog.prices[id]?.name ?? 'Subscription').join(' + '), status: row.status,
            hasAccess: subscriptionAccessUntil(row) > Date.now() && Object.values(parseEntitlements(row.entitlements)).some(Boolean), scheduledStop: row.scheduled_end !== null };
        }), pendingCheckout: pending ? { id: pending.id, priceId: pending.price_id, name: config.catalog.prices[pending.price_id]?.name ?? 'Selected plan' } : null });
    }
    if (leaf === '/sync') {
      const body = await readJson(request);
      if (!body || Object.keys(body).length !== 0) throw new BillingError('billing-invalid-request', 422);
      const result = await reconcileBillingAccount(env, { ...config, deadline: Date.now() + 25_000, budget: { remaining: 500 } }, guard.user, true);
      if (result.state === 'busy') throw new BillingError('billing-sync-busy', 409);
      return json(result);
    }
    if (leaf === '/plans') return json({ plans: await availablePlans(config) });
    if (leaf === '/portal') {
      const body = await readJson(request);
      if (!body || Object.keys(body).length !== 0) throw new BillingError('billing-invalid-request', 422);
      const customer = await billingCustomer(env, config, guard.user.id);
      if (!customer) throw new BillingError('billing-customer-not-found', 404);
      const { data } = await paddleRequest(config, `/customers/${customer.customer_id}/portal-sessions`, 'POST', {});
      if (!record(data) || data.customer_id !== customer.customer_id || !record(data.urls) || !record(data.urls.general) || typeof data.urls.general.overview !== 'string') throw new BillingError('billing-provider-response-invalid');
      const portal = new URL(data.urls.general.overview);
      const host = config.catalog.environment === 'sandbox' ? 'sandbox-customer-portal.paddle.com' : 'customer-portal.paddle.com';
      if (portal.protocol !== 'https:' || portal.hostname !== host || portal.username || portal.password || portal.port) throw new BillingError('billing-provider-response-invalid');
      // Temporary authenticated URL: return once, never store it in D1 or logs.
      return json({ portalUrl: portal.href });
    }
    if (method === 'GET') return json(await checkoutDetails(env, config, guard.user.id, url.searchParams.get('transactionId') ?? ''));
    const body = await readJson(request);
    if (!body || Object.keys(body).length !== 1) throw new BillingError('billing-invalid-request', 422);
    if (method === 'DELETE') {
      if (typeof body.attemptId !== 'string') throw new BillingError('billing-invalid-request', 422);
      return json(await cancelCheckout(env, config, guard.user, body.attemptId, url.origin));
    }
    if (typeof body.priceId !== 'string') throw new BillingError('billing-invalid-request', 422);
    return json(await startCheckout(env, config, guard.user, body.priceId, url.origin));
  } catch (cause) { return json({ error: cause instanceof BillingError ? cause.code : 'billing-unavailable' }, cause instanceof BillingError ? cause.status : 503); }
}
