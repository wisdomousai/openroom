/**
 * Workspace hierarchy: spaces, folders, deck and session placement.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import { signCookieValue } from '../src/cookies.js';
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

describe('workspace hierarchy', () => {
  it('bootstraps the Personal space, owned and not shared, on first list', async () => {
    const { cookie } = await seedSession();
    const res = await asUser(cookie, '/api/my/spaces', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      spaces: { id: string; name: string; role: string; shared: boolean; updatedAt: number }[];
    };
    expect(body.spaces.length).toBeGreaterThanOrEqual(1);
    expect(body.spaces[0]).toMatchObject({ name: 'Personal', role: 'owner', shared: false });
    expect(body.spaces[0]!.updatedAt).toBeGreaterThan(0);
  });

  it('creates and patches experiences through cookie and personal-token clients', async () => {
    const { cookie } = await seedSession();
    const created = await asUser(cookie, '/api/my/spaces', {
      method: 'POST', body: JSON.stringify({ name: 'French lessons', experience: 'tutoring', languages: { taught: 'fr', native: 'en' } }),
    });
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    const minted = await asUser(cookie, '/api/my/tokens', { method: 'POST', body: JSON.stringify({ name: 'Preparation' }) });
    const { token } = await minted.json() as { token: string };
    const tokenCall = (path: string, method = 'GET', body?: object) => worker.fetch(new Request(`${BASE}${path}`, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env as never);
    expect((await tokenCall(`/api/my/spaces/${id}`, 'PATCH', { experience: 'training' })).status).toBe(200);
    const detail = await (await tokenCall(`/api/my/spaces/${id}`)).json() as { space: { settings: unknown } };
    expect(detail.space.settings).toEqual({ experience: 'training', languages: { taught: 'fr', native: 'en' } });
    const cleared = await asUser(cookie, `/api/my/spaces/${id}`, { method: 'PATCH', body: JSON.stringify({ languages: null }) });
    expect(await cleared.json()).toMatchObject({ settings: { experience: 'training' } });
    const listed = await (await tokenCall('/api/my/spaces')).json() as { spaces: { id: string; settings: unknown }[] };
    expect(listed.spaces.find((space) => space.id === id)?.settings).toEqual({ experience: 'training' });
    expect((await tokenCall('/api/my/spaces', 'POST', { name: 'School', experience: 'classroom' })).status).toBe(201);
  });

  it('restricts experience changes to the owner and rejects invalid settings without changing stored values', async () => {
    const owner = await seedSession();
    const editor = await seedSession();
    const presenter = await seedSession();
    const created = await asUser(owner.cookie, '/api/my/spaces', { method: 'POST', body: JSON.stringify({ name: 'School', experience: 'classroom' }) });
    const { id } = await created.json() as { id: string };
    for (const [userId, role] of [[editor.userId, 'editor'], [presenter.userId, 'presenter']]) {
      await env.DB.prepare('INSERT INTO space_members (space_id, user_id, role, created_at) VALUES (?1, ?2, ?3, ?4)')
        .bind(id, userId, role, Date.now()).run();
    }
    const patch = (cookie: string, body: object) => asUser(cookie, `/api/my/spaces/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    expect((await patch(editor.cookie, { experience: 'training' })).status).toBe(403);
    expect((await patch(presenter.cookie, { languages: { taught: 'fr', native: 'en' } })).status).toBe(403);
    expect((await patch(editor.cookie, { languages: { taught: 'de', native: 'en' } })).status).toBe(200);
    expect((await patch(owner.cookie, { experience: 'invalid', languages: null })).status).toBe(422);
    expect((await patch(owner.cookie, { experience: 'training', languages: { taught: 'invalid', native: 'en' } })).status).toBe(422);
    const detail = await (await asUser(owner.cookie, `/api/my/spaces/${id}`)).json() as { space: { settings: unknown } };
    expect(detail.space.settings).toEqual({ experience: 'classroom', languages: { taught: 'de', native: 'en' } });
    const stranger = await seedSession();
    expect((await patch(stranger.cookie, { experience: 'tutoring' })).status).toBe(404);
  });

  it('gives a new context its own space and refuses a second in that space', async () => {
    const { cookie } = await seedSession();
    const homeSpaces = (await (await asUser(cookie, '/api/my/spaces')).json()) as {
      spaces: { id: string }[];
    };
    const homeSpaceId = homeSpaces.spaces[0]!.id;
    const { contextId, spaceId } = await createSmokeContext((path, init) =>
      asUser(cookie, path, init ?? {}),
    );
    // Its own space, not the caller's home one.
    expect(spaceId).not.toBe(homeSpaceId);

    const second = await asUser(cookie, '/api/tutoring/contexts', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Someone else', kind: 'person', spaceId }),
    });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toBe('space-has-context');

    // The home space is still free, so it takes one.
    const inHome = await asUser(cookie, '/api/tutoring/contexts', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Housemate', kind: 'person', spaceId: homeSpaceId }),
    });
    expect(inHome.status).toBe(201);
    expect(((await inHome.json()) as { context: { spaceId: string } }).context.spaceId).toBe(
      homeSpaceId,
    );
    expect(contextId).toBeTruthy();
  });

  it('reuses one context in a second space, so each space carries its own pair', async () => {
    const { cookie } = await seedSession();
    const { contextId, spaceId } = await createSmokeContext((path, init) =>
      asUser(cookie, path, init ?? {}),
    );

    const second = await asUser(cookie, '/api/my/spaces', {
      method: 'POST',
      body: JSON.stringify({ name: 'Camille — German', contextId }),
    });
    expect(second.status).toBe(201);
    const secondSpaceId = ((await second.json()) as { id: string }).id;
    expect(secondSpaceId).not.toBe(spaceId);

    // One context, two spaces, each free to carry a different language pair.
    for (const [space, languages] of [
      [spaceId, { taught: 'fr', native: 'en' }],
      [secondSpaceId, { taught: 'de', native: 'en' }],
    ] as const) {
      const saved = await asUser(cookie, `/api/my/spaces/${space}`, {
        method: 'PATCH',
        body: JSON.stringify({ languages }),
      });
      expect(saved.status).toBe(200);
    }
    const reread = (await (await asUser(cookie, `/api/my/spaces/${secondSpaceId}`)).json()) as {
      space: { settings?: { languages?: { taught: string } } };
    };
    expect(reread.space.settings?.languages?.taught).toBe('de');

    // A context nobody can reach is not reusable.
    const stranger = await seedSession();
    const stolen = await asUser(stranger.cookie, '/api/my/spaces', {
      method: 'POST',
      body: JSON.stringify({ name: 'Not mine', contextId }),
    });
    expect(stolen.status).toBe(404);
  });

  it('restores trashed folders', async () => {
    const { cookie } = await seedSession();
    /*
     * A context brings its own space, so everything filed beside it goes
     * there. The home space is a different space now.
     */
    const { contextId, spaceId } = await createSmokeContext((path, init) =>
      asUser(cookie, path, init ?? {}),
    );
    const folder = (await (await asUser(cookie, `/api/my/spaces/${spaceId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Recoverable' }),
    })).json()) as { id: string };
    const deck = (await (await asUser(cookie, '/api/decks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Filed template', spaceId, folderId: folder.id, contextId }),
    })).json()) as { deck: { id: string } };

    const trashFolder = await asUser(cookie, `/api/my/folders/${folder.id}/trash`, { method: 'POST' });
    expect(trashFolder.status).toBe(200);
    const hiddenTree = (await (await asUser(cookie, `/api/my/spaces/${spaceId}`)).json()) as { folders: { id: string }[] };
    expect(hiddenTree.folders.map((row) => row.id)).not.toContain(folder.id);
    const filed = await env.DB.prepare('SELECT folder_id FROM decks WHERE id = ?1').bind(deck.deck.id).first<{ folder_id: string | null }>();
    expect(filed?.folder_id).toBe(folder.id);
    const trashedFolders = (await (await asUser(cookie, '/api/my/folders/trash')).json()) as { folders: { id: string }[] };
    expect(trashedFolders.folders.map((row) => row.id)).toContain(folder.id);
    expect((await asUser(cookie, `/api/my/folders/${folder.id}/restore`, { method: 'POST' })).status).toBe(200);
    const shownTree = (await (await asUser(cookie, `/api/my/spaces/${spaceId}`)).json()) as { folders: { id: string }[] };
    expect(shownTree.folders.map((row) => row.id)).toContain(folder.id);
  });

  it('lists decks and sessions in a folder tree', async () => {
    const { cookie } = await seedSession();
    /*
     * A context brings its own space, so everything filed beside it goes
     * there. The home space is a different space now.
     */
    const { contextId, spaceId } = await createSmokeContext((path, init) =>
      asUser(cookie, path, init ?? {}),
    );

    const folder = (await (
      await asUser(cookie, `/api/my/spaces/${spaceId}/folders`, {
        method: 'POST',
        body: JSON.stringify({ name: 'Bio unit' }),
      })
    ).json()) as { id: string };

    const created = (await (
      await asUser(cookie, '/api/decks', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Cell division',
          spaceId,
          folderId: folder.id,
          contextId,
          createSession: true,
        }),
      })
    ).json()) as { deck: { id: string }; session: { id: string } | null };

    expect(created.deck.id).toBeTruthy();
    expect(created.session?.id).toBeTruthy();

    const tree = await asUser(
      cookie,
      `/api/my/spaces/${spaceId}?folderId=${encodeURIComponent(folder.id)}`,
    );
    expect(tree.status).toBe(200);
    const body = (await tree.json()) as {
      decks: { id: string; title: string; contents?: { slides: number; askTheClass: number; homework: boolean } }[];
      sessions: { id: string; deckId: string }[];
    };
    const listed = body.decks.find((d) => d.id === created.deck.id);
    expect(listed).toBeTruthy();
    expect(listed?.contents).toEqual({
      slides: 0,
      askTheClass: 0,
      homework: false,
      recap: false,
      minutes: null,
    });
    expect(body.sessions.some((r) => r.id === created.session!.id)).toBe(true);
  });

  it('deletes a folder subtree and unfiles what was in it', async () => {
    const { cookie } = await seedSession();
    /*
     * A context brings its own space, so everything filed beside it goes
     * there. The home space is a different space now.
     */
    const { contextId, spaceId } = await createSmokeContext((path, init) =>
      asUser(cookie, path, init ?? {}),
    );

    const parentRes = await asUser(cookie, `/api/my/spaces/${spaceId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Course' }),
    });
    const parent = (await parentRes.json()) as { id: string };

    const childRes = await asUser(cookie, `/api/my/spaces/${spaceId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Week 1', parentId: parent.id }),
    });
    const child = (await childRes.json()) as { id: string };

    const deckRes = await asUser(cookie, '/api/decks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Filed template',
        spaceId,
        folderId: child.id,
        contextId,
      }),
    });
    const deck = (await deckRes.json()) as { deck: { id: string } };

    const del = await asUser(cookie, `/api/my/folders/${parent.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);

    const tree = (await (
      await asUser(cookie, `/api/my/spaces/${spaceId}?folderId=root`)
    ).json()) as {
      folders: { id: string }[];
      decks: { id: string; folderId: string | null }[];
    };
    expect(tree.folders.some((f) => f.id === parent.id || f.id === child.id)).toBe(false);
    const moved = tree.decks.find((d) => d.id === deck.deck.id);
    expect(moved?.folderId).toBeNull();
  });

  it('renames and moves a folder with cycle rejection', async () => {
    const { cookie } = await seedSession();
    const spaces = (await (await asUser(cookie, '/api/my/spaces')).json()) as {
      spaces: { id: string }[];
    };
    const spaceId = spaces.spaces[0]!.id;

    const parentRes = await asUser(cookie, `/api/my/spaces/${spaceId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Course' }),
    });
    const parent = (await parentRes.json()) as { id: string };

    const childRes = await asUser(cookie, `/api/my/spaces/${spaceId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Week 1', parentId: parent.id }),
    });
    const child = (await childRes.json()) as { id: string };

    const siblingRes = await asUser(cookie, `/api/my/spaces/${spaceId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Labs' }),
    });
    const sibling = (await siblingRes.json()) as { id: string };

    const rename = await asUser(cookie, `/api/my/folders/${child.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Week One' }),
    });
    expect(rename.status).toBe(200);
    const renamed = (await rename.json()) as { name: string };
    expect(renamed.name).toBe('Week One');

    const move = await asUser(cookie, `/api/my/folders/${child.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ parentId: sibling.id }),
    });
    expect(move.status).toBe(200);
    const moved = (await move.json()) as { parentId: string };
    expect(moved.parentId).toBe(sibling.id);

    const cycle = await asUser(cookie, `/api/my/folders/${sibling.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ parentId: child.id }),
    });
    expect(cycle.status).toBe(400);

    const toRoot = await asUser(cookie, `/api/my/folders/${child.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ parentId: null, sortOrder: 3 }),
    });
    expect(toRoot.status).toBe(200);
    const rooted = (await toRoot.json()) as { parentId: string | null; sortOrder: number };
    expect(rooted.parentId).toBeNull();
    expect(rooted.sortOrder).toBe(3);
  });

  it('copies a folder subtree', async () => {
    const { cookie } = await seedSession();
    /*
     * A context brings its own space, so everything filed beside it goes
     * there. The home space is a different space now.
     */
    const { spaceId } = await createSmokeContext((path, init) =>
      asUser(cookie, path, init ?? {}),
    );

    const courseRes = await asUser(cookie, `/api/my/spaces/${spaceId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Biology' }),
    });
    const course = (await courseRes.json()) as { id: string };

    const weekRes = await asUser(cookie, `/api/my/spaces/${spaceId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Week 1', parentId: course.id }),
    });
    expect(weekRes.status).toBe(201);

    const copyRes = await asUser(cookie, `/api/my/folders/${course.id}/copy`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(copyRes.status).toBe(201);
    const copy = (await copyRes.json()) as { id: string; name: string };
    expect(copy.name).toBe('Biology (copy)');

    const tree = (await (await asUser(cookie, `/api/my/spaces/${spaceId}`)).json()) as {
      folders: { id: string; name: string; parentId: string | null }[];
    };

    const copyWeek = tree.folders.find(
      (f) => f.parentId === copy.id && f.name === 'Week 1',
    );
    expect(copyWeek).toBeDefined();
  });
});
