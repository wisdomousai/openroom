/**
 * Google OIDC start + callback.
 *
 * The token exchange is injected, so nothing here ever reaches the network:
 * we drive the callback with a fake exchanger returning a hand-built id_token.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import {
  desktopHandoffUrl,
  desktopRedeemRoute,
  googleCallbackRoute,
  googleStartRoute,
  OAUTH_COOKIE,
  SESSION_COOKIE,
  type ControlEnv,
  type TokenExchanger,
} from '../src/auth.js';
import worker from '../src/index.js';
import { BASE, call } from './helpers.js';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

function configured(): ControlEnv {
  return { ...(env as unknown as ControlEnv), GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'shh' };
}

function b64url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fakeIdToken(claims: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: 'RS256' }))}.${b64url(JSON.stringify(claims))}.signature-not-checked`;
}

function claimsFor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: 'google-sub-1',
    email: 'host@example.com',
    name: 'Host One',
    exp: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  };
}

function exchanger(idToken: string | null): TokenExchanger {
  return async () => (idToken === null ? { ok: false } : { ok: true, idToken });
}

/** Run the start route and hand back the state cookie + state parameter. */
async function begin(
  returnTo?: string,
  desktop = false,
): Promise<{ cookie: string; state: string; challenge: string }> {
  const url = new URL(`${BASE}/api/auth/google`);
  if (returnTo !== undefined) url.searchParams.set('returnTo', returnTo);
  if (desktop) url.searchParams.set('desktop', '1');
  const res = await googleStartRoute(new Request(url), configured());
  expect(res.status).toBe(302);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const value = /or_oauth=([^;]+)/.exec(setCookie)?.[1];
  expect(value).toBeTruthy();
  const location = new URL(res.headers.get('location') ?? '');
  return {
    cookie: `${OAUTH_COOKIE}=${value as string}`,
    state: location.searchParams.get('state') as string,
    challenge: location.searchParams.get('code_challenge') as string,
  };
}

function callbackRequest(cookie: string, params: Record<string, string>): Request {
  const url = new URL(`${BASE}/api/auth/google/callback`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString(), { headers: { cookie } });
}

describe('google oidc', () => {
  it('501s when GOOGLE_CLIENT_ID is not configured', async () => {
    const res = await call('/api/auth/google');
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'auth-not-configured' });

    const cb = await call('/api/auth/google/callback?code=x&state=y');
    expect(cb.status).toBe(501);
  });

  it('redirects to Google with PKCE + state and an HttpOnly state cookie', async () => {
    const res = await googleStartRoute(new Request(`${BASE}/api/auth/google`), configured());
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') as string);
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('scope')).toBe('openid email profile');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')?.length).toBeGreaterThan(20);
    expect(location.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/google/callback`);

    const setCookie = res.headers.get('set-cookie') as string;
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=600');
  });

  it('completes the callback: upserts the user, sets a session cookie, /api/me works', async () => {
    const { cookie, state } = await begin();
    const res = await googleCallbackRoute(
      callbackRequest(cookie, { code: 'auth-code', state }),
      configured(),
      exchanger(fakeIdToken(claimsFor())),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/host/');

    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`)) as string;
    expect(session).toContain('HttpOnly');
    expect(session).toContain('Secure');
    expect(session).toContain('SameSite=Lax');
    expect(cookies.some((c) => c.startsWith(`${OAUTH_COOKIE}=`) && c.includes('Max-Age=0'))).toBe(true);

    const sessionPair = session.split(';')[0] as string;
    const me = await worker.fetch(
      new Request(`${BASE}/api/me`, { headers: { cookie: sessionPair } }),
      env as never,
    );
    expect(me.status).toBe(200);
    const body = (await me.json()) as { user: { email: string; name: string } };
    expect(body.user.email).toBe('host@example.com');
    expect(body.user.name).toBe('Host One');

    // second login with the same google_sub reuses the user row
    const again = await begin();
    const res2 = await googleCallbackRoute(
      callbackRequest(again.cookie, { code: 'auth-code-2', state: again.state }),
      configured(),
      exchanger(fakeIdToken(claimsFor({ name: 'Renamed' }))),
    );
    expect(res2.status).toBe(302);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE google_sub = ?1')
      .bind('google-sub-1')
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('returns to a signed browser-only deletion confirmation path after login', async () => {
    const returnTo = '/confirm-deletion/abc_123-XYZ';
    const { cookie, state } = await begin(returnTo);
    const response = await googleCallbackRoute(
      callbackRequest(cookie, { code: 'auth-code', state }),
      configured(),
      exchanger(fakeIdToken(claimsFor({ sub: `return-${crypto.randomUUID()}` }))),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(returnTo);

    const external = await begin('https://evil.example/steal');
    const externalResponse = await googleCallbackRoute(
      callbackRequest(external.cookie, { code: 'auth-code', state: external.state }),
      configured(),
      exchanger(fakeIdToken(claimsFor({ sub: `safe-${crypto.randomUUID()}` }))),
    );
    expect(externalResponse.headers.get('location')).toBe('/host/');
  });

  it('returns to the MCP consent URL after Google login', async () => {
    const returnTo =
      '/api/mcp/authorize?response_type=code&client_id=x&redirect_uri=http%3A%2F%2F127.0.0.1%3A9%2Fcallback';
    const { cookie, state } = await begin(returnTo);
    const response = await googleCallbackRoute(
      callbackRequest(cookie, { code: 'auth-code', state }),
      configured(),
      exchanger(fakeIdToken(claimsFor({ sub: `mcp-${crypto.randomUUID()}` }))),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(returnTo);

    const hostTrap = await begin('/host/');
    const hostResponse = await googleCallbackRoute(
      callbackRequest(hostTrap.cookie, { code: 'auth-code', state: hostTrap.state }),
      configured(),
      exchanger(fakeIdToken(claimsFor({ sub: `host-${crypto.randomUUID()}` }))),
    );
    expect(hostResponse.headers.get('location')).toBe('/host/');
  });

  it('rejects a mismatched, missing or expired state', async () => {
    const { cookie, state } = await begin();

    const mismatch = await googleCallbackRoute(
      callbackRequest(cookie, { code: 'c', state: `${state}x` }),
      configured(),
      exchanger(fakeIdToken(claimsFor())),
    );
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json() as { error: string }).error).toBe('state-mismatch');

    const noCookie = await googleCallbackRoute(
      new Request(`${BASE}/api/auth/google/callback?code=c&state=${state}`),
      configured(),
      exchanger(fakeIdToken(claimsFor())),
    );
    expect(noCookie.status).toBe(400);

    const tampered = await googleCallbackRoute(
      callbackRequest(`${OAUTH_COOKIE}=forged.value`, { code: 'c', state }),
      configured(),
      exchanger(fakeIdToken(claimsFor())),
    );
    expect(tampered.status).toBe(400);

    const expired = await googleCallbackRoute(
      callbackRequest(cookie, { code: 'c', state }),
      configured(),
      exchanger(fakeIdToken(claimsFor())),
      Date.now() + 11 * 60 * 1000,
    );
    expect(expired.status).toBe(400);
    expect((await expired.json() as { error: string }).error).toBe('state-expired');
  });

  it('rejects id_tokens with the wrong issuer, audience or an expired exp', async () => {
    for (const [overrides, expected] of [
      [{ iss: 'https://evil.example' }, 'bad-issuer'],
      [{ aud: 'someone-elses-client' }, 'bad-audience'],
      [{ exp: Math.floor(Date.now() / 1000) - 5 }, 'id-token-expired'],
    ] as [Record<string, unknown>, string][]) {
      const { cookie, state } = await begin();
      const res = await googleCallbackRoute(
        callbackRequest(cookie, { code: 'c', state }),
        configured(),
        exchanger(fakeIdToken(claimsFor(overrides))),
      );
      expect(res.status).toBe(502);
      expect((await res.json() as { error: string }).error).toBe(expected);
    }
  });

  it('502s when the token exchange fails', async () => {
    const { cookie, state } = await begin();
    const res = await googleCallbackRoute(
      callbackRequest(cookie, { code: 'c', state }),
      configured(),
      exchanger(null),
    );
    expect(res.status).toBe(502);
  });

  it('hands a desktop start back through openroom:// instead of /host/', async () => {
    const { cookie, state } = await begin(undefined, true);
    const res = await googleCallbackRoute(
      callbackRequest(cookie, { code: 'auth-code', state }),
      configured(),
      exchanger(fakeIdToken(claimsFor({ sub: `desk-${crypto.randomUUID()}` }))),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    const ticket = /ticket=([^"&]+)/.exec(html)?.[1];
    expect(ticket).toBeTruthy();
    expect(html).toContain(desktopHandoffUrl(ticket as string));

    const redeem = await desktopRedeemRoute(
      new Request(`${BASE}/api/auth/desktop/redeem`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticket }),
      }),
      configured(),
    );
    expect(redeem.status).toBe(200);
    const cookies = redeem.headers.getSetCookie();
    const session = cookies.find((item) => item.startsWith(`${SESSION_COOKIE}=`)) as string;
    expect(session).toContain('HttpOnly');
    const sessionPair = session.split(';')[0] as string;

    const me = await worker.fetch(
      new Request(`${BASE}/api/me`, { headers: { cookie: sessionPair } }),
      env as never,
    );
    expect(me.status).toBe(200);

    const replay = await desktopRedeemRoute(
      new Request(`${BASE}/api/auth/desktop/redeem`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticket }),
      }),
      configured(),
    );
    expect(replay.status).toBe(400);
  });
});
