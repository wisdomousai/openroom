/** How the desktop shell should treat a top-level navigation. */
export type DesktopNavigationDecision = 'allow' | 'open-auth-start' | 'open-external' | 'ignore';

export const DESKTOP_AUTH_HANDOFF_HOST = 'auth';
export const DESKTOP_DECK_HANDOFF_HOST = 'deck';

export interface DesktopDeckHandoff {
  origin: string;
  deckId: string;
}

export function desktopGoogleStartUrl(onlineOrigin: string): string {
  const url = new URL('/api/auth/google', onlineOrigin);
  url.searchParams.set('desktop', '1');
  return url.toString();
}

export function withDesktopAuthFlag(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('desktop', '1');
  return parsed.toString();
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

export function decideDesktopNavigation(url: string, onlineOrigin: string): DesktopNavigationDecision {
  if (url.startsWith('openroom://app/') || url.startsWith('openroom://local/')) return 'allow';
  if (isOpenRoomGoogleStart(url, onlineOrigin)) return 'open-auth-start';
  if (url.startsWith(onlineOrigin)) return 'allow';
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
