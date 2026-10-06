/** Shared control-plane OAuth: exact redirects, S256, single-use codes and revocable connections. */
import { sha256Hex, verifyApiToken } from './api-tokens.js';
import { DEMO_ACCOUNTS, demoAuthEnabled, demoLoginRoute, getSession, googleAuthConfigured } from './auth.js';
import type { Env } from './index.js';

export const POWERPOINT_CLIENT_ID = 'openroom-powerpoint';
const CONSENT_COOKIE = 'or_oauth_consent';
const CODE_TTL_SECONDS = 10 * 60;
const ACCESS_TTL_SECONDS = 30 * 24 * 60 * 60;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
} as const;

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

/* --------------------------------------------------- generic signed values */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    usage,
  ]);
}

async function signValue(secret: string, payload: Record<string, unknown>): Promise<string> {
  const body = encoder.encode(JSON.stringify(payload));
  const key = await hmacKey(secret, 'sign');
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
  return `${b64url(body)}.${b64url(sig)}`;
}

async function verifyValue(secret: string, token: string): Promise<Record<string, unknown> | null> {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = b64urlDecode(token.slice(0, dot));
  const sig = b64urlDecode(token.slice(dot + 1));
  if (body === null || sig === null) return null;
  const key = await hmacKey(secret, 'verify');
  const bodyBuf = new Uint8Array(body).buffer as ArrayBuffer;
  const sigBuf = new Uint8Array(sig).buffer as ArrayBuffer;
  const valid = await crypto.subtle.verify('HMAC', key, sigBuf, bodyBuf);
  if (!valid) return null;
  try {
    const parsed: unknown = JSON.parse(decoder.decode(body));
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.byteLength !== bufB.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < bufA.byteLength; i += 1) diff |= bufA[i]! ^ bufB[i]!;
  return diff === 0;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export interface McpAccessClaims { userId: string; connectionId: string }

export async function connectionActive(env: Pick<Env, 'DB'>, id: string, userId: string): Promise<boolean> {
  return !!await env.DB.prepare('SELECT id FROM oauth_connections WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL AND expires_at > ?3').bind(id, userId, Date.now()).first();
}

export async function verifyMcpAccessToken(env: Pick<Env, 'DB'>, bearer: string): Promise<McpAccessClaims | null> {
  if (!/^orauth_[A-Za-z0-9_-]{43}$/.test(bearer)) return null;
  const row = await env.DB.prepare('SELECT id, user_id FROM oauth_connections WHERE token_hash = ?1 AND revoked_at IS NULL AND expires_at > ?2').bind(await sha256Hex(bearer), Date.now()).first<{ id: string; user_id: string }>();
  return row ? { userId: row.user_id, connectionId: row.id } : null;
}

/* ------------------------------------------------------ discovery metadata */

export function protectedResourceMetadata(origin: string): Response {
  return json(
    {
      resource: `${origin}/api/mcp`,
      resource_name: 'OpenRoom',
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp'],
    },
    200,
    { 'access-control-allow-origin': '*' },
  );
}

export function authorizationServerMetadata(origin: string): Response {
  return json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/api/mcp/authorize`,
      token_endpoint: `${origin}/api/mcp/token`,
      registration_endpoint: `${origin}/api/mcp/register`,
      revocation_endpoint: `${origin}/api/mcp/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp'],
      // Auth.md discovery (isitagentready authMd): skill + register_uri + at least one
      // complete registration method. OpenRoom binds credentials to a host account with
      // a verified email (Google OAuth / session) via browser consent — not ID-JAG or
      // anonymous. See GET /auth.md for the full procedure.
      agent_auth: {
        skill: `${origin}/auth.md`,
        register_uri: `${origin}/api/mcp/register`,
        claim_uri: `${origin}/api/mcp/authorize`,
        identity_types_supported: ['identity_assertion'],
        identity_assertion: {
          assertion_types_supported: ['verified_email'],
          credential_types_supported: ['access_token', 'api_key'],
        },
      },
    },
    200,
    { 'access-control-allow-origin': '*' },
  );
}

/* ------------------------------------------------- dynamic registration */

function validRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  } catch { return false; }
}

export async function registerRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'invalid_request' }, 405);
  let body: Record<string, unknown>;
  try {
    const raw: unknown = JSON.parse(await boundedText(request) ?? 'null');
    if (typeof raw !== 'object' || raw === null) throw new Error('bad');
    body = raw as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_client_metadata' }, 400);
  }
  const redirectUris = Array.isArray(body['redirect_uris']) ? body['redirect_uris'] : [];
  if (redirectUris.length === 0 || redirectUris.length > 8 || !redirectUris.every(validRedirectUri)) {
    return json({ error: 'invalid_redirect_uri' }, 400);
  }
  const name = typeof body['client_name'] === 'string' ? body['client_name'].slice(0, 120) : 'MCP client';
  const expanded = [...new Set(redirectUris as string[])];
  const clientId = await signValue(env.TOKEN_SECRET, { t: 'mcp-client', ru: expanded, n: name });
  return json(
    {
      client_id: clientId,
      client_name: name,
      redirect_uris: expanded,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    },
    201,
  );
}

/* ------------------------------------------------------------- authorize */

interface ClientInfo {
  redirectUris: string[];
  name: string;
  firstParty: boolean;
}

async function parseClientId(env: Env, clientId: string, origin: string): Promise<ClientInfo | null> {
  if (clientId === POWERPOINT_CLIENT_ID) return { redirectUris: [`${origin}/office/callback.html`], name: 'OpenRoom for PowerPoint', firstParty: true };
  if (clientId.length > 24000) return null;
  const payload = await verifyValue(env.TOKEN_SECRET, clientId);
  if (payload === null || payload['t'] !== 'mcp-client') return null;
  const ru = payload['ru'];
  if (!Array.isArray(ru) || !ru.every(validRedirectUri)) return null;
  return { redirectUris: ru, name: typeof payload['n'] === 'string' ? payload['n'] : 'Connected application', firstParty: false };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function consentCookie(url: URL, nonce: string, age = CODE_TTL_SECONDS): string {
  return `${CONSENT_COOKIE}=${nonce}; Path=/api/mcp/authorize; HttpOnly; SameSite=Lax; Max-Age=${age}${url.protocol === 'https:' ? '; Secure' : ''}`;
}
function consentPage(fields: Record<string, string>, client: ClientInfo, nonce: string, url: URL, env: Env, signedInAs?: string, error?: string): Response {
  const returnTo = `/api/mcp/authorize?${new URLSearchParams(Object.fromEntries(Object.entries(fields).filter(([key]) => key !== 'consent'))).toString()}`;
  const signInHref = `/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`;
  const hidden = Object.entries(fields).map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join('');
  const google = googleAuthConfigured(env), demo = demoAuthEnabled(env);
  const signIn = signedInAs ? '' : `${google ? `<p><a href="${escapeHtml(signInHref)}">Sign in with Google</a> to continue.</p>` : ''}${demo ? `<form method="post">${hidden}<p>Local development · use a demo account.</p><label for="demo-account">Demo account</label><select id="demo-account" name="username">${DEMO_ACCOUNTS.map((account) => `<option value="${escapeHtml(account.username)}">${escapeHtml(account.name)}</option>`).join('')}</select><input type="hidden" name="action" value="demo-sign-in"><input type="hidden" name="password" value="demo"><button type="submit">Sign in with demo account</button></form>` : ''}${!google && !demo ? '<p role="status">Sign-in is not configured on this OpenRoom server.</p>' : ''}`;
  const approval = signedInAs || !client.firstParty
    ? `<form method="post">${hidden}${signedInAs ? `<p>Signed in as <strong>${escapeHtml(signedInAs)}</strong>.</p><input type="hidden" name="via_session" value="1">` : '<label for="credential">Personal API token</label><input id="credential" name="credential" type="password" autocomplete="off">'}<button type="submit">Approve connection</button></form>`
    : '';
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to OpenRoom</title><style>body{font:16px/1.6 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f6f8;color:#17212d}main{max-width:440px;margin:24px;padding:32px;background:white;border:1px solid #d9dfe5;border-radius:12px}h1{font-size:24px;line-height:1.3}p{color:#526578}label{display:block;margin-top:16px}input[type=password],select{box-sizing:border-box;width:100%;padding:10px;margin-top:8px;font:inherit}button{padding:12px 20px;margin-top:20px;background:#175b96;color:white;border:0;border-radius:6px;font:inherit;cursor:pointer}.error{color:#b91c1c}</style><main><h1>Connect ${escapeHtml(client.name)}</h1><p>This application can read and edit your OpenRoom decks and use the spaces and sessions your account can access.</p><p>You can revoke this connection in Settings. Your space permissions and paid capabilities still apply.</p>${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}${signIn}${approval}</main></html>`;
  // A no-referrer form navigation sends Origin: null in Chromium. Same-origin
  // preserves our CSRF origin check while still suppressing cross-origin referrers.
  return new Response(html, { status: error ? 401 : 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", 'set-cookie': consentCookie(url, nonce) } });
}

async function boundedText(request: Request): Promise<string | null> {
  const reader = request.body?.getReader(); if (!reader) return '';
  const decoder = new TextDecoder(); let size = 0, text = '';
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 32 * 1024) { await reader.cancel(); return null; } text += decoder.decode(part.value, { stream: true }); }
    return text + decoder.decode();
  } catch { return null; } finally { reader.releaseLock(); }
}
async function readFormParams(request: Request): Promise<URLSearchParams> {
  const text = await boundedText(request); if (text === null) return new URLSearchParams();
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return new URLSearchParams(text);
  try {
    const value: unknown = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) return new URLSearchParams();
    const params = new URLSearchParams(); for (const [key, item] of Object.entries(value)) if (typeof item === 'string') params.set(key, item);
    return params;
  } catch { return new URLSearchParams(); }
}

export async function authorizeRoute(request: Request, url: URL, env: Env): Promise<Response> {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'invalid_request' }, 405);
  const params = request.method === 'POST' ? await readFormParams(request) : url.searchParams;
  const clientId = params.get('client_id') ?? '', redirectUri = params.get('redirect_uri') ?? '', state = params.get('state') ?? '', challenge = params.get('code_challenge') ?? '';
  const client = await parseClientId(env, clientId, url.origin);
  if (!client) return json({ error: 'invalid_client' }, 400);
  if (!client.redirectUris.includes(redirectUri)) return json({ error: 'invalid_redirect_uri' }, 400);
  if (params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || state.length > 1024) return json({ error: 'invalid_request' }, 400);
  const fields = { response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: 'S256' };
  const fieldHash = await sha256Hex(JSON.stringify(fields)), user = await getSession(request, env);
  if (request.method === 'GET') {
    const nonce = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const consent = await signValue(env.TOKEN_SECRET, { t: 'consent', n: nonce, h: fieldHash, uid: user?.id ?? null, exp: nowSeconds() + CODE_TTL_SECONDS });
    return consentPage({ ...fields, consent }, client, nonce, url, env, user?.email);
  }
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== url.origin) return json({ error: 'csrf-required' }, 403);
  const consent = await verifyValue(env.TOKEN_SECRET, params.get('consent') ?? '');
  const cookie = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${CONSENT_COOKIE}=`))?.slice(CONSENT_COOKIE.length + 1) ?? '';
  if (!consent || consent.t !== 'consent' || consent.h !== fieldHash || typeof consent.exp !== 'number' || consent.exp <= nowSeconds() || typeof consent.n !== 'string' || !timingSafeEqualStr(consent.n, cookie) || consent.uid !== (user?.id ?? null)) return json({ error: 'csrf-required' }, 403);
  if (params.get('action') === 'demo-sign-in') {
    // Reuse the ordinary local-only login, after validating this browser's
    // consent proof. A fresh GET binds consent to the newly signed-in identity.
    if (!demoAuthEnabled(env)) return json({ error: 'demo-auth-disabled' }, 501);
    const login = await demoLoginRoute(new Request(new URL('/api/auth/demo/login', url), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: params.get('username'), password: params.get('password') }),
    }), env);
    if (!login.ok) return consentPage({ ...fields, consent: params.get('consent')! }, client, consent.n, url, env, user?.email, 'Demo sign-in failed. Choose a demo account and try again.');
    return new Response(null, { status: 303, headers: {
      location: `/api/mcp/authorize?${new URLSearchParams(fields)}`,
      'set-cookie': login.headers.get('set-cookie')!,
      'cache-control': 'no-store', 'referrer-policy': 'same-origin',
    } });
  }
  let userId: string | undefined;
  if (params.get('via_session') === '1' && user) userId = user.id;
  else if (!client.firstParty) userId = (await verifyApiToken(env, params.get('credential') ?? ''))?.user.id;
  if (!userId) return consentPage({ ...fields, consent: params.get('consent')! }, client, consent.n, url, env, user?.email, client.firstParty ? 'Sign in to continue.' : 'Sign in or use a valid personal API token to approve.');
  const code = `orcode_${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_codes WHERE expires_at <= ?1').bind(Date.now()),
    env.DB.prepare('INSERT INTO oauth_codes (code_hash,user_id,client_id,client_name,redirect_uri,challenge,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7)').bind(await sha256Hex(code), userId, clientId, client.name, redirectUri, challenge, Date.now() + CODE_TTL_SECONDS * 1000),
  ]);
  const target = new URL(redirectUri); target.searchParams.set('code', code); if (state) target.searchParams.set('state', state);
  return new Response(null, { status: 302, headers: { location: target.toString(), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'set-cookie': consentCookie(url, '', 0) } });
}

/* ----------------------------------------------------------------- token */

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return b64url(new Uint8Array(digest));
}

export async function tokenRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'invalid_request' }, 405);
  const params = await readFormParams(request);
  if (params.get('grant_type') !== 'authorization_code') return json({ error: 'unsupported_grant_type' }, 400);
  const code = params.get('code') ?? '', verifier = params.get('code_verifier') ?? '', clientId = params.get('client_id') ?? '', redirectUri = params.get('redirect_uri') ?? '';
  if (!/^orcode_[A-Za-z0-9_-]{43}$/.test(code) || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !clientId || !validRedirectUri(redirectUri)) return json({ error: 'invalid_grant' }, 400);
  const hash = await sha256Hex(code), challenge = await s256(verifier), now = Date.now();
  const token = `orauth_${b64url(crypto.getRandomValues(new Uint8Array(32)))}`, id = crypto.randomUUID();
  // One atomic batch: only one competing redemption can copy then consume this code.
  const [inserted] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO oauth_connections (id,user_id,client_id,client_name,redirect_uri,token_hash,created_at,expires_at)
      SELECT ?1,user_id,client_id,client_name,redirect_uri,?2,?3,?4 FROM oauth_codes
      WHERE code_hash = ?5 AND client_id = ?6 AND redirect_uri = ?7 AND challenge = ?8 AND expires_at > ?3`).bind(id, await sha256Hex(token), now, now + ACCESS_TTL_SECONDS * 1000, hash, clientId, redirectUri, challenge),
    env.DB.prepare('DELETE FROM oauth_codes WHERE code_hash = ?1 AND client_id = ?2 AND redirect_uri = ?3 AND challenge = ?4 AND expires_at > ?5').bind(hash, clientId, redirectUri, challenge, now),
  ]);
  if (!inserted?.meta.changes) return json({ error: 'invalid_grant' }, 400);
  return json({ access_token: token, token_type: 'Bearer', expires_in: ACCESS_TTL_SECONDS, scope: 'mcp', connection_id: id });
}

export async function revokeOAuthRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'invalid_request' }, 405);
  const params = await readFormParams(request), token = params.get('token') ?? '', clientId = params.get('client_id') ?? '';
  if (/^orauth_[A-Za-z0-9_-]{43}$/.test(token) && clientId) await env.DB.prepare('UPDATE oauth_connections SET revoked_at = ?1 WHERE token_hash = ?2 AND client_id = ?3 AND revoked_at IS NULL').bind(Date.now(), await sha256Hex(token), clientId).run();
  return json({});
}
