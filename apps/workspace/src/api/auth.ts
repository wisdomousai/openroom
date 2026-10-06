import { baseUrl, request } from './client';

/* ------------------------------------------------------------ control plane */

export interface Entitlements {
  keep: boolean;
  roster: boolean;
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

/** null = signed out. Never throws for the 401 case. */
export async function fetchMe(): Promise<MeUser | null> {
  try {
    const res = await fetch(`${baseUrl}/api/me`, { credentials: 'same-origin' });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    const body = (await res.json()) as { user: MeUser };
    return body.user ?? null;
  } catch {
    return null;
  }
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
 * account card as interactive.
 */
export async function fetchAuthStatus(): Promise<AuthStatus> {
  try {
    const res = await fetch(`${baseUrl}/api/auth/status`, { credentials: 'same-origin' });
    if (!res.ok) return { google: false, demo: false, accounts: [] };
    const body = (await res.json()) as Partial<AuthStatus>;
    return {
      google: body.google === true,
      demo: body.demo === true,
      accounts: Array.isArray(body.accounts) ? body.accounts : [],
    };
  } catch {
    return { google: false, demo: false, accounts: [] };
  }
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
