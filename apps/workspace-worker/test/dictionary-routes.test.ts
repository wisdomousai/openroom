/**
 * Who may look a word up, and on which credential.
 *
 * The learner route is the interesting one. It is session-scoped rather than on
 * `/api/learner/*` because a learner in a live session holds a session capability
 * token and nothing else — the participant app forgets its context access link
 * the moment it joins. These tests are what keeps that boundary checkable.
 */
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { isTutoringApiPath } from '@openroom/schema';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import worker from '../src/index.js';
import { signCookieValue } from '../src/cookies.js';
import { BASE, createSessionWithOutline, join, SMOKE_OUTLINE } from './helpers.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

const OUTLINE = {
  version: 1,
  meta: { title: 'Le passé composé', subject: 'French', level: 'B1' },
  // Pseudonymous so the test can join without minting a context access link.
  // The route's gate is the session's context, not the identity mode.
  defaults: { identityMode: 'pseudonymous', resultVisibility: 'hidden-until-close' },
  steps: [
    { id: 'intro', kind: 'title', title: 'Je rate le train' },
    { id: 'gap-step', kind: 'interaction', interactionId: 'gap' },
  ],
  interactions: [
    {
      id: 'gap',
      type: 'fill-the-gaps',
      prompt: "J'{{g1}} raté le train.",
      gaps: [{ id: 'g1', answers: ['ai'] }],
    },
  ],
};

async function seedCookie(): Promise<string> {
  const userId = `tutor-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, created_at, entitlements)
     VALUES (?1, ?2, ?3, ?4, ?5, '{}')`,
  )
    .bind(userId, `sub-${userId}`, `${userId}@example.com`, 'Tutor', now)
    .run();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(sessionId, userId, now, now + 86_400_000)
    .run();
  return `${SESSION_COOKIE}=${encodeURIComponent(await signCookieValue(TOKEN_SECRET, sessionId))}`;
}

function asBrowser(cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('content-type', 'application/json');
  headers.set(CSRF_HEADER, '1');
  return worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env as never);
}

function lookup(sessionCode: string, token: string | null, body: unknown): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  return worker.fetch(
    new Request(`${BASE}/api/sessions/${sessionCode}/dictionary`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    env as never,
  );
}

/** A live tutoring session, reached the way the tutor reaches it. */
async function tutoringSession(): Promise<{
  code: string;
  sessionCode: string;
  hostToken: string;
  spaceId: string;
}> {
  const cookie = await seedCookie();
  const contextRes = await asBrowser(cookie, '/api/tutoring/contexts', {
    method: 'POST',
    body: JSON.stringify({ displayName: 'Camille', kind: 'person', context: { level: 'B1' } }),
  });
  expect(contextRes.status).toBe(201);
  const contextId = ((await contextRes.json()) as { context: { id: string } }).context.id;

  const deckRes = await asBrowser(cookie, '/api/decks', {
    method: 'POST',
    body: JSON.stringify({ contextId, outline: OUTLINE, shape: 'tutoring', createSession: true }),
  });
  expect(deckRes.status).toBe(201);
  const sessionId = ((await deckRes.json()) as { session: { id: string } }).session.id;

  const launched = await asBrowser(cookie, `/api/sessions/${sessionId}/launch`, {
    method: 'POST',
    body: JSON.stringify({ start: true }),
  });
  expect(launched.status).toBe(201);
  const session = (await launched.json()) as { code: string; sessionCode: string; hostToken: string };

  const space = await env.DB.prepare('SELECT space_id FROM live_sessions WHERE code = ?1')
    .bind(session.code)
    .first<{ space_id: string }>();
  return { ...session, spaceId: space?.space_id ?? '' };
}

describe('POST /api/sessions/:code/dictionary', () => {
  let session: Awaited<ReturnType<typeof tutoringSession>>;
  let learner: Awaited<ReturnType<typeof join>>;

  beforeAll(async () => {
    session = await tutoringSession();
    learner = await join(session.code);
  });

  it('refuses a caller with no session token', async () => {
    const res = await lookup(session.sessionCode, null, { word: 'rate' });
    expect(res.status).toBe(401);
  });

  it('refuses a token minted for another session', async () => {
    const other = await createSessionWithOutline(SMOKE_OUTLINE);
    const res = await lookup(session.sessionCode, other.hostToken, { word: 'rate' });
    expect(res.status).toBe(403);
  });

  /*
   * The route exists for everyone holding the session's token: the phone has no
   * other credential, and the tutor console reaching it is not a privilege
   * escalation — it is the same read.
   */
  it('accepts a participant token, and gets as far as the space settings', async () => {
    const res = await lookup(session.sessionCode, learner.participantToken, { word: 'rate' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'languages-not-configured' });
  });

  it('refuses a word it would not put in a URL, before touching the session', async () => {
    const res = await lookup(session.sessionCode, learner.participantToken, { word: '../etc' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid-word' });
  });

  /*
   * In a plain anonymous poll session the route does not exist. A 404 rather than
   * a 403 so there is nothing for a phone to discover.
   */
  it('is absent from a session that was not launched from a context', async () => {
    const plain = await createSessionWithOutline(SMOKE_OUTLINE);
    const res = await lookup(plain.sessionCode, plain.hostToken, { word: 'rate' });
    expect(res.status).toBe(404);
  });

  it('is not reachable by any other method', async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/api/sessions/${session.sessionCode}/dictionary`, {
        headers: { authorization: `Bearer ${learner.participantToken}` },
      }),
      env as never,
    );
    expect(res.status).toBe(405);
  });
});

describe('the agent surface', () => {
  /*
   * Both dictionary routes are console conveniences and stay off the agent
   * surface — see the comment in packages/schema/src/tutoring-paths.ts. The
   * assertion is here so a future "why isn't this in the CLI?" gets an answer
   * rather than a patch.
   */
  it('does not carry the dictionary', () => {
    expect(isTutoringApiPath('/api/tutoring/dictionary')).toBe(false);
  });
});
