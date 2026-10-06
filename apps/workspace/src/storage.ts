import type { StoredSession } from '@openroom/editor';

const SESSION_PREFIX = 'openroom.host.session.';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — degrade silently */
  }
}
function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// The browser no longer accepts deployment credentials. Clear any value left
// behind by versions that exposed the old signed-out session-creation fallback.
safeRemove('openroom.host.adminKey');

export function saveLiveSession(session: StoredSession): void {
  safeSet(SESSION_PREFIX + session.sessionCode, JSON.stringify(session));
}

export function loadLiveSession(sessionCode: string): StoredSession | null {
  const raw = safeGet(SESSION_PREFIX + sessionCode);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed && typeof parsed.hostToken === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Forget a session on this device.
 *
 * Called when a session ends: the credentials are spent, and leaving them
 * behind is what put an ended session back under Home's "On this device".
 */
export function clearLiveSession(sessionCode: string): void {
  safeRemove(SESSION_PREFIX + sessionCode);
}

export function listLiveSessions(): StoredSession[] {
  const out: StoredSession[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(SESSION_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as StoredSession;
        if (parsed && typeof parsed.sessionCode === 'string') out.push(parsed);
      } catch {
        /* skip corrupt entry */
      }
    }
  } catch {
    return out;
  }
  return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}
