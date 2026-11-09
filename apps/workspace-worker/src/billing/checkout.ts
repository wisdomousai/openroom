import { and, eq, isNull, lte } from 'drizzle-orm';
import type { ControlEnv, SessionUser } from '../auth';
import { orm } from '../db/client';
import { billingCheckouts, billingCustomerIntents, billingCustomers } from '../db/schema';
import { availablePlans } from './prices';
import { paddleId, record } from './paddle';
import { BillingError, paddleList, paddleRequest, type PaddleConfig } from './provider';

const c = billingCheckouts;
export const currentCheckout = (env: ControlEnv, config: PaddleConfig, userId: string) => orm(env).select({ id: c.id, priceId: c.priceId, transactionId: c.transactionId, attemptedAt: c.attemptedAt, createdAt: c.createdAt, claim: c.claim })
  .from(c).where(and(eq(c.environment, config.catalog.environment), eq(c.userId, userId), isNull(c.closedAt))).get();
type CheckoutRow = NonNullable<Awaited<ReturnType<typeof currentCheckout>>>;
type HeldCheckout = CheckoutRow & { claim: string };
export const billingCustomer = (env: ControlEnv, config: PaddleConfig, userId: string) => orm(env).select({ customerId: billingCustomers.customerId }).from(billingCustomers)
  .where(and(eq(billingCustomers.environment, config.catalog.environment), eq(billingCustomers.userId, userId))).get();
const intentOf = (environment: string, userId: string) => and(eq(billingCustomerIntents.environment, environment), eq(billingCustomerIntents.userId, userId));
const heldBy = (attempt: HeldCheckout) => and(eq(c.id, attempt.id), eq(c.claim, attempt.claim));

async function customerForCheckout(env: ControlEnv, config: PaddleConfig, user: SessionUser, create = true): Promise<string | null> {
  const linked = await billingCustomer(env, config, user.id);
  if (linked) return linked.customerId;
  const environment = config.catalog.environment;
  if (create) await orm(env).insert(billingCustomerIntents).values({ environment, userId: user.id, reference: crypto.randomUUID(), email: user.email }).onConflictDoNothing().run();
  const intent = await orm(env).select({ reference: billingCustomerIntents.reference, email: billingCustomerIntents.email, attemptedAt: billingCustomerIntents.attemptedAt })
    .from(billingCustomerIntents).where(intentOf(environment, user.id)).get();
  if (!intent) { if (!create) return null; throw new BillingError('billing-customer-unavailable'); }
  if (!create && intent.attemptedAt === null) return null;
  const matches = (await paddleList(config, '/customers', { email: intent.email, status: 'active,archived' })).filter((item) => item.email === intent.email);
  const ours = matches.filter((item) => record(item.custom_data) && item.custom_data.openroom_customer_reference === intent.reference);
  if (ours.length > 1 || (!ours.length && matches.length)) throw new BillingError('billing-customer-conflict', 409);
  let customer: unknown = ours[0];
  if (!customer) {
    if (!create || intent.attemptedAt !== null) throw new BillingError('billing-checkout-pending');
    await orm(env).update(billingCustomerIntents).set({ attemptedAt: Date.now() }).where(intentOf(environment, user.id)).run();
    try {
      customer = (await paddleRequest(config, '/customers', 'POST', { email: intent.email, ...(user.name ? { name: user.name } : {}), custom_data: { openroom_customer_reference: intent.reference } })).data;
    } catch (cause) {
      // A definite rejection is safe to retry. An uncertain write is recovered by reference.
      if (cause instanceof BillingError && cause.rejected) await orm(env).update(billingCustomerIntents).set({ attemptedAt: null }).where(intentOf(environment, user.id)).run();
      throw cause;
    }
  }
  if (!record(customer) || !paddleId(customer.id, 'ctm') || customer.status !== 'active' || customer.email !== intent.email || !record(customer.custom_data) || customer.custom_data.openroom_customer_reference !== intent.reference) throw new BillingError('billing-customer-response-invalid');
  await orm(env).insert(billingCustomers).values({ environment, customerId: customer.id, userId: user.id, createdAt: Date.now() }).onConflictDoNothing().run();
  const saved = await billingCustomer(env, config, user.id);
  if (saved?.customerId !== customer.id) throw new BillingError('billing-customer-conflict', 409);
  return saved.customerId;
}

function transaction(value: unknown, customerId: string, attempt?: CheckoutRow): Record<string, unknown> & { id: string; status: string } {
  if (!record(value) || !paddleId(value.id, 'txn') || typeof value.status !== 'string' || value.customer_id !== customerId || value.collection_mode !== 'automatic') throw new BillingError('billing-transaction-unavailable', 404);
  if (attempt && (!record(value.custom_data) || value.custom_data.openroom_checkout_reference !== attempt.id || !Array.isArray(value.items) || value.items.length !== 1 || !record(value.items[0]) || value.items[0].quantity !== 1 || !record(value.items[0].price) || value.items[0].price.id !== attempt.priceId)) throw new BillingError('billing-transaction-response-invalid');
  return value as Record<string, unknown> & { id: string; status: string };
}

async function checkoutTransaction(env: ControlEnv, config: PaddleConfig, customerId: string, attempt: HeldCheckout, origin: string, create: boolean) {
  let value: unknown;
  if (attempt.transactionId) value = (await paddleRequest(config, `/transactions/${attempt.transactionId}`)).data;
  else if (attempt.attemptedAt !== null) {
    const matches = (await paddleList(config, '/transactions', { customer_id: customerId, 'created_at[GTE]': new Date(attempt.createdAt - 60_000).toISOString() }))
      .filter((item) => record(item.custom_data) && item.custom_data.openroom_checkout_reference === attempt.id);
    if (matches.length > 1) throw new BillingError('billing-checkout-conflict', 409);
    if (!matches.length) throw new BillingError('billing-checkout-pending');
    value = matches[0];
  } else {
    if (!create) return null;
    if (!(await availablePlans(config)).some((plan) => plan.priceId === attempt.priceId)) throw new BillingError('billing-price-unavailable', 422);
    const changed = await orm(env).update(c).set({ attemptedAt: Date.now() }).where(and(heldBy(attempt), isNull(c.attemptedAt))).run();
    if (changed.meta.changes !== 1) throw new BillingError('billing-checkout-busy', 409);
    try {
      value = (await paddleRequest(config, '/transactions', 'POST', { customer_id: customerId, collection_mode: 'automatic',
        items: [{ price_id: attempt.priceId, quantity: 1 }], custom_data: { openroom_checkout_reference: attempt.id }, checkout: { url: `${origin}/billing/pay` } })).data;
    } catch (cause) {
      if (cause instanceof BillingError && cause.rejected) await orm(env).update(c).set({ attemptedAt: null }).where(heldBy(attempt)).run();
      throw cause;
    }
  }
  const result = transaction(value, customerId, attempt);
  const saved = await orm(env).update(c).set({ transactionId: result.id }).where(heldBy(attempt)).run();
  if (saved.meta.changes !== 1) throw new BillingError('billing-checkout-busy', 409);
  return result;
}

export async function withCheckout<T>(env: ControlEnv, config: PaddleConfig, userId: string, work: (row: HeldCheckout) => Promise<T>): Promise<T> {
  const row = await currentCheckout(env, config, userId);
  if (!row) throw new BillingError('billing-checkout-not-found', 404);
  const claim = crypto.randomUUID(), now = Date.now();
  const locked = await orm(env).update(c).set({ claim, leaseUntil: now + 10 * 60_000 }).where(and(eq(c.id, row.id), isNull(c.closedAt), lte(c.leaseUntil, now))).run();
  if (locked.meta.changes !== 1) throw new BillingError('billing-checkout-busy', 409);
  try {
    const lockedRow = await currentCheckout(env, config, userId);
    if (!lockedRow || lockedRow.id !== row.id || lockedRow.claim !== claim) throw new BillingError('billing-checkout-busy', 409);
    return await work({ ...lockedRow, claim });
  }
  finally { await orm(env).update(c).set({ claim: null, leaseUntil: 0 }).where(and(eq(c.id, row.id), eq(c.claim, claim))).run(); }
}

export async function startCheckout(env: ControlEnv, config: PaddleConfig, user: SessionUser, priceId: string, origin: string) {
  if (!config.catalog.prices[priceId]) throw new BillingError('billing-price-unavailable', 422);
  // Exactly one open checkout per account, across tabs, devices and repeated HTTP calls.
  await orm(env).insert(c).values({ id: crypto.randomUUID(), environment: config.catalog.environment, userId: user.id, priceId, createdAt: Date.now() }).onConflictDoNothing().run();
  return withCheckout(env, config, user.id, async (attempt) => {
    if (attempt.priceId !== priceId) throw new BillingError('billing-checkout-in-progress', 409);
    const customerId = await customerForCheckout(env, config, user);
    if (!customerId) throw new BillingError('billing-customer-unavailable');
    const existing = await paddleList(config, '/subscriptions', { customer_id: customerId, status: 'active,trialing,past_due,paused' });
    if (existing.some((item) => item.customer_id === customerId && ['active', 'trialing', 'past_due', 'paused'].includes(String(item.status)))) {
      if (!attempt.transactionId && attempt.attemptedAt === null) await orm(env).update(c).set({ closedAt: Date.now() }).where(heldBy(attempt)).run();
      throw new BillingError('billing-subscription-exists', 409);
    }
    const value = await checkoutTransaction(env, config, customerId, attempt, origin, true);
    if (value && ['completed', 'canceled'].includes(value.status)) await orm(env).update(c).set({ closedAt: Date.now() }).where(heldBy(attempt)).run();
    if (!value || !['draft', 'ready'].includes(value.status)) throw new BillingError(value?.status === 'canceled' ? 'billing-checkout-canceled' : 'billing-payment-processing', 409);
    return { checkoutUrl: `${origin}/billing/pay?_ptxn=${value.id}`, attemptId: attempt.id };
  });
}

export async function cancelCheckout(env: ControlEnv, config: PaddleConfig, user: SessionUser, attemptId: string, origin: string) {
  return withCheckout(env, config, user.id, async (attempt) => {
    if (attempt.id !== attemptId) throw new BillingError('billing-checkout-changed', 409);
    const customer = await billingCustomer(env, config, user.id);
    const value = customer ? await checkoutTransaction(env, config, customer.customerId, attempt, origin, false) : null;
    if (value && value.status !== 'canceled') {
      if (!['draft', 'ready'].includes(value.status)) throw new BillingError('billing-payment-processing', 409);
      const result = transaction((await paddleRequest(config, `/transactions/${value.id}`, 'PATCH', { status: 'canceled' })).data, customer!.customerId, attempt);
      if (result.status !== 'canceled') throw new BillingError('billing-checkout-pending');
    }
    await orm(env).update(c).set({ closedAt: Date.now() }).where(heldBy(attempt)).run();
    return { canceled: true };
  });
}

export async function checkoutDetails(env: ControlEnv, config: PaddleConfig, userId: string, transactionId: string) {
  if (!paddleId(transactionId, 'txn')) throw new BillingError('billing-transaction-unavailable', 404);
  const customer = await billingCustomer(env, config, userId);
  if (!customer) throw new BillingError('billing-transaction-unavailable', 404);
  const value = transaction((await paddleRequest(config, `/transactions/${transactionId}`)).data, customer.customerId);
  if (value.id !== transactionId) throw new BillingError('billing-transaction-response-invalid');
  if (['completed', 'canceled'].includes(value.status)) await orm(env).update(c).set({ closedAt: Date.now() })
    .where(and(eq(c.environment, config.catalog.environment), eq(c.userId, userId), eq(c.transactionId, value.id), isNull(c.closedAt))).run();
  return { transactionId: value.id, status: value.status, subscriptionId: paddleId(value.subscription_id, 'sub') ? value.subscription_id : null, environment: config.catalog.environment, clientToken: config.clientToken };
}

/** Recover only; background work never starts another purchase or creates a customer. */
export async function recoverCheckout(env: ControlEnv, config: PaddleConfig, user: SessionUser): Promise<void> {
  if (!await currentCheckout(env, config, user.id)) return;
  await withCheckout(env, config, user.id, async (attempt) => {
    const customerId = await customerForCheckout(env, config, user, false);
    if (!customerId) return;
    const value = await checkoutTransaction(env, config, customerId, attempt, '', false);
    if (value && ['completed', 'canceled'].includes(value.status)) await orm(env).update(c).set({ closedAt: Date.now() }).where(heldBy(attempt)).run();
  });
}
