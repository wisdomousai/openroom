/**
 * Item tags — the axis that cuts across folders.
 *
 * A folder answers *where does this live*; there is exactly one answer per
 * item and it is the tree. A tag answers *what is this like*, and there are
 * many answers per item, shared across folders. The two are not
 * interchangeable and neither replaces the other: moving an item never touches
 * its tags, tagging an item never moves it.
 *
 * ## Normalisation is server-side, and that is load-bearing
 *
 * `normalizeTag` runs here, at the API, not in the browser. The browser, the
 * CLI and MCP are peer clients (`AGENTS.md`); if each one lowercased on its own
 * they would eventually disagree, and the disagreement would be invisible —
 * you would just get two facet rows called `B1` and `b1` and no way to merge
 * them. Clients send whatever the user typed; the API decides what it means.
 * The unique index in `0015_item_tags.sql` then makes idempotence structural
 * rather than a property of the write path.
 *
 * ## Authorisation
 *
 * A tag is not a thing you can own separately from the item it is on. Every
 * route here resolves the item first, discovers the space from the item's own
 * row, and checks membership on that space — the caller never names the space.
 * Reads need membership; writes need `editor` or above, the same bar as moving
 * or renaming the item, because a tag is identity chrome in exactly the sense
 * `AGENTS.md` §"Entity panel" describes.
 */
import { json, type ControlEnv, type SessionUser } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { memberOfSpace, readJson } from './control-utils.js';
import { roleAtLeast, spaceRole } from './members.js';

/**
 * The item kinds a tag can hang on, in **API vocabulary**.
 *
 * `deck` is the UI's "Template" and `session` is the UI's "Session"
 * (`docs/TERMINOLOGY.md`). The database and every wire path use the domain
 * word; the browser translates on the way in and out.
 */
export const TAGGABLE_ITEM_TYPES = ['deck', 'session', 'record', 'context'] as const;
export type TaggableItemType = (typeof TAGGABLE_ITEM_TYPES)[number];

const ITEM_TYPE_SET: ReadonlySet<string> = new Set(TAGGABLE_ITEM_TYPES);

/**
 * Limits, enforced here and nowhere else.
 *
 * 32 characters is a label, not a sentence — a tag that does not fit on a chip
 * is a description, and descriptions belong on the edit route. 24 tags per item
 * is far past any real filing scheme and exists only to stop an agent loop from
 * turning one row into a keyword dump.
 */
export const TAG_MAX_LENGTH = 32;
export const MAX_TAGS_PER_ITEM = 24;

/**
 * Trim, lowercase, collapse inner whitespace. Returns null for anything that
 * cannot be a tag: empty after trimming, longer than `TAG_MAX_LENGTH`, or
 * carrying a control character or a comma.
 *
 * The comma is excluded because tags are routinely pasted and typed as
 * comma-separated lists; allowing one inside a tag would make `"a,b"` mean two
 * different things depending on which client parsed it.
 */
export function normalizeTag(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  if (/[\u0000-\u001f\u007f,]/.test(input)) return null;
  const collapsed = input.trim().replace(/\s+/g, ' ').toLowerCase();
  if (collapsed === '') return null;
  if (collapsed.length > TAG_MAX_LENGTH) return null;
  return collapsed;
}

/**
 * Normalise a whole set. Order is preserved from first appearance, duplicates
 * that collapse onto the same normal form are dropped rather than rejected —
 * `['B1', ' b1 ']` is one tag typed twice, not an error.
 */
export function normalizeTagSet(
  input: unknown,
): { ok: true; tags: string[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'tags-must-be-array' };
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input) {
    const tag = normalizeTag(raw);
    if (tag === null) return { ok: false, error: 'invalid-tag' };
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  if (tags.length > MAX_TAGS_PER_ITEM) return { ok: false, error: 'too-many-tags' };
  return { ok: true, tags };
}

export function isTaggableItemType(value: unknown): value is TaggableItemType {
  return typeof value === 'string' && ITEM_TYPE_SET.has(value);
}

/**
 * Find the space an item belongs to, or null when the item does not exist or
 * is in the trash.
 *
 * A record has no place of its own: it inherits the session's, which is why the
 * `record` branch joins back through `sessions`. That is the same rule the library
 * list uses to decide which folder a record row appears in, so a record can
 * never be tagged into a space its session is not in.
 */
async function itemSpaceId(
  env: ControlEnv,
  itemType: TaggableItemType,
  itemId: string,
): Promise<string | null> {
  const query: Record<TaggableItemType, string> = {
    deck: 'SELECT space_id FROM decks WHERE id = ?1 AND deleted_at IS NULL',
    session: 'SELECT space_id FROM sessions WHERE id = ?1 AND deleted_at IS NULL',
    context: 'SELECT space_id FROM contexts WHERE id = ?1 AND deleted_at IS NULL',
    record:
      `SELECT r.space_id AS space_id FROM session_records rr
         JOIN sessions r ON r.id = rr.session_id
        WHERE rr.id = ?1 AND r.deleted_at IS NULL`,
  };
  const row = await env.DB.prepare(query[itemType]).bind(itemId).first<{ space_id: string | null }>();
  return row?.space_id ?? null;
}

type ItemGuard =
  | { ok: true; user: SessionUser; spaceId: string }
  | { ok: false; response: Response };

async function requireItem(
  request: Request,
  env: ControlEnv,
  itemType: string,
  itemId: string,
  mutating: boolean,
): Promise<ItemGuard> {
  const guard = await requireControlUser(request, env, mutating);
  if (!guard.ok) return guard;
  if (!isTaggableItemType(itemType)) return { ok: false, response: json({ error: 'not-found' }, 404) };
  const spaceId = await itemSpaceId(env, itemType, itemId);
  if (spaceId === null) return { ok: false, response: json({ error: 'not-found' }, 404) };
  if (mutating) {
    const access = await spaceRole(env, guard.user, spaceId);
    if (access === null) return { ok: false, response: json({ error: 'not-found' }, 404) };
    if (!roleAtLeast(access.role, 'editor')) {
      return { ok: false, response: json({ error: 'forbidden' }, 403) };
    }
  } else if (!(await memberOfSpace(env, guard.user.id, spaceId))) {
    return { ok: false, response: json({ error: 'not-found' }, 404) };
  }
  return { ok: true, user: guard.user, spaceId };
}

async function readItemTags(
  env: ControlEnv,
  itemType: TaggableItemType,
  itemId: string,
): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT tag FROM item_tags WHERE item_type = ?1 AND item_id = ?2 ORDER BY tag ASC',
  )
    .bind(itemType, itemId)
    .all<{ tag: string }>();
  return (results ?? []).map((row) => row.tag);
}

/** All tag rows in a space — the browser groups them onto its list rows. */
export async function readSpaceItemTags(
  env: ControlEnv,
  spaceId: string,
): Promise<{ itemType: string; itemId: string; tag: string }[]> {
  const { results } = await env.DB.prepare(
    `SELECT item_type, item_id, tag FROM item_tags
      WHERE space_id = ?1 ORDER BY tag ASC LIMIT 5000`,
  )
    .bind(spaceId)
    .all<{ item_type: string; item_id: string; tag: string }>();
  return (results ?? []).map((row) => ({
    itemType: row.item_type,
    itemId: row.item_id,
    tag: row.tag,
  }));
}

/** GET /api/my/spaces/:spaceId/tags — the facet list under the tree rail. */
export async function spaceTagsRoute(
  request: Request,
  env: ControlEnv,
  spaceId: string,
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
  const guard = await requireControlUser(request, env, false);
  if (!guard.ok) return guard.response;
  if (!(await memberOfSpace(env, guard.user.id, spaceId))) {
    return json({ error: 'not-found' }, 404);
  }
  const { results } = await env.DB.prepare(
    `SELECT tag, COUNT(*) AS count FROM item_tags
      WHERE space_id = ?1 GROUP BY tag ORDER BY count DESC, tag ASC`,
  )
    .bind(spaceId)
    .all<{ tag: string; count: number }>();
  return json({ tags: (results ?? []).map((row) => ({ tag: row.tag, count: row.count })) });
}

/**
 * /api/my/items/:itemType/:itemId/tags
 *
 * GET    → `{ tags: string[] }`
 * PUT    → replace the whole set, body `{ tags: string[] }`
 * POST   → add one, body `{ tag: string }` (idempotent)
 *
 * Every write answers with the item's full tag set after the change, so a
 * client never has to re-read to know what it now has.
 */
export async function itemTagsRoute(
  request: Request,
  env: ControlEnv,
  itemType: string,
  itemId: string,
): Promise<Response> {
  const method = request.method;
  if (method !== 'GET' && method !== 'PUT' && method !== 'POST') {
    return json({ error: 'method-not-allowed' }, 405);
  }
  const guard = await requireItem(request, env, itemType, itemId, method !== 'GET');
  if (!guard.ok) return guard.response;
  const type = itemType as TaggableItemType;

  if (method === 'GET') {
    return json({ itemType: type, itemId, tags: await readItemTags(env, type, itemId) });
  }

  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  const now = Date.now();

  if (method === 'POST') {
    const tag = normalizeTag(body.tag);
    if (tag === null) return json({ error: 'invalid-tag' }, 400);
    const existing = await readItemTags(env, type, itemId);
    if (!existing.includes(tag) && existing.length >= MAX_TAGS_PER_ITEM) {
      return json({ error: 'too-many-tags' }, 400);
    }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO item_tags (space_id, item_type, item_id, tag, created_at, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
      .bind(guard.spaceId, type, itemId, tag, now, guard.user.id)
      .run();
    return json({ ok: true, itemType: type, itemId, tags: await readItemTags(env, type, itemId) });
  }

  const parsed = normalizeTagSet(body.tags);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const statements = [
    env.DB.prepare('DELETE FROM item_tags WHERE item_type = ?1 AND item_id = ?2').bind(type, itemId),
    ...parsed.tags.map((tag) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO item_tags (space_id, item_type, item_id, tag, created_at, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(guard.spaceId, type, itemId, tag, now, guard.user.id),
    ),
  ];
  await env.DB.batch(statements);
  return json({ ok: true, itemType: type, itemId, tags: parsed.tags });
}

/** DELETE /api/my/items/:itemType/:itemId/tags/:tag */
export async function deleteItemTagRoute(
  request: Request,
  env: ControlEnv,
  itemType: string,
  itemId: string,
  rawTag: string,
): Promise<Response> {
  if (request.method !== 'DELETE') return json({ error: 'method-not-allowed' }, 405);
  const guard = await requireItem(request, env, itemType, itemId, true);
  if (!guard.ok) return guard.response;
  const type = itemType as TaggableItemType;
  const tag = normalizeTag(rawTag);
  if (tag === null) return json({ error: 'invalid-tag' }, 400);
  await env.DB.prepare(
    'DELETE FROM item_tags WHERE item_type = ?1 AND item_id = ?2 AND tag = ?3',
  )
    .bind(type, itemId, tag)
    .run();
  return json({ ok: true, itemType: type, itemId, tags: await readItemTags(env, type, itemId) });
}

/**
 * Router fragment for the tag plane. Returns null when the path is not a tag
 * path, so `index.ts` can keep falling through.
 */
export async function handleTagApi(
  request: Request,
  env: ControlEnv,
  url: URL,
): Promise<Response | null> {
  const path = url.pathname;

  const spaceTags = /^\/api\/my\/spaces\/([^/]+)\/tags$/.exec(path);
  if (spaceTags !== null) {
    return spaceTagsRoute(request, env, decodeURIComponent(spaceTags[1] as string));
  }

  const itemTag = /^\/api\/my\/items\/([^/]+)\/([^/]+)\/tags\/([^/]+)$/.exec(path);
  if (itemTag !== null) {
    return deleteItemTagRoute(
      request,
      env,
      decodeURIComponent(itemTag[1] as string),
      decodeURIComponent(itemTag[2] as string),
      decodeURIComponent(itemTag[3] as string),
    );
  }

  const itemTags = /^\/api\/my\/items\/([^/]+)\/([^/]+)\/tags$/.exec(path);
  if (itemTags !== null) {
    return itemTagsRoute(
      request,
      env,
      decodeURIComponent(itemTags[1] as string),
      decodeURIComponent(itemTags[2] as string),
    );
  }

  return null;
}
