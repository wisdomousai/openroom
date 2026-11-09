/**
 * Guest links — a named guest in one session.
 *
 * Fifth credential family (`orinv_…`). Not a student access link, not a space
 * invite, not an account. The host types the display name. The blast radius
 * of a leaked token is exactly one session.
 */
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';

import { sha256Hex } from './api-tokens.js';
import { json, type ControlEnv } from './auth.js';
import { orm } from './db/client.js';
import { guestLinks, guestLists } from './db/schema.js';
import { readEntitlements } from './entitlements.js';

export const GUEST_LINK_PREFIX = 'orinv_';
const MAX_SEATS = 200;

function randomBase64Url(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let binary = '';
  for (const b of buf) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function isValidInviteShape(raw: string): boolean {
  return /^orinv_[A-Za-z0-9_-]{8,64}_[A-Za-z0-9_-]{16,128}$/.test(raw);
}

export interface VerifiedGuestLink {
  linkId: string;
  displayName: string;
  sessionCode: string;
}

export async function verifyGuestLink(
  env: ControlEnv,
  raw: string,
  sessionCode: string,
  now: number = Date.now(),
): Promise<VerifiedGuestLink | null> {
  if (!isValidInviteShape(raw)) return null;
  const hash = await sha256Hex(raw);
  const db = orm(env);
  const row = await db
    .select({ id: guestLinks.id, displayName: guestLinks.displayName, sessionCode: guestLinks.sessionCode })
    .from(guestLinks)
    .where(and(eq(guestLinks.tokenHash, hash), eq(guestLinks.sessionCode, sessionCode), isNull(guestLinks.revokedAt)))
    .get();
  if (row === undefined) return null;
  await db
    .update(guestLinks)
    .set({ redeemedAt: sql`COALESCE(${guestLinks.redeemedAt}, ${now})` })
    .where(eq(guestLinks.id, row.id))
    .run();
  return { linkId: row.id, displayName: row.displayName, sessionCode: row.sessionCode };
}

async function ensureGuestList(
  env: ControlEnv,
  sessionCode: string,
  createdBy: string,
  now: number,
): Promise<void> {
  await orm(env).insert(guestLists).values({ sessionCode, createdBy, createdAt: now }).onConflictDoNothing().run();
}

export async function mintGuestLink(
  env: ControlEnv,
  sessionCode: string,
  createdBy: string,
  displayName: string,
): Promise<{ ok: true; token: string; linkId: string; displayName: string } | { ok: false; error: string; status: number }> {
  const name = displayName.trim().replace(/\s+/g, ' ').slice(0, 64);
  if (name === '') return { ok: false, error: 'invalid-name', status: 400 };
  const seats = await orm(env)
    .select({ n: count() })
    .from(guestLinks)
    .where(and(eq(guestLinks.sessionCode, sessionCode), isNull(guestLinks.revokedAt)))
    .get();
  if ((seats?.n ?? 0) >= MAX_SEATS) return { ok: false, error: 'guest-list-full', status: 409 };
  const now = Date.now();
  await ensureGuestList(env, sessionCode, createdBy, now);
  const linkId = randomBase64Url(16);
  const secret = randomBase64Url(32);
  const token = `${GUEST_LINK_PREFIX}${linkId}_${secret}`;
  const hash = await sha256Hex(token);
  await orm(env)
    .insert(guestLinks)
    .values({ id: linkId, sessionCode, displayName: name, tokenHash: hash, createdAt: now })
    .run();
  return { ok: true, token, linkId, displayName: name };
}

export async function listGuestLinks(
  env: ControlEnv,
  sessionCode: string,
): Promise<Array<{ id: string; displayName: string; redeemedAt: number | null; revokedAt: number | null }>> {
  return orm(env)
    .select({
      id: guestLinks.id,
      displayName: guestLinks.displayName,
      redeemedAt: guestLinks.redeemedAt,
      revokedAt: guestLinks.revokedAt,
    })
    .from(guestLinks)
    .where(eq(guestLinks.sessionCode, sessionCode))
    .orderBy(asc(guestLinks.createdAt));
}

export async function revokeGuestLink(
  env: ControlEnv,
  sessionCode: string,
  linkId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const result = await orm(env)
    .update(guestLinks)
    .set({ revokedAt: now })
    .where(and(eq(guestLinks.id, linkId), eq(guestLinks.sessionCode, sessionCode), isNull(guestLinks.revokedAt)))
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function requireNamedSessionAccess(
  env: ControlEnv,
  userId: string | null,
): Promise<Response | null> {
  if (userId === null) return null;
  const entitlements = await readEntitlements(env, userId);
  if (entitlements.guestList) return null;
  return json({ ok: false, error: 'guest-list-required' }, 403);
}
