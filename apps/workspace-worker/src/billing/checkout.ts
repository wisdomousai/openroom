import type { ControlEnv, SessionUser } from '../auth';
import { availablePlans } from './prices';
import { paddleId, record } from './paddle';
import { BillingError, paddleList, paddleRequest, type PaddleConfig } from './provider';

export interface CheckoutRow { id: string; price_id: string; transaction_id: string | null; attempted_at: number | null; created_at: number; claim: string | null }
export const currentCheckout = (env: ControlEnv, config: PaddleConfig, userId: string) => env.DB.prepare('SELECT id,price_id,transaction_id,attempted_at,created_at,claim FROM billing_checkouts WHERE environment=?1 AND user_id=?2 AND closed_at IS NULL').bind(config.catalog.environment, userId).first<CheckoutRow>();
export const billingCustomer = (env: ControlEnv, config: PaddleConfig, userId: string) => env.DB.prepare('SELECT customer_id FROM billing_customers WHERE environment=?1 AND user_id=?2').bind(config.catalog.environment, userId).first<{ customer_id: string }>();

async function customerForCheckout(env: ControlEnv, config: PaddleConfig, user: SessionUser, create = true): Promise<string | null> {
  const linked = await billingCustomer(env, config, user.id);
  if (linked) return linked.customer_id;
  const environment = config.catalog.environment;
  if (create) await env.DB.prepare('INSERT OR IGNORE INTO billing_customer_intents (environment,user_id,reference,email) VALUES (?1,?2,?3,?4)').bind(environment, user.id, crypto.randomUUID(), user.email).run();
  const intent = await env.DB.prepare('SELECT reference,email,attempted_at FROM billing_customer_intents WHERE environment=?1 AND user_id=?2').bind(environment, user.id).first<{ reference: string; email: string; attempted_at: number | null }>();
  if (!intent) { if (!create) return null; throw new BillingError('billing-customer-unavailable'); }
  if (!create && intent.attempted_at === null) return null;
  const matches = (await paddleList(config, '/customers', { email: intent.email, status: 'active,archived' })).filter((item) => item.email === intent.email);
  const ours = matches.filter((item) => record(item.custom_data) && item.custom_data.openroom_customer_reference === intent.reference);
  if (ours.length > 1 || (!ours.length && matches.length)) throw new BillingError('billing-customer-conflict', 409);
  let customer: unknown = ours[0];
  if (!customer) {
    if (!create || intent.attempted_at !== null) throw new BillingError('billing-checkout-pending');
    await env.DB.prepare('UPDATE billing_customer_intents SET attempted_at=?1 WHERE environment=?2 AND user_id=?3').bind(Date.now(), environment, user.id).run();
    try {
      customer = (await paddleRequest(config, '/customers', 'POST', { email: intent.email, ...(user.name ? { name: user.name } : {}), custom_data: { openroom_customer_reference: intent.reference } })).data;
    } catch (cause) {
      // A definite rejection is safe to retry. An uncertain write is recovered by reference.
      if (cause instanceof BillingError && cause.rejected) await env.DB.prepare('UPDATE billing_customer_intents SET attempted_at=NULL WHERE environment=?1 AND user_id=?2').bind(environment, user.id).run();
      throw cause;
    }
  }
  if (!record(customer) || !paddleId(customer.id, 'ctm') || customer.status !== 'active' || customer.email !== intent.email || !record(customer.custom_data) || customer.custom_data.openroom_customer_reference !== intent.reference) throw new BillingError('billing-customer-response-invalid');
  await env.DB.prepare('INSERT OR IGNORE INTO billing_customers (environment,customer_id,user_id,created_at) VALUES (?1,?2,?3,?4)').bind(environment, customer.id, user.id, Date.now()).run();
  const saved = await billingCustomer(env, config, user.id);
  if (saved?.customer_id !== customer.id) throw new BillingError('billing-customer-conflict', 409);
  return saved.customer_id;
}

function transaction(value: unknown, customerId: string, attempt?: CheckoutRow): Record<string, unknown> & { id: string; status: string } {
  if (!record(value) || !paddleId(value.id, 'txn') || typeof value.status !== 'string' || value.customer_id !== customerId || value.collection_mode !== 'automatic') throw new BillingError('billing-transaction-unavailable', 404);
  if (attempt && (!record(value.custom_data) || value.custom_data.openroom_checkout_reference !== attempt.id || !Array.isArray(value.items) || value.items.length !== 1 || !record(value.items[0]) || value.items[0].quantity !== 1 || !record(value.items[0].price) || value.items[0].price.id !== attempt.price_id)) throw new BillingError('billing-transaction-response-invalid');
  return value as Record<string, unknown> & { id: string; status: string };
}

async function checkoutTransaction(env: ControlEnv, config: PaddleConfig, customerId: string, attempt: CheckoutRow, origin: string, create: boolean) {
  let value: unknown;
  if (attempt.transaction_id) value = (await paddleRequest(config, `/transactions/${attempt.transaction_id}`)).data;
  else if (attempt.attempted_at !== null) {
    const matches = (await paddleList(config, '/transactions', { customer_id: customerId, 'created_at[GTE]': new Date(attempt.created_at - 60_000).toISOString() }))
      .filter((item) => record(item.custom_data) && item.custom_data.openroom_checkout_reference === attempt.id);
    if (matches.length > 1) throw new BillingError('billing-checkout-conflict', 409);
    if (!matches.length) throw new BillingError('billing-checkout-pending');
    value = matches[0];
  } else {
    if (!create) return null;
    if (!(await availablePlans(config)).some((plan) => plan.priceId === attempt.price_id)) throw new BillingError('billing-price-unavailable', 422);
    const changed = await env.DB.prepare('UPDATE billing_checkouts SET attempted_at=?1 WHERE id=?2 AND claim=?3 AND attempted_at IS NULL').bind(Date.now(), attempt.id, attempt.claim).run();
    if (changed.meta.changes !== 1) throw new BillingError('billing-checkout-busy', 409);
    try {
      value = (await paddleRequest(config, '/transactions', 'POST', { customer_id: customerId, collection_mode: 'automatic',
        items: [{ price_id: attempt.price_id, quantity: 1 }], custom_data: { openroom_checkout_reference: attempt.id }, checkout: { url: `${origin}/billing/pay` } })).data;
    } catch (cause) {
      if (cause instanceof BillingError && cause.rejected) await env.DB.prepare('UPDATE billing_checkouts SET attempted_at=NULL WHERE id=?1 AND claim=?2').bind(attempt.id, attempt.claim).run();
      throw cause;
    }
  }
  const result = transaction(value, customerId, attempt);
  const saved = await env.DB.prepare('UPDATE billing_checkouts SET transaction_id=?1 WHERE id=?2 AND claim=?3').bind(result.id, attempt.id, attempt.claim).run();
  if (saved.meta.changes !== 1) throw new BillingError('billing-checkout-busy', 409);
  return result;
}

export async function withCheckout<T>(env: ControlEnv, config: PaddleConfig, userId: string, work: (row: CheckoutRow) => Promise<T>): Promise<T> {
  const row = await currentCheckout(env, config, userId);
  if (!row) throw new BillingError('billing-checkout-not-found', 404);
  const claim = crypto.randomUUID(), now = Date.now();
  const locked = await env.DB.prepare('UPDATE billing_checkouts SET claim=?1,lease_until=?2 WHERE id=?3 AND closed_at IS NULL AND lease_until<=?4').bind(claim, now + 10 * 60_000, row.id, now).run();
  if (locked.meta.changes !== 1) throw new BillingError('billing-checkout-busy', 409);
  try {
    const lockedRow = await currentCheckout(env, config, userId);
    if (!lockedRow || lockedRow.id !== row.id || lockedRow.claim !== claim) throw new BillingError('billing-checkout-busy', 409);
    return await work(lockedRow);
  }
  finally { await env.DB.prepare('UPDATE billing_checkouts SET claim=NULL,lease_until=0 WHERE id=?1 AND claim=?2').bind(row.id, claim).run(); }
}

export async function startCheckout(env: ControlEnv, config: PaddleConfig, user: SessionUser, priceId: string, origin: string) {
  if (!config.catalog.prices[priceId]) throw new BillingError('billing-price-unavailable', 422);
  // Exactly one open checkout per account, across tabs, devices and repeated HTTP calls.
  await env.DB.prepare('INSERT OR IGNORE INTO billing_checkouts (id,environment,user_id,price_id,created_at) VALUES (?1,?2,?3,?4,?5)').bind(crypto.randomUUID(), config.catalog.environment, user.id, priceId, Date.now()).run();
  return withCheckout(env, config, user.id, async (attempt) => {
    if (attempt.price_id !== priceId) throw new BillingError('billing-checkout-in-progress', 409);
    const customerId = await customerForCheckout(env, config, user);
    if (!customerId) throw new BillingError('billing-customer-unavailable');
    const existing = await paddleList(config, '/subscriptions', { customer_id: customerId, status: 'active,trialing,past_due,paused' });
    if (existing.some((item) => item.customer_id === customerId && ['active', 'trialing', 'past_due', 'paused'].includes(String(item.status)))) {
      if (!attempt.transaction_id && attempt.attempted_at === null) await env.DB.prepare('UPDATE billing_checkouts SET closed_at=?1 WHERE id=?2 AND claim=?3').bind(Date.now(), attempt.id, attempt.claim).run();
      throw new BillingError('billing-subscription-exists', 409);
    }
    const value = await checkoutTransaction(env, config, customerId, attempt, origin, true);
    if (value && ['completed', 'canceled'].includes(value.status)) await env.DB.prepare('UPDATE billing_checkouts SET closed_at=?1 WHERE id=?2 AND claim=?3').bind(Date.now(), attempt.id, attempt.claim).run();
    if (!value || !['draft', 'ready'].includes(value.status)) throw new BillingError(value?.status === 'canceled' ? 'billing-checkout-canceled' : 'billing-payment-processing', 409);
    return { checkoutUrl: `${origin}/billing/pay?_ptxn=${value.id}`, attemptId: attempt.id };
  });
}

export async function cancelCheckout(env: ControlEnv, config: PaddleConfig, user: SessionUser, attemptId: string, origin: string) {
  return withCheckout(env, config, user.id, async (attempt) => {
    if (attempt.id !== attemptId) throw new BillingError('billing-checkout-changed', 409);
    const customer = await billingCustomer(env, config, user.id);
    const value = customer ? await checkoutTransaction(env, config, customer.customer_id, attempt, origin, false) : null;
    if (value && value.status !== 'canceled') {
      if (!['draft', 'ready'].includes(value.status)) throw new BillingError('billing-payment-processing', 409);
      const result = transaction((await paddleRequest(config, `/transactions/${value.id}`, 'PATCH', { status: 'canceled' })).data, customer!.customer_id, attempt);
      if (result.status !== 'canceled') throw new BillingError('billing-checkout-pending');
    }
    await env.DB.prepare('UPDATE billing_checkouts SET closed_at=?1 WHERE id=?2 AND claim=?3').bind(Date.now(), attempt.id, attempt.claim).run();
    return { canceled: true };
  });
}

export async function checkoutDetails(env: ControlEnv, config: PaddleConfig, userId: string, transactionId: string) {
  if (!paddleId(transactionId, 'txn')) throw new BillingError('billing-transaction-unavailable', 404);
  const customer = await billingCustomer(env, config, userId);
  if (!customer) throw new BillingError('billing-transaction-unavailable', 404);
  const value = transaction((await paddleRequest(config, `/transactions/${transactionId}`)).data, customer.customer_id);
  if (value.id !== transactionId) throw new BillingError('billing-transaction-response-invalid');
  if (['completed', 'canceled'].includes(value.status)) await env.DB.prepare('UPDATE billing_checkouts SET closed_at=?1 WHERE environment=?2 AND user_id=?3 AND transaction_id=?4 AND closed_at IS NULL').bind(Date.now(), config.catalog.environment, userId, value.id).run();
  return { transactionId: value.id, status: value.status, subscriptionId: paddleId(value.subscription_id, 'sub') ? value.subscription_id : null, environment: config.catalog.environment, clientToken: config.clientToken };
}

/** Recover only; background work never starts another purchase or creates a customer. */
export async function recoverCheckout(env: ControlEnv, config: PaddleConfig, user: SessionUser): Promise<void> {
  if (!await currentCheckout(env, config, user.id)) return;
  await withCheckout(env, config, user.id, async (attempt) => {
    const customerId = await customerForCheckout(env, config, user, false);
    if (!customerId) return;
    const value = await checkoutTransaction(env, config, customerId, attempt, '', false);
    if (value && ['completed', 'canceled'].includes(value.status)) await env.DB.prepare('UPDATE billing_checkouts SET closed_at=?1 WHERE id=?2 AND claim=?3').bind(Date.now(), attempt.id, attempt.claim).run();
  });
}
