import { and, eq, gt, lte, max, min, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { paddleCatalog, priceEntitlements } from './paddle';
import type { ControlEnv } from '../auth';
import { orm, type Orm } from '../db/client';
import { billingCustomers, billingEvents, billingSubscriptions as subscriptions } from '../db/schema';
export const RECOVERY_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export interface SubscriptionAccess { status: string; periodEnd: number | null; scheduledEnd: number | null; pastDueSince: number | null }
export interface SubscriptionRow extends SubscriptionAccess { id: string; entitlements: string; priceIds: string }

/** Correlated to the outer `billing_subscriptions` row: the latest non-past_due revision at or before its current state. */
export const lastHealthyOrder = (db: Orm) => { const s = subscriptions, h = alias(billingEvents, 'h');
  return db.select({ order: max(h.stateOrder) }).from(h).where(and(eq(h.environment, s.environment), eq(h.subscriptionId, s.id), ne(h.subscriptionStatus, 'past_due'), lte(h.stateOrder, s.stateOrder))); };
/** The earliest past_due transition after that revision: the start of the current recovery episode. */
export const pastDueStart = (db: Orm) => { const s = subscriptions, p = alias(billingEvents, 'p');
  return db.select({ at: min(p.occurredAt) }).from(p).where(and(eq(p.environment, s.environment), eq(p.subscriptionId, s.id), eq(p.eventType, 'subscription.past_due'),
    eq(p.subscriptionStatus, 'past_due'), lte(p.stateOrder, s.stateOrder), gt(p.stateOrder, sql`COALESCE(${lastHealthyOrder(db)},'')`))); };

export async function billingSubscriptions(env: ControlEnv, userId: string): Promise<SubscriptionRow[]> {
  if (env.PADDLE_ENVIRONMENT !== 'sandbox' && env.PADDLE_ENVIRONMENT !== 'live') return [];
  const db = orm(env), s = subscriptions, c = billingCustomers;
  const results = await db.select({ id: s.id, status: s.status, priceIds: s.priceIds, periodEnd: s.periodEnd, scheduledEnd: s.scheduledEnd, pastDueSince: sql<number | null>`${pastDueStart(db)}` })
    .from(s).innerJoin(c, and(eq(c.environment, s.environment), eq(c.customerId, s.customerId)))
    .where(and(eq(c.userId, userId), eq(c.environment, env.PADDLE_ENVIRONMENT)));
  const catalog = paddleCatalog(env);
  return results.map((row) => {
    let ids: string[] = []; try { const value: unknown = JSON.parse(row.priceIds); if (Array.isArray(value) && value.every((id) => typeof id === 'string')) ids = value; } catch { /* invalid state grants nothing */ }
    return { ...row, entitlements: JSON.stringify(catalog ? priceEntitlements(catalog, ids).entitlements : {}) };
  });
}

/** Evaluated at access time, so expiration does not depend on a cron tick or another webhook. */
export function subscriptionAccessUntil(row: SubscriptionAccess): number {
  const until = row.status === 'past_due' ? (row.pastDueSince === null ? 0 : row.pastDueSince + RECOVERY_GRACE_MS)
    : row.status === 'active' || row.status === 'trialing' ? row.periodEnd ?? 0 : 0;
  return Math.min(until, row.scheduledEnd ?? Infinity);
}
