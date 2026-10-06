/**
 * Space-level collaboration: roles, invites and shared space access.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import { signCookieValue } from '../src/cookies.js';
import worker from '../src/index.js';
import { BASE, SMOKE_OUTLINE } from './helpers.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

interface Seeded {
  userId: string;
  email: string;
  cookie: string;
}

async function seedSession(name = 'Host'): Promise<Seeded> {
  const userId = `user-${crypto.randomUUID()}`;
  const email = `${userId}@example.com`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, created_at, entitlements)
     VALUES (?1, ?2, ?3, ?4, ?5, '{}')`,
  )
    .bind(userId, `sub-${userId}`, email, name, now)
    .run();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(sessionId, userId, now, now + 30 * 24 * 60 * 60 * 1000)
    .run();
  const signed = await signCookieValue(TOKEN_SECRET, sessionId);
  return { userId, email, cookie: `${SESSION_COOKIE}=${encodeURIComponent(signed)}` };
}

function asUser(user: Seeded, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('cookie', user.cookie);
  headers.set('content-type', 'application/json');
  headers.set(CSRF_HEADER, '1');
  return worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env as never);
}

/** Bootstrap the owner's workspace and return their personal space id. */
async function homeSpace(user: Seeded): Promise<string> {
  const res = await asUser(user, '/api/my/spaces', { method: 'GET' });
  expect(res.status).toBe(200);
  const { spaces } = (await res.json()) as { spaces: { id: string; role: string }[] };
  expect(spaces.length).toBeGreaterThan(0);
  return spaces[0]!.id;
}

/**
 * The context a space holds, making it if the space has none.
 *
 * A space holds one context, so a second create in the same space is a 409 and
 * the answer is the context already there — not a new one.
 */
async function contextForSpace(user: Seeded, spaceId: string, displayName: string): Promise<string> {
  const res = await asUser(user, '/api/tutoring/contexts', {
    method: 'POST',
    body: JSON.stringify({ displayName, kind: 'class', context: {}, spaceId }),
  });
  if (res.status === 409) {
    const listed = (await (
      await asUser(user, `/api/tutoring/contexts?spaceId=${encodeURIComponent(spaceId)}`)
    ).json()) as { contexts: { id: string }[] };
    return listed.contexts[0]!.id;
  }
  expect(res.status).toBe(201);
  return ((await res.json()) as { context: { id: string } }).context.id;
}

async function createDelivery(user: Seeded, spaceId: string): Promise<{ deckId: string; sessionId: string }> {
  const contextId = await contextForSpace(user, spaceId, 'Shared class');
  const deckRes = await asUser(user, '/api/decks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Shared template', spaceId, contextId, createSession: true }),
  });
  expect(deckRes.status).toBe(201);
  const body = (await deckRes.json()) as { deck: { id: string }; session: { id: string } };
  return { deckId: body.deck.id, sessionId: body.session.id };
}

async function grantTeam(user: Seeded): Promise<void> {
  await env.DB.prepare('UPDATE users SET entitlements = ?1 WHERE id = ?2')
    .bind(JSON.stringify({ team: true, continuity: true }), user.userId)
    .run();
}

/** Owner invites `email`, invitee accepts. Returns the invite id. */
async function inviteAndAccept(
  owner: Seeded,
  spaceId: string,
  invitee: Seeded,
  role: 'editor' | 'presenter',
): Promise<string> {
  await grantTeam(owner);
  const invited = await asUser(owner, `/api/my/spaces/${spaceId}/invites`, {
    method: 'POST',
    body: JSON.stringify({ email: invitee.email.toUpperCase(), role }),
  });
  expect(invited.status).toBe(201);
  const { id } = (await invited.json()) as { id: string };
  const accepted = await asUser(invitee, `/api/my/invites/${id}/accept`, { method: 'POST' });
  expect(accepted.status).toBe(200);
  return id;
}

describe('space roles', () => {
  it('space members are owners; strangers get 404', async () => {
    const owner = await seedSession('Owner');
    const stranger = await seedSession('Stranger');
    const spaceId = await homeSpace(owner);

    const mine = await asUser(owner, `/api/my/spaces/${spaceId}`, { method: 'GET' });
    expect(mine.status).toBe(200);
    const body = (await mine.json()) as { space: { role: string } };
    expect(body.space.role).toBe('owner');

    const theirs = await asUser(stranger, `/api/my/spaces/${spaceId}`, { method: 'GET' });
    expect(theirs.status).toBe(404);
  });

  it('presenters can read decks and start sessions but not modify anything', async () => {
    const owner = await seedSession('Owner');
    const presenter = await seedSession('Presenter');
    const spaceId = await homeSpace(owner);
    const { deckId, sessionId } = await createDelivery(owner, spaceId);
    await inviteAndAccept(owner, spaceId, presenter, 'presenter');

    const folder = await asUser(presenter, `/api/my/spaces/${spaceId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Nope' }),
    });
    expect(folder.status).toBe(403);

    expect((await asUser(presenter, `/api/decks/${deckId}`)).status).toBe(200);
    const detail = await asUser(presenter, `/api/sessions/${sessionId}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ canEdit: false });
    expect(await (await asUser(owner, `/api/sessions/${sessionId}`)).json()).toMatchObject({ canEdit: true });
    const visibleDecks = (await (await asUser(presenter, `/api/decks?spaceId=${spaceId}`)).json()) as { decks: { id: string }[] };
    const visibleSessions = (await (await asUser(presenter, `/api/sessions?spaceId=${spaceId}`)).json()) as { sessions: { id: string }[] };
    expect(visibleDecks.decks.map((row) => row.id)).toContain(deckId);
    expect(visibleSessions.sessions.map((row) => row.id)).toContain(sessionId);
    expect((await asUser(presenter, '/api/decks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Nope', spaceId }),
    })).status).toBe(403);
    expect((await asUser(presenter, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ deckId }),
    })).status).toBe(403);
    expect((await asUser(presenter, `/api/decks/${deckId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Nope' }),
    })).status).toBe(403);
    expect((await asUser(presenter, `/api/decks/${deckId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ content: { version: 1, meta: { title: 'Nope' }, steps: [] }, baseVersion: 0 }),
    })).status).toBe(403);
    expect((await asUser(presenter, `/api/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Nope' }),
    })).status).toBe(403);
    expect((await asUser(presenter, `/api/sessions/${sessionId}`, { method: 'DELETE' })).status).toBe(403);
    expect((await asUser(presenter, `/api/sessions/${sessionId}/record`, {
      method: 'PUT',
      body: JSON.stringify({ notes: 'Nope' }),
    })).status).toBe(403);

    const session = await asUser(presenter, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ outline: SMOKE_OUTLINE, spaceId }),
    });
    expect(session.status).toBe(201);
  });
});

describe('invites', () => {
  it('refuses a free owner with team-required and still accepts an already-issued invite', async () => {
    const owner = await seedSession('Owner');
    const colleague = await seedSession('Colleague');
    const spaceId = await homeSpace(owner);

    const refused = await asUser(owner, `/api/my/spaces/${spaceId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ email: colleague.email, role: 'editor' }),
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ ok: false, error: 'team-required' });

    await grantTeam(owner);
    const created = await asUser(owner, `/api/my/spaces/${spaceId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ email: colleague.email, role: 'editor' }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const accept = await asUser(colleague, `/api/my/invites/${id}/accept`, { method: 'POST' });
    expect(accept.status).toBe(200);
  });

  it('sessions the full lifecycle and enforces owner-only management', async () => {
    const owner = await seedSession('Owner');
    const editor = await seedSession('Editor');
    const spaceId = await homeSpace(owner);
    await grantTeam(owner);

    // Duplicate pending invite → 409.
    const first = await asUser(owner, `/api/my/spaces/${spaceId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ email: editor.email, role: 'editor' }),
    });
    expect(first.status).toBe(201);
    const dup = await asUser(owner, `/api/my/spaces/${spaceId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ email: editor.email, role: 'presenter' }),
    });
    expect(dup.status).toBe(409);

    // Invitee sees it.
    const pending = await asUser(editor, '/api/my/invites', { method: 'GET' });
    const { invites } = (await pending.json()) as { invites: { id: string; role: string }[] };
    expect(invites).toHaveLength(1);
    expect(invites[0]!.role).toBe('editor');

    // Wrong-email accept → 403.
    const stranger = await seedSession('Stranger');
    const wrong = await asUser(stranger, `/api/my/invites/${invites[0]!.id}/accept`, {
      method: 'POST',
    });
    expect(wrong.status).toBe(403);

    // Accept → member listed; invite gone from pending.
    const accept = await asUser(editor, `/api/my/invites/${invites[0]!.id}/accept`, {
      method: 'POST',
    });
    expect(accept.status).toBe(200);
    const membersRes = await asUser(owner, `/api/my/spaces/${spaceId}/members`, {
      method: 'GET',
    });
    const membersBody = (await membersRes.json()) as {
      members: { userId: string; role: string }[];
      invites: unknown[];
    };
    expect(membersBody.members.map((m) => m.userId)).toContain(editor.userId);
    expect(membersBody.invites).toHaveLength(0);

    // Inviting an existing member → 409.
    const again = await asUser(owner, `/api/my/spaces/${spaceId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ email: editor.email, role: 'editor' }),
    });
    expect(again.status).toBe(409);

    // Non-owner cannot invite or remove members.
    const editorInvite = await asUser(editor, `/api/my/spaces/${spaceId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ email: 'someone@example.com', role: 'editor' }),
    });
    expect(editorInvite.status).toBe(403);

    // Owner changes role, then removes the member.
    const patch = await asUser(owner, `/api/my/spaces/${spaceId}/members/${editor.userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'presenter' }),
    });
    expect(patch.status).toBe(200);
    const remove = await asUser(owner, `/api/my/spaces/${spaceId}/members/${editor.userId}`, {
      method: 'DELETE',
    });
    expect(remove.status).toBe(200);
    const gone = await asUser(editor, `/api/my/spaces/${spaceId}`, { method: 'GET' });
    expect(gone.status).toBe(404);

    // The space owner cannot be removed.
    const removeOwner = await asUser(owner, `/api/my/spaces/${spaceId}/members/${owner.userId}`, {
      method: 'DELETE',
    });
    expect(removeOwner.status).toBe(400);
  });

  it('revoked invites cannot be accepted', async () => {
    const owner = await seedSession('Owner');
    const invitee = await seedSession('Invitee');
    const spaceId = await homeSpace(owner);
    await grantTeam(owner);

    const created = await asUser(owner, `/api/my/spaces/${spaceId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ email: invitee.email, role: 'editor' }),
    });
    const { id } = (await created.json()) as { id: string };

    const revoked = await asUser(owner, `/api/my/invites/${id}`, { method: 'DELETE' });
    expect(revoked.status).toBe(200);

    const accept = await asUser(invitee, `/api/my/invites/${id}/accept`, { method: 'POST' });
    expect(accept.status).toBe(404);
  });
});


describe('headless workspace invitations', () => {
  it('uses the same owner licence and membership boundary for a personal API token', async () => {
    const owner = await seedSession('Owner');
    const invitee = await seedSession('Invitee');
    const spaceId = await homeSpace(owner);
    const tokenResponse = await asUser(owner, '/api/my/tokens', { method: 'POST', body: JSON.stringify({ name: 'Workspace automation' }) });
    expect(tokenResponse.status).toBe(201);
    const { token } = await tokenResponse.json() as { token: string };
    const invite = () => worker.fetch(new Request(`${BASE}/api/my/spaces/${spaceId}/invites`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: invitee.email, role: 'editor' }),
    }), env as never);
    expect((await invite()).status).toBe(403);
    await grantTeam(owner);
    const response = await invite();
    expect(response.status).toBe(201);
    const { id } = await response.json() as { id: string };
    expect((await asUser(invitee, `/api/my/invites/${id}/accept`, { method: 'POST' })).status).toBe(200);
    const member = await env.DB.prepare('SELECT role FROM space_members WHERE space_id = ?1 AND user_id = ?2').bind(spaceId, invitee.userId).first();
    expect(member).toMatchObject({ role: 'editor' });
  });
});
