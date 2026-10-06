/**
 * Tag client for the OpenRoom control plane.
 *
 * Folders say *where* an item lives; tags cut *across* folders. The browser
 * reaches the same four routes this module wraps, because the browser, the
 * CLI, MCP and a raw API caller are peer clients of one application service
 * (`AGENTS.md` §"Product architecture"). Nothing here is browser-specific and
 * nothing here is agent-specific.
 *
 * ## There is deliberately no `normalizeTag` in this package
 *
 * Tag text is trimmed and lowercased **at the API**, not in a client. If this
 * SDK also normalised, there would be two definitions of "the same tag" that
 * could drift a release apart, and the drift would show up as duplicate facet
 * rows nobody can merge. So: send what the user typed, read back what the
 * server decided. Every write below answers with the item's full tag set
 * after the change precisely so a caller never has to guess.
 *
 * The constants are mirrored here for input hints (a character counter, a
 * disabled Add button) — they describe the server's rule, they do not enforce
 * it. A client that ignores them gets a `400`, which is the correct outcome.
 */
import type { FetchLike } from './client.js';

/** Longest tag the API will accept, after normalisation. */
export const TAG_MAX_LENGTH = 32;

/** Most tags one item may carry. */
export const MAX_TAGS_PER_ITEM = 24;

/**
 * Taggable item kinds, in **API vocabulary**.
 *
 * `deck` is the authored file and `session` is one started instance of it —
 * see `docs/TERMINOLOGY.md`. A UI translating kind ids onto these owns the
 * translation; the wire never carries the UI word.
 */
export const TAGGABLE_ITEM_TYPES = ['deck', 'session', 'record', 'context'] as const;
export type TaggableItemType = (typeof TAGGABLE_ITEM_TYPES)[number];

/** One row of the space-wide facet list. */
export interface SpaceTagFacet {
  tag: string;
  count: number;
}

/** The response every tag write returns: the item's set after the change. */
export interface ItemTagSet {
  itemType: TaggableItemType;
  itemId: string;
  tags: string[];
}

export interface TagsClientOptions {
  /** Worker origin, e.g. `https://openroom.example`. */
  baseUrl: string;
  /**
   * Personal API token (`orpat_…`) or an MCP OAuth access token. Omit in a
   * browser, where the `or_session` cookie plus the CSRF header authenticates
   * instead — pass `credentials: 'include'` through `fetch` in that case.
   */
  token?: string;
  /** Testing seam; defaults to the global. */
  fetch?: FetchLike;
}

export interface TagsClient {
  /** Every tag in one space, with counts — the facet list. */
  listSpaceTags(spaceId: string): Promise<SpaceTagFacet[]>;
  /** The tags on one item. */
  getItemTags(itemType: TaggableItemType, itemId: string): Promise<string[]>;
  /** Replace an item's whole tag set. */
  setItemTags(itemType: TaggableItemType, itemId: string, tags: string[]): Promise<string[]>;
  /** Add one tag. Idempotent — adding a tag the item already has is a no-op. */
  addItemTag(itemType: TaggableItemType, itemId: string, tag: string): Promise<string[]>;
  /** Remove one tag. Idempotent — removing an absent tag is a no-op. */
  removeItemTag(itemType: TaggableItemType, itemId: string, tag: string): Promise<string[]>;
}

export class TagError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'TagError';
    this.status = status;
  }
}

export function createTagsClient(options: TagsClientOptions): TagsClient {
  const base = options.baseUrl.replace(/\/+$/, '');
  const f: FetchLike =
    options.fetch ?? ((globalThis as unknown as { fetch: FetchLike }).fetch as FetchLike);

  async function call(path: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
    if (init?.body !== undefined) headers['content-type'] = 'application/json';
    // A cookie-authenticated browser write needs the CSRF header; a bearer
    // token does not, and sending it anyway is harmless.
    if (init?.method !== undefined && init.method !== 'GET') headers['x-openroom-csrf'] = '1';

    const res = await f(`${base}${path}`, {
      ...(init?.method !== undefined ? { method: init.method } : {}),
      headers,
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      throw new TagError(body?.error ?? `Tag request failed (${res.status})`, res.status);
    }
    return body;
  }

  const itemPath = (itemType: TaggableItemType, itemId: string): string =>
    `/api/my/items/${encodeURIComponent(itemType)}/${encodeURIComponent(itemId)}/tags`;

  return {
    async listSpaceTags(spaceId) {
      const body = (await call(
        `/api/my/spaces/${encodeURIComponent(spaceId)}/tags`,
      )) as { tags?: SpaceTagFacet[] } | null;
      return body?.tags ?? [];
    },
    async getItemTags(itemType, itemId) {
      const body = (await call(itemPath(itemType, itemId))) as ItemTagSet | null;
      return body?.tags ?? [];
    },
    async setItemTags(itemType, itemId, tags) {
      const body = (await call(itemPath(itemType, itemId), {
        method: 'PUT',
        body: { tags },
      })) as ItemTagSet | null;
      return body?.tags ?? [];
    },
    async addItemTag(itemType, itemId, tag) {
      const body = (await call(itemPath(itemType, itemId), {
        method: 'POST',
        body: { tag },
      })) as ItemTagSet | null;
      return body?.tags ?? [];
    },
    async removeItemTag(itemType, itemId, tag) {
      const body = (await call(
        `${itemPath(itemType, itemId)}/${encodeURIComponent(tag)}`,
        { method: 'DELETE' },
      )) as ItemTagSet | null;
      return body?.tags ?? [];
    },
  };
}
