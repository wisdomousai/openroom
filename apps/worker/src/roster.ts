/**
 * Roster invites — a named seat in one session.
 *
 * Fifth credential family (`orinv_…`). Not a context access link, not a space
 * invite, not an account. The host types the display name. The blast radius
 * of a leaked token is exactly one session.
 */
import { sha256Hex } from './api-tokens.js';
import { json, type ControlEnv } from './auth.js';
import { readEntitlements } from './entitlements.js';

export const ROSTER_INVITE_PREFIX = 'orinv_';
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

export interface VerifiedRosterSeat {
  seatId: string;
  displayName: string;
  sessionCode: string;
}

export async function verifyRosterInvite(
  env: ControlEnv,
  raw: string,
  sessionCode: string,
  now: number = Date.now(),
): Promise<VerifiedRosterSeat | null> {
  if (!isValidInviteShape(raw)) return null;
  const hash = await sha256Hex(raw);
  const row = await env.DB.prepare(
    `SELECT id, display_name, session_code FROM roster_seats
      WHERE token_hash = ?1 AND session_code = ?2 AND revoked_at IS NULL`,
  )
    .bind(hash, sessionCode)
    .first<{ id: string; display_name: string; session_code: string }>();
  if (row === null) return null;
  await env.DB.prepare(
    'UPDATE roster_seats SET redeemed_at = COALESCE(redeemed_at, ?1) WHERE id = ?2',
  )
    .bind(now, row.id)
    .run();
  return { seatId: row.id, displayName: row.display_name, sessionCode: row.session_code };
}

async function ensureRoster(
  env: ControlEnv,
  sessionCode: string,
  createdBy: string,
  now: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO session_rosters (session_code, created_by, created_at)
     VALUES (?1, ?2, ?3)`,
  )
    .bind(sessionCode, createdBy, now)
    .run();
}

export async function mintRosterSeat(
  env: ControlEnv,
  sessionCode: string,
  createdBy: string,
  displayName: string,
): Promise<{ ok: true; token: string; seatId: string; displayName: string } | { ok: false; error: string; status: number }> {
  const name = displayName.trim().replace(/\s+/g, ' ').slice(0, 64);
  if (name === '') return { ok: false, error: 'invalid-name', status: 400 };
  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM roster_seats WHERE session_code = ?1 AND revoked_at IS NULL',
  )
    .bind(sessionCode)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_SEATS) return { ok: false, error: 'roster-full', status: 409 };
  const now = Date.now();
  await ensureRoster(env, sessionCode, createdBy, now);
  const seatId = randomBase64Url(16);
  const secret = randomBase64Url(32);
  const token = `${ROSTER_INVITE_PREFIX}${seatId}_${secret}`;
  const hash = await sha256Hex(token);
  await env.DB.prepare(
    `INSERT INTO roster_seats (id, session_code, display_name, token_hash, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(seatId, sessionCode, name, hash, now)
    .run();
  return { ok: true, token, seatId, displayName: name };
}

export async function listRosterSeats(
  env: ControlEnv,
  sessionCode: string,
): Promise<Array<{ id: string; displayName: string; redeemedAt: number | null; revokedAt: number | null }>> {
  const { results } = await env.DB.prepare(
    `SELECT id, display_name, redeemed_at, revoked_at FROM roster_seats
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

export async function revokeRosterSeat(
  env: ControlEnv,
  sessionCode: string,
  seatId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE roster_seats SET revoked_at = ?1
      WHERE id = ?2 AND session_code = ?3 AND revoked_at IS NULL`,
  )
    .bind(now, seatId, sessionCode)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function requireNamedSessionAccess(
  env: ControlEnv,
  userId: string | null,
): Promise<Response | null> {
  if (userId === null) return null;
  const entitlements = await readEntitlements(env, userId);
  if (entitlements.roster) return null;
  return json({ ok: false, error: 'roster-required' }, 403);
}
