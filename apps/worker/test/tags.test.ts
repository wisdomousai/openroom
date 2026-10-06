/**
 * Item tags: normalisation, uniqueness, limits, and who may write them.
 *
 * Normalisation is the contract that matters. It happens at the API so the
 * browser, the CLI and MCP cannot disagree about whether two strings are the
 * same tag — these tests are what makes "the API decides" checkable rather
 * than aspirational.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import { signCookieValue } from '../src/tokens.js';
import worker from '../src/index.js';
import { BASE, createSmokeContext } from './helpers.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

async function seedSession(): Promise<{ userId: string; cookie: string }> {
  const userId = `user-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, created_at, entitlements)
     VALUES (?1, ?2, ?3, ?4, ?5, '{}')`,
  )
    .bind(userId, `sub-${userId}`, `${userId}@example.com`, 'Host', now)
    .run();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(sessionId, userId, now, now + 30 * 24 * 60 * 60 * 1000)
    .run();
  const signed = await signCookieValue(TOKEN_SECRET, sessionId);
  return { userId, cookie: `${SESSION_COOKIE}=${encodeURIComponent(signed)}` };
}

function asUser(cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('content-type', 'application/json');
  headers.set(CSRF_HEADER, '1');
  return worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env as never);
}

/** A space with one deck in it, which is the thing we tag. */
async function seedDeck(): Promise<{ cookie: string; spaceId: string; deckId: string }> {
  const { cookie } = await seedSession();
  const { contextId } = await createSmokeContext((path, init) => asUser(cookie, path, init ?? {}));
  const spaces = (await (await asUser(cookie, '/api/my/spaces')).json()) as {
    spaces: { id: string }[];
  };
  const spaceId = spaces.spaces[0]!.id;
  const res = await asUser(cookie, '/api/decks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Passé composé', contextId, spaceId }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { deck: { id: string } };
  return { cookie, spaceId, deckId: body.deck.id };
}

const tagsPath = (deckId: string) => `/api/my/items/deck/${deckId}/tags`;

describe('item tags', () => {
  it('normalises at the API: trims, lowercases, collapses inner whitespace', async () => {
    const { cookie, deckId } = await seedDeck();
    const res = await asUser(cookie, tagsPath(deckId), {
      method: 'POST',
      body: JSON.stringify({ tag: '  Exam   Prep ' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { tags: string[] }).tags).toEqual(['exam prep']);
  });

  it('treats differently-typed spellings of one tag as one row', async () => {
    const { cookie, deckId } = await seedDeck();
    for (const typed of ['B1', ' b1', 'b1  ']) {
      const res = await asUser(cookie, tagsPath(deckId), {
        method: 'POST',
        body: JSON.stringify({ tag: typed }),
      });
      expect(res.status).toBe(200);
    }
    const tags = ((await (await asUser(cookie, tagsPath(deckId))).json()) as { tags: string[] })
      .tags;
    expect(tags).toEqual(['b1']);

    // And the uniqueness index, not just the read path, holds exactly one row.
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM item_tags WHERE item_type = 'deck' AND item_id = ?1",
    )
      .bind(deckId)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it('rejects a tag that cannot be a label: empty, over-long, or comma-bearing', async () => {
    const { cookie, deckId } = await seedDeck();
    for (const bad of ['   ', 'x'.repeat(33), 'a,b']) {
      const res = await asUser(cookie, tagsPath(deckId), {
        method: 'POST',
        body: JSON.stringify({ tag: bad }),
      });
      expect(res.status).toBe(400);
    }
  });

  it('replaces the whole set on PUT and de-duplicates collapsing spellings', async () => {
    const { cookie, deckId } = await seedDeck();
    await asUser(cookie, tagsPath(deckId), {
      method: 'PUT',
      body: JSON.stringify({ tags: ['B1', 'grammar'] }),
    });
    const res = await asUser(cookie, tagsPath(deckId), {
      method: 'PUT',
      body: JSON.stringify({ tags: ['Speaking', ' speaking '] }),
    });
    expect(((await res.json()) as { tags: string[] }).tags).toEqual(['speaking']);
    const after = ((await (await asUser(cookie, tagsPath(deckId))).json()) as {
      tags: string[];
    }).tags;
    expect(after).toEqual(['speaking']);
  });

  it('caps how many tags one item may carry', async () => {
    const { cookie, deckId } = await seedDeck();
    const res = await asUser(cookie, tagsPath(deckId), {
      method: 'PUT',
      body: JSON.stringify({ tags: Array.from({ length: 25 }, (_, i) => `tag-${i}`) }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('too-many-tags');
  });

  it('removes a tag by its normalised form even when the URL carries the typed one', async () => {
    const { cookie, deckId } = await seedDeck();
    await asUser(cookie, tagsPath(deckId), {
      method: 'POST',
      body: JSON.stringify({ tag: 'b1' }),
    });
    const res = await asUser(cookie, `${tagsPath(deckId)}/${encodeURIComponent(' B1 ')}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { tags: string[] }).tags).toEqual([]);
  });

  it('lists the space facets with counts', async () => {
    const { cookie, spaceId, deckId } = await seedDeck();
    await asUser(cookie, tagsPath(deckId), {
      method: 'PUT',
      body: JSON.stringify({ tags: ['b1', 'grammar'] }),
    });
    const res = await asUser(cookie, `/api/my/spaces/${spaceId}/tags`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tags: { tag: string; count: number }[] };
    expect(body.tags).toEqual([
      { tag: 'b1', count: 1 },
      { tag: 'grammar', count: 1 },
    ]);
  });

  it('hides another user’s item behind 404 rather than 403', async () => {
    // The space is discovered from the item, never named by the caller, so a
    // stranger cannot learn that the id exists.
    const { deckId } = await seedDeck();
    const { cookie: stranger } = await seedSession();
    const res = await asUser(stranger, tagsPath(deckId), {
      method: 'POST',
      body: JSON.stringify({ tag: 'b1' }),
    });
    expect(res.status).toBe(404);
  });

  it('carries tags into the space tree so a row can draw its chips', async () => {
    const { cookie, spaceId, deckId } = await seedDeck();
    await asUser(cookie, tagsPath(deckId), {
      method: 'POST',
      body: JSON.stringify({ tag: 'B1' }),
    });
    const res = await asUser(cookie, `/api/my/spaces/${spaceId}`);
    const body = (await res.json()) as {
      itemTags: { itemType: string; itemId: string; tag: string }[];
    };
    expect(body.itemTags).toContainEqual({ itemType: 'deck', itemId: deckId, tag: 'b1' });
  });
});
