import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import worker from '../src/index.js';
import { signCookieValue } from '../src/cookies.js';
import { BASE } from './helpers.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

const SAMPLE_CONTENT = {
  version: 1,
  meta: {
    title: 'French B1: travel problems',
    subject: 'French',
    language: 'French',
    level: 'B1',
    objectives: ['Explain a travel problem in the past tense'],
  },
  steps: [
    { id: 'welcome', kind: 'title', title: 'Les voyages', tutorNotes: 'Ask about last weekend.' },
    { id: 'phrase', kind: 'term', term: 'rater le train', meaning: 'to miss the train' },
    { id: 'check', kind: 'interaction', interactionId: 'past-tense' },
  ],
  interactions: [
    {
      id: 'past-tense',
      type: 'choice',
      prompt: 'Choose the correct sentence.',
      options: [
        { id: 'a', label: "J'ai raté le train.", correct: true },
        { id: 'b', label: 'Je rate le train hier.' },
      ],
    },
  ],
} as const;

async function seedSession(): Promise<{ userId: string; cookie: string }> {
  const userId = `tutor-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, created_at, entitlements)
     VALUES (?1, ?2, ?3, ?4, ?5, '{"continuity":true}')`,
  ).bind(userId, `sub-${userId}`, `${userId}@example.com`, 'Tutor', now).run();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
  ).bind(sessionId, userId, now, now + 86_400_000).run();
  const signed = await signCookieValue(TOKEN_SECRET, sessionId);
  return { userId, cookie: `${SESSION_COOKIE}=${encodeURIComponent(signed)}` };
}

function asBrowser(cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('content-type', 'application/json');
  headers.set(CSRF_HEADER, '1');
  return worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env as never);
}

async function mcpTool(
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; value: any }> {
  const response = await worker.fetch(new Request(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  }), env as never);
  expect(response.status).toBe(200);
  const body = await response.json() as any;
  return {
    isError: body.result.isError,
    value: JSON.parse(body.result.content[0].text),
  };
}

/**
 * `spaceId` names the space to put the context in; omit it and the context
 * brings a new space of its own, since a space holds one context.
 *
 * A test that shares work with a second member must pass the space it granted
 * membership on — otherwise the context lands somewhere that member cannot see.
 */
async function createContext(cookie: string, spaceId?: string): Promise<string> {
  const response = await asBrowser(cookie, '/api/tutoring/contexts', {
    method: 'POST',
    body: JSON.stringify({
      displayName: 'Camille',
      kind: 'person',
      context: { language: 'French', level: 'B1', goals: ['Friday test'] },
      ...(spaceId === undefined ? {} : { spaceId }),
    }),
  });
  expect(response.status).toBe(201);
  const body = await response.json() as { context: { id: string } };
  return body.context.id;
}

async function createDeckWithSession(
  cookie: string,
  contextId: string,
): Promise<{ deckId: string; sessionId: string }> {
  const response = await asBrowser(cookie, '/api/decks', {
    method: 'POST',
    body: JSON.stringify({ contextId, outline: SAMPLE_CONTENT, shape: 'tutoring', createSession: true }),
  });
  expect(response.status).toBe(201);
  const body = await response.json() as {
    deck: { id: string; currentVersion: number };
    session: { id: string } | null;
  };
  expect(body.deck.currentVersion).toBe(1);
  expect(body.session?.id).toBeTruthy();
  return { deckId: body.deck.id, sessionId: body.session!.id };
}

describe('folder-scoped decks and sessions', () => {
  it('links one file identity and keeps full local paths private to the reporting user', async () => {
    const owner = await seedSession();
    const editor = await seedSession();
    const spaces = (await (await asBrowser(owner.cookie, '/api/my/spaces')).json()) as { spaces: { id: string }[] };
    const spaceId = spaces.spaces[0]!.id;
    await env.DB.prepare(
      'INSERT INTO space_members (space_id, user_id, role, created_at) VALUES (?1, ?2, ?3, ?4)',
    ).bind(spaceId, editor.userId, 'editor', Date.now()).run();
    const { deckId } = await createDeckWithSession(owner.cookie, await createContext(owner.cookie, spaceId));
    const fileId = crypto.randomUUID();

    const linked = await asBrowser(owner.cookie, `/api/decks/${deckId}/file-link`, {
      method: 'POST',
      body: JSON.stringify({ fileId }),
    });
    expect(linked.status).toBe(201);

    const detail = await asBrowser(owner.cookie, `/api/decks/${deckId}`);
    const detailBody = await detail.json() as { contentHash: string; contentVersion: number };
    expect(detailBody.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const etag = detail.headers.get('etag');
    expect(etag).toBeTruthy();
    expect((await asBrowser(owner.cookie, `/api/decks/${deckId}`, {
      headers: { 'if-none-match': etag! },
    })).status).toBe(304);

    const location = await asBrowser(owner.cookie, `/api/decks/${deckId}/file-locations/macbook`, {
      method: 'PUT',
      body: JSON.stringify({
        fileId,
        deviceName: 'Classroom MacBook',
        path: '/Users/teacher/Class prep/French.openroom',
        localRevision: 4,
        contentHash: detailBody.contentHash,
        syncedVersion: detailBody.contentVersion,
        syncedHash: detailBody.contentHash,
      }),
    });
    expect(location.status).toBe(200);

    const ownerLink = await asBrowser(owner.cookie, `/api/decks/${deckId}/file-link`);
    const ownerBody = await ownerLink.json() as { locations: { path: string }[] };
    expect(ownerBody.locations[0]!.path).toContain('/Users/teacher/');

    const editorLink = await asBrowser(editor.cookie, `/api/decks/${deckId}/file-link`);
    const editorBody = await editorLink.json() as { linked: boolean; fileId: string; locations: unknown[] };
    expect(editorBody).toEqual(expect.objectContaining({ linked: true, fileId, locations: [] }));
  });

  it('records desktop version provenance only for the linked file', async () => {
    const owner = await seedSession();
    const { deckId } = await createDeckWithSession(owner.cookie, await createContext(owner.cookie));
    const fileId = crypto.randomUUID();
    expect((await asBrowser(owner.cookie, `/api/decks/${deckId}/file-link`, {
      method: 'POST', body: JSON.stringify({ fileId }),
    })).status).toBe(201);
    const detail = await (await asBrowser(owner.cookie, `/api/decks/${deckId}`)).json() as { contentHash: string };
    const revised = structuredClone(SAMPLE_CONTENT) as any;
    revised.meta.title = 'Saved from the desktop file';
    const saved = await asBrowser(owner.cookie, `/api/decks/${deckId}/versions`, {
      method: 'POST',
      body: JSON.stringify({
        baseVersion: 1,
        outline: revised,
        fileSync: { fileId, localRevision: 7, baseContentHash: detail.contentHash },
      }),
    });
    expect(saved.status).toBe(201);
    const versions = await (await asBrowser(owner.cookie, `/api/decks/${deckId}/versions`)).json() as {
      versions: { version: number; sourceKind: string; sourceFileId: string; sourceLocalRevision: number }[];
    };
    expect(versions.versions[0]).toEqual(expect.objectContaining({
      version: 2,
      sourceKind: 'desktop',
      sourceFileId: fileId,
      sourceLocalRevision: 7,
    }));

    const wrongFile = await asBrowser(owner.cookie, `/api/decks/${deckId}/versions`, {
      method: 'POST',
      body: JSON.stringify({
        baseVersion: 2,
        outline: { ...revised, meta: { title: 'Wrong file' } },
        fileSync: { fileId: crypto.randomUUID(), localRevision: 8, baseContentHash: detail.contentHash },
      }),
    });
    expect(wrongFile.status).toBe(409);
  });

  it('scopes unfiled decks and sessions to the whole space, by role', async () => {
    const owner = await seedSession();
    const editor = await seedSession();
    const presenter = await seedSession();
    const spaces = (await (await asBrowser(owner.cookie, '/api/my/spaces')).json()) as { spaces: { id: string }[] };
    const spaceId = spaces.spaces[0]!.id;
    for (const [member, role] of [[editor, 'editor'], [presenter, 'presenter']] as const) {
      await env.DB.prepare(
        'INSERT INTO space_members (space_id, user_id, role, created_at) VALUES (?1, ?2, ?3, ?4)',
      )
        .bind(spaceId, member.userId, role, Date.now())
        .run();
    }
    const { deckId, sessionId } = await createDeckWithSession(owner.cookie, await createContext(owner.cookie, spaceId));

    // Both roles read; only the editor writes, even though neither created it.
    for (const member of [editor, presenter]) {
      expect((await asBrowser(member.cookie, `/api/decks/${deckId}`)).status).toBe(200);
      expect((await asBrowser(member.cookie, `/api/sessions/${sessionId}`)).status).toBe(200);
    }
    expect((await asBrowser(presenter.cookie, `/api/decks/${deckId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Nope' }),
    })).status).toBe(403);
    expect((await asBrowser(presenter.cookie, `/api/sessions/${sessionId}`, { method: 'DELETE' })).status).toBe(403);
    expect((await asBrowser(editor.cookie, `/api/decks/${deckId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Renamed by a space editor' }),
    })).status).toBe(200);
    expect((await asBrowser(editor.cookie, `/api/sessions/${sessionId}`, { method: 'DELETE' })).status).toBe(200);
  });

  it('stores contexts, deck content versions, and a draft session', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie);
    const { deckId } = await createDeckWithSession(cookie, contextId);

    const ctxRes = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}`);
    const ctxBody = await ctxRes.json() as { context: { context: { level: string } } };
    expect(ctxBody.context.context.level).toBe('B1');

    const deck = await asBrowser(cookie, `/api/decks/${deckId}`);
    const deckBody = await deck.json() as {
      contentVersion: number;
      content: { steps: { tutorNotes?: string }[] };
    };
    expect(deckBody.contentVersion).toBe(1);
    expect(deckBody.content.steps[0]!.tutorNotes).toContain('last weekend');

    const nextOutline = structuredClone(SAMPLE_CONTENT) as unknown as Record<string, unknown>;
    const meta = nextOutline['meta'] as Record<string, unknown>;
    meta['title'] = 'French B1: travel problems, revised';
    const save = await asBrowser(cookie, `/api/decks/${deckId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ baseVersion: 1, outline: nextOutline }),
    });
    expect(save.status).toBe(201);
    expect((await save.json() as { version: number }).version).toBe(2);

    const stale = await asBrowser(cookie, `/api/decks/${deckId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ baseVersion: 1, outline: nextOutline }),
    });
    expect(stale.status).toBe(409);
  });

  it('launches a session through the live session runtime', async () => {
    const { cookie } = await seedSession();
    const { sessionId, deckId } = await createDeckWithSession(cookie, await createContext(cookie));
    const launch = await asBrowser(cookie, `/api/sessions/${sessionId}/launch`, {
      method: 'POST',
      body: JSON.stringify({ start: true }),
    });
    expect(launch.status).toBe(201);
    const launched = await launch.json() as {
      sessionCode: string;
      hostToken: string;
      stageToken: string;
      sessionId: string;
      deckId: string;
      deckVersion: number;
    };
    expect(launched.sessionId).toBe(sessionId);
    expect(launched.deckId).toBe(deckId);
    expect(launched.deckVersion).toBe(1);

    const state = await worker.fetch(new Request(
      `${BASE}/api/sessions/${launched.sessionCode}/state?role=host`,
      { headers: { authorization: `Bearer ${launched.hostToken}` } },
    ), env as never);
    expect(state.status).toBe(200);
    expect((await state.json() as { status: string }).status).toBe('live');

    const stage = await worker.fetch(new Request(
      `${BASE}/api/sessions/${launched.sessionCode}/state?role=stage`,
      { headers: { authorization: `Bearer ${launched.stageToken}` } },
    ), env as never);
    const stageBody = await stage.json() as {
      outline: { currentStep: { kind: string; tutorNotes?: string } };
    };
    expect(stageBody.outline.currentStep.kind).toBe('title');
    expect(stageBody.outline.currentStep).not.toHaveProperty('tutorNotes');
  });

  it('stores a compact session record and rejects writes on trashed sessions', async () => {
    const { cookie } = await seedSession();
    const { sessionId } = await createDeckWithSession(cookie, await createContext(cookie));
    const put = await asBrowser(cookie, `/api/sessions/${sessionId}/record`, {
      method: 'PUT',
      body: JSON.stringify({
        outcomes: ['Used passé composé independently'],
        notes: 'Review agreement next time.',
        homework: ['Write three travel sentences'],
        artifacts: [{ interactionId: 'past-tense', result: 'correct' }],
      }),
    });
    expect(put.status).toBe(200);

    const trash = await asBrowser(cookie, `/api/sessions/${sessionId}`, { method: 'DELETE' });
    expect(trash.status).toBe(200);
    const putTrash = await asBrowser(cookie, `/api/sessions/${sessionId}/record`, {
      method: 'PUT',
      body: JSON.stringify({ outcomes: ['should fail'], notes: '', homework: [] }),
    });
    expect(putTrash.status).toBe(409);
  });

  it('allows a session record when deck has no content version yet', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie);
    const created = await asBrowser(cookie, '/api/decks', {
      method: 'POST',
      body: JSON.stringify({ contextId, title: 'Empty deck', createSession: true }),
    });
    expect(created.status).toBe(201);
    const body = await created.json() as { deck: { id: string }; session: { id: string } };
    const put = await asBrowser(cookie, `/api/sessions/${body.session.id}/record`, {
      method: 'PUT',
      body: JSON.stringify({ outcomes: ['Showed up'], notes: 'Still drafting content', homework: [] }),
    });
    expect(put.status).toBe(200);
  });

  it('uses recoverable trash and browser permanent purge for contexts', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie);

    const trash = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}`, { method: 'DELETE' });
    expect(trash.status).toBe(200);

    const restore = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/restore`, { method: 'POST' });
    expect(restore.status).toBe(200);
    await asBrowser(cookie, `/api/tutoring/contexts/${contextId}`, { method: 'DELETE' });

    const intent = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/permanent-deletion`, { method: 'POST' });
    expect(intent.status).toBe(202);
    const intentBody = await intent.json() as { confirmationUrl: string };

    const anonymousConfirm = await worker.fetch(new Request(intentBody.confirmationUrl, { method: 'POST' }), env as never);
    expect(anonymousConfirm.status).toBe(401);

    const confirmed = await asBrowser(cookie, new URL(intentBody.confirmationUrl).pathname, { method: 'POST' });
    expect(confirmed.status).toBe(200);

    const missing = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}`);
    expect(missing.status).toBe(404);
  });

  it('accepts decks and sessions through PAT and MCP openroom_api', async () => {
    const { cookie } = await seedSession();
    const minted = await asBrowser(cookie, '/api/my/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'Claude Desktop' }),
    });
    const token = (await minted.json() as { token: string }).token;

    const contextResult = await mcpTool(token, 'openroom_api', {
      method: 'POST',
      path: '/api/tutoring/contexts',
      body: { displayName: 'MCP person', kind: 'person', context: { language: 'French', level: 'B1' } },
    });
    expect(contextResult.value.status).toBe(201);
    const contextId = contextResult.value.body.context.id as string;

    const deckResult = await mcpTool(token, 'openroom_api', {
      method: 'POST',
      path: '/api/decks',
      body: { contextId, outline: SAMPLE_CONTENT, createSession: true },
    });
    expect(deckResult.value.status).toBe(201);
    const sessionId = deckResult.value.body.session.id as string;

    const launchResult = await mcpTool(token, 'openroom_api', {
      method: 'POST',
      path: `/api/sessions/${sessionId}/launch`,
      body: { start: false },
    });
    expect(launchResult.value.status).toBe(201);
    expect(launchResult.value.body.sessionId).toBe(sessionId);
  });
});

describe('control plane hardening', () => {
  it('creates no session by default; sessions are created explicitly', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie);
    const created = await asBrowser(cookie, '/api/decks', {
      method: 'POST',
      body: JSON.stringify({ contextId, outline: SAMPLE_CONTENT }),
    });
    expect(created.status).toBe(201);
    const body = await created.json() as { deck: { id: string }; session: unknown };
    expect(body.session).toBeNull();

    const session = await asBrowser(cookie, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ deckId: body.deck.id }),
    });
    expect(session.status).toBe(201);
    const sessionBody = await session.json() as { session: { id: string; deckId: string; status: string } };
    expect(sessionBody.session.deckId).toBe(body.deck.id);
    expect(sessionBody.session.status).toBe('draft');
  });

  it('rejects folder links from another space', async () => {
    const { cookie: cookieA } = await seedSession();
    const { cookie: cookieB } = await seedSession();

    const spacesB = (await (await asBrowser(cookieB, '/api/my/spaces')).json()) as {
      spaces: { id: string }[];
    };
    const spaceB = spacesB.spaces[0]!.id;
    const folderB = (await (
      await asBrowser(cookieB, `/api/my/spaces/${spaceB}/folders`, {
        method: 'POST',
        body: JSON.stringify({ name: 'B unit' }),
      })
    ).json()) as { id: string };

    const ctxA = await createContext(cookieA);
    // Legacy context omission is accepted, but an inaccessible folder is still hidden.
    const missingCtx = await asBrowser(cookieA, '/api/decks', {
      method: 'POST',
      body: JSON.stringify({ title: 'A deck', folderId: folderB.id }),
    });
    expect(missingCtx.status).toBe(404);
    const postDeck = await asBrowser(cookieA, '/api/decks', {
      method: 'POST',
      body: JSON.stringify({ title: 'A deck', contextId: ctxA, folderId: folderB.id }),
    });
    expect(postDeck.status).toBe(404);

    const { deckId, sessionId } = await createDeckWithSession(cookieA, await createContext(cookieA));
    const patchDeck = await asBrowser(cookieA, `/api/decks/${deckId}`, {
      method: 'PATCH',
      body: JSON.stringify({ folderId: folderB.id }),
    });
    expect(patchDeck.status).toBe(404);
    const patchSession = await asBrowser(cookieA, `/api/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ folderId: folderB.id }),
    });
    expect(patchSession.status).toBe(404);

    // Same-space links still work: file the deck under A's own folder.
    const spacesA = (await (await asBrowser(cookieA, '/api/my/spaces')).json()) as {
      spaces: { id: string }[];
    };
    const folderA = (await (
      await asBrowser(cookieA, `/api/my/spaces/${spacesA.spaces[0]!.id}/folders`, {
        method: 'POST',
        body: JSON.stringify({ name: 'A unit' }),
      })
    ).json()) as { id: string };
    const patchOk = await asBrowser(cookieA, `/api/decks/${deckId}`, {
      method: 'PATCH',
      body: JSON.stringify({ folderId: folderA.id }),
    });
    expect(patchOk.status).toBe(200);
    const patched = await patchOk.json() as { deck: { folderId: string; spaceId: string } };
    expect(patched.deck.folderId).toBe(folderA.id);
    expect(patched.deck.spaceId).toBe(spacesA.spaces[0]!.id);
  });

  it('keeps live/completed statuses server-owned and rejects double launch', async () => {
    const { cookie } = await seedSession();
    const { deckId, sessionId } = await createDeckWithSession(cookie, await createContext(cookie));

    const liveCreate = await asBrowser(cookie, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ deckId, status: 'live' }),
    });
    expect(liveCreate.status).toBe(422);
    const livePatch = await asBrowser(cookie, `/api/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'ended' }),
    });
    expect(livePatch.status).toBe(422);

    const launch = await asBrowser(cookie, `/api/sessions/${sessionId}/launch`, {
      method: 'POST',
      body: JSON.stringify({ start: true }),
    });
    expect(launch.status).toBe(201);
    const relaunch = await asBrowser(cookie, `/api/sessions/${sessionId}/launch`, {
      method: 'POST',
      body: JSON.stringify({ start: true }),
    });
    expect(relaunch.status).toBe(409);
  });

  it('permanent purge of a deck detaches sessions that recorded it', async () => {
    const { cookie } = await seedSession();
    const { deckId, sessionId } = await createDeckWithSession(cookie, await createContext(cookie));
    const launch = await asBrowser(cookie, `/api/sessions/${sessionId}/launch`, {
      method: 'POST',
      body: JSON.stringify({ start: true }),
    });
    expect(launch.status).toBe(201);
    const { sessionCode } = await launch.json() as { sessionCode: string };
    const before = await env.DB.prepare('SELECT deck_id, session_id FROM live_sessions WHERE code = ?1')
      .bind(sessionCode)
      .first<{ deck_id: string | null; session_id: string | null }>();
    expect(before?.deck_id).toBe(deckId);
    expect(before?.session_id).toBe(sessionId);

    await asBrowser(cookie, `/api/decks/${deckId}`, { method: 'DELETE' });
    const intent = await asBrowser(cookie, `/api/decks/${deckId}/permanent-deletion`, { method: 'POST' });
    expect(intent.status).toBe(202);
    const { confirmationUrl } = await intent.json() as { confirmationUrl: string };
    const confirmed = await asBrowser(cookie, new URL(confirmationUrl).pathname, { method: 'POST' });
    expect(confirmed.status).toBe(200);

    const after = await env.DB.prepare('SELECT deck_id, session_id, deck_version FROM live_sessions WHERE code = ?1')
      .bind(sessionCode)
      .first<{ deck_id: string | null; session_id: string | null; deck_version: number | null }>();
    expect(after?.deck_id).toBeNull();
    expect(after?.session_id).toBeNull();
    expect(after?.deck_version).toBeNull();
  });

  it('context purge detaches sessions that re-linked the context from other decks', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie);
    // Deck B belongs to a different context, in its own space.
    const otherCtx = await createContext(cookie);
    const created = await asBrowser(cookie, '/api/decks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Standalone', outline: SAMPLE_CONTENT, contextId: otherCtx }),
    });
    expect(created.status).toBe(201);
    const deckB = (await created.json() as { deck: { id: string } }).deck.id;
    const sessionRes = await asBrowser(cookie, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ deckId: deckB, contextId: otherCtx }),
    });
    expect(sessionRes.status).toBe(201);
    const sessionB = (await sessionRes.json() as { session: { id: string } }).session.id;

    /*
     * Re-linked in the table, not through the API: a session's context must now be
     * the one its deck's space holds, so the route refuses to build this
     * state. Rows that predate that rule still exist, and detaching them is
     * exactly what purge is for — so the fixture writes what the API will not.
     */
    await env.DB.prepare('UPDATE sessions SET context_id = ?1 WHERE id = ?2')
      .bind(contextId, sessionB)
      .run();

    await asBrowser(cookie, `/api/tutoring/contexts/${contextId}`, { method: 'DELETE' });
    const intent = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/permanent-deletion`, { method: 'POST' });
    expect(intent.status).toBe(202);
    const { confirmationUrl } = await intent.json() as { confirmationUrl: string };
    const confirmed = await asBrowser(cookie, new URL(confirmationUrl).pathname, { method: 'POST' });
    expect(confirmed.status).toBe(200);

    const sessionAfter = await asBrowser(cookie, `/api/sessions/${sessionB}`);
    expect(sessionAfter.status).toBe(200);
    expect((await sessionAfter.json() as { session: { contextId: string | null } }).session.contextId).toBeNull();
  });

  it('PAT cannot confirm a permanent purge', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie);
    await asBrowser(cookie, `/api/tutoring/contexts/${contextId}`, { method: 'DELETE' });

    const minted = await asBrowser(cookie, '/api/my/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'agent' }),
    });
    const token = (await minted.json() as { token: string }).token;
    const asPat = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${BASE}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    }), env as never);

    // The agent may request the intent; only a signed-in browser may confirm it.
    const intent = await asPat(`/api/tutoring/contexts/${contextId}/permanent-deletion`, { method: 'POST' });
    expect(intent.status).toBe(202);
    const { confirmationUrl } = await intent.json() as { confirmationUrl: string };

    const patConfirm = await asPat(new URL(confirmationUrl).pathname, { method: 'POST' });
    expect(patConfirm.status).toBe(401);

    const stillThere = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}`);
    expect(stillThere.status).toBe(200);
  });

  it('session record contains no ballot data', async () => {
    const { cookie } = await seedSession();
    const { sessionId } = await createDeckWithSession(cookie, await createContext(cookie));
    const put = await asBrowser(cookie, `/api/sessions/${sessionId}/record`, {
      method: 'PUT',
      body: JSON.stringify({ outcomes: ['Done'], notes: '', homework: [], ballots: [{ secret: 'vote' }] }),
    });
    expect(put.status).toBe(200);
    const record = (await (await asBrowser(cookie, `/api/sessions/${sessionId}/record`)).json()) as {
      record: Record<string, unknown>;
    };
    expect(Object.keys(record.record).sort()).toEqual([
      'artifacts', 'contextId', 'createdAt', 'deckVersion', 'homework', 'homeworkAudience', 'homeworkRevision', 'id',
      'nextNote', 'notes', 'outcomes', 'sessionCode', 'sessionId', 'updatedAt',
    ]);
  });
});

/**
 * Hybrid save: the rolling draft alongside numbered versions.
 *
 * The behaviours worth pinning are the ones that would silently corrupt trust
 * in the indicator or leak working text into delivery — not the CRUD shape.
 */
describe('deck drafts', () => {
  it('upserts one draft per deck, accepts unparseable YAML, and 404s when absent', async () => {
    const { cookie } = await seedSession();
    const { deckId } = await createDeckWithSession(cookie, await createContext(cookie));

    expect((await asBrowser(cookie, `/api/decks/${deckId}/draft`)).status).toBe(404);

    // Mid-keystroke YAML: auto-save exists precisely for this state.
    const broken = 'meta:\n  title: "unclosed';
    const first = await asBrowser(cookie, `/api/decks/${deckId}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ source: broken, baseVersion: 1 }),
    });
    expect(first.status).toBe(200);
    expect((await first.json() as { savedAt: number }).savedAt).toBeGreaterThan(0);

    await asBrowser(cookie, `/api/decks/${deckId}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ source: 'meta:\n  title: later\n', baseVersion: 1 }),
    });
    const read = await asBrowser(cookie, `/api/decks/${deckId}/draft`);
    expect(read.status).toBe(200);
    const draft = await read.json() as { source: string; baseVersion: number; updatedAt: number };
    expect(draft.source).toBe('meta:\n  title: later\n');
    expect(draft.baseVersion).toBe(1);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM deck_drafts WHERE deck_id = ?1')
      .bind(deckId).first<{ n: number }>();
    expect(rows?.n).toBe(1);

    expect((await asBrowser(cookie, `/api/decks/${deckId}/draft`, { method: 'DELETE' })).status)
      .toBe(204);
    expect((await asBrowser(cookie, `/api/decks/${deckId}/draft`)).status).toBe(404);
  });

  it('stamping a version clears the draft and never feeds delivery', async () => {
    const { cookie } = await seedSession();
    const { deckId, sessionId } = await createDeckWithSession(cookie, await createContext(cookie));
    await asBrowser(cookie, `/api/decks/${deckId}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ source: 'not: [an, outline', baseVersion: 1 }),
    });

    // The draft is working text: a launch still delivers the stamped version.
    const launch = await asBrowser(cookie, `/api/sessions/${sessionId}/launch`, {
      method: 'POST',
      body: JSON.stringify({ start: false }),
    });
    expect(launch.status).toBe(201);
    expect((await launch.json() as { deckVersion: number }).deckVersion).toBe(1);
    expect((await asBrowser(cookie, `/api/decks/${deckId}/draft`)).status).toBe(200);

    const nextOutline = structuredClone(SAMPLE_CONTENT) as unknown as Record<string, unknown>;
    (nextOutline['meta'] as Record<string, unknown>)['title'] = 'Saved on purpose';
    const save = await asBrowser(cookie, `/api/decks/${deckId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ baseVersion: 1, outline: nextOutline }),
    });
    expect(save.status).toBe(201);
    expect((await asBrowser(cookie, `/api/decks/${deckId}/draft`)).status).toBe(404);
  });

  it('rejects oversized drafts and enforces the version route’s auth and role', async () => {
    const owner = await seedSession();
    const presenter = await seedSession();
    const stranger = await seedSession();
    const spaces = (await (await asBrowser(owner.cookie, '/api/my/spaces')).json()) as {
      spaces: { id: string }[];
    };
    await env.DB.prepare(
      'INSERT INTO space_members (space_id, user_id, role, created_at) VALUES (?1, ?2, ?3, ?4)',
    ).bind(spaces.spaces[0]!.id, presenter.userId, 'presenter', Date.now()).run();
    const { deckId } = await createDeckWithSession(
      owner.cookie,
      await createContext(owner.cookie, spaces.spaces[0]!.id),
    );
    const path = `/api/decks/${deckId}/draft`;
    const body = JSON.stringify({ source: 'meta:\n', baseVersion: 1 });

    const anonymous = await worker.fetch(
      new Request(`${BASE}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body }),
      env as never,
    );
    expect(anonymous.status).toBe(401);
    expect((await asBrowser(stranger.cookie, path)).status).toBe(404);
    expect((await asBrowser(presenter.cookie, path)).status).toBe(404); // reads, no draft yet
    expect((await asBrowser(presenter.cookie, path, { method: 'PUT', body })).status).toBe(403);

    const huge = JSON.stringify({ source: 'x'.repeat(256 * 1024 + 1), baseVersion: 1 });
    expect((await asBrowser(owner.cookie, path, { method: 'PUT', body: huge })).status).toBe(413);
    expect((await asBrowser(owner.cookie, path, { method: 'PUT', body: JSON.stringify({ source: 'y' }) })).status)
      .toBe(400);
  });
});


describe('standalone decks', () => {
  it('creates and starts a deck without a student, keeping the current slide', async () => {
    const { cookie, userId } = await seedSession();
    const created = await asBrowser(cookie, '/api/decks', { method: 'POST', body: JSON.stringify({ title: 'Standalone', content: SAMPLE_CONTENT }) });
    expect(created.status).toBe(201);
    const { deck } = await created.json() as any;
    expect(deck.contextId).toBeNull();
    const patched = await asBrowser(cookie, `/api/decks/${deck.id}`, { method: 'PATCH', body: JSON.stringify({ contextId: null }) });
    expect(patched.status).toBe(200);
    const sessionResponse = await asBrowser(cookie, '/api/sessions', { method: 'POST', body: JSON.stringify({ deckId: deck.id }) });
    expect(sessionResponse.status).toBe(201);
    const { session } = await sessionResponse.json() as any;
    expect(session.contextId).toBeNull();
    const bad = await asBrowser(cookie, `/api/sessions/${session.id}/launch`, { method: 'POST', body: JSON.stringify({ start: true, cursor: { stepId: 'missing', shown: 1 } }) });
    expect(bad.status).toBe(422);
    const launched = await asBrowser(cookie, `/api/sessions/${session.id}/launch`, { method: 'POST', body: JSON.stringify({ start: true, cursor: { stepId: 'phrase', shown: 1 } }) });
    expect(launched.status).toBe(201);
    const live = await launched.json() as any;
    expect(live.started).toBe(true);
    const state = await worker.fetch(new Request(`${BASE}/api/sessions/${live.sessionCode}/state?role=host`, { headers: { authorization: `Bearer ${live.hostToken}` } }), env as never);
    expect((await state.json() as any).outline).toMatchObject({ currentStepIndex: 1, shownGroups: 1 });
    const contexts = await env.DB.prepare('SELECT COUNT(*) AS n FROM contexts WHERE created_by = ?1').bind(userId).first<{ n: number }>();
    expect(contexts?.n).toBe(0);
  });
  it('rejects a stale draft without overwriting acknowledged content', async () => {
    const { cookie } = await seedSession();
    const { deckId } = await createDeckWithSession(cookie, await createContext(cookie));
    const path = `/api/decks/${deckId}/draft`;
    const first = await asBrowser(cookie, path, { method: 'PUT', body: JSON.stringify({ source: 'work in progress', baseVersion: 1 }) });
    expect(first.status).toBe(200);
    const stale = await asBrowser(cookie, path, { method: 'PUT', body: JSON.stringify({ source: 'stale work', baseVersion: 0 }) });
    expect(stale.status).toBe(409);
    expect(await (await asBrowser(cookie, path)).json()).toMatchObject({ source: 'work in progress', baseVersion: 1 });
  });
});
