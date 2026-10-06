/**
 * Signed cookie values for the control plane: the `or_session` cookie
 * (payload = session id) and the short-lived OAuth state cookie (payload =
 * JSON with the CSRF state + PKCE verifier).
 *
 * Format: `base64url(utf8 value).base64url(HMAC-SHA256)`, keyed by
 * `TOKEN_SECRET`. Keeping the value signed means a tampered cookie is rejected
 * before it ever reaches D1. Session capability tokens are a different
 * credential and live with the relay (`openroom-relay/tokens`).
 */

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
