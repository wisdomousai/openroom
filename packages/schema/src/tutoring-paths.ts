/**
 * Shared control-plane path allowlist for peer clients (MCP, CLI).
 * Must stay aligned with the worker's routers (tutoring contexts, decks,
 * sessions, media assets).
 *
 * Contexts, decks (content + versions), sessions (delivery instances), media
 * assets.
 *
 * `/api/tutoring/lookup`, `/api/tutoring/dictionary` and `/api/tutoring/stock`
 * are deliberately absent: they are tutor-console conveniences (word lookup,
 * stock photo search), not agent-surface CRUD, so peer clients get no path for
 * them. Do not "fix" this by adding them.
 *
 * Stock photo search does reach agents, but as the named `picture_search` MCP
 * tool, which calls the route through `controlRequest` and shapes the hits into
 * a pasteable `media` object. That is the same reason the `deck_*` tools
 * exist as names rather than raw paths. The path itself stays off this
 * allowlist, so `openroom_api` still refuses it.
 */

/** Path only (no origin). Query strings are allowed. */
export const TUTORING_API_PATH_PATTERN =
  /^\/api\/(?:my\/(?:billing(?:\/(?:plans|checkout|portal|sync))?|archives(?:\/[^/?]+(?:\/document)?)?|spaces(?:\/[^/?]+\/(?:members(?:\/[^/?]+)?|invites))?|invites(?:\/[^/?]+(?:\/accept)?)?)|tutoring\/(?:contexts(?:\/[^/?]+(?:\/(?:restore|permanent-deletion|learners|returned|work(?:\/[^/?]+(?:\/(?:feedback|audio))?)?|links(?:\/[^/?]+)?))?)?|spaces\/[^/?]+\/(?:assets|brand-kits)|brand-kits\/[^/?]+(?:\/restore)?|assets\/[^/?]+)|presentations\/start|decks(?:\/[^/?]+(?:\/(?:versions|draft|start|restore|permanent-deletion))?)?|sessions(?:\/[^/?]+(?:\/(?:record|launch|resume|restore|permanent-deletion))?)?)(?:\?[^#]*)?$/;

export function isTutoringApiPath(path: string): boolean {
  return TUTORING_API_PATH_PATTERN.test(path);
}
