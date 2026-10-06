/**
 * Dev-mode demo accounts: static seed + username/password login that mints a
 * real or_session cookie so the control plane (decks, sessions, quota) works
 * without Google OAuth.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import {
  CSRF_HEADER,
  DEMO_ACCOUNTS,
  SESSION_COOKIE,
  type ControlEnv,
  authStatusRoute,
  demoLoginRoute,
} from '../src/auth.js';
import { BASE, call } from './helpers.js';

function withDemo(on: boolean): ControlEnv {
  const base = env as unknown as ControlEnv;
  return { ...base, DEMO_AUTH: on ? '1' : '0' };
}

describe('GET /api/auth/status', () => {
  it('reports demo accounts when DEMO_AUTH is enabled', async () => {
    const res = await call('/api/auth/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      google: boolean;
      demo: boolean;
      accounts: Array<{ username: string; email: string; name: string }>;
    };
    expect(body.demo).toBe(true);
    expect(body.google).toBe(false);
    expect(body.accounts.map((a) => a.username)).toEqual(
      DEMO_ACCOUNTS.map((a) => a.username),
    );
    // Passwords must never leave the server.
    for (const a of body.accounts) {
      expect(a).not.toHaveProperty('password');
    }
  });

  it('hides accounts when demo auth is off', () => {
    const res = authStatusRoute(new Request(`${BASE}/api/auth/status`), withDemo(false));
    expect(res.status).toBe(200);
    return res.json().then((raw) => {
      const body = raw as { demo: boolean; accounts: unknown[] };
      expect(body.demo).toBe(false);
      expect(body.accounts).toEqual([]);
    });
  });
});

describe('POST /api/auth/demo/login', () => {
  it('501s when DEMO_AUTH is disabled', async () => {
    const res = await demoLoginRoute(
      new Request(`${BASE}/api/auth/demo/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'demo' }),
      }),
      withDemo(false),
    );
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'demo-auth-disabled' });
  });

  it('rejects bad credentials', async () => {
    const res = await call('/api/auth/demo/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'wrong' }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid-credentials' });
  });

  it('omits Secure on HTTP so a LAN origin can store the session cookie', async () => {
    const res = await demoLoginRoute(
      new Request('http://192.168.1.20:8787/api/auth/demo/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'demo' }),
      }),
      withDemo(true),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.getSetCookie().find((item) => item.startsWith(`${SESSION_COOKIE}=`)) ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).not.toContain('Secure');
  });

  it('rejects unknown usernames', async () => {
    const res = await call('/api/auth/demo/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'nobody', password: 'demo' }),
    });
    expect(res.status).toBe(401);
  });

  it('mints a session cookie and unlocks /api/me + control plane', async () => {
    const res = await call('/api/auth/demo/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'demo' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string; email: string; name: string } };
    expect(body.user.email).toBe('alice@openroom.dev');
    expect(body.user.name).toBe('Alice Teacher');

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    const pair = setCookie.split(';')[0] as string;

    const me = await call('/api/me', { headers: { cookie: pair } });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { user: { email: string } };
    expect(meBody.user.email).toBe('alice@openroom.dev');

    // Control plane accepts the demo session (create a deck; no context needed).
    await call('/api/my/spaces', { headers: { cookie: pair } });
    const deckRes = await call('/api/decks', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: pair,
        [CSRF_HEADER]: '1',
      },
      body: JSON.stringify({ title: 'Demo template' }),
    });
    expect(deckRes.status).toBe(201);
  });

  it('reuses the same user row on a second login (stable identity)', async () => {
    const login = async () =>
      call('/api/auth/demo/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'bob', password: 'demo' }),
      });

    const first = await login();
    const firstBody = (await first.json()) as { user: { id: string } };
    const second = await login();
    const secondBody = (await second.json()) as { user: { id: string } };
    expect(secondBody.user.id).toBe(firstBody.user.id);

    const count = await (env as unknown as ControlEnv).DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE google_sub = 'demo:bob'",
    ).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('accepts username case-insensitively', async () => {
    const res = await call('/api/auth/demo/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Alice', password: 'demo' }),
    });
    expect(res.status).toBe(200);
  });
});
