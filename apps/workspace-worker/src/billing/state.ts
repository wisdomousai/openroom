import { and, eq, exists, gt, inArray, lt, lte, notExists, or, sql, type AnyColumn } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { alias } from 'drizzle-orm/sqlite-core';
import { BillingError } from './provider';
import { lastHealthyOrder, pastDueStart } from './access';
import { orm } from '../db/client';
import { billingAccountSync, billingCustomers, billingEvents, billingPendingEvents, billingSubscriptions } from '../db/schema';
import type { ControlEnv } from '../auth';
import { priceEntitlements, type BillingEvent, type BillingSubscription, type Catalog } from './paddle';

export type BillingSource = 'webhook' | 'event-stream' | 'snapshot';
export async function billingHash(bytes: BufferSource): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const excluded = (col: AnyColumn) => sql`excluded.${sql.identifier(col.name)}`;

/** The caller verifies either the raw webhook signature or the fixed-origin API response. */
export async function recordBillingEvent(env: ControlEnv, catalog: Catalog, event: BillingEvent, hash: string, source: BillingSource): Promise<'recorded' | 'unlinked'> {
  const sub = event.subscription, environment = catalog.environment, db = orm(env);
  if (sub && !await db.select({ one: sql`1` }).from(billingCustomers).where(and(eq(billingCustomers.environment, environment), eq(billingCustomers.customerId, sub.customerId))).get()) {
    await db.insert(billingPendingEvents).values({ environment, eventId: event.id, customerId: sub.customerId, eventJson: JSON.stringify(event), payloadHash: hash, source, receivedAt: Date.now() }).onConflictDoNothing().run();
    return 'unlinked';
  }
  if (sub) {
    const existing = await db.select({ customerId: billingSubscriptions.customerId }).from(billingSubscriptions).where(and(eq(billingSubscriptions.environment, environment), eq(billingSubscriptions.id, sub.id))).get();
    if (existing && existing.customerId !== sub.customerId) throw new BillingError('billing-subscription-owner-conflict');
  }
  const claim = crypto.randomUUID(), rank = source === 'snapshot' ? 1 : 0;
  const known = sub ? priceEntitlements(catalog, sub.priceIds).known : false;
  // This batch's receipt won the event ID; billing_events is keyed by (environment, event_id), so at most one row.
  const claimed = and(eq(billingEvents.environment, environment), eq(billingEvents.eventId, event.id), eq(billingEvents.claim, claim));
  const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [db.insert(billingEvents).values({ environment, eventId: event.id, eventType: event.type, occurredAt: event.occurredAt, eventOrder: event.order,
    stateOrder: sub?.order ?? null, source, receivedAt: Date.now(), payloadHash: hash, claim, subscriptionId: sub?.id ?? null, subscriptionStatus: sub?.status ?? null,
    outcome: sub ? known ? 'recorded' : 'unknown-price' : 'ignored' }).onConflictDoNothing()];
  const s = billingSubscriptions;
  if (sub && source !== 'event-stream') statements.push(db.insert(s).select(db.select({ environment: sql`${environment}`.as('environment'), id: sql`${sub.id}`.as('id'), customerId: sql`${sub.customerId}`.as('customer_id'), status: sql`${sub.status}`.as('status'),
    priceIds: sql`${JSON.stringify(sub.priceIds)}`.as('price_ids'), periodEnd: sql`${sub.periodEnd}`.as('period_end'), scheduledEnd: sql`${sub.scheduledEnd}`.as('scheduled_end'), eventId: sql`${event.id}`.as('event_id'), stateOrder: sql`${sub.order}`.as('state_order'), stateRank: sql`${rank}`.as('state_rank') })
    .from(billingEvents).where(claimed))
    .onConflictDoUpdate({ target: [s.environment, s.id], set: { status: excluded(s.status), priceIds: excluded(s.priceIds), periodEnd: excluded(s.periodEnd), scheduledEnd: excluded(s.scheduledEnd),
      eventId: excluded(s.eventId), stateOrder: excluded(s.stateOrder), stateRank: excluded(s.stateRank) },
    setWhere: and(or(gt(excluded(s.stateOrder), s.stateOrder), and(eq(excluded(s.stateOrder), s.stateOrder), gt(excluded(s.stateRank), s.stateRank))), eq(excluded(s.customerId), s.customerId)) }));
  if (sub && source === 'event-stream') statements.push(db.insert(billingAccountSync).select(db.select({ environment: sql`${environment}`.as('environment'), userId: billingCustomers.userId, leaseUntil: sql`0`.as('lease_until'), claim: sql`NULL`.as('claim'),
    checkedAt: sql`NULL`.as('checked_at'), nextAt: sql`0`.as('next_at'), error: sql`NULL`.as('error') }).from(billingCustomers)
    .where(and(eq(billingCustomers.environment, environment), eq(billingCustomers.customerId, sub.customerId), exists(db.select({ one: sql`1` }).from(billingEvents).where(claimed)))))
    .onConflictDoUpdate({ target: [billingAccountSync.environment, billingAccountSync.userId], set: { nextAt: 0 } }));
  statements.push(db.delete(billingPendingEvents).where(and(eq(billingPendingEvents.environment, environment), eq(billingPendingEvents.eventId, event.id))));
  // Atomic receipt + state. Duplicate deliveries cannot replace the winning claim.
  await db.batch(statements);
  return 'recorded';
}

export async function recordBillingSnapshot(env: ControlEnv, catalog: Catalog, sub: BillingSubscription): Promise<void> {
  const hash = await billingHash(new TextEncoder().encode(JSON.stringify(sub)));
  const result = await recordBillingEvent(env, catalog, { id: `snapshot_${hash}`, type: 'subscription.snapshot', occurredAt: sub.updatedAt, order: sub.order, subscription: sub }, hash, 'snapshot');
  if (result !== 'recorded') throw new Error('billing-customer-unlinked');
}

/** Keep current state and all access-relevant failure/boundary evidence, even when old. */
export async function compactBillingEvidence(env: ControlEnv, environment: string, now = Date.now()): Promise<void> {
  const db = orm(env), s = billingSubscriptions, e = alias(billingEvents, 'e'), cutoff = now - 120 * 86_400_000;
  const kept = db.select({ one: sql`1` }).from(s).where(and(eq(s.environment, e.environment), or(eq(s.eventId, e.eventId), and(eq(s.id, e.subscriptionId), lte(e.stateOrder, s.stateOrder),
    or(eq(e.stateOrder, lastHealthyOrder(db)), and(eq(e.eventType, 'subscription.past_due'), eq(e.occurredAt, pastDueStart(db))))))));
  await db.delete(billingEvents).where(inArray(sql`${billingEvents}.rowid`,
    db.select({ rowid: sql`${e}.rowid` }).from(e).where(and(eq(e.environment, environment), lt(e.receivedAt, cutoff), notExists(kept))).limit(200))).run();
  const pending = billingPendingEvents;
  await db.delete(pending).where(inArray(sql`${pending}.rowid`,
    db.select({ rowid: sql`${pending}.rowid` }).from(pending).where(and(eq(pending.environment, environment), lt(pending.receivedAt, cutoff))).limit(200))).run();
}
