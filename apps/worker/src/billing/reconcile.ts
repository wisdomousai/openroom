import type { ControlEnv, SessionUser } from '../auth';
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
  await env.DB.prepare('INSERT OR IGNORE INTO billing_sync (environment) VALUES (?1)').bind(environment).run();
  const lease = await env.DB.prepare('UPDATE billing_sync SET claim=?1,lease_until=?2 WHERE environment=?3 AND lease_until<=?4').bind(claim, now + 3 * MINUTE, environment, now).run();
  if (lease.meta.changes !== 1) return { processed: 0, unlinked: 0, busy: true };
  let processed = 0, unlinked = 0;
  try {
    const savedCursor = await env.DB.prepare('SELECT cursor,last_success_at FROM billing_sync WHERE environment=?1').bind(environment).first<{ cursor: string | null; last_success_at: number | null }>();
    let cursor = savedCursor?.last_success_at && savedCursor.last_success_at > now - 85 * 86_400_000 ? savedCursor.cursor : null;
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
      const saved = await env.DB.prepare('UPDATE billing_sync SET cursor=?1,checked_at=?2,last_success_at=?2,caught_up_at=CASE WHEN ?5=0 THEN ?2 ELSE caught_up_at END,error=NULL WHERE environment=?3 AND claim=?4 AND lease_until>?2').bind(next, Date.now(), environment, claim, meta.pagination.has_more ? 1 : 0).run();
      if (saved.meta.changes !== 1) throw new BillingError('billing-sync-lease-lost');
      cursor = next;
      if (!meta.pagination.has_more) break;
    }
    return { processed, unlinked, busy: false };
  } catch (error) {
    await env.DB.prepare('UPDATE billing_sync SET checked_at=?1,error=?2 WHERE environment=?3 AND claim=?4').bind(Date.now(), billingSyncError(error), environment, claim).run();
    throw error;
  } finally { await env.DB.prepare('UPDATE billing_sync SET claim=NULL,lease_until=0 WHERE environment=?1 AND claim=?2').bind(environment, claim).run(); }
}

export interface AccountSyncResult { state: 'updated' | 'busy' | 'recent'; checkoutIssue: string | null }
/** Customer ownership comes only from our mapping, never from a provider email or metadata. */
export async function reconcileBillingAccount(env: ControlEnv, config: PaddleConfig, user: SessionUser, manual = false): Promise<AccountSyncResult> {
  spendBillingBudget(config, 20);
  const environment = config.catalog.environment, now = Date.now(), claim = crypto.randomUUID();
  await env.DB.prepare('INSERT OR IGNORE INTO billing_account_sync (environment,user_id) VALUES (?1,?2)').bind(environment, user.id).run();
  const prior = await env.DB.prepare('SELECT checked_at,lease_until,next_at FROM billing_account_sync WHERE environment=?1 AND user_id=?2').bind(environment, user.id).first<{ checked_at: number | null; lease_until: number; next_at: number }>();
  if (prior && prior.lease_until > now) return { state: 'busy', checkoutIssue: null };
  if (prior && (manual ? prior.checked_at !== null && prior.checked_at > now - MINUTE : prior.next_at > now)) return { state: 'recent', checkoutIssue: null };
  const locked = await env.DB.prepare(`UPDATE billing_account_sync SET claim=?1,lease_until=?2 WHERE environment=?3 AND user_id=?4 AND lease_until<=?5
    AND (?6=1 AND (checked_at IS NULL OR checked_at<=?7) OR ?6=0 AND next_at<=?5)`)
    .bind(claim, now + 3 * MINUTE, environment, user.id, now, manual ? 1 : 0, now - MINUTE).run();
  if (locked.meta.changes !== 1) return { state: 'busy', checkoutIssue: null };
  let issue: string | null = null;
  try {
    // A pending checkout must not prevent verification of an existing subscription.
    try { await recoverCheckout(env, config, user); } catch (error) { issue = billingSyncError(error); }
    const customer = await billingCustomer(env, config, user.id);
    if (customer) {
      const values = await paddleList(config, '/subscriptions', { customer_id: customer.customer_id, status: 'active,trialing,past_due,paused,canceled' });
      if (values.length > 50) throw new BillingError('billing-subscription-limit');
      const subscriptions = values.map(parseBillingSubscription);
      if (subscriptions.some((sub) => !sub || sub.customerId !== customer.customer_id)) throw new BillingError('billing-subscription-response-invalid');
      // An incomplete list is not evidence of cancellation. Verify known missing IDs directly.
      const known = await env.DB.prepare('SELECT id FROM billing_subscriptions WHERE environment=?1 AND customer_id=?2').bind(environment, customer.customer_id).all<{ id: string }>();
      const missing = known.results.filter((row) => !subscriptions.some((sub) => sub!.id === row.id));
      if (subscriptions.length + missing.length > 50) throw new BillingError('billing-subscription-limit');
      for (const row of missing) {
        if (!paddleId(row.id, 'sub')) throw new BillingError('billing-subscription-response-invalid');
        const sub = parseBillingSubscription((await paddleRequest(config, `/subscriptions/${row.id}`)).data);
        if (!sub || sub.id !== row.id || sub.customerId !== customer.customer_id) throw new BillingError('billing-subscription-response-invalid');
        subscriptions.push(sub);
      }
      for (const sub of subscriptions) { spendBillingBudget(config, 6); await recordBillingSnapshot(env, config.catalog, sub!); }
      const pending = await env.DB.prepare('SELECT event_json,payload_hash,source FROM billing_pending_events WHERE environment=?1 AND customer_id=?2 ORDER BY event_id LIMIT 100').bind(environment, customer.customer_id).all<{ event_json: string; payload_hash: string; source: BillingSource }>();
      for (const row of pending.results) {
        const event = JSON.parse(row.event_json) as BillingEvent;
        if (event.subscription?.customerId !== customer.customer_id) throw new BillingError('billing-pending-owner-conflict');
        spendBillingBudget(config, 6);
        await recordBillingEvent(env, config.catalog, event, row.payload_hash, row.source);
      }

    }
    const saved = await env.DB.prepare('UPDATE billing_account_sync SET checked_at=?1,next_at=?2,error=?3 WHERE environment=?4 AND user_id=?5 AND claim=?6 AND lease_until>?1')
      .bind(Date.now(), Date.now() + (issue ? 10 : 60) * MINUTE, issue, environment, user.id, claim).run();
    if (saved.meta.changes !== 1) throw new BillingError('billing-sync-lease-lost');
    return { state: 'updated', checkoutIssue: issue };
  } catch (error) {
    await env.DB.prepare('UPDATE billing_account_sync SET checked_at=?1,next_at=?2,error=?3 WHERE environment=?4 AND user_id=?5 AND claim=?6')
      .bind(Date.now(), Date.now() + 10 * MINUTE, billingSyncError(error), environment, user.id, claim).run();
    throw error;
  } finally { await env.DB.prepare('UPDATE billing_account_sync SET claim=NULL,lease_until=0 WHERE environment=?1 AND user_id=?2 AND claim=?3').bind(environment, user.id, claim).run(); }
}

/** Bounded background repair, independent of participation and ballot processing. */
export async function reconcileBilling(env: ControlEnv): Promise<void> {
  const configured = paddleConfig(env);
  if (!configured) return;
  const config = { ...configured, deadline: Date.now() + 120_000, budget: { remaining: 750 } };
  let failures = 0;
  try { await reconcileEventStream(env, config); } catch (error) { failures++; console.warn(JSON.stringify({ event: 'billing.event-sync.failed', environment: config.catalog.environment, code: billingSyncError(error) })); }
  const accounts = await env.DB.prepare(`SELECT u.id,u.email,u.name FROM users u
    JOIN (SELECT user_id FROM billing_customers WHERE environment=?1 UNION SELECT user_id FROM billing_checkouts WHERE environment=?1 AND closed_at IS NULL) b ON b.user_id=u.id
    LEFT JOIN billing_account_sync s ON s.user_id=u.id AND s.environment=?1
    WHERE COALESCE(s.next_at,0)<=?2 AND COALESCE(s.lease_until,0)<=?2 ORDER BY COALESCE(s.checked_at,0),u.id LIMIT ?3`)
    .bind(config.catalog.environment, Date.now(), ACCOUNTS_PER_RUN).all<SessionUser>();
  for (const user of accounts.results) {
    try { const result = await reconcileBillingAccount(env, config, user); if (result.checkoutIssue) { failures++; console.warn(JSON.stringify({ event: 'billing.account-sync.pending', environment: config.catalog.environment, code: result.checkoutIssue })); } }
    catch (error) { failures++; console.warn(JSON.stringify({ event: 'billing.account-sync.failed', environment: config.catalog.environment, code: billingSyncError(error) })); }
  }
  await compactBillingEvidence(env, config.catalog.environment);
  if (failures) throw new Error('Billing reconciliation needs attention; see redacted billing diagnostics.');
}
