/**
 * Every canonical navigation target in the host workspace, in one place.
 *
 *   /                          Home
 *   /space[/:spaceId]          the Library (folder tree, root or space)
 *   /decks/new                 dedicated deck creation
 *   /decks/:id/edit            deck editor (full-bleed outline authoring)
 *   /sessions/:code[?token=]   live session console (8-char join code)
 *   /sessions/:code/remote     phone presenter remote
 *   /sessions/:code/qna        audience Q&A desk (co-host moderation surface)
 *   /sessions/:id/record       a session's Notes (durable id)
 *   /settings                  account + ops
 *   /tutor/contexts            students
 *   /learn?token=orlnk_…       the student's own records (no account, no shell)
 *
 * There is one home for library work: the space folder tree (`/space`). Decks
 * and sessions have no collection route; a session is started, never scheduled,
 * and its remaining teacher surface after the hour is Notes.
 *
 * The builders return typed router targets, consumed as `<Link {...to.x()}>` or
 * `navigate(to.x())`. No screen writes a URL string: the only strings minted
 * here are the three `*ShareUrl` builders, which exist because a share link is
 * copied to another device.
 */

export interface LibraryPlace {
  spaceId: string | null | undefined;
  folderId?: string | null;
  itemId?: string | null;
  contextId?: string | null;
}

const opt = (value: string | null | undefined): string | undefined => value ?? undefined;

export const to = {
  home: () => ({ to: '/' as const }),

  /** The Library. Root when no space is known; otherwise space + folder + selected item + person. */
  library: (place?: LibraryPlace) =>
    place?.spaceId
      ? ({
          to: '/space/$spaceId' as const,
          params: { spaceId: place.spaceId },
          search: {
            folderId: opt(place.folderId),
            itemId: opt(place.itemId),
            contextId: opt(place.contextId),
          },
        })
      : ({ to: '/space' as const }),

  deckNew: (
    place: { contextId?: string | null; spaceId?: string | null; folderId?: string | null } = {},
  ) => ({
    to: '/decks/new' as const,
    search: {
      contextId: opt(place.contextId),
      spaceId: opt(place.spaceId),
      folderId: opt(place.folderId),
    },
  }),
  deckEditor: (deckId: string) => ({ to: '/decks/$deckId/edit' as const, params: { deckId } }),
  savedResults: (archiveId: string) => ({ to: '/results/$archiveId' as const, params: { archiveId } }),

  sessionConsole: (sessionCode: string, token?: string) => ({
    to: '/sessions/$sessionCode' as const,
    params: { sessionCode },
    search: { token },
  }),
  sessionRecap: (sessionCode: string, token?: string) => ({
    to: '/sessions/$sessionCode/recap' as const, params: { sessionCode }, search: { token },
  }),
  sessionRemote: (sessionCode: string, token?: string) => ({
    to: '/sessions/$sessionCode/remote' as const,
    params: { sessionCode },
    search: { token },
  }),
  sessionQna: (sessionCode: string, token?: string) => ({
    to: '/sessions/$sessionCode/qna' as const,
    params: { sessionCode },
    search: { token },
  }),
  /** Notes. Addressed by the durable session id, never by join code. */
  sessionNotes: (sessionKey: string) => ({
    to: '/sessions/$sessionKey/record' as const,
    params: { sessionKey },
  }),

  students: () => ({ to: '/tutor/contexts' as const }),
  studentNew: (sourceSpaceId?: string, experience?: 'tutoring' | 'classroom') => ({
    to: '/tutor/contexts/new' as const, search: { sourceSpaceId, experience },
  }),
  student: (contextId: string) => ({
    to: '/tutor/contexts/$contextId' as const,
    params: { contextId },
  }),
  studentEdit: (contextId: string) => ({
    to: '/tutor/contexts/$contextId/edit' as const,
    params: { contextId },
  }),
  studentLinkNew: (contextId: string) => ({
    to: '/tutor/contexts/$contextId/links/new' as const,
    params: { contextId },
  }),
  studentWork: (contextId: string) => ({ to: '/tutor/contexts/$contextId/work' as const, params: { contextId } }),
  studentWorkReview: (contextId: string, submissionId: string) => ({ to: '/tutor/contexts/$contextId/work/$submissionId/edit' as const, params: { contextId, submissionId } }),

  spaceNew: () => ({ to: '/space/new' as const }),
  lessonExamples: (spaceId: string, place: { folderId?: string | null; contextId?: string | null } = {}) => ({
    to: '/space/$spaceId/samples' as const,
    params: { spaceId },
    search: { folderId: opt(place.folderId), contextId: opt(place.contextId) },
  }),
  brandKits: (spaceId: string, trashed = false) => ({ to: '/space/$spaceId/brand-kits' as const, params: { spaceId }, search: { trashed: trashed || undefined } }),
  brandKitNew: (spaceId: string) => ({ to: '/space/$spaceId/brand-kits/new' as const, params: { spaceId } }),
  brandKit: (spaceId: string, kitId: string) => ({ to: '/space/$spaceId/brand-kits/$kitId' as const, params: { spaceId, kitId } }),
  brandKitEdit: (spaceId: string, kitId: string) => ({ to: '/space/$spaceId/brand-kits/$kitId/edit' as const, params: { spaceId, kitId } }),
  spaceEdit: (spaceId: string) => ({ to: '/space/$spaceId/edit' as const, params: { spaceId } }),
  spaceMembers: (spaceId: string) => ({
    to: '/space/$spaceId/members' as const,
    params: { spaceId },
  }),
  spaceInvite: (spaceId: string) => ({
    to: '/space/$spaceId/members/invite' as const,
    params: { spaceId },
  }),
  spaceMemberEdit: (spaceId: string, userId: string) => ({
    to: '/space/$spaceId/members/$userId/edit' as const,
    params: { spaceId, userId },
  }),

  trash: (spaceId?: string) => ({ to: '/tutor/trash' as const, search: { spaceId } }),
  settings: (spaceId?: string) => ({ to: '/settings' as const, search: { spaceId } }),
  billing: () => ({ to: '/settings/billing' as const }),
  settingsTokenNew: () => ({ to: '/settings/tokens/new' as const }),
  learn: (token: string | null) => ({
    to: '/learn' as const,
    search: { token: token ?? undefined },
  }),
} as const;

/** What every builder above produces: a router target, spread onto Link or navigate. */
export type LinkTarget = ReturnType<(typeof to)[keyof typeof to]>;

/**
 * Absolute share URLs — the only place a token may appear in a URL string.
 *
 * The token lives in the hash fragment, which browsers never put on the wire:
 * no `Referer`, no server access log.
 */
export function shareUrl(hashPath: string, origin: string, pathname: string): string {
  const base = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return `${origin}${base}#${hashPath}`;
}

/** Presenter remote link — hand this to the phone in the presenter's pocket. */
export function remoteShareUrl(
  sessionCode: string,
  hostToken: string,
  origin: string = location.origin,
  pathname: string = location.pathname,
): string {
  return shareUrl(
    `/sessions/${encodeURIComponent(sessionCode)}/remote?token=${encodeURIComponent(hostToken)}`,
    origin,
    pathname,
  );
}

/** Q&A desk link — hand this to a co-host who moderates audience questions. */
export function qnaShareUrl(
  sessionCode: string,
  hostToken: string,
  origin: string = location.origin,
  pathname: string = location.pathname,
): string {
  return shareUrl(
    `/sessions/${encodeURIComponent(sessionCode)}/qna?token=${encodeURIComponent(hostToken)}`,
    origin,
    pathname,
  );
}

/** The student's own page, opened by a context access link and nothing else. */
export function learnerShareUrl(origin: string, pathname: string, token: string): string {
  return shareUrl(`/learn?token=${encodeURIComponent(token)}`, origin, pathname);
}
