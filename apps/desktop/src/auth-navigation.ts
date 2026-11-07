import { createHash, randomBytes } from 'node:crypto';

/** How the desktop shell should treat a top-level navigation. */
export type DesktopNavigationDecision = 'allow' | 'open-auth-start' | 'open-external' | 'ignore';

export const DESKTOP_AUTH_HANDOFF_HOST = 'auth';
export const DESKTOP_DECK_HANDOFF_HOST = 'deck';

export interface DesktopDeckHandoff {
  origin: string;
  deckId: string;
}

export function desktopGoogleStartUrl(onlineOrigin: string, challenge: string): string {
  return withDesktopAuthFlag(new URL('/api/auth/google', onlineOrigin).toString(), challenge);
}

/** Marks a Google start as Desktop's, bound to the challenge of the sign-in Desktop holds. */
export function withDesktopAuthFlag(url: string, challenge: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('desktop', '1');
  parsed.searchParams.set('desktop_challenge', challenge);
  return parsed.toString();
}

/** Matches the server's OAuth state lifetime. */
const DESKTOP_SIGN_IN_TTL_MS = 10 * 60 * 1000;

/**
 * The browser sign-in Desktop started. Its challenge rides the Google start;
 * the verifier stays in this process and goes with the redeem, so a ticket
 * from someone else's sign-in cannot sign this Desktop in.
 */
export interface DesktopSignInBinding {
  /** The challenge for a browser sign-in; a second start reuses the pending one. */
  begin(): string;
  /** The pending sign-in's verifier, or null when Desktop started none. */
  verifier(): string | null;
  finish(): void;
}

export function createDesktopSignInBinding(now: () => number = Date.now): DesktopSignInBinding {
  let pending: { verifier: string; challenge: string; expiresAt: number } | null = null;
  const live = () => (pending !== null && pending.expiresAt > now() ? pending : null);
  return {
    begin() {
      const current = live();
      if (current !== null) return current.challenge;
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      pending = { verifier, challenge, expiresAt: now() + DESKTOP_SIGN_IN_TTL_MS };
      return challenge;
    },
    verifier: () => live()?.verifier ?? null,
    finish() { pending = null; },
  };
}

export function isOpenRoomGoogleStart(url: string, onlineOrigin: string): boolean {
  try {
    const parsed = new URL(url);
    const origin = new URL(onlineOrigin);
    return parsed.origin === origin.origin && parsed.pathname === '/api/auth/google';
  } catch {
    return false;
  }
}

/** Google's own hops. Forwarding only these (without /api/auth/google) drops the PKCE cookie. */
export function isGoogleAuthHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === 'accounts.google.com' ||
      host === 'accounts.youtube.com' ||
      host === 'oauthaccountmanager.googleapis.com' ||
      host.endsWith('.google.com') ||
      host.endsWith('.googleusercontent.com') ||
      host === 'gstatic.com' ||
      host.endsWith('.gstatic.com')
    );
  } catch {
    return false;
  }
}

/**
 * The pages that carry the Desktop bridge: the bundled renderer at
 * openroom://app and the configured OpenRoom origin, compared as parsed
 * origins. Navigation and every IPC sender are held to this one test.
 */
export function isTrustedDesktopUrl(url: string, onlineOrigin: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.username !== '' || parsed.password !== '') return false;
    if (parsed.protocol === 'openroom:') return parsed.host === 'app';
    return parsed.origin === new URL(onlineOrigin).origin;
  } catch {
    return false;
  }
}

export function decideDesktopNavigation(url: string, onlineOrigin: string): DesktopNavigationDecision {
  if (isOpenRoomGoogleStart(url, onlineOrigin)) return 'open-auth-start';
  if (isTrustedDesktopUrl(url, onlineOrigin)) return 'allow';
  if (isGoogleAuthHost(url)) return 'ignore';
  if (url.startsWith('https://') || url.startsWith('http://')) return 'open-external';
  return 'ignore';
}

export function parseDesktopAuthHandoff(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'openroom:' || parsed.hostname !== DESKTOP_AUTH_HANDOFF_HOST) return null;
    const ticket = parsed.searchParams.get('ticket');
    return ticket !== null && ticket !== '' ? ticket : null;
  } catch {
    return null;
  }
}

export function parseDesktopDeckHandoff(url: string): DesktopDeckHandoff | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'openroom:'
      || parsed.hostname !== DESKTOP_DECK_HANDOFF_HOST
      || parsed.pathname !== '/open'
    ) return null;
    const deckId = parsed.searchParams.get('deckId');
    const rawOrigin = parsed.searchParams.get('origin');
    if (deckId === null || deckId === '' || rawOrigin === null) return null;
    const origin = new URL(rawOrigin);
    if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search !== '' || origin.hash !== '') {
      return null;
    }
    return { origin: origin.origin, deckId };
  } catch {
    return null;
  }
}
