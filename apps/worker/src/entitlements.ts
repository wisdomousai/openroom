/**
 * Shared paid-access reader for browser, desktop, CLI, MCP and live host controls.
 * Paddle-managed accounts use verified subscription records and time-bound access.
 * Manual development flags apply only before a customer mapping exists. No client
 * writes either source. Missing state and malformed flags always resolve to free.
 *
 * A deployment with no `PADDLE_ENVIRONMENT` has no billing at all (self-hosted):
 * every account holds every capability except the reserved `connectors`.
 */
import type { ControlEnv } from './auth.js';
import { billingSubscriptions, subscriptionAccessUntil } from './billing/access';

export const ENTITLEMENT_FLAGS = [
  'keep',
  'roster',
  'rawExport',
  'branding',
  'team',
  'continuity',
  'connectors',
] as const;

export type EntitlementFlag = (typeof ENTITLEMENT_FLAGS)[number];

export type Entitlements = Record<EntitlementFlag, boolean>;

export const FREE_ENTITLEMENTS: Entitlements = {
  keep: false,
  roster: false,
  rawExport: false,
  branding: false,
  team: false,
  continuity: false,
  connectors: false,
};

/** Every implemented capability; `connectors` stays reserved even without billing. */
export const SELF_HOSTED_ENTITLEMENTS: Entitlements = {
  keep: true,
  roster: true,
  rawExport: true,
  branding: true,
  team: true,
  continuity: true,
  connectors: false,
};

/** Billing exists only when the deployment names a Paddle environment. */
export function billingConfigured(env: { PADDLE_ENVIRONMENT?: string }): boolean {
  return typeof env.PADDLE_ENVIRONMENT === 'string' && env.PADDLE_ENVIRONMENT.trim() !== '';
}

export function parseEntitlements(raw: unknown): Entitlements {
  const parsed = coerceObject(raw);
  if (parsed === null) return { ...FREE_ENTITLEMENTS };
  const out: Entitlements = { ...FREE_ENTITLEMENTS };
  for (const flag of ENTITLEMENT_FLAGS) {
    if (parsed[flag] === true) out[flag] = true;
  }
  return out;
}

function coerceObject(raw: unknown): Record<string, unknown> | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function hasEntitlement(entitlements: Entitlements, flag: EntitlementFlag): boolean {
  return entitlements[flag];
}

export async function readEntitlements(env: ControlEnv, userId: string): Promise<Entitlements> {
  if (!billingConfigured(env)) return { ...SELF_HOSTED_ENTITLEMENTS };
  const row = await env.DB.prepare(`SELECT entitlements,
    EXISTS (SELECT 1 FROM billing_customers WHERE user_id = ?1) AS billing_managed FROM users WHERE id = ?1`)
    .bind(userId)
    .first<{ entitlements: string; billing_managed: number }>();
  if (!row?.billing_managed) return parseEntitlements(row?.entitlements ?? '{}');
  const result = { ...FREE_ENTITLEMENTS };
  if (env.PADDLE_ENVIRONMENT !== 'sandbox' && env.PADDLE_ENVIRONMENT !== 'live') return result;
  const results = await billingSubscriptions(env, userId);
  const now = Date.now();
  for (const sub of results) {
    if (subscriptionAccessUntil(sub) <= now) continue;
    const flags = parseEntitlements(sub.entitlements);
    for (const flag of ENTITLEMENT_FLAGS) if (flags[flag]) result[flag] = true;
  }
  return result;
}

/** Billing follows the space owner; starting a shared deck does not transfer it. */
export async function sessionEntitlementOwner(env: ControlEnv, code: string): Promise<{ userId: string | null; spaceId: string | null } | null> {
  return env.DB.prepare(`SELECT CASE WHEN l.space_id IS NULL THEN l.user_id ELSE s.owner_user_id END AS userId,
    l.space_id AS spaceId FROM live_sessions l LEFT JOIN spaces s ON s.id = l.space_id WHERE l.code = ?1`)
    .bind(code).first<{ userId: string | null; spaceId: string | null }>();
}
