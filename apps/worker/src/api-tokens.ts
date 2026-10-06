/**
 * Personal API tokens (PATs) for MCP / agent access.
 *
 * A signed-in host mints a token in Settings; the raw secret is returned
 * once. Only a SHA-256 hash is stored. MCP accepts the bearer either as the
 * ops ADMIN_KEY (god-mode, no ownership) or as a PAT (scoped to that user:
 * session quota + ownership records on create; status/results only for owned sessions).
 *
 * Format: `orpat_<id>_<secret>` — both segments are base64url randoms.
 */

import { json, requireSession, type ControlEnv, type SessionUser } from './auth.js';

export const MAX_TOKENS_PER_USER = 10;
export const TOKEN_NAME_MAX = 80;
const PREFIX_LEN = 12;

const encoder = new TextEncoder();

function randomBase64Url(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let binary = '';
  for (const b of buf) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  const view = new Uint8Array(digest);
  let out = '';
  for (const b of view) out += b.toString(16).padStart(2, '0');
  return out;
}

function isValidTokenShape(raw: string): boolean {
  // orpat_<id>_<secret> — id ~22 chars (16 bytes), secret ~43 chars (32 bytes)
  return /^orpat_[A-Za-z0-9_-]{8,64}_[A-Za-z0-9_-]{16,128}$/.test(raw);
}

export interface ApiTokenRow {
  id: string;
  userId: string;
  name: string;
  tokenPrefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface VerifiedPat {
  tokenId: string;
  user: SessionUser;
}

/**
 * Verify a raw bearer as a non-revoked PAT and return its owner.
 * Updates last_used_at (best-effort; not on the ballot path).
 */
export async function verifyApiToken(
  env: ControlEnv,
  raw: string,
): Promise<VerifiedPat | null> {
  if (!isValidTokenShape(raw)) return null;
  const hash = await sha256Hex(raw);
  const row = await env.DB.prepare(
    `SELECT t.id AS id, t.user_id AS user_id, u.email AS email, u.name AS name
       FROM api_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ?1 AND t.revoked_at IS NULL`,
  )
    .bind(hash)
    .first<{ id: string; user_id: string; email: string; name: string | null }>();
  if (row === null) return null;

  // Fire-and-forget last_used; ignore failures so auth still succeeds.
  void env.DB.prepare('UPDATE api_tokens SET last_used_at = ?1 WHERE id = ?2')
    .bind(Date.now(), row.id)
    .run();

  return {
    tokenId: row.id,
    user: { id: row.user_id, email: row.email, name: row.name ?? null },
  };
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** GET /api/my/tokens */
export async function listTokensRoute(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireSession(request, env);
  if (!guard.ok) return guard.response;

  const { results } = await env.DB.prepare(
    `SELECT id, name, token_prefix, created_at, last_used_at
       FROM api_tokens
      WHERE user_id = ?1 AND revoked_at IS NULL
      ORDER BY created_at DESC`,
  )
    .bind(guard.user.id)
    .all<{
      id: string;
      name: string;
      token_prefix: string;
      created_at: number;
      last_used_at: number | null;
    }>();

  return json({
    tokens: (results ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.token_prefix,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
    })),
  });
}

/**
 * POST /api/my/tokens  body { name? }
 * Returns the raw secret once; it is never stored in cleartext.
 */
export async function mintTokenRoute(request: Request, env: ControlEnv): Promise<Response> {
  const guard = await requireSession(request, env, true);
  if (!guard.ok) return guard.response;

  const body = await readJson(request);
  const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
  const name = (rawName === '' ? 'Agent access' : rawName).slice(0, TOKEN_NAME_MAX);

  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?1 AND revoked_at IS NULL',
  )
    .bind(guard.user.id)
    .first<{ n: number }>();
  if ((countRow?.n ?? 0) >= MAX_TOKENS_PER_USER) {
    return json({ error: 'token-limit', max: MAX_TOKENS_PER_USER }, 429);
  }

  const id = randomBase64Url(16);
  const secret = randomBase64Url(32);
  const token = `orpat_${id}_${secret}`;
  const hash = await sha256Hex(token);
  const prefix = token.slice(0, PREFIX_LEN);
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, created_at, last_used_at, revoked_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL)`,
  )
    .bind(id, guard.user.id, name, hash, prefix, now)
    .run();

  return json(
    {
      id,
      name,
      prefix,
      createdAt: now,
      token, // shown once
    },
    201,
  );
}

/** DELETE /api/my/tokens/:id */
export async function revokeTokenRoute(
  request: Request,
  env: ControlEnv,
  tokenId: string,
): Promise<Response> {
  const guard = await requireSession(request, env, true);
  if (!guard.ok) return guard.response;

  const result = await env.DB.prepare(
    `UPDATE api_tokens SET revoked_at = ?1
      WHERE id = ?2 AND user_id = ?3 AND revoked_at IS NULL`,
  )
    .bind(Date.now(), tokenId, guard.user.id)
    .run();

  if ((result.meta.changes ?? 0) === 0) {
    return json({ error: 'not-found' }, 404);
  }
  return json({ ok: true });
}
