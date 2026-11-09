/**
 * Guest-list sessions: host-typed names, `orinv_…`, not a student access link.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import { signCookieValue } from '../src/cookies.js';
import worker from '../src/index.js';
import { BASE, call } from './helpers.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

const GUEST_LIST_OUTLINE = {
  version: 1,
  meta: { title: 'Committee vote' },
  defaults: { identityMode: 'guest-list' },
  interactions: [
    {
      id: 'motion',
      type: 'choice',
      prompt: 'Approve?',
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ],
    },
  ],
};

describe('guest-list sessions', () => {
  it('refuses create without the guest list entitlement', async () => {
    const free = await seedUser('{}');
    const res = await asUser(free, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ outline: GUEST_LIST_OUTLINE }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'guest-list-required' });
  });

  it('mints orinv_ guest links, joins from the lobby, and keeps two same names apart', async () => {
    const owner = await seedUser(JSON.stringify({ guestList: true, rawExport: true }));
    const created = await asUser(owner, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ outline: GUEST_LIST_OUTLINE }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as { sessionCode: string; hostToken: string; code: string; joinUrl?: string };
    // The code alone admits nobody here, so no bare join address is handed out.
    expect(session.joinUrl).toBeUndefined();

    const first = await mintLink(session, owner, 'Alex');
    const second = await mintLink(session, owner, 'Alex');
    expect(first.token.startsWith('orinv_')).toBe(true);
    expect(second.id).not.toBe(first.id);

    const joinFirst = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code, guestLink: first.token }),
    });
    expect(joinFirst.status).toBe(200);
    const a = (await joinFirst.json()) as { participantId: string; name: string };
    expect(a.name).toBe('Alex');

    const joinSecond = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code, guestLink: second.token }),
    });
    const b = (await joinSecond.json()) as { participantId: string; name: string };
    expect(b.name).toBe('Alex');
    expect(b.participantId).not.toBe(a.participantId);

    const again = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code, guestLink: first.token }),
    });
    const a2 = (await again.json()) as { participantId: string };
    expect(a2.participantId).toBe(a.participantId);

    const bare = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code }),
    });
    expect(bare.status).toBe(403);

    const asLink = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code, studentLink: first.token }),
    });
    expect(asLink.status).toBe(403);

    const learner = await call('/api/learner/me', {
      headers: { authorization: `Bearer ${first.token}` },
    });
    expect(learner.status).toBeGreaterThanOrEqual(400);

    const tutoring = await call('/api/tutoring/students', {
      headers: { authorization: `Bearer ${first.token}` },
    });
    expect(tutoring.status).toBe(401);
  });

  it('does not let a guest link identify into a tutoring session', async () => {
    const owner = await seedUser(JSON.stringify({ guestList: true }));
    const session = await createOwnedAnonymous(owner);
    const other = await asUser(owner, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ outline: GUEST_LIST_OUTLINE }),
    });
    const guestListSession = (await other.json()) as { sessionCode: string; hostToken: string; code: string };
    const seat = await mintLink(guestListSession, owner, 'Bo');
    const sneak = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code, guestLink: seat.token }),
    });
    expect(sneak.status).toBe(403);
  });

  it('lets a space editor mint guest links but not a presenter co-host', async () => {
    const owner = await seedUser(JSON.stringify({ guestList: true, team: true }));
    const presenter = await seedUser('{}');
    const space = (await (await asUser(owner, '/api/my/spaces', {
      method: 'POST',
      body: JSON.stringify({ name: 'Board', experience: 'training' }),
    })).json()) as { id: string };
    await env.DB.prepare('INSERT INTO space_members (space_id, user_id, role, created_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(space.id, presenter.userId, 'presenter', Date.now())
      .run();
    const created = await asUser(owner, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ outline: GUEST_LIST_OUTLINE, spaceId: space.id }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as { sessionCode: string; hostToken: string; code: string };
    const coHost = await asUser(presenter, `/api/my/sessions/${session.code}/co-host`, { method: 'POST' });
    expect(coHost.status).toBe(200);
    const { hostToken } = (await coHost.json()) as { hostToken: string };

    const refused = await call(`/api/sessions/${session.sessionCode}/guest-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${hostToken}` },
      body: JSON.stringify({ displayName: 'Mallory' }),
    });
    expect(refused.status).toBe(403);
    expect(await mintLink(session, owner, 'Alex')).toMatchObject({ token: expect.stringMatching(/^orinv_/) });
  });
});

async function mintLink(
  session: { sessionCode: string; hostToken: string },
  _owner: { cookie: string },
  displayName: string,
): Promise<{ id: string; token: string }> {
  const res = await call(`/api/sessions/${session.sessionCode}/guest-links`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.hostToken}`,
    },
    body: JSON.stringify({ displayName }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; token: string };
}

async function createOwnedAnonymous(
  session: { cookie: string },
): Promise<{ sessionCode: string; code: string; hostToken: string }> {
  const res = await asUser(session, '/api/sessions', {
    method: 'POST',
    body: JSON.stringify({
      outline: {
        version: 1,
        meta: { title: 'Class' },
        defaults: { identityMode: 'anonymous' },
        interactions: [{ id: 'q', type: 'text', prompt: 'Hi' }],
      },
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { sessionCode: string; code: string; hostToken: string };
}

async function seedUser(entitlementsJson: string): Promise<{ userId: string; cookie: string }> {
  const userId = `guest-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, created_at, entitlements)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(userId, `sub-${userId}`, `${userId}@example.com`, 'Guest List Host', now, entitlementsJson)
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

function asUser(session: { cookie: string }, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('cookie', session.cookie);
  headers.set('content-type', 'application/json');
  headers.set(CSRF_HEADER, '1');
  return worker.fetch(new Request(`${BASE}${path}`, { method: 'GET', ...init, headers }), env as never);
}
