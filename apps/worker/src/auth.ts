/**
 * Host identity: Google OIDC (authorization code + PKCE) on top of the
 * D1 control plane.
 *
 * Two credential families now coexist and must not be confused:
 *
 *   • capability tokens (tokens.ts) — bearer, per-session, short-lived. They are
 *     what participants/stage/host clients actually drive the session with, and
 *     they never touch D1.
 *   • the `or_session` cookie — proves *who the host is*. It only ever
 *     unlocks control-plane routes (create a session, list sessions, deck library).
 *
 * A session cookie is never accepted on a session route, and a capability token is
 * never accepted on a control-plane route. That keeps the blast radius of a
 * leaked session link at exactly one session.
 */

import { readEntitlements } from './entitlements.js';
import type { PaddleEnv } from './billing/paddle';
import {
  signCookieValue,
  signToken,
  verifyCookieValue,
  type Role,
} from './tokens.js';

/* ----------------------------------------------------------------- config */

export interface ControlEnv extends PaddleEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  TOKEN_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_AUTH_URL?: string;
  GOOGLE_TOKEN_URL?: string;
  /**
   * When `"1"` / `"true"`, enable static demo accounts for local development.
   * Never set in production — these accounts have public passwords.
   */
  DEMO_AUTH?: string;
  /** Pixabay search key. Worker-only; never sent to the browser. */
  PIXABAY_API_KEY?: string;
}

export const SESSION_COOKIE = 'or_session';
export const OAUTH_COOKIE = 'or_oauth';
export const CSRF_HEADER = 'x-openroom-csrf';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_TTL_MS = 10 * 60 * 1000;

const DEFAULT_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

/* ------------------------------------------------------------- primitives */

function randomId(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let binary = '';
  for (const b of buf) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlOfBytes(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64urlOfBytes(digest);
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (header === null) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function cookieSecure(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

function cookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  options: { path?: string; request: Request },
): string {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? '/'}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (cookieSecure(options.request)) attrs.splice(3, 0, 'Secure');
  return attrs.join('; ');
}

function clearCookie(name: string, options: { path?: string; request: Request }): string {
  const attrs = [`${name}=`, `Path=${options.path ?? '/'}`, 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (cookieSecure(options.request)) attrs.splice(3, 0, 'Secure');
  return attrs.join('; ');
}

function redirect(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 302,
    headers: { location, 'cache-control': 'no-store', ...headers },
  });
}

/* ---------------------------------------------------------------- session */

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Resolve the caller's identity from the `or_session` cookie.
 *
 * Exactly one D1 read per call, and nothing is cached: a logout must take
 * effect on the very next request, so trading a read for revocation latency is
 * the wrong deal at this scale (a session lookup is a primary-key hit).
 */
export async function getSession(request: Request, env: ControlEnv): Promise<SessionUser | null> {
  const signed = readCookie(request, SESSION_COOKIE);
  if (signed === null) return null;
  const sessionId = await verifyCookieValue(env.TOKEN_SECRET, signed);
  if (sessionId === null) return null;

  const row = await env.DB.prepare(
    `SELECT u.id AS id, u.email AS email, u.name AS name
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?1 AND s.expires_at > ?2`,
  )
    .bind(sessionId, Date.now())
    .first<{ id: string; email: string; name: string | null }>();

  if (row === null) return null;
  return { id: row.id, email: row.email, name: row.name ?? null };
}

export type SessionGuard =
  | { ok: true; user: SessionUser }
  | { ok: false; response: Response };

/**
 * Guard for cookie-authenticated routes.
 *
 * `mutating` routes additionally require the `x-openroom-csrf: 1` header.
 * `SameSite=Lax` already prevents a cross-site form/`fetch` from carrying the
 * cookie on a POST; the header is defence in depth — it cannot be set by a
 * simple cross-origin form, so it survives any future SameSite regression or
 * a browser that treats the attribute loosely.
 */
export async function requireSession(
  request: Request,
  env: ControlEnv,
  mutating = false,
): Promise<SessionGuard> {
  // Identity first, then CSRF: an anonymous caller must see 401 (not a
  // confusing 403 about a header it was never going to send).
  const user = await getSession(request, env);
  if (user === null) return { ok: false, response: json({ error: 'unauthorized' }, 401) };
  if (mutating && request.headers.get(CSRF_HEADER) !== '1') {
    return { ok: false, response: json({ error: 'csrf-required' }, 403) };
  }
  return { ok: true, user };
}

async function createSession(env: ControlEnv, userId: string, now: number): Promise<string> {
  const sessionId = randomId();
  await env.DB.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(sessionId, userId, now, now + SESSION_TTL_MS)
    .run();
  return signCookieValue(env.TOKEN_SECRET, sessionId);
}

/**
 * Upsert a user keyed by a stable subject (`google_sub` column). Demo accounts
 * use a synthetic `demo:<username>` subject so they share the same path as
 * Google users — session ownership, deck library, quotas, recovery all just work.
 */
async function upsertUserBySub(
  env: ControlEnv,
  sub: string,
  email: string,
  name: string | null,
  now: number,
): Promise<string> {
  const existing = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?1')
    .bind(sub)
    .first<{ id: string }>();
  if (existing !== null) {
    await env.DB.prepare('UPDATE users SET email = ?1, name = ?2 WHERE id = ?3')
      .bind(email, name, existing.id)
      .run();
    return existing.id;
  }
  const id = randomId(16);
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, created_at, entitlements)
     VALUES (?1, ?2, ?3, ?4, ?5, '{}')`,
  )
    .bind(id, sub, email, name, now)
    .run();
  return id;
}

/* ------------------------------------------------------------- demo auth */

/**
 * Static seed accounts for local / staging without Google OAuth.
 * Passwords are intentional public knowledge — never enable DEMO_AUTH in prod.
 */
export interface DemoAccount {
  username: string;
  password: string;
  email: string;
  name: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    username: 'alice',
    password: 'demo',
    email: 'alice@openroom.dev',
    name: 'Alice Teacher',
  },
  {
    username: 'bob',
    password: 'demo',
    email: 'bob@openroom.dev',
    name: 'Bob Host',
  },
  {
    username: 'cara',
    password: 'demo',
    email: 'cara@openroom.dev',
    name: 'Cara Host',
  },
] as const;

export function demoAuthEnabled(env: ControlEnv): boolean {
  const flag = env.DEMO_AUTH?.trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

export function googleAuthConfigured(env: ControlEnv): boolean {
  return typeof env.GOOGLE_CLIENT_ID === 'string' && env.GOOGLE_CLIENT_ID !== '';
}

export interface AuthStatus {
  google: boolean;
  demo: boolean;
  /** Present only when `demo` is true — no passwords. */
  accounts: Array<{ username: string; email: string; name: string }>;
}

/** GET /api/auth/status — what sign-in methods this deployment offers. */
export function authStatusRoute(_request: Request, env: ControlEnv): Response {
  const demo = demoAuthEnabled(env);
  const status: AuthStatus = {
    google: googleAuthConfigured(env),
    demo,
    accounts: demo
      ? DEMO_ACCOUNTS.map(({ username, email, name }) => ({ username, email, name }))
      : [],
  };
  return json(status);
}

/**
 * POST /api/auth/demo/login — body `{ username, password }`.
 * Mints a real `or_session` cookie against a D1 user so the rest of the
 * control plane (decks, sessions, quota) works without Google.
 */
export async function demoLoginRoute(
  request: Request,
  env: ControlEnv,
  now: number = Date.now(),
): Promise<Response> {
  if (!demoAuthEnabled(env)) {
    return json({ error: 'demo-auth-disabled' }, 501);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid-body' }, 400);
  }
  if (typeof body !== 'object' || body === null) {
    return json({ error: 'invalid-body' }, 400);
  }
  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return json({ error: 'invalid-body' }, 400);
  }
  const normalized = username.trim().toLowerCase();
  const account = DEMO_ACCOUNTS.find((a) => a.username === normalized);
  if (account === undefined || account.password !== password) {
    return json({ error: 'invalid-credentials' }, 401);
  }

  const userId = await upsertUserBySub(
    env,
    `demo:${account.username}`,
    account.email,
    account.name,
    now,
  );
  const sessionCookie = await createSession(env, userId, now);
  return json(
    { user: { id: userId, email: account.email, name: account.name } },
    200,
    {
      'set-cookie': cookie(SESSION_COOKIE, sessionCookie, Math.floor(SESSION_TTL_MS / 1000), {
        request,
      }),
    },
  );
}

/* ------------------------------------------------------------------ OIDC */

interface OAuthState {
  state: string;
  verifier: string;
  exp: number;
  /** Signed same-origin path used for browser-only confirmation flows. */
  returnTo?: string;
  /** OpenRoom Desktop: finish in the system browser, then hand the session back. */
  desktop?: boolean;
}

export const DESKTOP_AUTH_TICKET_TTL_MS = 2 * 60 * 1000;

export function desktopHandoffUrl(ticket: string): string {
  return `openroom://auth/desktop?ticket=${encodeURIComponent(ticket)}`;
}

function desktopHandoffPage(ticket: string, sessionCookie: string, request: Request): Response {
  const href = desktopHandoffUrl(ticket);
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Return to OpenRoom</title>
<meta http-equiv="refresh" content="0;url=${href}">
<body>
<p>You're signed in. Returning to OpenRoom…</p>
<p><a href="${href}">Open OpenRoom</a></p>
</body>
</html>
`;
  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'set-cookie': cookie(SESSION_COOKIE, sessionCookie, Math.floor(SESSION_TTL_MS / 1000), { request }),
  });
  headers.append('set-cookie', clearCookie(OAUTH_COOKIE, { path: '/api/auth', request }));
  return new Response(html, { status: 200, headers });
}

function safeAuthReturnTo(value: string | null): string | undefined {
  if (value === null || value === '' || value.includes('\\') || /[\r\n\0]/.test(value)) return undefined;
  if (value.startsWith('//') || !value.startsWith('/')) return undefined;
  if (/^\/confirm-deletion\/[A-Za-z0-9_-]+$/.test(value)) return value;
  const withoutHash = value.split('#')[0] ?? value;
  const path = withoutHash.split('?')[0] ?? '';
  if (path === '/api/mcp/authorize') return withoutHash;
  return undefined;
}

function redirectUri(url: URL): string {
  return `${url.origin}/api/auth/google/callback`;
}

/** GET /api/auth/google — kick off the authorization-code + PKCE dance. */
export async function googleStartRoute(request: Request, env: ControlEnv): Promise<Response> {
  if (!googleAuthConfigured(env)) {
    return json({ error: 'auth-not-configured' }, 501);
  }
  const clientId = env.GOOGLE_CLIENT_ID as string;
  const url = new URL(request.url);
  const state = randomId(16);
  const verifier = randomId(32);
  const returnTo = safeAuthReturnTo(url.searchParams.get('returnTo'));
  const desktop = url.searchParams.get('desktop') === '1';
  const payload: OAuthState = {
    state,
    verifier,
    exp: Date.now() + OAUTH_TTL_MS,
    ...(returnTo === undefined ? {} : { returnTo }),
    ...(desktop ? { desktop: true } : {}),
  };
  const signed = await signCookieValue(env.TOKEN_SECRET, JSON.stringify(payload));

  const authUrl = new URL(env.GOOGLE_AUTH_URL ?? DEFAULT_AUTH_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri(url));
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', await pkceChallenge(verifier));
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return redirect(authUrl.toString(), {
    'set-cookie': cookie(OAUTH_COOKIE, signed, Math.floor(OAUTH_TTL_MS / 1000), {
      path: '/api/auth',
      request,
    }),
  });
}

export interface TokenExchangeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}
export interface TokenExchangeResult {
  ok: boolean;
  idToken?: string;
}
export type TokenExchanger = (
  env: ControlEnv,
  input: TokenExchangeInput,
) => Promise<TokenExchangeResult>;

/** Real exchange against Google's token endpoint (never used in tests). */
export const fetchTokenExchange: TokenExchanger = async (env, input) => {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: env.GOOGLE_CLIENT_ID ?? '',
    client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
    code_verifier: input.codeVerifier,
  });
  const res = await fetch(env.GOOGLE_TOKEN_URL ?? DEFAULT_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) return { ok: false };
  const parsed = (await res.json()) as { id_token?: unknown };
  if (typeof parsed.id_token !== 'string') return { ok: false };
  return { ok: true, idToken: parsed.id_token };
};

export interface IdTokenClaims {
  sub: string;
  email: string;
  name?: string;
  iss: string;
  aud: string;
  exp: number;
}

/**
 * Decode an id_token payload WITHOUT verifying its JWS signature.
 *
 * Why that is safe *here* and nowhere else: this token is not something a
 * client handed us. We fetched it ourselves, over TLS, straight from Google's
 * token endpoint, in a confidential-client code exchange authenticated with
 * our client secret and bound to our PKCE verifier. The provenance guarantee
 * comes from the transport, not from the signature — this is exactly the case
 * OpenID Connect Core §3.1.3.7 carves out. We still check `iss`, `aud ===
 * client_id` and `exp` so that a misconfigured endpoint or a token minted for
 * a different client cannot slip through. If we ever accept an id_token from
 * anywhere else (an implicit flow, a client POST, a cached blob), this
 * shortcut becomes a vulnerability and full JWKS verification is mandatory.
 */
export function decodeIdToken(idToken: string): IdTokenClaims | null {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const segment = parts[1] as string;
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  let parsed: unknown;
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const c = parsed as Record<string, unknown>;
  if (
    typeof c.sub !== 'string' ||
    typeof c.email !== 'string' ||
    typeof c.iss !== 'string' ||
    typeof c.aud !== 'string' ||
    typeof c.exp !== 'number'
  ) {
    return null;
  }
  return {
    sub: c.sub,
    email: c.email,
    ...(typeof c.name === 'string' ? { name: c.name } : {}),
    iss: c.iss,
    aud: c.aud,
    exp: c.exp,
  };
}

async function upsertUser(env: ControlEnv, claims: IdTokenClaims, now: number): Promise<string> {
  return upsertUserBySub(env, claims.sub, claims.email, claims.name ?? null, now);
}

/**
 * GET /api/auth/google/callback.
 *
 * The token exchange is injected so the callback logic is testable without
 * ever talking to Google.
 */
export async function googleCallbackRoute(
  request: Request,
  env: ControlEnv,
  exchange: TokenExchanger = fetchTokenExchange,
  now: number = Date.now(),
): Promise<Response> {
  if (!googleAuthConfigured(env)) {
    return json({ error: 'auth-not-configured' }, 501);
  }
  const clientId = env.GOOGLE_CLIENT_ID as string;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (code === null || code === '' || state === null) {
    return json({ error: 'invalid-callback' }, 400);
  }

  const signedState = readCookie(request, OAUTH_COOKIE);
  if (signedState === null) return json({ error: 'missing-state' }, 400);
  const raw = await verifyCookieValue(env.TOKEN_SECRET, signedState);
  if (raw === null) return json({ error: 'bad-state' }, 400);
  let parsed: OAuthState;
  try {
    parsed = JSON.parse(raw) as OAuthState;
  } catch {
    return json({ error: 'bad-state' }, 400);
  }
  if (typeof parsed.state !== 'string' || typeof parsed.verifier !== 'string') {
    return json({ error: 'bad-state' }, 400);
  }
  if (parsed.exp <= now) return json({ error: 'state-expired' }, 400);
  if (parsed.state !== state) return json({ error: 'state-mismatch' }, 400);

  const exchanged = await exchange(env, {
    code,
    codeVerifier: parsed.verifier,
    redirectUri: redirectUri(url),
  });
  if (!exchanged.ok || exchanged.idToken === undefined) {
    return json({ error: 'exchange-failed' }, 502);
  }

  const claims = decodeIdToken(exchanged.idToken);
  if (claims === null) return json({ error: 'invalid-id-token' }, 502);
  if (!GOOGLE_ISSUERS.has(claims.iss)) return json({ error: 'bad-issuer' }, 502);
  if (claims.aud !== clientId) return json({ error: 'bad-audience' }, 502);
  if (claims.exp * 1000 <= now) return json({ error: 'id-token-expired' }, 502);

  const userId = await upsertUser(env, claims, now);
  const sessionCookie = await createSession(env, userId, now);

  if (parsed.desktop === true) {
    const sessionId = await verifyCookieValue(env.TOKEN_SECRET, sessionCookie);
    if (sessionId === null) return json({ error: 'session-failed' }, 500);
    const ticket = randomId(24);
    await env.DB.prepare(
      'INSERT INTO desktop_auth_tickets (id, session_id, expires_at) VALUES (?1, ?2, ?3)',
    )
      .bind(ticket, sessionId, now + DESKTOP_AUTH_TICKET_TTL_MS)
      .run();
    return desktopHandoffPage(ticket, sessionCookie, request);
  }

  const headers = new Headers({
    location: safeAuthReturnTo(parsed.returnTo ?? null) ?? '/host/',
    'cache-control': 'no-store',
  });
  headers.append(
    'set-cookie',
    cookie(SESSION_COOKIE, sessionCookie, Math.floor(SESSION_TTL_MS / 1000), { request }),
  );
  headers.append('set-cookie', clearCookie(OAUTH_COOKIE, { path: '/api/auth', request }));
  return new Response(null, { status: 302, headers });
}

/**
 * POST /api/auth/desktop/redeem — body `{ ticket }`.
 *
 * One-time exchange after the system-browser Google dance. Not a credential
 * family of its own: it only hands the already-created `or_session` to Electron.
 */
export async function desktopRedeemRoute(request: Request, env: ControlEnv): Promise<Response> {
  let ticket = '';
  try {
    const body = (await request.json()) as { ticket?: unknown };
    if (typeof body.ticket === 'string') ticket = body.ticket.trim();
  } catch {
    return json({ error: 'invalid-ticket' }, 400);
  }
  if (ticket === '') return json({ error: 'invalid-ticket' }, 400);

  const row = await env.DB.prepare(
    'SELECT session_id AS sessionId, expires_at AS expiresAt FROM desktop_auth_tickets WHERE id = ?1',
  )
    .bind(ticket)
    .first<{ sessionId: string; expiresAt: number }>();
  await env.DB.prepare('DELETE FROM desktop_auth_tickets WHERE id = ?1').bind(ticket).run();
  if (row === null || row.expiresAt <= Date.now()) {
    return json({ error: 'invalid-ticket' }, 400);
  }

  const signed = await signCookieValue(env.TOKEN_SECRET, row.sessionId);
  return json({ ok: true }, 200, {
    'set-cookie': cookie(SESSION_COOKIE, signed, Math.floor(SESSION_TTL_MS / 1000), { request }),
  });
}

/** POST /api/auth/logout — drop the row, then the cookie. */
export async function logoutRoute(request: Request, env: ControlEnv): Promise<Response> {
  if (request.headers.get(CSRF_HEADER) !== '1') {
    return json({ error: 'csrf-required' }, 403);
  }
  const signed = readCookie(request, SESSION_COOKIE);
  if (signed !== null) {
    const sessionId = await verifyCookieValue(env.TOKEN_SECRET, signed);
    if (sessionId !== null) {
      await env.DB.prepare('DELETE FROM auth_sessions WHERE id = ?1').bind(sessionId).run();
    }
  }
  return json({ ok: true }, 200, { 'set-cookie': clearCookie(SESSION_COOKIE, { request }) });
}

/** GET /api/me. */
export async function meRoute(request: Request, env: ControlEnv): Promise<Response> {
  const user = await getSession(request, env);
  // Always 200: a signed-out probe is the normal host bootstrap, not an error.
  // Returning 401 here litters the browser console and fails strict walkthrough gates.
  if (user === null) return json({ user: null });
  const entitlements = await readEntitlements(env, user.id);
  return json({ user: { id: user.id, email: user.email, name: user.name, entitlements } });
}

/** Mint a fresh session capability token for a recovered session. */
export function mintSessionToken(secret: string, sessionCode: string, role: Role): Promise<string> {
  return signToken(secret, { sessionCode, role });
}
