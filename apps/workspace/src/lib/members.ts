/**
 * Pure helpers for space collaboration UI (testable without a DOM).
 */
import type { MySpace, SpaceRole } from '../api';

export interface GroupedSpaces {
  mine: MySpace[];
  shared: MySpace[];
}

/** Split the /api/my/spaces list into "My spaces" and "Shared with me". */
export function groupSpaces(spaces: MySpace[]): GroupedSpaces {
  const mine: MySpace[] = [];
  const shared: MySpace[] = [];
  for (const p of spaces) (p.shared ? shared : mine).push(p);
  mine.sort((a, b) => a.createdAt - b.createdAt);
  return { mine, shared };
}

/** The space whose browser the pathname is on, or null at `/space`. */
export function activeSpaceId(pathname: string): string | null {
  const match = /^\/space\/([^/]+)/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * True when a space row in the rail owns the accent, so the "My spaces" nav
 * item above it can step down to a trail. Exactly one row may read as "you are
 * here"; two highlights give the tree no parent/child signal at all.
 *
 * `/space` with no id resolves to the first unshared space, which is why a
 * null id still hands the accent to a row.
 */
export function spaceRowOwnsAccent(pathname: string, spaces: MySpace[]): boolean {
  if (!pathname.startsWith('/space')) return false;
  const current = activeSpaceId(pathname);
  return current === null
    ? spaces.some((p) => !p.shared)
    : spaces.some((p) => p.id === current);
}

const ROLE_RANK: Record<SpaceRole, number> = { presenter: 1, editor: 2, owner: 3 };

export function roleAtLeast(role: SpaceRole, min: SpaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Minimal invite-form validation; returns null when acceptable. */
export function inviteEmailError(email: string, selfEmail: string | null): string | null {
  const trimmed = email.trim().toLowerCase();
  if (trimmed === '') return 'Enter an email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'That does not look like an email.';
  if (selfEmail !== null && trimmed === selfEmail.toLowerCase()) {
    return 'You are already in this space.';
  }
  return null;
}
