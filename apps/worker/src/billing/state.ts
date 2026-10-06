import { BillingError } from './provider';
import type { ControlEnv } from '../auth';
import { priceEntitlements, type BillingEvent, type BillingSubscription, type Catalog } from './paddle';

export type BillingSource = 'webhook' | 'event-stream' | 'snapshot';
export async function billingHash(bytes: BufferSource): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The caller verifies either the raw webhook signature or the fixed-origin API response. */
export async function recordBillingEvent(env: ControlEnv, catalog: Catalog, event: BillingEvent, hash: string, source: BillingSource): Promise<'recorded' | 'unlinked'> {
  const sub = event.subscription, environment = catalog.environment;
  if (sub && !await env.DB.prepare('SELECT 1 FROM billing_customers WHERE environment=?1 AND customer_id=?2').bind(environment, sub.customerId).first()) {
    await env.DB.prepare('INSERT OR IGNORE INTO billing_pending_events (environment,event_id,customer_id,event_json,payload_hash,source,received_at) VALUES (?1,?2,?3,?4,?5,?6,?7)').bind(environment, event.id, sub.customerId, JSON.stringify(event), hash, source, Date.now()).run();
    return 'unlinked';
  }
  if (sub) {
    const existing = await env.DB.prepare('SELECT customer_id FROM billing_subscriptions WHERE environment=?1 AND id=?2').bind(environment, sub.id).first<{ customer_id: string }>();
    if (existing && existing.customer_id !== sub.customerId) throw new BillingError('billing-subscription-owner-conflict');
  }
  const claim = crypto.randomUUID(), rank = source === 'snapshot' ? 1 : 0;
  const known = sub ? priceEntitlements(catalog, sub.priceIds).known : false;
  const statements = [env.DB.prepare(`INSERT OR IGNORE INTO billing_events
    (environment,event_id,event_type,occurred_at,event_order,state_order,source,received_at,payload_hash,claim,subscription_id,subscription_status,outcome)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`)
    .bind(environment, event.id, event.type, event.occurredAt, event.order, sub?.order ?? null, source, Date.now(), hash, claim, sub?.id ?? null, sub?.status ?? null, sub ? known ? 'recorded' : 'unknown-price' : 'ignored')];
  if (sub && source !== 'event-stream') statements.push(env.DB.prepare(`INSERT INTO billing_subscriptions
    (environment,id,customer_id,status,price_ids,period_end,scheduled_end,event_id,state_order,state_rank)
    SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10
    WHERE EXISTS (SELECT 1 FROM billing_events WHERE environment=?1 AND event_id=?8 AND claim=?11)
    ON CONFLICT(environment,id) DO UPDATE SET status=excluded.status,price_ids=excluded.price_ids,
      period_end=excluded.period_end,scheduled_end=excluded.scheduled_end,event_id=excluded.event_id,state_order=excluded.state_order,state_rank=excluded.state_rank
    WHERE (excluded.state_order > billing_subscriptions.state_order OR (excluded.state_order = billing_subscriptions.state_order AND excluded.state_rank > billing_subscriptions.state_rank))
      AND excluded.customer_id = billing_subscriptions.customer_id`)
    .bind(environment, sub.id, sub.customerId, sub.status, JSON.stringify(sub.priceIds), sub.periodEnd, sub.scheduledEnd, event.id, sub.order, rank, claim));
  if (sub && source === 'event-stream') statements.push(env.DB.prepare(`INSERT INTO billing_account_sync (environment,user_id,next_at)
    SELECT ?1,user_id,0 FROM billing_customers WHERE environment=?1 AND customer_id=?2
      AND EXISTS (SELECT 1 FROM billing_events WHERE environment=?1 AND event_id=?3 AND claim=?4)
    ON CONFLICT(environment,user_id) DO UPDATE SET next_at=0`).bind(environment, sub.customerId, event.id, claim));
  statements.push(env.DB.prepare('DELETE FROM billing_pending_events WHERE environment=?1 AND event_id=?2').bind(environment, event.id));
  // Atomic receipt + state. Duplicate deliveries cannot replace the winning claim.
  await env.DB.batch(statements);
  return 'recorded';
}

export async function recordBillingSnapshot(env: ControlEnv, catalog: Catalog, sub: BillingSubscription): Promise<void> {
  const hash = await billingHash(new TextEncoder().encode(JSON.stringify(sub)));
  const result = await recordBillingEvent(env, catalog, { id: `snapshot_${hash}`, type: 'subscription.snapshot', occurredAt: sub.updatedAt, order: sub.order, subscription: sub }, hash, 'snapshot');
  if (result !== 'recorded') throw new Error('billing-customer-unlinked');
}

/** Keep current state and all access-relevant failure/boundary evidence, even when old. */
export async function compactBillingEvidence(env: ControlEnv, environment: string, now = Date.now()): Promise<void> {
  await env.DB.prepare(`DELETE FROM billing_events WHERE rowid IN (
    SELECT e.rowid FROM billing_events e WHERE e.environment=?1 AND e.received_at<?2
      AND NOT EXISTS (SELECT 1 FROM billing_subscriptions s WHERE s.environment=e.environment AND
        (s.event_id=e.event_id OR (s.id=e.subscription_id AND e.state_order<=s.state_order AND
          (e.state_order=(SELECT MAX(h.state_order) FROM billing_events h WHERE h.environment=s.environment AND h.subscription_id=s.id AND h.subscription_status!='past_due' AND h.state_order<=s.state_order)
            OR (e.event_type='subscription.past_due' AND e.occurred_at=(SELECT MIN(p.occurred_at) FROM billing_events p
              WHERE p.environment=s.environment AND p.subscription_id=s.id AND p.event_type='subscription.past_due' AND p.subscription_status='past_due'
                AND p.state_order<=s.state_order AND p.state_order>COALESCE((SELECT MAX(h.state_order) FROM billing_events h WHERE h.environment=s.environment AND h.subscription_id=s.id AND h.subscription_status!='past_due' AND h.state_order<=s.state_order),'')))))))
    LIMIT 200
  )`).bind(environment, now - 120 * 86_400_000).run();
  await env.DB.prepare('DELETE FROM billing_pending_events WHERE rowid IN (SELECT rowid FROM billing_pending_events WHERE environment=?1 AND received_at<?2 LIMIT 200)').bind(environment, now - 120 * 86_400_000).run();
}
