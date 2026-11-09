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
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import { json, type ControlEnv, type SessionUser } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { memberOfSpace, readJson } from './control-utils.js';
import { orm } from './db/client.js';
import { decks, itemTags, sessionRecords, sessions, students } from './db/schema.js';
import { roleAtLeast, spaceRole } from './members.js';

/**
 * The item kinds a tag can hang on, in **API vocabulary**.
 *
 * `deck` is the UI's "Template" and `session` is the UI's "Session"
 * (`docs/TERMINOLOGY.md`). The database and every wire path use the domain
 * word; the browser translates on the way in and out.
 */
export const TAGGABLE_ITEM_TYPES = ['deck', 'session', 'record', 'student'] as const;
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
  const db = orm(env);
  switch (itemType) {
    case 'deck':
      return (
        (await db.select({ spaceId: decks.spaceId }).from(decks).where(and(eq(decks.id, itemId), isNull(decks.deletedAt))).get())
          ?.spaceId ?? null
      );
    case 'session':
      return (
        (
          await db
            .select({ spaceId: sessions.spaceId })
            .from(sessions)
            .where(and(eq(sessions.id, itemId), isNull(sessions.deletedAt)))
            .get()
        )?.spaceId ?? null
      );
    case 'student':
      return (
        (
          await db
            .select({ spaceId: students.spaceId })
            .from(students)
            .where(and(eq(students.id, itemId), isNull(students.deletedAt)))
            .get()
        )?.spaceId ?? null
      );
    case 'record':
      return (
        (
          await db
            .select({ spaceId: sessions.spaceId })
            .from(sessionRecords)
            .innerJoin(sessions, eq(sessions.id, sessionRecords.sessionId))
            .where(and(eq(sessionRecords.id, itemId), isNull(sessions.deletedAt)))
            .get()
        )?.spaceId ?? null
      );
  }
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
  const rows = await orm(env)
    .select({ tag: itemTags.tag })
    .from(itemTags)
    .where(and(eq(itemTags.itemType, itemType), eq(itemTags.itemId, itemId)))
    .orderBy(asc(itemTags.tag));
  return rows.map((row) => row.tag);
}

/** All tag rows in a space — the browser groups them onto its list rows. */
export async function readSpaceItemTags(
  env: ControlEnv,
  spaceId: string,
): Promise<{ itemType: string; itemId: string; tag: string }[]> {
  return await orm(env)
    .select({ itemType: itemTags.itemType, itemId: itemTags.itemId, tag: itemTags.tag })
    .from(itemTags)
    .where(eq(itemTags.spaceId, spaceId))
    .orderBy(asc(itemTags.tag))
    .limit(5000);
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
  const total = count();
  const rows = await orm(env)
    .select({ tag: itemTags.tag, count: total })
    .from(itemTags)
    .where(eq(itemTags.spaceId, spaceId))
    .groupBy(itemTags.tag)
    .orderBy(desc(total), asc(itemTags.tag));
  return json({ tags: rows.map((row) => ({ tag: row.tag, count: row.count })) });
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
    await orm(env)
      .insert(itemTags)
      .values({ spaceId: guard.spaceId, itemType: type, itemId, tag, createdAt: now, createdBy: guard.user.id })
      .onConflictDoNothing()
      .run();
    return json({ ok: true, itemType: type, itemId, tags: await readItemTags(env, type, itemId) });
  }

  const parsed = normalizeTagSet(body.tags);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const db = orm(env);
  const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
    db.delete(itemTags).where(and(eq(itemTags.itemType, type), eq(itemTags.itemId, itemId))),
    ...parsed.tags.map((tag) =>
      db
        .insert(itemTags)
        .values({ spaceId: guard.spaceId, itemType: type, itemId, tag, createdAt: now, createdBy: guard.user.id })
        .onConflictDoNothing(),
    ),
  ];
  await db.batch(statements);
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
  await orm(env)
    .delete(itemTags)
    .where(and(eq(itemTags.itemType, type), eq(itemTags.itemId, itemId), eq(itemTags.tag, tag)))
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
