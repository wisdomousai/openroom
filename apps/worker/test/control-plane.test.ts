/**
 * Control plane: sessions, /api/me, session creation via
 * cookie, the session quota and cross-device recovery.
 *
 * Sessions are seeded by inserting rows straight into D1 (the OAuth dance
 * itself is covered in oauth.test.ts), then exercised over HTTP.
 */
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import { signCookieValue } from '../src/tokens.js';
import worker from '../src/index.js';
import { BASE, call, SMOKE_OUTLINE } from './helpers.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

interface Signed {
  userId: string;
  sessionId: string;
  cookie: string;
}

let counter = 0;

async function seedSession(opts: { expiresAt?: number } = {}): Promise<Signed> {
  counter += 1;
  const userId = `user-${counter}-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, created_at, entitlements)
     VALUES (?1, ?2, ?3, ?4, ?5, '{}')`,
  )
    .bind(userId, `sub-${userId}`, `${userId}@example.com`, 'Test Host', now)
    .run();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(sessionId, userId, now, opts.expiresAt ?? now + 30 * 24 * 60 * 60 * 1000)
    .run();
  const signed = await signCookieValue(TOKEN_SECRET, sessionId);
  return { userId, sessionId, cookie: `${SESSION_COOKIE}=${encodeURIComponent(signed)}` };
}

function asUser(
  session: Signed,
  path: string,
  init: RequestInit & { csrf?: boolean } = {},
): Promise<Response> {
  const { csrf, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('cookie', session.cookie);
  headers.set('content-type', 'application/json');
  if (csrf !== false) headers.set(CSRF_HEADER, '1');
  return worker.fetch(new Request(`${BASE}${path}`, { ...rest, headers }), env as never);
}

describe('sessions and /api/me', () => {
  it('returns null user without a cookie and the user with one', async () => {
    const anon = await call('/api/me');
    expect(anon.status).toBe(200);
    expect(await anon.json()).toEqual({ user: null });

    const session = await seedSession();
    const res = await asUser(session, '/api/me', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string; email: string; name: string; entitlements: Record<string, boolean> };
    };
    expect(body.user.id).toBe(session.userId);
    expect(body.user.email).toBe(`${session.userId}@example.com`);
    expect(body.user.name).toBe('Test Host');
    expect(body.user.entitlements).toEqual({
      keep: false,
      roster: false,
      rawExport: false,
      branding: false,
      team: false,
      continuity: false,
      connectors: false,
    });
  });

  it('treats a tampered cookie and an expired session as signed out', async () => {
    const tampered = await worker.fetch(
      new Request(`${BASE}/api/me`, { headers: { cookie: `${SESSION_COOKIE}=abc.def` } }),
      env as never,
    );
    expect(tampered.status).toBe(200);
    expect(await tampered.json()).toEqual({ user: null });

    const expired = await seedSession({ expiresAt: Date.now() - 1000 });
    const res = await asUser(expired, '/api/me', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null });
  });

  it('logout deletes the session row, clears the cookie and requires the csrf header', async () => {
    const session = await seedSession();

    const noCsrf = await asUser(session, '/api/auth/logout', { method: 'POST', csrf: false });
    expect(noCsrf.status).toBe(403);
    expect((await noCsrf.json() as { error: string }).error).toBe('csrf-required');

    const res = await asUser(session, '/api/auth/logout', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');

    const after = await asUser(session, '/api/me', { method: 'GET' });
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({ user: null });

    const row = await env.DB.prepare('SELECT id FROM auth_sessions WHERE id = ?1')
      .bind(session.sessionId)
      .first();
    expect(row).toBeNull();
  });
});


describe('session creation and recovery', () => {
  it('creates a session with a session cookie and no admin key, and records the owner', async () => {
    const session = await seedSession();
    const res = await asUser(session, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ outline: SMOKE_OUTLINE }),
    });
    expect(res.status).toBe(201);
    const live = (await res.json()) as { code: string; sessionCode: string; hostToken: string };

    const row = await env.DB.prepare('SELECT user_id, title, ended FROM live_sessions WHERE code = ?1')
      .bind(live.code)
      .first<{ user_id: string; title: string; ended: number }>();
    expect(row?.user_id).toBe(session.userId);
    expect(row?.title).toBe('Helper outline');
    expect(row?.ended).toBe(0);
  });

  it('requires the csrf header on cookie-authenticated session creation', async () => {
    const session = await seedSession();
    const res = await asUser(session, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ outline: SMOKE_OUTLINE }),
      csrf: false,
    });
    expect(res.status).toBe(403);
  });

  it('keeps the admin-key override working and leaves the session unowned', async () => {
    const res = await call('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-openroom-admin': 'test-admin' },
      body: JSON.stringify({ outline: SMOKE_OUTLINE }),
    });
    expect(res.status).toBe(201);
    const { code } = (await res.json()) as { code: string };
    const row = await env.DB.prepare('SELECT code FROM live_sessions WHERE code = ?1').bind(code).first();
    expect(row).toBeNull();
  });

  it('429s the 21st session in a rolling 24h window', async () => {
    const session = await seedSession();
    const now = Date.now();
    for (let i = 0; i < 20; i += 1) {
      await env.DB.prepare(
        'INSERT INTO live_sessions (code, user_id, title, created_at, ended) VALUES (?1, ?2, ?3, ?4, 0)',
      )
        .bind(`SEED${i}${session.userId.slice(0, 6)}`, session.userId, 'seeded', now - 1000)
        .run();
    }
    const blocked = await asUser(session, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ outline: SMOKE_OUTLINE }),
    });
    expect(blocked.status).toBe(429);
    expect((await blocked.json() as { error: string }).error).toBe('session-quota');

    // sessions older than the window do not count
    await env.DB.prepare('UPDATE live_sessions SET created_at = ?1 WHERE user_id = ?2')
      .bind(now - 25 * 60 * 60 * 1000, session.userId)
      .run();
    const allowed = await asUser(session, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ outline: SMOKE_OUTLINE }),
    });
    expect(allowed.status).toBe(201);
  });

  it('/api/my/sessions mints usable host tokens for recent sessions (LIVE-11)', async () => {
    const session = await seedSession();
    const created = await asUser(session, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ outline: SMOKE_OUTLINE }),
    });
    const live = (await created.json()) as { code: string; sessionCode: string };

    const list = await asUser(session, '/api/my/sessions', { method: 'GET' });
    expect(list.status).toBe(200);
    const { sessions } = (await list.json()) as {
      sessions: {
        code: string;
        title: string;
        recoverable: boolean;
        hostToken?: string;
        stageToken?: string;
      }[];
    };
    const entry = sessions.find((r) => r.code === live.code);
    expect(entry?.recoverable).toBe(true);
    expect(entry?.title).toBe('Helper outline');
    expect(typeof entry?.hostToken).toBe('string');

    // the freshly minted token really drives the session
    const command = await call(`/api/sessions/${live.sessionCode}/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${entry?.hostToken as string}`,
      },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        command: { command: 'session.start' },
      }),
    });
    expect(command.status).toBe(200);

    const state = await call(`/api/sessions/${live.sessionCode}/state?role=stage`, {
      headers: { authorization: `Bearer ${entry?.stageToken as string}` },
    });
    expect(state.status).toBe(200);
  });

  it('marks sessions older than the recovery window as non-recoverable and mints nothing', async () => {
    const session = await seedSession();
    await env.DB.prepare(
      'INSERT INTO live_sessions (code, user_id, title, created_at, ended) VALUES (?1, ?2, ?3, ?4, ?5)',
    )
      .bind('OLDCODE1', session.userId, 'Yesterday', Date.now() - 13 * 60 * 60 * 1000, 0)
      .run();
    await env.DB.prepare(
      'INSERT INTO live_sessions (code, user_id, title, created_at, ended) VALUES (?1, ?2, ?3, ?4, ?5)',
    )
      .bind('ENDEDRM1', session.userId, 'Finished', Date.now(), 1)
      .run();

    const { sessions } = (await (
      await asUser(session, '/api/my/sessions', { method: 'GET' })
    ).json()) as { sessions: { code: string; recoverable: boolean; hostToken?: string }[] };

    for (const code of ['OLDCODE1', 'ENDEDRM1']) {
      const entry = sessions.find((r) => r.code === code);
      expect(entry?.recoverable).toBe(false);
      expect(entry?.hostToken).toBeUndefined();
    }
  });
});

/**
 * Preferences are the one user-writable JSON blob in the control plane, so the
 * limits are the contract: junk in `pins` must be dropped rather than stored or
 * rejected wholesale, and the blob must not become a place to stash documents.
 */
describe('user prefs', () => {
  it('sanitises pins, keeps unknown keys, and caps the blob', async () => {
    const session = await seedSession();

    const empty = (await (await asUser(session, '/api/my/prefs')).json()) as { prefs: unknown };
    expect(empty.prefs).toEqual({});

    const written = await asUser(session, '/api/my/prefs', {
      method: 'PUT',
      body: JSON.stringify({
        prefs: {
          pins: [
            { kind: 'context', id: 'ctx-1', label: '  Léa Marchand  ' },
            { kind: 'context', id: 'ctx-1', label: 'duplicate' },
            { kind: 'not-a-kind', id: 'x', label: 'bogus' },
            { kind: 'session', id: 'session-1' },
            'nonsense',
            ...Array.from({ length: 20 }, (_, i) => ({ kind: 'session', id: `r${i}`, label: `Session ${i}` })),
          ],
          theme: 'chalkboard',
        },
      }),
    });
    expect(written.status).toBe(200);
    const stored = (await written.json()) as {
      prefs: { pins: { kind: string; id: string; label: string }[]; theme: string };
    };
    // Duplicates collapse, unknown kinds and label-less rows are dropped, the
    // rest is capped — and a key this build knows nothing about survives.
    expect(stored.prefs.pins).toHaveLength(12);
    expect(stored.prefs.pins[0]).toEqual({ kind: 'context', id: 'ctx-1', label: 'Léa Marchand' });
    expect(stored.prefs.pins.filter((p) => p.id === 'ctx-1')).toHaveLength(1);
    expect(stored.prefs.pins.some((p) => p.kind === 'not-a-kind')).toBe(false);
    expect(stored.prefs.theme).toBe('chalkboard');

    const readBack = (await (await asUser(session, '/api/my/prefs')).json()) as {
      prefs: { pins: unknown[] };
    };
    expect(readBack.prefs.pins).toHaveLength(12);

    const tooBig = await asUser(session, '/api/my/prefs', {
      method: 'PUT',
      body: JSON.stringify({ prefs: { note: 'x'.repeat(9000) } }),
    });
    expect(tooBig.status).toBe(413);

    const notAnObject = await asUser(session, '/api/my/prefs', {
      method: 'PUT',
      body: JSON.stringify({ prefs: ['pins'] }),
    });
    expect(notAnObject.status).toBe(400);

    const noCsrf = await asUser(session, '/api/my/prefs', {
      method: 'PUT',
      csrf: false,
      body: JSON.stringify({ prefs: {} }),
    });
    expect(noCsrf.status).toBe(403);
  });
});
