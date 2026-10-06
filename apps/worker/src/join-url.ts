/**
 * Join-surface URL helpers.
 *
 * Production join origin is `https://join.openroom.app` (JOIN_ORIGIN in
 * wrangler.jsonc). When unset or empty (local: `.dev.vars` clears it; tests
 * may omit it), fall back to the path-mounted join SPA at `/join/` on the
 * same host so wrangler dev and e2e keep working without a second hostname.
 */

export interface JoinOriginEnv {
  JOIN_ORIGIN?: string;
}

/** Hostname that serves the participant SPA at `/` (rewritten from `/join/`). */
export function isJoinHost(hostname: string): boolean {
  return hostname === 'join.openroom.app' || hostname.startsWith('join.');
}

/** Absolute (or same-host `/join/…`) URL participants open to enter a session. */
export function joinUrlForCode(env: JoinOriginEnv, code: string): string {
  const origin = env.JOIN_ORIGIN?.trim().replace(/\/$/, '');
  if (origin) return `${origin}/?code=${encodeURIComponent(code)}`;
  return `/join/?code=${encodeURIComponent(code)}`;
}

/**
 * Turn a domain `joinPath` (`/?code=…`) into the wire `joinUrl`.
 * Already-absolute URLs pass through unchanged.
 */
export function absolutizeJoinUrl(env: JoinOriginEnv, joinPath: string): string {
  if (/^https?:\/\//i.test(joinPath)) return joinPath;
  const origin = env.JOIN_ORIGIN?.trim().replace(/\/$/, '');
  if (!origin) {
    // Path-mounted local join SPA.
    if (joinPath.startsWith('/join')) return joinPath;
    return `/join${joinPath.startsWith('/') ? joinPath : `/${joinPath}`}`;
  }
  const path = joinPath.startsWith('/') ? joinPath : `/${joinPath}`;
  return `${origin}${path}`;
}
