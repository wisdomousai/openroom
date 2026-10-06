import { request } from './client';

/* ---------------------------------------------------------- home + prefs */

/**
 * The one Home zone that needs a join the list endpoints do not do.
 *
 * Everything else on Home is assembled from `listSessions` / `listDecks` /
 * `listContexts`, which the page loads anyway. `needsRecord`
 * hangs off `sessions × live_sessions × session_records`, so it arrives as one
 * route rather than an N+1 of per-session record probes.
 */
export interface HomeNeedsRecord {
  sessionId: string;
  title: string;
  contextId: string | null;
  spaceId: string;
  deliveredAt: number;
}

export interface HomeSummary {
  needsRecord: HomeNeedsRecord[];
}

export function getHomeSummary(): Promise<HomeSummary> {
  return request<HomeSummary>('/api/my/home');
}
