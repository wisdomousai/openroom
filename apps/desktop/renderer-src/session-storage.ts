/**
 * This device's record of the live sessions it started.
 *
 * The key matches the workspace bundle's (apps/workspace/src/storage.ts): both
 * are served from `openroom://app`, so a session started from the file window
 * opens in the workspace's console, remote and Q&A pages.
 */
import type { StoredSession } from '@openroom/editor';

const SESSION_PREFIX = 'openroom.host.session.';

export function saveLiveSession(session: StoredSession): void {
  try {
    localStorage.setItem(SESSION_PREFIX + session.sessionCode, JSON.stringify(session));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

/** Forget a session on this device once it ends: its credentials are spent. */
export function clearLiveSession(sessionCode: string): void {
  try {
    localStorage.removeItem(SESSION_PREFIX + sessionCode);
  } catch {
    /* ignore */
  }
}
