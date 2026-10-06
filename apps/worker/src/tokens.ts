/**
 * Capability tokens — HMAC-SHA256 over a JSON payload.
 *
 * Format: `base64url(payloadJSON).base64url(signature)`.
 * Payload: { sessionCode, role, participantId?, exp }  (exp = epoch seconds).
 *
 * Verification uses `crypto.subtle.verify`, which does the comparison in
 * constant time inside the runtime — we never compare signatures with `===`.
 */

export type Role = 'host' | 'participant' | 'stage';

export interface TokenPayload {
  sessionCode: string;
  role: Role;
  participantId?: string;
  facilitatorId?: string;
  /** Account identity for live access rechecks; never a control-plane credential. */
  userId?: string;
  /** Issuing OAuth connection, when present. Revocation applies to this host seat too. */
  connectionId?: string;
  /** epoch seconds */
  exp: number;
}

/** participant capabilities live 6h; host/stage 12h (CONTRACTS §Tokens). */
export const TOKEN_TTL_SECONDS: Record<Role, number> = {
  participant: 6 * 60 * 60,
  host: 12 * 60 * 60,
  stage: 12 * 60 * 60,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(value: string): Uint8Array | null {
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

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  const cached = keyCache.get(secret);
  if (cached !== undefined) return cached;
  const created = crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  keyCache.set(secret, created);
  return created;
}

export async function signToken(
  secret: string,
  payload: Omit<TokenPayload, 'exp'> & { exp?: number },
  nowMs: number = Date.now(),
): Promise<string> {
  const exp = payload.exp ?? Math.floor(nowMs / 1000) + TOKEN_TTL_SECONDS[payload.role];
  const full: TokenPayload = {
    sessionCode: payload.sessionCode,
    role: payload.role,
    ...(payload.participantId === undefined ? {} : { participantId: payload.participantId }),
    ...(payload.role === 'host' ? { facilitatorId: payload.facilitatorId ?? 'creator', ...(payload.userId === undefined ? {} : { userId: payload.userId }) } : {}),
    ...(payload.role === 'host' && payload.connectionId ? { connectionId: payload.connectionId } : {}),
    exp,
  };
  const body = encoder.encode(JSON.stringify(full));
  const key = await hmacKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
  return `${base64urlEncode(body)}.${base64urlEncode(signature)}`;
}

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'expired' };

export async function verifyToken(
  secret: string,
  token: string,
  nowMs: number = Date.now(),
): Promise<VerifyResult> {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1 || token.indexOf('.', dot + 1) !== -1) {
    return { ok: false, reason: 'malformed' };
  }
  const body = base64urlDecode(token.slice(0, dot));
  const signature = base64urlDecode(token.slice(dot + 1));
  if (body === null || signature === null) return { ok: false, reason: 'malformed' };

  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify('HMAC', key, signature, body);
  if (!valid) return { ok: false, reason: 'bad-signature' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(body));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: 'malformed' };
  const candidate = parsed as Record<string, unknown>;
  const { sessionCode, role, participantId, facilitatorId, userId, connectionId, exp } = candidate;
  if (
    typeof sessionCode !== 'string' ||
    (role !== 'host' && role !== 'participant' && role !== 'stage') ||
    typeof exp !== 'number' ||
    (participantId !== undefined && typeof participantId !== 'string') ||
    (role === 'host' && (typeof facilitatorId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(facilitatorId))) ||
    (userId !== undefined && (role !== 'host' || typeof userId !== 'string' || userId !== facilitatorId)) ||
    (connectionId !== undefined && (role !== 'host' || typeof userId !== 'string' || typeof connectionId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(connectionId))) ||
    (role !== 'host' && facilitatorId !== undefined)
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (exp * 1000 <= nowMs) return { ok: false, reason: 'expired' };

  return {
    ok: true,
    payload: {
      sessionCode,
      role,
      ...(participantId === undefined ? {} : { participantId }),
      ...(role === 'host' ? { facilitatorId: facilitatorId as string, ...(userId === undefined ? {} : { userId: userId as string }) } : {}),
      ...(connectionId === undefined ? {} : { connectionId: connectionId as string }),
      exp,
    },
  };
}

/* --------------------------------------------------------------- cookies */

/**
 * Sign an opaque cookie value with the same HMAC key as capability tokens.
 *
 * Format: `base64url(utf8 value).base64url(signature)`. Used for the session
 * cookie (payload = session id) and the short-lived OAuth state cookie
 * (payload = JSON with the CSRF state + PKCE verifier). Keeping the value
 * signed means a tampered cookie is rejected before it ever reaches D1.
 */
export async function signCookieValue(secret: string, value: string): Promise<string> {
  const body = encoder.encode(value);
  const key = await hmacKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
  return `${base64urlEncode(body)}.${base64urlEncode(signature)}`;
}

/** Verify a value produced by `signCookieValue`; returns null when invalid. */
export async function verifyCookieValue(secret: string, signed: string): Promise<string | null> {
  const dot = signed.indexOf('.');
  if (dot <= 0 || dot === signed.length - 1 || signed.indexOf('.', dot + 1) !== -1) return null;
  const body = base64urlDecode(signed.slice(0, dot));
  const signature = base64urlDecode(signed.slice(dot + 1));
  if (body === null || signature === null) return null;
  const key = await hmacKey(secret);
  // constant-time inside the runtime
  const valid = await crypto.subtle.verify('HMAC', key, signature, body);
  if (!valid) return null;
  return decoder.decode(body);
}

/** Pull a bearer token out of the Authorization header, or `?token=` for WS upgrades. */
export function extractToken(request: Request, url: URL): string | null {
  const header = request.headers.get('authorization');
  if (header !== null) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1] !== undefined) return match[1].trim();
  }
  const query = url.searchParams.get('token');
  return query === null || query === '' ? null : query;
}
