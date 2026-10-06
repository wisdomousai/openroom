export interface StoredSession {
  sessionCode: string;
  /** Join code used to find this session when the shared QR URL is scanned again. */
  code?: string;
  token: string;
  participantId: string;
  /** Session-local handle (pseudonymous sessions only). */
  handle?: string;
}

const SESSION_PREFIX = 'openroom:participant:session:';
const CODE_PREFIX = 'openroom:participant:code:';

function stores(): Storage[] {
  const globals = globalThis as { localStorage?: Storage; sessionStorage?: Storage };
  return [globals.localStorage, globals.sessionStorage].filter(
    (store): store is Storage => store !== undefined,
  );
}

function parseSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.token || !parsed?.sessionCode || !parsed?.participantId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readStored(key: string): StoredSession | null {
  for (const store of stores()) {
    try {
      const session = parseSession(store.getItem(key));
      if (session) return session;
    } catch {
      /* private mode / storage disabled — try the other browser store */
    }
  }
  return null;
}

/** Credentials are stored per session so reloads and ordinary browser restarts survive. */
export function loadSession(sessionCode: string): StoredSession | null {
  return readStored(SESSION_PREFIX + sessionCode);
}

/** Find a session capability from the shared `?code=` QR URL. */
export function loadSessionByCode(code: string): StoredSession | null {
  return readStored(CODE_PREFIX + code.trim().toUpperCase());
}

export function saveSession(session: StoredSession): void {
  const serialized = JSON.stringify(session);
  for (const store of stores()) {
    try {
      store.setItem(SESSION_PREFIX + session.sessionCode, serialized);
      if (session.code) store.setItem(CODE_PREFIX + session.code.toUpperCase(), serialized);
    } catch {
      /* private mode / storage disabled — the in-memory app session still works */
    }
  }
}

export function clearSession(session: Pick<StoredSession, 'sessionCode' | 'code'>): void {
  for (const store of stores()) {
    try {
      store.removeItem(SESSION_PREFIX + session.sessionCode);
      if (session.code) store.removeItem(CODE_PREFIX + session.code.toUpperCase());
    } catch {
      /* ignore */
    }
  }
}

export function readQuery(): { code: string | null; session: string | null } {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  return {
    code: code ? code.trim().toUpperCase() : null,
    session: params.get('session'),
  };
}

/**
 * The context access link a tutoring learner arrives with (`?link=orlnk_…`).
 *
 * Same discipline as the learner records page: it is read, used once for the
 * join, and never stored. `forgetLinkInUrl` takes it back out of the address
 * bar the moment the join succeeds, so a shared screenshot of the URL is not a
 * credential.
 */
export function readContextLink(): string | null {
  const value = new URLSearchParams(location.search).get('link');
  return value !== null && value.trim() !== '' ? value.trim() : null;
}

/** Roster invite a named seat arrives with (`?invite=orinv_…`). Used once, never stored. */
export function readRosterInvite(): string | null {
  const value = new URLSearchParams(location.search).get('invite');
  return value !== null && value.trim() !== '' ? value.trim() : null;
}

export function forgetLinkInUrl(): void {
  const url = new URL(location.href);
  url.searchParams.delete('link');
  history.replaceState(null, '', url.toString());
}

/** Keep ?session= in the URL so a reload finds the stored credentials again. */
export function rememberSessionInUrl(sessionCode: string): void {
  const url = new URL(location.href);
  url.searchParams.delete('code');
  url.searchParams.set('session', sessionCode);
  history.replaceState(null, '', url.toString());
}

export function forgetSessionInUrl(): void {
  const url = new URL(location.href);
  url.searchParams.delete('session');
  url.searchParams.delete('code');
  history.replaceState(null, '', url.toString());
}
