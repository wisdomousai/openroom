import { and, asc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { ControlEnv, SessionUser } from '../auth';
import { orm } from '../db/client';
import { billingAccountSync, billingCheckouts, billingCustomers, billingPendingEvents, billingSubscriptions, billingSync, users } from '../db/schema';
import { billingCustomer, recoverCheckout } from './checkout';
import { paddleId, parseBillingEvent, parseBillingSubscription, record, SUBSCRIPTION_EVENTS, type BillingEvent } from './paddle';
import { BillingError, paddleConfig, paddleList, paddleRequest, spendBillingBudget, type PaddleConfig } from './provider';
import { billingHash, compactBillingEvidence, recordBillingEvent, recordBillingSnapshot, type BillingSource } from './state';

const MINUTE = 60_000;
const EVENT_PAGE_SIZE = 50, EVENT_PAGES_PER_RUN = 2, ACCOUNTS_PER_RUN = 3;
export const billingSyncError = (error: unknown) => error instanceof BillingError ? error.code : 'billing-sync-failed';

/** At most two pages per tick. Advance only after every valid linked event was committed. */
export async function reconcileEventStream(env: ControlEnv, config: PaddleConfig): Promise<{ processed: number; unlinked: number; busy: boolean }> {
  spendBillingBudget(config, 20);
  const environment = config.catalog.environment, now = Date.now(), claim = crypto.randomUUID();
  const db = orm(env), sync = billingSync, held = and(eq(sync.environment, environment), eq(sync.claim, claim));
  await db.insert(sync).values({ environment }).onConflictDoNothing().run();
  const lease = await db.update(sync).set({ claim, leaseUntil: now + 3 * MINUTE }).where(and(eq(sync.environment, environment), lte(sync.leaseUntil, now))).run();
  if (lease.meta.changes !== 1) return { processed: 0, unlinked: 0, busy: true };
  let processed = 0, unlinked = 0;
  try {
    const savedCursor = await db.select({ cursor: sync.cursor, lastSuccessAt: sync.lastSuccessAt }).from(sync).where(eq(sync.environment, environment)).get();
    let cursor = savedCursor?.lastSuccessAt && savedCursor.lastSuccessAt > now - 85 * 86_400_000 ? savedCursor.cursor : null;
    for (let page = 0; page < EVENT_PAGES_PER_RUN; page++) {
      const query = new URLSearchParams({ order_by: 'id[ASC]', per_page: String(EVENT_PAGE_SIZE), event_type: SUBSCRIPTION_EVENTS.join(','), ...(cursor ? { after: cursor } : {}) });
      const { data, meta } = await paddleRequest(config, `/events?${query}`);
      if (!Array.isArray(data) || data.length > EVENT_PAGE_SIZE || !record(meta.pagination) || typeof meta.pagination.has_more !== 'boolean') throw new BillingError('billing-event-page-invalid');
      let next = cursor;
      for (const value of data) {
        const event = parseBillingEvent(value);
        if (!event?.subscription || (next && event.id <= next)) throw new BillingError('billing-event-page-invalid');
        const hash = await billingHash(new TextEncoder().encode(JSON.stringify(value)));
        spendBillingBudget(config, 6);
        const result = await recordBillingEvent(env, config.catalog, event, hash, 'event-stream');
        if (result === 'unlinked') unlinked++; else processed++;
        next = event.id;
      }
      if (meta.pagination.has_more && (!next || next === cursor)) throw new BillingError('billing-event-page-invalid');
      const at = Date.now();
      // caught_up_at moves only once the stream has no more pages.
      const saved = await db.update(sync).set({ cursor: next, checkedAt: at, lastSuccessAt: at, ...(meta.pagination.has_more ? {} : { caughtUpAt: at }), error: null }).where(and(held, gt(sync.leaseUntil, at))).run();
      if (saved.meta.changes !== 1) throw new BillingError('billing-sync-lease-lost');
      cursor = next;
      if (!meta.pagination.has_more) break;
    }
    return { processed, unlinked, busy: false };
  } catch (error) {
    await db.update(sync).set({ checkedAt: Date.now(), error: billingSyncError(error) }).where(held).run();
    throw error;
  } finally { await db.update(sync).set({ claim: null, leaseUntil: 0 }).where(held).run(); }
}

export interface AccountSyncResult { state: 'updated' | 'busy' | 'recent'; checkoutIssue: string | null }
/** Customer ownership comes only from our mapping, never from a provider email or metadata. */
export async function reconcileBillingAccount(env: ControlEnv, config: PaddleConfig, user: SessionUser, manual = false): Promise<AccountSyncResult> {
  spendBillingBudget(config, 20);
  const environment = config.catalog.environment, now = Date.now(), claim = crypto.randomUUID();
  const db = orm(env), sync = billingAccountSync, account = and(eq(sync.environment, environment), eq(sync.userId, user.id)), held = and(account, eq(sync.claim, claim));
  await db.insert(sync).values({ environment, userId: user.id }).onConflictDoNothing().run();
  const prior = await db.select({ checkedAt: sync.checkedAt, leaseUntil: sync.leaseUntil, nextAt: sync.nextAt }).from(sync).where(account).get();
  if (prior && prior.leaseUntil > now) return { state: 'busy', checkoutIssue: null };
  if (prior && (manual ? prior.checkedAt !== null && prior.checkedAt > now - MINUTE : prior.nextAt > now)) return { state: 'recent', checkoutIssue: null };
  const locked = await db.update(sync).set({ claim, leaseUntil: now + 3 * MINUTE })
    .where(and(account, lte(sync.leaseUntil, now), manual ? or(isNull(sync.checkedAt), lte(sync.checkedAt, now - MINUTE)) : lte(sync.nextAt, now))).run();
  if (locked.meta.changes !== 1) return { state: 'busy', checkoutIssue: null };
  let issue: string | null = null;
  try {
    // A pending checkout must not prevent verification of an existing subscription.
    try { await recoverCheckout(env, config, user); } catch (error) { issue = billingSyncError(error); }
    const customer = await billingCustomer(env, config, user.id);
    if (customer) {
      const values = await paddleList(config, '/subscriptions', { customer_id: customer.customerId, status: 'active,trialing,past_due,paused,canceled' });
      if (values.length > 50) throw new BillingError('billing-subscription-limit');
      const subscriptions = values.map(parseBillingSubscription);
      if (subscriptions.some((sub) => !sub || sub.customerId !== customer.customerId)) throw new BillingError('billing-subscription-response-invalid');
      // An incomplete list is not evidence of cancellation. Verify known missing IDs directly.
      const known = await db.select({ id: billingSubscriptions.id }).from(billingSubscriptions).where(and(eq(billingSubscriptions.environment, environment), eq(billingSubscriptions.customerId, customer.customerId)));
      const missing = known.filter((row) => !subscriptions.some((sub) => sub!.id === row.id));
      if (subscriptions.length + missing.length > 50) throw new BillingError('billing-subscription-limit');
      for (const row of missing) {
        if (!paddleId(row.id, 'sub')) throw new BillingError('billing-subscription-response-invalid');
        const sub = parseBillingSubscription((await paddleRequest(config, `/subscriptions/${row.id}`)).data);
        if (!sub || sub.id !== row.id || sub.customerId !== customer.customerId) throw new BillingError('billing-subscription-response-invalid');
        subscriptions.push(sub);
      }
      for (const sub of subscriptions) { spendBillingBudget(config, 6); await recordBillingSnapshot(env, config.catalog, sub!); }
      const p = billingPendingEvents;
      const pending = await db.select({ eventJson: p.eventJson, payloadHash: p.payloadHash, source: p.source }).from(p)
        .where(and(eq(p.environment, environment), eq(p.customerId, customer.customerId))).orderBy(asc(p.eventId)).limit(100);
      for (const row of pending) {
        const event = JSON.parse(row.eventJson) as BillingEvent;
        if (event.subscription?.customerId !== customer.customerId) throw new BillingError('billing-pending-owner-conflict');
        spendBillingBudget(config, 6);
        await recordBillingEvent(env, config.catalog, event, row.payloadHash, row.source as BillingSource);
      }

    }
    const at = Date.now();
    const saved = await db.update(sync).set({ checkedAt: at, nextAt: Date.now() + (issue ? 10 : 60) * MINUTE, error: issue }).where(and(held, gt(sync.leaseUntil, at))).run();
    if (saved.meta.changes !== 1) throw new BillingError('billing-sync-lease-lost');
    return { state: 'updated', checkoutIssue: issue };
  } catch (error) {
    await db.update(sync).set({ checkedAt: Date.now(), nextAt: Date.now() + 10 * MINUTE, error: billingSyncError(error) }).where(held).run();
    throw error;
  } finally { await db.update(sync).set({ claim: null, leaseUntil: 0 }).where(held).run(); }
}

/** Bounded background repair, independent of participation and answer processing. */
export async function reconcileBilling(env: ControlEnv): Promise<void> {
  const configured = paddleConfig(env);
  if (!configured) return;
  const config = { ...configured, deadline: Date.now() + 120_000, budget: { remaining: 750 } };
  let failures = 0;
  try { await reconcileEventStream(env, config); } catch (error) { failures++; console.warn(JSON.stringify({ event: 'billing.event-sync.failed', environment: config.catalog.environment, code: billingSyncError(error) })); }
  const db = orm(env), environment = config.catalog.environment, due = Date.now(), s = billingAccountSync;
  const b = db.select({ userId: billingCustomers.userId }).from(billingCustomers).where(eq(billingCustomers.environment, environment))
    .union(db.select({ userId: billingCheckouts.userId }).from(billingCheckouts).where(and(eq(billingCheckouts.environment, environment), isNull(billingCheckouts.closedAt)))).as('b');
  const accounts: SessionUser[] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users)
    .innerJoin(b, eq(b.userId, users.id)).leftJoin(s, and(eq(s.userId, users.id), eq(s.environment, environment)))
    .where(and(lte(sql`COALESCE(${s.nextAt},0)`, due), lte(sql`COALESCE(${s.leaseUntil},0)`, due))).orderBy(sql`COALESCE(${s.checkedAt},0)`, users.id).limit(ACCOUNTS_PER_RUN);
  for (const user of accounts) {
    try { const result = await reconcileBillingAccount(env, config, user); if (result.checkoutIssue) { failures++; console.warn(JSON.stringify({ event: 'billing.account-sync.pending', environment: config.catalog.environment, code: result.checkoutIssue })); } }
    catch (error) { failures++; console.warn(JSON.stringify({ event: 'billing.account-sync.failed', environment: config.catalog.environment, code: billingSyncError(error) })); }
  }
  await compactBillingEvidence(env, config.catalog.environment);
  if (failures) throw new Error('Billing reconciliation needs attention; see redacted billing diagnostics.');
}
