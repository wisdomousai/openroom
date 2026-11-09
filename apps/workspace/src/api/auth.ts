import { apiFetch, baseUrl, request, responseError } from './client';

/* ------------------------------------------------------------ control plane */

export interface Entitlements {
  keep: boolean;
  guestList: boolean;
  rawExport: boolean;
  branding: boolean;
  team: boolean;
  continuity: boolean;
  largeSessions: boolean;
  connectors: boolean;
}

export interface MeUser {
  id: string;
  email: string;
  name: string | null;
  entitlements?: Entitlements;
}

/**
 * null = signed out: the worker answered 200 with `user: null` (or 401).
 * A failed answer or an unreachable worker throws an ApiError, so the sign-in
 * gate can tell "signed out" from "could not check".
 */
export async function fetchMe(): Promise<MeUser | null> {
  const res = await apiFetch(`${baseUrl}/api/me`, { credentials: 'same-origin' });
  if (res.status === 401) return null;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw responseError(res.status, body);
  return (body as { user?: MeUser | null } | null)?.user ?? null;
}

export interface DemoAccountPublic {
  username: string;
  email: string;
  name: string;
}

export interface AuthStatus {
  google: boolean;
  demo: boolean;
  accounts: DemoAccountPublic[];
}

/**
 * What sign-in methods this deployment offers.
 * Google and/or static demo accounts (dev). Either is enough to show the
 * account card as interactive. A failed probe throws an ApiError rather than
 * reporting that no method exists.
 */
export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await apiFetch(`${baseUrl}/api/auth/status`, { credentials: 'same-origin' });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw responseError(res.status, body);
  const status = (body ?? {}) as Partial<AuthStatus>;
  return {
    google: status.google === true,
    demo: status.demo === true,
    accounts: Array.isArray(status.accounts) ? status.accounts : [],
  };
}

export function signInUrl(): string {
  return `${baseUrl}/api/auth/google`;
}

/**
 * Dev-mode username/password login against static demo accounts.
 * Sets the same `or_session` cookie Google OAuth would.
 */
export function demoLogin(
  username: string,
  password: string,
): Promise<{ user: MeUser }> {
  return request<{ user: MeUser }>('/api/auth/demo/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function logout(): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/auth/logout', { method: 'POST', mutating: true });
}
