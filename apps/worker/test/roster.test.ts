/**
 * Roster sessions: host-typed names, `orinv_…`, not a context access link.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import { signCookieValue } from '../src/cookies.js';
import worker from '../src/index.js';
import { BASE, call } from './helpers.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

const ROSTER_OUTLINE = {
  version: 1,
  meta: { title: 'Committee vote' },
  defaults: { identityMode: 'roster' },
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

describe('roster sessions', () => {
  it('refuses create without the roster entitlement', async () => {
    const free = await seedUser('{}');
    const res = await asUser(free, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ outline: ROSTER_OUTLINE }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'roster-required' });
  });

  it('mints orinv_ seats, joins from the lobby, and keeps two same names apart', async () => {
    const owner = await seedUser(JSON.stringify({ roster: true, rawExport: true }));
    const created = await asUser(owner, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ outline: ROSTER_OUTLINE }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as { sessionCode: string; hostToken: string; code: string };

    const first = await mintSeat(session, owner, 'Alex');
    const second = await mintSeat(session, owner, 'Alex');
    expect(first.token.startsWith('orinv_')).toBe(true);
    expect(second.id).not.toBe(first.id);

    const joinFirst = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code, rosterInvite: first.token }),
    });
    expect(joinFirst.status).toBe(200);
    const a = (await joinFirst.json()) as { participantId: string; handle: string };
    expect(a.handle).toBe('Alex');

    const joinSecond = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code, rosterInvite: second.token }),
    });
    const b = (await joinSecond.json()) as { participantId: string; handle: string };
    expect(b.handle).toBe('Alex');
    expect(b.participantId).not.toBe(a.participantId);

    const again = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code, rosterInvite: first.token }),
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
      body: JSON.stringify({ code: session.code, contextLink: first.token }),
    });
    expect(asLink.status).toBe(403);

    const learner = await call('/api/learner/me', {
      headers: { authorization: `Bearer ${first.token}` },
    });
    expect(learner.status).toBeGreaterThanOrEqual(400);

    const tutoring = await call('/api/tutoring/contexts', {
      headers: { authorization: `Bearer ${first.token}` },
    });
    expect(tutoring.status).toBe(401);
  });

  it('does not let a roster invite identify into a tutoring session', async () => {
    const owner = await seedUser(JSON.stringify({ roster: true }));
    const session = await createOwnedAnonymous(owner);
    const other = await asUser(owner, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ outline: ROSTER_OUTLINE }),
    });
    const rosterSession = (await other.json()) as { sessionCode: string; hostToken: string; code: string };
    const seat = await mintSeat(rosterSession, owner, 'Bo');
    const sneak = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code, rosterInvite: seat.token }),
    });
    expect(sneak.status).toBe(403);
  });
});

async function mintSeat(
  session: { sessionCode: string; hostToken: string },
  _owner: { cookie: string },
  displayName: string,
): Promise<{ id: string; token: string }> {
  const res = await call(`/api/sessions/${session.sessionCode}/roster/seats`, {
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
  const userId = `ros-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, created_at, entitlements)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(userId, `sub-${userId}`, `${userId}@example.com`, 'Roster Host', now, entitlementsJson)
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
