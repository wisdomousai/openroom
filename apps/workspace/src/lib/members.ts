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

/**
 * Spaces the nav lists. A student's own space (`sp_ctx_…`) is left out while
 * that student is in Trash (the trashed place is reached through Trash), and
 * when no student and no deck is left in it. A space whose student was deleted
 * with decks still filed in it is listed like any other. Lists not loaded yet
 * hide nothing.
 */
export function navigableSpaces(
  spaces: MySpace[],
  known: {
    trashed?: readonly { spaceId: string }[] | undefined;
    live?: readonly { spaceId: string }[] | undefined;
    decks?: readonly { spaceId: string }[] | undefined;
  },
): MySpace[] {
  const trashed = new Set((known.trashed ?? []).map((student) => student.spaceId));
  const live = known.live && known.decks ? new Set(known.live.map((student) => student.spaceId)) : null;
  const filed = known.decks ? new Set(known.decks.map((deck) => deck.spaceId)) : null;
  return spaces.filter((space) => {
    if (!space.id.startsWith('sp_ctx_')) return true;
    if (trashed.has(space.id)) return false;
    return live === null || filed === null || live.has(space.id) || filed.has(space.id);
  });
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
