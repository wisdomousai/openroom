/**
 * Context access links: the learner-side capability credential.
 *
 * These are behavioural auth tests. The point of the file is the negative half:
 * a link is scoped to exactly ONE context, is never a `SessionUser`, and never
 * reaches the control plane. Everything asserted here is a boundary that, if it
 * moved, would leak one tutoring client's records to another.
 */
import { encodeVoiceWav, VOICE_WAV_MAX_BYTES, VOICE_MAX_RECORDINGS_PER_TASK } from '@openroom/schema';
import { expireLearnerAudio, purgeLearnerAudio } from '../src/learner-audio.js';
import { learnerPracticePost } from '../src/learner-practice.js';
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import worker from '../src/index.js';
import { signCookieValue } from '../src/tokens.js';
import { BASE, command, stateJson } from './helpers.js';
import {
  LEARNER_AUTH_FAILURE_LIMIT,
  LEARNER_AUTH_WINDOW_MS,
  learnerClientKey,
} from '../src/learner-rate-limit.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

type Identity = 'identified' | 'pseudonymous' | 'anonymous';

/** Outline whose session names every participant from their context access link. */
function outline(identityMode: Identity): Record<string, unknown> {
  return {
    version: 1,
    meta: { title: 'Travel problems', subject: 'French', level: 'B1' },
    defaults: { identityMode },
    steps: [{ id: 'check', kind: 'interaction', interactionId: 'past-tense' }],
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
  };
}

interface Signed {
  userId: string;
  cookie: string;
}

async function seedSession(): Promise<Signed> {
  const userId = `link-user-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, created_at, entitlements)
     VALUES (?1, ?2, ?3, ?4, ?5, '{"continuity":true}')`,
  )
    .bind(userId, `sub-${userId}`, `${userId}@example.com`, 'Link Tutor', now)
    .run();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(sessionId, userId, now, now + 86_400_000)
    .run();
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

/**
 * A learner request from a fresh client each time. The per-client throttle
 * (learner-rate-limit.ts) buckets by `CF-Connecting-IP`, and D1 state is shared
 * across the tests in this file, so a fixed client would let one test's failed
 * attempts spend another test's budget. The throttle's own behaviour is
 * exercised deliberately in its describe block below, with pinned clients.
 */
function asLearner(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  headers.set('cf-connecting-ip', `198.51.100.7-${crypto.randomUUID()}`);
  return worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env as never);
}

/**
 * `spaceId` names the space to put the context in; omit it and the context
 * brings a new space of its own, since a space holds one context. A test that
 * grants a second member must name the space it granted them on.
 */
async function createContext(
  cookie: string,
  displayName: string,
  spaceId?: string,
): Promise<string> {
  const response = await asBrowser(cookie, '/api/tutoring/contexts', {
    method: 'POST',
    body: JSON.stringify({
      displayName,
      kind: 'person',
      context: { level: 'B1' },
      ...(spaceId === undefined ? {} : { spaceId }),
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { context: { id: string } }).context.id;
}

async function mintLink(cookie: string, contextId: string): Promise<string> {
  const response = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { token: string }).token;
}

async function createSession(
  cookie: string,
  contextId: string,
  identityMode: Identity = 'identified',
): Promise<string> {
  const response = await asBrowser(cookie, '/api/decks', {
    method: 'POST',
    body: JSON.stringify({
      contextId,
      outline: outline(identityMode),
      shape: 'tutoring',
      createSession: true,
    }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { session: { id: string } };
  return body.session.id;
}

async function launch(
  cookie: string,
  sessionId: string,
  start = true,
): Promise<{ code: string; sessionCode: string; hostToken: string; stageToken: string }> {
  const response = await asBrowser(cookie, `/api/sessions/${sessionId}/launch`, {
    method: 'POST',
    body: JSON.stringify({ start }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as {
    code: string;
    sessionCode: string;
    hostToken: string;
    stageToken: string;
  };
}

function joinWith(body: Record<string, unknown>): Promise<Response> {
  return worker.fetch(
    new Request(`${BASE}/api/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env as never,
  );
}

describe('context access links — tutor side', () => {
  it('shows the raw token exactly once and never again', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');

    const minted = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(minted.status).toBe(201);
    const body = (await minted.json()) as {
      id: string;
      token: string;
      tokenPrefix: string;
      expiresAt: number;
    };
    expect(body.token.startsWith('orlnk_')).toBe(true);
    expect(body.tokenPrefix).toBe(body.token.slice(0, 12));
    // Default expiry is 180 days out.
    expect(Math.round((body.expiresAt - Date.now()) / 86_400_000)).toBe(180);

    const listed = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links`);
    expect(listed.status).toBe(200);
    const text = await listed.text();
    expect(text).not.toContain(body.token);
    const links = (JSON.parse(text) as { links: { id: string; tokenPrefix: string }[] }).links;
    expect(links).toHaveLength(1);
    expect(links[0]!.id).toBe(body.id);
    expect(links[0]!.tokenPrefix).toBe(body.tokenPrefix);

    // The cleartext token is nowhere in D1 — only its SHA-256 digest.
    const stored = await env.DB.prepare(
      'SELECT token_hash FROM context_access_links WHERE id = ?1',
    )
      .bind(body.id)
      .first<{ token_hash: string }>();
    expect(stored?.token_hash).not.toBe(body.token);
  });

  it('revokes without hard-deleting, and the revoked link stops working', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const minted = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const { id, token } = (await minted.json()) as { id: string; token: string };
    expect((await asLearner(token, '/api/learner/me')).status).toBe(200);

    const revoked = await asBrowser(
      cookie,
      `/api/tutoring/contexts/${contextId}/links/${id}`,
      { method: 'DELETE' },
    );
    expect(revoked.status).toBe(200);

    expect((await asLearner(token, '/api/learner/me')).status).toBe(401);
    expect((await asLearner(token, '/api/learner/sessions')).status).toBe(401);

    // The audit row survives; it is marked, not erased.
    const listed = (await (
      await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links`)
    ).json()) as { links: { id: string; revokedAt: number | null }[] };
    expect(listed.links).toHaveLength(1);
    expect(listed.links[0]!.revokedAt).toBeGreaterThan(0);
  });

  it('caps live links per context and lets a revoked slot be reused', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const response = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(201);
      ids.push(((await response.json()) as { id: string }).id);
    }
    const overflow = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(overflow.status).toBe(429);

    await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links/${ids[0]}`, {
      method: 'DELETE',
    });
    const retry = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(retry.status).toBe(201);
  });

  it('lets an editor mint but never a presenter', async () => {
    const owner = await seedSession();
    const presenter = await seedSession();
    const editor = await seedSession();
    const spaces = (await (await asBrowser(owner.cookie, '/api/my/spaces')).json()) as {
      spaces: { id: string }[];
    };
    const spaceId = spaces.spaces[0]!.id;
    for (const [member, role] of [
      [presenter, 'presenter'],
      [editor, 'editor'],
    ] as const) {
      await env.DB.prepare(
        'INSERT INTO space_members (space_id, user_id, role, created_at) VALUES (?1, ?2, ?3, ?4)',
      )
        .bind(spaceId, member.userId, role, Date.now())
        .run();
    }
    const contextId = await createContext(owner.cookie, 'Camille', spaceId);

    const asPresenter = await asBrowser(presenter.cookie, `/api/tutoring/contexts/${contextId}/links`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(asPresenter.status).toBe(403);

    const asEditor = await asBrowser(editor.cookie, `/api/tutoring/contexts/${contextId}/links`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(asEditor.status).toBe(201);
  });

  it('refuses to mint for a context in another tutor space', async () => {
    const owner = await seedSession();
    const stranger = await seedSession();
    const contextId = await createContext(owner.cookie, 'Camille');
    const response = await asBrowser(stranger.cookie, `/api/tutoring/contexts/${contextId}/links`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(404);
  });
});

describe('context access links — learner plane', () => {
  it('serves only its own context, and never the tutor-private notes', async () => {
    const { cookie } = await seedSession();
    const camille = await createContext(cookie, 'Camille');
    const other = await createContext(cookie, 'Noor');

    const camilleSession = await createSession(cookie, camille);
    const otherSession = await createSession(cookie, other);
    for (const sessionId of [camilleSession, otherSession]) {
      await launch(cookie, sessionId);
      const record = await asBrowser(cookie, `/api/sessions/${sessionId}/record`, {
        method: 'PUT',
        body: JSON.stringify({
          outcomes: ['Used passé composé independently'],
          notes: 'SECRET-TUTOR-NOTE: parents asked about attention span.',
          homework: ['Write three travel sentences'],
          artifacts: [{ interactionId: 'past-tense', result: 'correct' }],
        }),
      });
      expect(record.status).toBe(200);
    }

    const token = await mintLink(cookie, camille);

    const me = await asLearner(token, '/api/learner/me');
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ contextId: camille, displayName: 'Camille' });

    const sessionsResponse = await asLearner(token, '/api/learner/sessions');
    expect(sessionsResponse.status).toBe(200);
    const raw = await sessionsResponse.text();

    // The tutor-private note must not appear anywhere in the body, under any key.
    expect(raw).not.toContain('SECRET-TUTOR-NOTE');
    // Nor may the payload leak the sibling context's session.
    expect(raw).not.toContain(otherSession);
    // A transient session signal must never appear under any key either: the
    // learner plane is a records surface, not a live-session surface.
    expect(raw).not.toMatch(/"signal(s)?"/i);
    expect(raw).not.toContain('stuck');
    expect(raw).not.toContain('got-it');

    const { sessions } = JSON.parse(raw) as {
      sessions: {
        id: string;
        title: string;
        status: string;
        record?: { outcomes: string[]; homework: string[]; artifacts: unknown[] };
      }[];
    };
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe(camilleSession);
    expect(sessions[0]!.record?.outcomes).toEqual(['Used passé composé independently']);
    expect(sessions[0]!.record?.homework).toEqual([
      { id: 'item-1', kind: 'reading', body: 'Write three travel sentences', assignmentRevision: 1 },
    ]);
    expect(Object.keys(sessions[0]!.record!).sort()).toEqual(['artifacts', 'homework', 'outcomes']);
  });

  it('rejects an expired link', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const minted = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const { id, token } = (await minted.json()) as { id: string; token: string };
    expect((await asLearner(token, '/api/learner/sessions')).status).toBe(200);

    await env.DB.prepare('UPDATE context_access_links SET expires_at = ?1 WHERE id = ?2')
      .bind(Date.now() - 1000, id)
      .run();

    expect((await asLearner(token, '/api/learner/me')).status).toBe(401);
    expect((await asLearner(token, '/api/learner/sessions')).status).toBe(401);
  });

  it('dies with its context when the context is trashed', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const token = await mintLink(cookie, contextId);
    expect((await asLearner(token, '/api/learner/me')).status).toBe(200);

    expect(
      (await asBrowser(cookie, `/api/tutoring/contexts/${contextId}`, { method: 'DELETE' })).status,
    ).toBe(200);
    expect((await asLearner(token, '/api/learner/me')).status).toBe(401);
  });

  it('never reaches the control plane', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const sessionId = await createSession(cookie, contextId);
    const token = await mintLink(cookie, contextId);

    for (const path of [
      '/api/tutoring/contexts',
      `/api/tutoring/contexts/${contextId}`,
      `/api/tutoring/contexts/${contextId}/links`,
      '/api/decks',
      '/api/sessions',
      `/api/sessions/${sessionId}`,
      `/api/sessions/${sessionId}/record`,
      '/api/my/sessions',
      '/api/my/tokens',
      '/api/my/spaces',
    ]) {
      const response = await asLearner(token, path);
      expect([401, 403], `${path} accepted a context link with ${response.status}`).toContain(
        response.status,
      );
    }
  });

  it('refuses a PAT and a session cookie on the learner plane', async () => {
    const { cookie } = await seedSession();

    const minted = await asBrowser(cookie, '/api/my/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'agent' }),
    });
    expect(minted.status).toBe(201);
    const pat = ((await minted.json()) as { token: string }).token;
    expect(pat.startsWith('orpat_')).toBe(true);

    for (const path of ['/api/learner/me', '/api/learner/sessions']) {
      expect((await asLearner(pat, path)).status).toBe(401);
      // A signed-in tutor's browser is still not a learner.
      const withCookie = await worker.fetch(
        new Request(`${BASE}${path}`, { headers: { cookie } }),
        env as never,
      );
      expect(withCookie.status).toBe(401);
      // And no credential at all is 401, not an empty 200.
      expect((await worker.fetch(new Request(`${BASE}${path}`), env as never)).status).toBe(401);
    }
  });
});

describe('identified sessions', () => {
  it('names the participant from the context and re-entry is the same participant', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const sessionId = await createSession(cookie, contextId);
    const { code } = await launch(cookie, sessionId);
    const token = await mintLink(cookie, contextId);

    const first = await joinWith({ code, contextLink: token });
    expect(first.status).toBe(200);
    const joined = (await first.json()) as {
      participantId: string;
      identityMode: string;
      handle: string;
    };
    expect(joined.identityMode).toBe('identified');
    expect(joined.handle).toBe('Camille');

    const again = await joinWith({ code, contextLink: token });
    expect(again.status).toBe(200);
    const rejoined = (await again.json()) as { participantId: string; handle: string };
    expect(rejoined.participantId).toBe(joined.participantId);
    expect(rejoined.handle).toBe('Camille');
  });

  it('is closed to anyone without a link', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const { code } = await launch(cookie, await createSession(cookie, contextId));

    const bare = await joinWith({ code });
    expect(bare.status).toBe(403);
    expect(((await bare.json()) as { error: string }).error).toBe('context-link-required');
  });

  it("rejects another context's link on this session", async () => {
    const { cookie } = await seedSession();
    const camille = await createContext(cookie, 'Camille');
    const noor = await createContext(cookie, 'Noor');
    const { code } = await launch(cookie, await createSession(cookie, camille));
    const noorToken = await mintLink(cookie, noor);

    const response = await joinWith({ code, contextLink: noorToken });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe('context-link-invalid');
  });

  it('rejects a revoked link at join even for the right session', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const { code } = await launch(cookie, await createSession(cookie, contextId));
    const minted = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const { id, token } = (await minted.json()) as { id: string; token: string };
    expect((await joinWith({ code, contextLink: token })).status).toBe(200);

    await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links/${id}`, { method: 'DELETE' });
    expect((await joinWith({ code, contextLink: token })).status).toBe(403);
  });

  it('refuses a link on a session that does not use one', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const { code } = await launch(cookie, await createSession(cookie, contextId, 'pseudonymous'));
    const token = await mintLink(cookie, contextId);

    const response = await joinWith({ code, contextLink: token });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe('identified-join-unavailable');

    // …and the session still works the ordinary pseudonymous way.
    const plain = await joinWith({ code });
    expect(plain.status).toBe(200);
    expect(((await plain.json()) as { identityMode: string }).identityMode).toBe('pseudonymous');
  });
});

describe('identified sessions require a started session', () => {
  it('refuses an identified join while the session is still in the lobby', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const { code } = await launch(cookie, await createSession(cookie, contextId), false);
    const token = await mintLink(cookie, contextId);

    const early = await joinWith({ code, contextLink: token });
    expect(early.status).toBe(409);
    const body = (await early.json()) as { error: string; message: string };
    expect(body.error).toBe('session-not-started');
    expect(body.message).toContain('not started');
  });

  it('admits the same link once the tutor starts, and again on re-entry', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const sessionId = await createSession(cookie, contextId);
    const { code, sessionCode, hostToken } = await launch(cookie, sessionId, false);
    const token = await mintLink(cookie, contextId);

    expect((await joinWith({ code, contextLink: token })).status).toBe(409);

    const started = await command(sessionCode, hostToken, { command: 'session.start' });
    expect(started.status).toBe(200);

    const joined = await joinWith({ code, contextLink: token });
    expect(joined.status).toBe(200);
    const first = (await joined.json()) as { participantId: string };

    // Re-entry mid-session still lands on the same participant.
    const again = await joinWith({ code, contextLink: token });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { participantId: string }).participantId).toBe(
      first.participantId,
    );
  });

  it('leaves lobby joins alone for pseudonymous and anonymous sessions', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');

    for (const mode of ['pseudonymous', 'anonymous'] as const) {
      const sessionId = await createSession(cookie, contextId, mode);
      const { code } = await launch(cookie, sessionId, false);
      const response = await joinWith({ code });
      expect(response.status, `${mode} lobby join`).toBe(200);
      expect(((await response.json()) as { identityMode: string }).identityMode).toBe(mode);
    }
  });
});

/**
 * Identified-session privacy: the link names the learner, ending the session
 * completes the session, and the learner plane never receives tutor notes or a
 * session code.
 */
describe('tutoring privacy — identified join and learner allowlist', () => {
  it('names the learner from the context, completes the session, and withholds notes and session codes', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const sessionId = await createSession(cookie, contextId);
    const { code, sessionCode, hostToken, stageToken } = await launch(cookie, sessionId);
    const link = await mintLink(cookie, contextId);

    const joined = await joinWith({ code, contextLink: link });
    expect(joined.status).toBe(200);
    const { participantId } = (await joined.json()) as {
      participantId: string;
    };

    const host = await stateJson(sessionCode, hostToken, 'host');
    expect(host.handles?.[participantId]).toBe('Camille');
    expect(host).not.toHaveProperty('signals');

    const stage = await stateJson(sessionCode, stageToken, 'stage');
    expect(stage).not.toHaveProperty('handles');
    expect(stage).not.toHaveProperty('signals');

    const end = await command(sessionCode, hostToken, { command: 'session.end' });
    expect(end.status).toBe(200);

    const sessionRow = await env.DB.prepare('SELECT status FROM sessions WHERE id = ?1')
      .bind(sessionId)
      .first<{ status: string }>();
    expect(sessionRow?.status).toBe('ended');

    await asBrowser(cookie, `/api/sessions/${sessionId}/record`, {
      method: 'PUT',
      body: JSON.stringify({
        outcomes: ['Used passé composé independently'],
        notes: 'Private tutor note — must never reach the learner',
        homework: ['Write three travel sentences'],
        artifacts: [],
      }),
    });

    const learnerSessions = await asLearner(link, '/api/learner/sessions');
    expect(learnerSessions.status).toBe(200);
    const raw = await learnerSessions.text();
    expect(raw).not.toContain('Private tutor note');
    expect(raw).not.toContain(code);
    expect(raw).not.toMatch(/"notes"/);
    expect(raw).not.toMatch(/"sessionCode"|"session_code"/);
    const body = JSON.parse(raw) as {
      sessions: Array<{ record?: { outcomes: string[]; homework: string[] } }>;
    };
    expect(body.sessions[0]?.record?.outcomes).toEqual(['Used passé composé independently']);
    expect(body.sessions[0]?.record?.homework).toEqual([
      { id: 'item-1', kind: 'reading', body: 'Write three travel sentences', assignmentRevision: 1 },
    ]);
  });
});

describe('learner practice writes', () => {
  const quizInteraction = {
    id: 'past-tense',
    type: 'choice' as const,
    prompt: 'Choose the correct sentence.',
    options: [
      { id: 'a', label: "J'ai raté le train.", correct: true },
      { id: 'b', label: 'Je rate le train hier.' },
    ],
  };

  async function publishHomework(cookie: string, sessionId: string, extra: Record<string, unknown> = {}) {
    const record = await asBrowser(cookie, `/api/sessions/${sessionId}/record`, {
      method: 'PUT',
      body: JSON.stringify({
        outcomes: ['Covered the past tense'],
        notes: 'SECRET-NEXT-PRIVATE',
        nextNote: 'Start with the ones they missed.',
        homework: [
          { id: 'write-1', kind: 'writing', prompt: 'Write six sentences.' },
          { id: 'quiz-1', kind: 'quiz', interaction: quizInteraction },
        ],
        artifacts: [],
        ...extra,
      }),
    });
    expect(record.status).toBe(200);
  }

  it('retains original exercises, rejects stale answers and safely replays an accepted attempt', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const sessionId = await createSession(cookie, contextId);
    await launch(cookie, sessionId);
    await publishHomework(cookie, sessionId);
    const token = await mintLink(cookie, contextId);
    const input = { itemId: `${sessionId}:quiz-1`, grade: 'again', answer: { kind: 'choice', optionIds: ['b'] }, assignmentRevision: 1, attemptId: crypto.randomUUID() };
    const submit = (value = input) => asLearner(token, '/api/learner/practice', { method: 'POST', body: JSON.stringify(value) });
    expect((await submit({ ...input, grade: 'good' })).status).toBe(422);
    expect((await submit({ ...input, answer: { kind: 'choice', optionIds: ['missing'] } })).status).toBe(422);
    const replayed = await Promise.all([submit(), submit()]);
    expect(replayed.map((response) => response.status)).toEqual([200, 200]);
    const state = () => env.DB.prepare('SELECT version, lapses, reps, last_attempt_id FROM learner_srs WHERE item_id = ?1').bind(input.itemId).first();
    expect(await state()).toMatchObject({ version: 1, lapses: 1, reps: 0, last_attempt_id: input.attemptId });
    expect((await submit({ ...input, answer: { kind: 'choice', optionIds: ['a'] } })).status).toBe(409);
    const revisedQuiz = { id: 'quiz-1', kind: 'quiz', interaction: { ...quizInteraction, prompt: 'A different question.', options: [{ id: 'a', label: 'Now incorrect' }, { id: 'b', label: 'Now correct', correct: true }] } };
    await publishHomework(cookie, sessionId, { homeworkRevision: 1, homework: [revisedQuiz] });
    expect((await submit()).status).toBe(200); // lost response may be retried after revision
    expect(await state()).toMatchObject({ version: 1, lapses: 1 });
    expect((await submit({ ...input, attemptId: crypto.randomUUID() })).status).toBe(409);
    const pickup = await (await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/returned`)).json() as { missed: { exercise: { interaction: { prompt: string } }; lastAnswer: unknown }[] };
    expect(pickup.missed).toEqual([expect.objectContaining({ exercise: { interaction: quizInteraction }, lastAnswer: input.answer })]);
    const newInput = { ...input, assignmentRevision: 2, grade: 'good', attemptId: crypto.randomUUID() };
    expect((await submit(newInput)).status).toBe(200);
    expect(await state()).toMatchObject({ version: 2, reps: 1, lapses: 0, last_attempt_id: newInput.attemptId });
    const retained = await env.DB.prepare('SELECT task_json, answer_json, assessment FROM learner_practice_attempts WHERE id = ?1').bind(input.attemptId).first<{ task_json: string; answer_json: string; assessment: string }>();
    expect(JSON.parse(retained!.task_json).interaction.prompt).toBe(quizInteraction.prompt);
    expect(JSON.parse(retained!.answer_json)).toEqual(input.answer);
    expect(retained!.assessment).toBe('incorrect');
    expect(await (await asLearner(token, '/api/learner/practice')).json()).toEqual({ items: [] });
    // Revisit deliberately retrieves even an exercise not due yet.
    const selected = await (await asLearner(token, `/api/learner/practice?itemId=${encodeURIComponent(input.itemId)}`)).json() as { items: { assignmentRevision: number }[] };
    expect(selected.items[0]?.assignmentRevision).toBe(2);
    await publishHomework(cookie, sessionId, { homeworkRevision: 2, homework: [revisedQuiz, { id: 'reading', kind: 'reading', body: 'Unrelated new task.' }] });
    expect(await (await asLearner(token, '/api/learner/practice')).json()).toEqual({ items: [] });
    await publishHomework(cookie, sessionId, { homeworkRevision: 3, homework: [{ ...revisedQuiz, interaction: { ...revisedQuiz.interaction, prompt: 'Practise the revised question.' } }] });
    const fresh = await (await asLearner(token, '/api/learner/practice')).json() as { items: { assignmentRevision: number }[] };
    expect(fresh.items[0]?.assignmentRevision).toBe(4);
  });

  it('binds retry receipts to one learner and respects changed recipients for new attempts', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Language group');
    await asBrowser(cookie, `/api/tutoring/contexts/${contextId}`, { method: 'PATCH', body: JSON.stringify({ kind: 'group' }) });
    const mint = async (displayName: string) => (await (await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links`, { method: 'POST', body: JSON.stringify({ displayName }) })).json()) as { token: string; learnerId: string };
    const lea = await mint('Léa'); const noor = await mint('Noor');
    const sessionId = await createSession(cookie, contextId);
    await launch(cookie, sessionId);
    await publishHomework(cookie, sessionId);
    const input = { itemId: `${sessionId}:quiz-1`, grade: 'good', answer: { kind: 'choice', optionIds: ['a'] }, assignmentRevision: 1, attemptId: crypto.randomUUID() };
    const submit = (token: string, value = input) => asLearner(token, '/api/learner/practice', { method: 'POST', body: JSON.stringify(value) });
    expect((await submit(lea.token)).status).toBe(200);
    expect((await submit(noor.token)).status).toBe(409);
    await publishHomework(cookie, sessionId, { homeworkRevision: 1, homeworkAudience: { 'quiz-1': [noor.learnerId] } });
    expect((await submit(lea.token)).status).toBe(200);
    expect((await submit(lea.token, { ...input, attemptId: crypto.randomUUID(), assignmentRevision: 2 })).status).toBe(404);
    expect((await submit(noor.token, { ...input, attemptId: crypto.randomUUID(), assignmentRevision: 2 })).status).toBe(200);
    expect(await (await asLearner(lea.token, `/api/learner/practice?itemId=${encodeURIComponent(input.itemId)}`)).json()).toEqual({ items: [] });
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM learner_practice_attempts WHERE session_id = ?1').bind(sessionId).first<{ count: number }>();
    expect(count?.count).toBe(2);
  });

  it('checks assignment and practice versions at the write, after concurrent changes', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const sessionId = await createSession(cookie, contextId);
    await launch(cookie, sessionId);
    await publishHomework(cookie, sessionId);
    const token = await mintLink(cookie, contextId);
    const input = { itemId: `${sessionId}:quiz-1`, grade: 'good', answer: { kind: 'choice', optionIds: ['a'] }, assignmentRevision: 1, attemptId: crypto.randomUUID() };
    const request = () => new Request(`${BASE}/api/learner/practice`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': crypto.randomUUID() }, body: JSON.stringify(input) });
    const beforeWrite = (change: () => Promise<unknown>) => ({ ...env, DB: {
      prepare: env.DB.prepare.bind(env.DB),
      batch: async (statements: D1PreparedStatement[]) => { await change(); return env.DB.batch(statements); },
    } });
    const revised = await learnerPracticePost(request(), beforeWrite(() => env.DB.prepare('UPDATE session_records SET homework_revision = 2 WHERE session_id = ?1').bind(sessionId).run()) as never);
    expect(revised.status).toBe(409);
    expect(await env.DB.prepare('SELECT id FROM learner_practice_attempts WHERE id = ?1').bind(input.attemptId).first()).toBeNull();
    expect(await env.DB.prepare('SELECT item_id FROM learner_srs WHERE item_id = ?1').bind(input.itemId).first()).toBeNull();
    input.assignmentRevision = 2;
    const winningId = crypto.randomUUID();
    const raced = await learnerPracticePost(request(), beforeWrite(async () => {
      expect((await asLearner(token, '/api/learner/practice', { method: 'POST', body: JSON.stringify({ ...input, attemptId: winningId }) })).status).toBe(200);
    }) as never);
    expect(raced.status).toBe(409);
    expect(await env.DB.prepare('SELECT id FROM learner_practice_attempts WHERE id = ?1').bind(input.attemptId).first()).toBeNull();
    expect(await env.DB.prepare('SELECT version, reps, last_attempt_id FROM learner_srs WHERE item_id = ?1').bind(input.itemId).first()).toEqual({ version: 1, reps: 1, last_attempt_id: winningId });
  });

  it.each(['session', 'context'])('purges private attempts with their %s after browser confirmation', async (kind) => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const sessionId = await createSession(cookie, contextId);
    await launch(cookie, sessionId);
    await publishHomework(cookie, sessionId);
    const token = await mintLink(cookie, contextId);
    const input = { itemId: `${sessionId}:quiz-1`, grade: 'good', answer: { kind: 'choice', optionIds: ['a'] }, assignmentRevision: 1, attemptId: crypto.randomUUID() };
    expect((await asLearner(token, '/api/learner/practice', { method: 'POST', body: JSON.stringify(input) })).status).toBe(200);
    const path = kind === 'context' ? `/api/tutoring/contexts/${contextId}` : `/api/sessions/${sessionId}`;
    expect((await asBrowser(cookie, path, { method: 'DELETE' })).status).toBe(200);
    const intent = await asBrowser(cookie, `${path}/permanent-deletion`, { method: 'POST' });
    expect(intent.status).toBe(202);
    const { confirmationUrl } = await intent.json() as { confirmationUrl: string };
    expect((await asBrowser(cookie, new URL(confirmationUrl).pathname, { method: 'POST' })).status).toBe(200);
    expect(await env.DB.prepare('SELECT id FROM learner_practice_attempts WHERE id = ?1').bind(input.attemptId).first()).toBeNull();
    expect(await env.DB.prepare('SELECT item_id FROM learner_srs WHERE item_id = ?1').bind(input.itemId).first()).toBeNull();
  });

  it('lets the link holder write and rehearse, and never leaks the scheduler or tutor notes', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const other = await createContext(cookie, 'Noor');
    const sessionId = await createSession(cookie, contextId);
    const otherSession = await createSession(cookie, other);
    await launch(cookie, sessionId);
    await launch(cookie, otherSession);
    await publishHomework(cookie, sessionId);
    await publishHomework(cookie, otherSession, { nextNote: 'Not for Camille.' });

    const token = await mintLink(cookie, contextId);
    const otherToken = await mintLink(cookie, other);

    const practice = await asLearner(token, '/api/learner/practice');
    expect(practice.status).toBe(200);
    const pile = (await practice.json()) as { items: Array<{ itemId: string; interaction: { prompt: string } }> };
    expect(pile.items).toHaveLength(1);
    expect(pile.items[0]!.itemId).toBe(`${sessionId}:quiz-1`);
    expect(JSON.stringify(pile)).not.toMatch(/dueAt|interval|ease|reps|lapses|nextNote|SECRET/);

    const write = await asLearner(token, '/api/learner/writing', {
      method: 'PUT',
      body: JSON.stringify({ sessionId, taskId: 'write-1', assignmentRevision: 1, body: 'J\'ai raté le train six fois.' }),
    });
    expect(write.status).toBe(200);

    const stolen = await asLearner(otherToken, '/api/learner/writing', {
      method: 'PUT',
      body: JSON.stringify({ sessionId, taskId: 'write-1', assignmentRevision: 1, body: 'should not land' }),
    });
    expect(stolen.status).toBe(404);

    const grade = await asLearner(token, '/api/learner/practice', {
      method: 'POST',
      body: JSON.stringify({ itemId: `${sessionId}:quiz-1`, grade: 'again', answer: { kind: 'choice', optionIds: ['b'] }, assignmentRevision: 1, attemptId: crypto.randomUUID() }),
    });
    expect(grade.status).toBe(200);
    expect(JSON.stringify(await grade.json())).not.toMatch(/dueAt|ease|reps|lapses/);

    const sessions = await asLearner(token, '/api/learner/sessions');
    const raw = await sessions.text();
    expect(raw).not.toContain('SECRET-NEXT-PRIVATE');
    expect(raw).not.toContain('Start with the ones they missed.');
    expect(raw).not.toMatch(/"nextNote"/);
    const body = JSON.parse(raw) as {
      sessions: Array<{ record?: { homework: Array<{ kind: string; submitted?: string }> } }>;
    };
    const writing = body.sessions[0]?.record?.homework.find((task) => task.kind === 'writing');
    expect(writing?.submitted).toBe("J'ai raté le train six fois.");

    const returned = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/returned`);
    expect(returned.status).toBe(200);
    const pickup = (await returned.json()) as {
      nextNote: string;
      writing: Array<{ body: string }>;
      missed: Array<{ exercise: { interaction: { prompt: string } } }>;
    };
    expect(pickup.nextNote).toBe('Start with the ones they missed.');
    expect(pickup.writing[0]?.body).toBe("J'ai raté le train six fois.");
    expect(pickup.missed[0]?.exercise.interaction.prompt).toBe('Choose the correct sentence.');
    expect(JSON.stringify(pickup)).not.toMatch(/dueAt|ease|reps|lapses/);
  });
  it('replacement links preserve private writing, practice and the same live seat', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'French group');
    expect((await asBrowser(cookie, `/api/tutoring/contexts/${contextId}`, { method: 'PATCH', body: JSON.stringify({ kind: 'group' }) })).status).toBe(200);
    expect((await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links`, { method: 'POST', body: '{}' })).status).toBe(422);
    const sessionId = await createSession(cookie, contextId);
    const live = await launch(cookie, sessionId);
    await publishHomework(cookie, sessionId);
    const mint = async (input: Record<string, unknown>) => {
      const response = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links`, { method: 'POST', body: JSON.stringify(input) });
      expect(response.status).toBe(201);
      return await response.json() as { id: string; learnerId: string; token: string };
    };
    const first = await mint({ displayName: 'Léa' });
    const second = await mint({ displayName: 'Noor' });
    const joined = await joinWith({ code: live.code, contextLink: first.token });
    expect(joined.status).toBe(200);
    const originalSeat = (await joined.json()) as { participantId: string };
    expect((await asLearner(first.token, '/api/learner/writing', { method: 'PUT', body: JSON.stringify({ sessionId, taskId: 'write-1', assignmentRevision: 1, body: 'Mon travail privé.' }) })).status).toBe(200);
    expect((await asLearner(first.token, '/api/learner/practice', { method: 'POST', body: JSON.stringify({ itemId: `${sessionId}:quiz-1`, grade: 'good', answer: { kind: 'choice', optionIds: ['a'] }, assignmentRevision: 1, attemptId: crypto.randomUUID() }) })).status).toBe(200);
    const replacement = await mint({ learnerId: first.learnerId });
    expect(replacement.learnerId).toBe(first.learnerId);
    await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links/${first.id}`, { method: 'DELETE' });
    expect((await asLearner(first.token, '/api/learner/sessions')).status).toBe(401);
    const restored = await asLearner(replacement.token, '/api/learner/sessions');
    expect(await restored.text()).toContain('Mon travail privé.');
    expect(await (await asLearner(second.token, '/api/learner/sessions')).text()).not.toContain('Mon travail privé.');
    expect(await (await asLearner(replacement.token, '/api/learner/practice')).json()).toEqual({ items: [] });
    expect((await (await asLearner(second.token, '/api/learner/practice')).json() as { items: unknown[] }).items).toHaveLength(1);
    const rejoined = await joinWith({ code: live.code, contextLink: replacement.token });
    expect(rejoined.status).toBe(200);
    expect((await rejoined.json() as { participantId: string }).participantId).toBe(originalSeat.participantId);
    const otherContext = await createContext(cookie, 'Another group');
    expect((await asBrowser(cookie, `/api/tutoring/contexts/${otherContext}/links`, { method: 'POST', body: JSON.stringify({ learnerId: first.learnerId }) })).status).toBe(404);
    expect((await asLearner(replacement.token, `/api/tutoring/contexts/${contextId}/learners`)).status).toBe(401);
    const learners = await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/learners`);
    expect((await learners.json() as { learners: { id: string }[] }).learners.map((person) => person.id).sort()).toEqual([first.learnerId, second.learnerId].sort());
  });

  it('a person context keeps one identity when renamed and given another link', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Lea');
    const first = await mintLink(cookie, contextId);
    expect((await asBrowser(cookie, `/api/tutoring/contexts/${contextId}`, { method: 'PATCH', body: JSON.stringify({ displayName: 'Léa' }) })).status).toBe(200);
    const replacement = await mintLink(cookie, contextId);
    for (const token of [first, replacement]) {
      expect(await (await asLearner(token, '/api/learner/me')).json()).toMatchObject({ displayName: 'Léa' });
    }
    expect(await (await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/learners`)).json()).toEqual({ learners: [{ id: `person-${contextId}`, displayName: 'Léa' }] });
  });

  it('keeps responses immutable, drafts private, published feedback personal, and assignment revisions explicit', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Léa and Noor');
    const sessionId = await createSession(cookie, contextId);
    await launch(cookie, sessionId);
    await publishHomework(cookie, sessionId);
    const lea = await mintLink(cookie, contextId);
    const noor = (await (await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links`, { method: 'POST', body: JSON.stringify({ displayName: 'Noor' }) })).json() as { token: string }).token;
    const write = (submissionId: string, body: string, assignmentRevision = 1) => asLearner(lea, '/api/learner/writing', { method: 'PUT', body: JSON.stringify({ sessionId, taskId: 'write-1', submissionId, body, assignmentRevision }) });
    expect((await write('response-first', 'Je suis allé à Berlin.')).status).toBe(200);
    expect((await write('response-first', 'Je suis allé à Berlin.')).status).toBe(200);
    expect((await write('response-first', 'Overwrite the original')).status).toBe(409);
    const base = `/api/tutoring/contexts/${contextId}/work`;
    const feedback = (version: number, action: string, message: string) => asBrowser(cookie, `${base}/response-first/feedback`, { method: 'PUT', body: JSON.stringify({ version, action, feedback: { message, corrections: [{ original: 'allé', replacement: 'allée', explanation: 'Agree with the speaker.' }] } }) });
    expect((await feedback(0, 'save', 'PRIVATE DRAFT')).status).toBe(200);
    expect(await (await asLearner(lea, '/api/learner/feedback')).json()).toEqual({ feedback: [] });
    expect((await feedback(1, 'publish', 'Clear story. Check the agreement.')).status).toBe(200);
    const published = await (await asLearner(lea, '/api/learner/feedback')).text();
    expect(published).toContain('Clear story. Check the agreement.');
    expect(published).not.toContain('PRIVATE DRAFT');
    expect(await (await asLearner(noor, '/api/learner/feedback')).json()).toEqual({ feedback: [] });
    expect((await feedback(2, 'save', 'PRIVATE REVISION')).status).toBe(200);
    expect(await (await asLearner(lea, '/api/learner/feedback')).text()).toBe(published);
    expect((await feedback(2, 'publish', 'Stale editor')).status).toBe(409);
    expect((await asLearner(lea, `${base}/response-first`)).status).toBe(401);
    expect((await asLearner(noor, `${base}/response-first/feedback`, { method: 'PUT', body: '{}' })).status).toBe(401);
    expect((await write('response-second', 'Je suis allée à Berlin.')).status).toBe(200);
    const work = await (await asBrowser(cookie, base)).json() as { work: { id: string }[] };
    expect(work.work.map((item) => item.id)).toEqual(['response-second']);
    const detail = await (await asBrowser(cookie, `${base}/response-second`)).json() as { earlier: { id: string; body: string }[] };
    expect(detail.earlier).toMatchObject([{ id: 'response-first', body: 'Je suis allé à Berlin.' }]);
    const revised = { homework: [{ id: 'write-1', kind: 'writing', prompt: 'Write about your next journey.' }] };
    expect((await asBrowser(cookie, `/api/sessions/${sessionId}/record`, { method: 'PUT', body: JSON.stringify(revised) })).status).toBe(409);
    expect((await asBrowser(cookie, `/api/sessions/${sessionId}/record`, { method: 'PUT', body: JSON.stringify({ ...revised, homeworkRevision: 1 }) })).status).toBe(200);
    expect((await write('response-stale', 'From an outdated task')).status).toBe(409);
    expect((await write('response-current', 'Je vais visiter Genève.', 2)).status).toBe(200);
    const original = await (await asBrowser(cookie, `${base}/response-first`)).json() as { work: { task: { prompt: string } } };
    expect(original.work.task.prompt).toBe('Write six sentences.');
    expect(await (await asLearner(lea, '/api/learner/feedback')).text()).toBe(published);
  });
});

describe('individual assignments', () => {
  it('filters all learner reads and writes, preserves restrictions on omission, and versions audience changes', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Conversation group');
    const sessionId = await createSession(cookie, contextId);
    await launch(cookie, sessionId);
    const mint = async (displayName: string) => (await (await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links`, { method: 'POST', body: JSON.stringify({ displayName }) })).json()) as { token: string; learnerId: string };
    const lea = await mint('Léa'); const noor = await mint('Noor');
    const people = (await (await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/learners`)).json() as { learners: { id: string; displayName: string }[] }).learners;
    const leaId = people.find((person) => person.displayName === 'Léa')!.id;
    const noorId = people.find((person) => person.displayName === 'Noor')!.id;
    const tasks = [
      { id: 'shared', kind: 'reading', body: 'Shared reading.' },
      { id: 'write', kind: 'writing', prompt: 'Only Léa receives this prompt.' },
      { id: 'voice', kind: 'voice', prompt: 'Only Noor receives this prompt.' },
      { id: 'quiz', kind: 'quiz', interaction: { id: 'q', type: 'choice', prompt: 'Private practice for Léa.', options: [{ id: 'a', label: 'A', correct: true }, { id: 'b', label: 'B' }] } },
    ];
    const audience = { write: [leaId], voice: [noorId], quiz: [leaId] };
    const record = (extra: Record<string, unknown> = {}) => asBrowser(cookie, `/api/sessions/${sessionId}/record`, { method: 'PUT', body: JSON.stringify({ homework: tasks, ...extra }) });
    expect((await record({ homeworkAudience: { write: ['wrong-context-person'] } })).status).toBe(422);
    expect((await record({ homeworkAudience: { missing: [leaId] } })).status).toBe(422);
    expect((await record({ homeworkAudience: { write: [] } })).status).toBe(422);
    expect((await record({ homeworkAudience: audience })).status).toBe(200);
    const leaLessons = await (await asLearner(lea.token, '/api/learner/sessions')).json() as { sessions: { record: { homework: { id: string }[] } }[] };
    const noorLessons = await (await asLearner(noor.token, '/api/learner/sessions')).json() as typeof leaLessons;
    expect(leaLessons.sessions[0]!.record.homework.map((task) => task.id)).toEqual(['shared', 'write', 'quiz']);
    expect(noorLessons.sessions[0]!.record.homework.map((task) => task.id)).toEqual(['shared', 'voice']);
    expect(JSON.stringify(leaLessons)).not.toContain(noorId);
    expect(JSON.stringify(noorLessons)).not.toContain('Only Léa');
    expect(await (await asLearner(noor.token, '/api/learner/practice')).json()).toEqual({ items: [] });
    expect((await asLearner(noor.token, '/api/learner/practice', { method: 'POST', body: JSON.stringify({ itemId: `${sessionId}:quiz`, grade: 'good', answer: { kind: 'choice', optionIds: ['a'] }, assignmentRevision: 1, attemptId: crypto.randomUUID() }) })).status).toBe(404);
    const write = (token: string, revision = 1) => asLearner(token, '/api/learner/writing', { method: 'PUT', body: JSON.stringify({ sessionId, taskId: 'write', assignmentRevision: revision, body: 'Une réponse.' }) });
    expect((await write(noor.token)).status).toBe(404);
    expect((await write(lea.token)).status).toBe(200);
    const audio = encodeVoiceWav(new Float32Array(16_000));
    expect((await asLearner(lea.token, `/api/learner/voice?sessionId=${sessionId}&taskId=voice&assignmentRevision=1&submissionId=not-assigned-voice`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: audio as Uint8Array<ArrayBuffer> })).status).toBe(404);
    expect((await record({ notes: 'Private tutor update' })).status).toBe(200);
    const unchanged = await (await asBrowser(cookie, `/api/sessions/${sessionId}/record`)).json() as { record: { homeworkAudience: unknown; homeworkRevision: number } };
    expect(unchanged.record.homeworkAudience).toEqual(audience);
    expect(unchanged.record.homeworkRevision).toBe(1);
    expect((await record({ homeworkAudience: {} })).status).toBe(409);
    expect((await record({ homeworkAudience: {}, homeworkRevision: 1 })).status).toBe(200);
    expect((await write(noor.token)).status).toBe(409);
    expect((await write(noor.token, 2)).status).toBe(200);
    // Corrupt policies never broaden the read projection.
    await env.DB.prepare('UPDATE session_records SET homework_audience_json = ?1 WHERE session_id = ?2').bind('{invalid-json', sessionId).run();
    const closed = await (await asLearner(noor.token, '/api/learner/sessions')).json() as typeof leaLessons;
    expect(closed.sessions[0]!.record.homework).toEqual([]);
    expect((await write(noor.token, 2)).status).toBe(404);
  });
});

describe('private voice responses', () => {
  it('isolates playback, validates bytes, preserves immutable audio and publishes only bounded comments', async () => {
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const sessionId = await createSession(cookie, contextId);
    await launch(cookie, sessionId);
    const task = { id: 'voice', kind: 'voice', prompt: 'Parlez de votre voyage.' };
    expect((await asBrowser(cookie, `/api/sessions/${sessionId}/record`, { method: 'PUT', body: JSON.stringify({ homework: [task] }) })).status).toBe(200);
    const lea = await mintLink(cookie, contextId);
    const noor = (await (await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/links`, { method: 'POST', body: JSON.stringify({ displayName: 'Noor' }) })).json() as { token: string }).token;
    const bytes = encodeVoiceWav(new Float32Array(32_000).fill(0.25));
    const upload = (token = lea, id = 'voice-original', data = bytes, revision = 1, headers: Record<string, string> = {}) => asLearner(token,
      `/api/learner/voice?sessionId=${sessionId}&taskId=voice&submissionId=${id}&assignmentRevision=${revision}`,
      { method: 'POST', headers: { 'content-type': 'audio/wav', ...headers }, body: data as Uint8Array<ArrayBuffer> });
    expect((await upload(lea, 'invalid-audio', new Uint8Array([1, 2, 3]))).status).toBe(422);
    expect((await upload(lea, 'too-big-audio', bytes, 1, { 'content-length': String(VOICE_WAV_MAX_BYTES + 1) })).status).toBe(413);
    expect((await upload(lea, 'wrong-format', bytes, 1, { 'content-type': 'audio/mpeg' })).status).toBe(415);
    expect((await upload()).status).toBe(200);
    expect((await upload()).status).toBe(200);
    expect((await upload(noor)).status).toBe(409);
    expect((await upload(lea, 'voice-original', encodeVoiceWav(new Float32Array(32_000).fill(0.5)))).status).toBe(409);
    const url = '/api/learner/submissions/voice-original/audio';
    expect((await asLearner(noor, url)).status).toBe(404);
    expect((await asBrowser(cookie, url)).status).toBe(401);
    const audio = await asLearner(lea, url);
    expect(audio.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(bytes);
    const range = await asLearner(lea, url, { headers: { range: 'bytes=0-43' } });
    expect(range.status).toBe(206);
    expect(range.headers.get('content-range')).toBe(`bytes 0-43/${bytes.length}`);
    expect(new Uint8Array(await range.arrayBuffer())).toEqual(bytes.slice(0, 44));
    expect((await asLearner(lea, url, { headers: { range: 'bytes=9999999-' } })).status).toBe(416);
    const base = `/api/tutoring/contexts/${contextId}/work/voice-original`;
    expect((await asBrowser(cookie, `${base}/audio`)).status).toBe(200);
    expect((await asLearner(lea, `${base}/audio`)).status).toBe(401);
    const pat = await (await asBrowser(cookie, '/api/my/tokens', { method: 'POST', body: JSON.stringify({ name: 'Voice review' }) })).json() as { token: string };
    const peerAudio = await asLearner(pat.token, '/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'openroom_api', arguments: { method: 'GET', path: `${base}/audio` } } }) });
    const peer = await peerAudio.json() as { result: { content: { type: string; data?: string; mimeType?: string }[] } };
    const audioBlock = peer.result.content.find((item) => item.type === 'audio');
    expect(audioBlock?.mimeType).toBe('audio/wav');
    expect(Uint8Array.from(atob(audioBlock!.data!), (char) => char.charCodeAt(0))).toEqual(bytes);
    const save = (atMs: number, action = 'save', version = 0) => asBrowser(cookie, `${base}/feedback`, { method: 'PUT', body: JSON.stringify({ version, action, feedback: { message: '', corrections: [], audioComments: [{ atMs, comment: 'Liaison ici.' }] } }) });
    expect((await save(2001)).status).toBe(422);
    expect((await save(1500)).status).toBe(200);
    expect(await (await asLearner(lea, '/api/learner/feedback')).json()).toEqual({ feedback: [] });
    expect((await save(1500, 'publish', 1)).status).toBe(200);
    expect(await (await asLearner(lea, '/api/learner/feedback')).json()).toMatchObject({ feedback: [{ audio: { available: true, durationMs: 2000 }, feedback: { audioComments: [{ atMs: 1500, comment: 'Liaison ici.' }] } }] });
    expect(await (await asLearner(noor, '/api/learner/feedback')).json()).toEqual({ feedback: [] });
    expect(await (await asLearner(lea, '/api/learner/sessions')).json()).toMatchObject({ sessions: [{ record: { homework: [{ kind: 'voice', audio: { submissionId: 'voice-original', available: true } }] } }] });
    const record = await env.DB.prepare('SELECT object_key FROM learner_audio WHERE submission_id = ?1').bind('voice-original').first<{ object_key: string }>();
    expect((await asLearner(noor, url, { method: 'DELETE' })).status).toBe(404);
    expect((await asLearner(lea, url, { method: 'DELETE' })).status).toBe(200);
    expect(await (env as unknown as { MEDIA: R2Bucket }).MEDIA.get(record!.object_key)).not.toBeNull();
    expect((await asLearner(lea, url)).status).toBe(410);
    expect((await asLearner(noor, url, { method: 'PATCH' })).status).toBe(404);
    expect((await asLearner(lea, url, { method: 'PATCH' })).status).toBe(200);
    expect((await asLearner(lea, url)).status).toBe(200);
    expect((await asLearner(lea, url, { method: 'DELETE' })).status).toBe(200);
    expect((await upload()).status).toBe(410);
    expect(await (await asLearner(lea, '/api/learner/feedback')).json()).toMatchObject({ feedback: [{ audio: { available: false }, feedback: { audioComments: [{ comment: 'Liaison ici.' }] } }] });
    expect((await asBrowser(cookie, `/api/sessions/${sessionId}/record`, { method: 'PUT', body: JSON.stringify({ homework: [{ ...task, prompt: 'Un autre voyage.' }], homeworkRevision: 1 }) })).status).toBe(200);
    expect((await upload(lea, 'voice-revised')).status).toBe(409);
    expect((await upload(lea, 'voice-revised', bytes, 2)).status).toBe(200);
    expect(await (await asBrowser(cookie, base)).json()).toMatchObject({ work: { task: { prompt: task.prompt } } });
    const expired = await env.DB.prepare('SELECT object_key FROM learner_audio WHERE submission_id = ?1').bind('voice-revised').first<{ object_key: string }>();
    expect(await expireLearnerAudio(env as never, Date.now() + 91 * 86_400_000)).toBeGreaterThan(0);
    expect(await (env as unknown as { MEDIA: R2Bucket }).MEDIA.get(expired!.object_key)).toBeNull();
    expect((await asLearner(lea, '/api/learner/submissions/voice-revised/audio')).status).toBe(410);
    expect((await upload(lea, 'voice-purged', bytes, 2)).status).toBe(200);
    const purged = await env.DB.prepare('SELECT object_key FROM learner_audio WHERE submission_id = ?1').bind('voice-purged').first<{ object_key: string }>();
    await purgeLearnerAudio(env as never, 'context_id', contextId);
    expect(await (env as unknown as { MEDIA: R2Bucket }).MEDIA.get(purged!.object_key)).toBeNull();
    expect(await env.DB.prepare('SELECT submission_id FROM learner_audio WHERE submission_id = ?1').bind('voice-purged').first()).toBeNull();
    for (let i = 0; i < VOICE_MAX_RECORDINGS_PER_TASK; i++) expect((await upload(lea, `voice-budget-${i}`, bytes, 2)).status).toBe(200);
    expect((await upload(lea, 'voice-over-budget', bytes, 2)).status).toBe(429);
    expect(await env.DB.prepare('SELECT id FROM learner_submissions WHERE id = ?1').bind('voice-over-budget').first()).toBeNull();
    expect((await asBrowser(cookie, `/api/tutoring/contexts/${contextId}/work/voice-budget-0/audio`, { method: 'DELETE' })).status).toBe(200);
    expect((await upload(lea, 'voice-after-removal', bytes, 2)).status).toBe(429);
    await env.DB.prepare('UPDATE learner_audio SET removed_at = ?1 WHERE submission_id = ?2').bind(Date.now() - 8 * 86_400_000, 'voice-budget-0').run();
    expect((await asLearner(lea, '/api/learner/submissions/voice-budget-0/audio', { method: 'PATCH' })).status).toBe(410);
    expect(await expireLearnerAudio(env as never)).toBe(1);
    expect((await upload(lea, 'voice-after-removal', bytes, 2)).status).toBe(200);
  });
});

/**
 * The learner plane is the only route family with no cookie and no session, so
 * it carries its own per-client budget. These tests are about cost control and
 * about the 429 never becoming the oracle the single 401 exists to deny — they
 * are not brute-force tests, and the limit is not a second factor.
 */
describe('learner plane throttle', () => {
  /** Each test gets its own client bucket; the stored key is a salted hash. */
  function client(): string {
    return `203.0.113.9-${crypto.randomUUID()}`;
  }

  /** The `learner_auth_attempts` key this client would be filed under. */
  function keyFor(ip: string): Promise<string> {
    return learnerClientKey(
      new Request(BASE, { headers: { 'cf-connecting-ip': ip } }),
      env as never,
    );
  }

  function asLearnerFrom(ip: string, token: string, path: string): Promise<Response> {
    return worker.fetch(
      new Request(`${BASE}${path}`, {
        headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': ip },
      }),
      env as never,
    );
  }

  const garbage = `orlnk_${'a'.repeat(22)}_${'b'.repeat(43)}`;

  it('cuts a client off after enough failures, and the 429 tells it nothing', async () => {
    const ip = client();
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const good = await mintLink(cookie, contextId);

    for (let i = 0; i < LEARNER_AUTH_FAILURE_LIMIT; i += 1) {
      const response = await asLearnerFrom(ip, garbage, '/api/learner/me');
      expect(response.status, `attempt ${i}`).toBe(401);
    }

    const limited = await asLearnerFrom(ip, garbage, '/api/learner/me');
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: 'learner-rate-limited' });

    // No oracle: the throttle fires before the credential is examined, so a
    // *valid* link from the same exhausted client gets the identical answer.
    // Nothing about which token was real leaks through the status code.
    const withGoodToken = await asLearnerFrom(ip, good, '/api/learner/me');
    expect(withGoodToken.status).toBe(429);
    expect(await withGoodToken.json()).toMatchObject({ error: 'learner-rate-limited' });

    // And it covers every learner route, not just the one that was hammered.
    expect((await asLearnerFrom(ip, good, '/api/learner/sessions')).status).toBe(429);
  });

  it('lets a valid link work indefinitely without spending budget', async () => {
    const ip = client();
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const token = await mintLink(cookie, contextId);

    for (let i = 0; i < LEARNER_AUTH_FAILURE_LIMIT * 2; i += 1) {
      expect((await asLearnerFrom(ip, token, '/api/learner/me')).status, `call ${i}`).toBe(200);
    }

    // A succeeding client leaves no bookkeeping behind at all — the success
    // path must not turn into a write per request.
    const row = await env.DB.prepare(
      'SELECT failures FROM learner_auth_attempts WHERE client_hash = ?1',
    )
      .bind(await keyFor(ip))
      .first<{ failures: number }>();
    expect(row).toBeNull();
  });

  it('forgets earlier failures once the client authenticates', async () => {
    const ip = client();
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const token = await mintLink(cookie, contextId);

    for (let i = 0; i < LEARNER_AUTH_FAILURE_LIMIT - 1; i += 1) {
      expect((await asLearnerFrom(ip, garbage, '/api/learner/me')).status).toBe(401);
    }
    expect((await asLearnerFrom(ip, token, '/api/learner/me')).status).toBe(200);

    // Budget is back to full: another near-limit run of failures still 401s.
    for (let i = 0; i < LEARNER_AUTH_FAILURE_LIMIT - 1; i += 1) {
      expect((await asLearnerFrom(ip, garbage, '/api/learner/me')).status, `retry ${i}`).toBe(401);
    }
    expect((await asLearnerFrom(ip, token, '/api/learner/me')).status).toBe(200);
  });

  it('reopens the budget when the window has passed', async () => {
    const ip = client();
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const token = await mintLink(cookie, contextId);

    for (let i = 0; i < LEARNER_AUTH_FAILURE_LIMIT; i += 1) {
      await asLearnerFrom(ip, garbage, '/api/learner/me');
    }
    expect((await asLearnerFrom(ip, token, '/api/learner/me')).status).toBe(429);

    // Age the window instead of sleeping a minute in a test.
    await env.DB.prepare(
      'UPDATE learner_auth_attempts SET window_start = window_start - ?1',
    )
      .bind(LEARNER_AUTH_WINDOW_MS + 1000)
      .run();

    expect((await asLearnerFrom(ip, token, '/api/learner/me')).status).toBe(200);
  });

  it('budgets each client separately', async () => {
    const noisy = client();
    const quiet = client();
    const { cookie } = await seedSession();
    const contextId = await createContext(cookie, 'Camille');
    const token = await mintLink(cookie, contextId);

    for (let i = 0; i < LEARNER_AUTH_FAILURE_LIMIT + 1; i += 1) {
      await asLearnerFrom(noisy, garbage, '/api/learner/me');
    }
    expect((await asLearnerFrom(noisy, token, '/api/learner/me')).status).toBe(429);
    expect((await asLearnerFrom(quiet, token, '/api/learner/me')).status).toBe(200);
  });

  it('never stores the caller IP', async () => {
    const ip = client();
    await asLearnerFrom(ip, garbage, '/api/learner/me');

    const row = await env.DB.prepare(
      'SELECT failures FROM learner_auth_attempts WHERE client_hash = ?1',
    )
      .bind(await keyFor(ip))
      .first<{ failures: number }>();
    expect(row?.failures).toBe(1);

    // Nothing in the table resembles an address; the key is a salted digest.
    const dump = await env.DB.prepare(
      "SELECT group_concat(client_hash, '|') AS all_keys FROM learner_auth_attempts",
    ).first<{ all_keys: string }>();
    expect(dump?.all_keys).not.toContain(ip);
    expect(dump?.all_keys).not.toContain('203.0.113');
  });
});
