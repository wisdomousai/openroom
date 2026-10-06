import { paddleCatalog, priceEntitlements } from './paddle';
import type { ControlEnv } from '../auth';
export const RECOVERY_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export interface SubscriptionAccess { status: string; period_end: number | null; scheduled_end: number | null; past_due_since: number | null }
export interface SubscriptionRow extends SubscriptionAccess { id: string; entitlements: string; price_ids: string }

export async function billingSubscriptions(env: ControlEnv, userId: string): Promise<SubscriptionRow[]> {
  if (env.PADDLE_ENVIRONMENT !== 'sandbox' && env.PADDLE_ENVIRONMENT !== 'live') return [];
  const { results } = await env.DB.prepare(`SELECT s.id,s.status,s.price_ids,s.period_end,s.scheduled_end,
    (SELECT MIN(e.occurred_at) FROM billing_events e
      WHERE e.environment=s.environment AND e.subscription_id=s.id AND e.event_type='subscription.past_due' AND e.subscription_status='past_due'
        AND e.state_order<=s.state_order AND e.state_order>COALESCE(
          (SELECT MAX(h.state_order) FROM billing_events h WHERE h.environment=s.environment AND h.subscription_id=s.id
            AND h.subscription_status!='past_due' AND h.state_order<=s.state_order),'')
    ) AS past_due_since
    FROM billing_subscriptions s JOIN billing_customers c ON c.environment=s.environment AND c.customer_id=s.customer_id
    WHERE c.user_id=?1 AND c.environment=?2`).bind(userId, env.PADDLE_ENVIRONMENT).all<SubscriptionRow>();
  const catalog = paddleCatalog(env);
  return results.map((row) => {
    let ids: string[] = []; try { const value: unknown = JSON.parse(row.price_ids); if (Array.isArray(value) && value.every((id) => typeof id === 'string')) ids = value; } catch { /* invalid state grants nothing */ }
    return { ...row, entitlements: JSON.stringify(catalog ? priceEntitlements(catalog, ids).entitlements : {}) };
  });
}

/** Evaluated at access time, so expiration does not depend on a cron tick or another webhook. */
export function subscriptionAccessUntil(row: SubscriptionAccess): number {
  const until = row.status === 'past_due' ? (row.past_due_since === null ? 0 : row.past_due_since + RECOVERY_GRACE_MS)
    : row.status === 'active' || row.status === 'trialing' ? row.period_end ?? 0 : 0;
  return Math.min(until, row.scheduled_end ?? Infinity);
}
