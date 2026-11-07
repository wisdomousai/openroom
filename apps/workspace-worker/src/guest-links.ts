/**
 * Guest links — a named guest in one session.
 *
 * Fifth credential family (`orinv_…`). Not a context access link, not a space
 * invite, not an account. The host types the display name. The blast radius
 * of a leaked token is exactly one session.
 */
import { sha256Hex } from './api-tokens.js';
import { json, type ControlEnv } from './auth.js';
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
  const row = await env.DB.prepare(
    `SELECT id, display_name, session_code FROM guest_links
      WHERE token_hash = ?1 AND session_code = ?2 AND revoked_at IS NULL`,
  )
    .bind(hash, sessionCode)
    .first<{ id: string; display_name: string; session_code: string }>();
  if (row === null) return null;
  await env.DB.prepare(
    'UPDATE guest_links SET redeemed_at = COALESCE(redeemed_at, ?1) WHERE id = ?2',
  )
    .bind(now, row.id)
    .run();
  return { linkId: row.id, displayName: row.display_name, sessionCode: row.session_code };
}

async function ensureGuestList(
  env: ControlEnv,
  sessionCode: string,
  createdBy: string,
  now: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO guest_lists (session_code, created_by, created_at)
     VALUES (?1, ?2, ?3)`,
  )
    .bind(sessionCode, createdBy, now)
    .run();
}

export async function mintGuestLink(
  env: ControlEnv,
  sessionCode: string,
  createdBy: string,
  displayName: string,
): Promise<{ ok: true; token: string; linkId: string; displayName: string } | { ok: false; error: string; status: number }> {
  const name = displayName.trim().replace(/\s+/g, ' ').slice(0, 64);
  if (name === '') return { ok: false, error: 'invalid-name', status: 400 };
  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM guest_links WHERE session_code = ?1 AND revoked_at IS NULL',
  )
    .bind(sessionCode)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_SEATS) return { ok: false, error: 'guest-list-full', status: 409 };
  const now = Date.now();
  await ensureGuestList(env, sessionCode, createdBy, now);
  const linkId = randomBase64Url(16);
  const secret = randomBase64Url(32);
  const token = `${GUEST_LINK_PREFIX}${linkId}_${secret}`;
  const hash = await sha256Hex(token);
  await env.DB.prepare(
    `INSERT INTO guest_links (id, session_code, display_name, token_hash, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(linkId, sessionCode, name, hash, now)
    .run();
  return { ok: true, token, linkId, displayName: name };
}

export async function listGuestLinks(
  env: ControlEnv,
  sessionCode: string,
): Promise<Array<{ id: string; displayName: string; redeemedAt: number | null; revokedAt: number | null }>> {
  const { results } = await env.DB.prepare(
    `SELECT id, display_name, redeemed_at, revoked_at FROM guest_links
      WHERE session_code = ?1 ORDER BY created_at ASC`,
  )
    .bind(sessionCode)
    .all<{ id: string; display_name: string; redeemed_at: number | null; revoked_at: number | null }>();
  return (results ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    redeemedAt: row.redeemed_at,
    revokedAt: row.revoked_at,
  }));
}

export async function revokeGuestLink(
  env: ControlEnv,
  sessionCode: string,
  linkId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE guest_links SET revoked_at = ?1
      WHERE id = ?2 AND session_code = ?3 AND revoked_at IS NULL`,
  )
    .bind(now, linkId, sessionCode)
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
