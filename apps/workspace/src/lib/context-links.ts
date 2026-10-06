/**
 * Pure helpers for context access links (the student's capability credential)
 * and for rendering what a link holder sees.
 *
 * A link is not an account and not a password: it is a bearer capability scoped
 * to exactly one context, so the whole of its state is (expiry, revocation) and
 * the whole of its blast radius is one student's records. The UI only ever gets
 * a `tokenPrefix` back from the server — the secret exists in the browser for
 * exactly one render, on the mint screen.
 */
import type { ContextLinkSummary } from '../api';
import { learnerShareUrl } from '../destinations';

export type LinkState = 'active' | 'expired' | 'revoked';

/**
 * Revocation outranks expiry: a link the tutor withdrew reads "Revoked" even
 * once its clock also runs out, because "I turned it off" is the fact the tutor
 * is looking for. `expiresAt: null` is a link with no clock.
 */
export function linkState(
  link: Pick<ContextLinkSummary, 'expiresAt' | 'revokedAt'>,
  now: number = Date.now(),
): LinkState {
  if (link.revokedAt !== null) return 'revoked';
  if (link.expiresAt !== null && link.expiresAt <= now) return 'expired';
  return 'active';
}

export function linkStateLabel(state: LinkState): string {
  switch (state) {
    case 'active':
      return 'Works';
    case 'expired':
      return 'Expired';
    case 'revoked':
      return 'Revoked';
  }
}

/** Live links are the ones that count against the per-context cap. */
export function liveLinkCount(
  links: readonly Pick<ContextLinkSummary, 'expiresAt' | 'revokedAt'>[],
  now: number = Date.now(),
): number {
  return links.filter((link) => linkState(link, now) === 'active').length;
}

/** The server refuses an eleventh live link with 429. */
export const MAX_LINKS_PER_CONTEXT = 10;

/**
 * The URL the learner route consumes — built by the same module the app
 * navigates with, so the thing the tutor copies and the thing `#/learn` reads
 * cannot drift apart. The token lives in the hash fragment, which browsers
 * never put on the wire: no `Referer`, no server access log.
 */
export function learnerLinkUrl(origin: string, pathname: string, token: string): string {
  return learnerShareUrl(origin, pathname, token);
}

/**
 * One line of a run record. Outcomes and homework are saved as plain strings;
 * artifacts are free-form JSON a tutor's agent wrote, so this reduces whatever
 * arrived to something a 14-year-old can read rather than showing raw JSON.
 */
export function recordItemLabel(item: unknown): string {
  if (typeof item === 'string') return item;
  if (typeof item === 'number' || typeof item === 'boolean') return String(item);
  if (item !== null && typeof item === 'object') {
    const row = item as Record<string, unknown>;
    for (const key of ['title', 'label', 'name', 'text', 'description']) {
      const value = row[key];
      if (typeof value === 'string' && value.trim() !== '') return value;
    }
    const url = row.url ?? row.href;
    if (typeof url === 'string' && url.trim() !== '') return url;
  }
  return '';
}

/** An artifact worth linking to, when the tutor recorded one. */
export function recordItemUrl(item: unknown): string | null {
  if (item === null || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
  const url = row.url ?? row.href;
  if (typeof url !== 'string') return null;
  return /^https?:\/\//i.test(url) ? url : null;
}
