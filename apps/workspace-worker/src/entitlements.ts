/**
 * Shared paid-access reader for browser, desktop, CLI, MCP and live host controls.
 * Paddle-managed accounts use verified subscription records and time-bound access.
 * Manual development flags apply only before a customer mapping exists. No client
 * writes either source. Missing state and malformed flags always resolve to free.
 *
 * A deployment that sets `PADDLE_ENVIRONMENT=off` has no billing at all
 * (self-hosted): every account holds every capability except the reserved
 * `connectors`. An unset value fails closed, so a deploy that drops the variable
 * cannot unlock paid features; only local demo-auth development treats unset as off.
 */
import { FREE_SESSION_PARTICIPANT_LIMIT } from '@openroom/schema';
import { eq, exists, sql } from 'drizzle-orm';
import { demoAuthEnabled, type ControlEnv } from './auth.js';
import { billingSubscriptions, subscriptionAccessUntil } from './billing/access';
import { orm } from './db/client.js';
import { billingCustomers, liveSessions, spaces, users } from './db/schema.js';

export const ENTITLEMENT_FLAGS = [
  'keep',
  'guestList',
  'rawExport',
  'branding',
  'team',
  'continuity',
  'largeSessions',
  'connectors',
] as const;

export type EntitlementFlag = (typeof ENTITLEMENT_FLAGS)[number];

export type Entitlements = Record<EntitlementFlag, boolean>;

export const FREE_ENTITLEMENTS: Entitlements = {
  keep: false,
  guestList: false,
  rawExport: false,
  branding: false,
  team: false,
  continuity: false,
  largeSessions: false,
  connectors: false,
};

/** Every implemented capability; `connectors` stays reserved even without billing. */
export const SELF_HOSTED_ENTITLEMENTS: Entitlements = {
  keep: true,
  guestList: true,
  rawExport: true,
  branding: true,
  team: true,
  continuity: true,
  largeSessions: true,
  connectors: false,
};

/**
 * Billing is off (self-hosted) only when the deployment says so with
 * `PADDLE_ENVIRONMENT=off`, or when it is unset on a local demo-auth server.
 */
export function billingOff(env: ControlEnv): boolean {
  const value = env.PADDLE_ENVIRONMENT?.trim() ?? '';
  return value === 'off' || (value === '' && demoAuthEnabled(env));
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
  if (billingOff(env)) return { ...SELF_HOSTED_ENTITLEMENTS };
  const db = orm(env);
  const row = await db
    .select({ entitlements: users.entitlements, billingManaged: exists(db.select({ one: sql`1` }).from(billingCustomers).where(eq(billingCustomers.userId, userId))) })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!row?.billingManaged) return parseEntitlements(row?.entitlements ?? '{}');
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
  const row = await orm(env)
    .select({ userId: sql<string | null>`CASE WHEN ${liveSessions.spaceId} IS NULL THEN ${liveSessions.userId} ELSE ${spaces.ownerUserId} END`, spaceId: liveSessions.spaceId })
    .from(liveSessions)
    .leftJoin(spaces, eq(spaces.id, liveSessions.spaceId))
    .where(eq(liveSessions.code, code))
    .get();
  return row ?? null;
}

/**
 * The audience limit a new live session carries into its Durable Object, read
 * once at creation from the billing owner (`null` admits any number). Joins
 * never read D1, and a lapse mid-session never removes anyone. A session with
 * no account owner (the ops admin key) is an unowned ops session and unlimited,
 * as it is for every other owner check.
 */
export async function sessionParticipantLimit(env: ControlEnv, ownerId: string | null): Promise<number | null> {
  if (ownerId === null) return null;
  return (await readEntitlements(env, ownerId)).largeSessions ? null : FREE_SESSION_PARTICIPANT_LIMIT;
}
