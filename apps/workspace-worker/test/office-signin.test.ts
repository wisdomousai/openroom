import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index.js';
import { BASE } from './helpers.js';

const fields = {
  response_type: 'code', client_id: 'openroom-powerpoint',
  redirect_uri: `${BASE}/office/callback.html`, state: 'office-first-use',
  code_challenge: 'a'.repeat(43), code_challenge_method: 'S256',
};
const authorize = `/api/mcp/authorize?${new URLSearchParams(fields)}`;
const request = (path: string, init?: RequestInit, demo = true) => worker.fetch(
  new Request(`${BASE}${path}`, init), { ...env, GOOGLE_CLIENT_ID: '', DEMO_AUTH: demo ? '1' : '0' } as never,
);
const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;
async function proofOf(response: Response) {
  const html = await response.text();
  return { consent: /name="consent" value="([^"]+)"/.exec(html)![1]!, cookie: cookieOf(response), html };
}
const post = (consent: string, cookie: string, extra: Record<string, string>, origin = BASE): RequestInit => ({
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, origin },
  body: new URLSearchParams({ ...fields, consent, ...extra }),
});

describe('PowerPoint first sign-in', () => {
  it('signs in locally, then requires fresh account-bound consent before issuing a connection code', async () => {
    const initial = await proofOf(await request(authorize));
    expect(initial.html).toContain('Sign in with demo account');
    expect(initial.html).not.toContain('Sign in with Google');
    const login = { action: 'demo-sign-in', username: 'alice', password: 'demo' };
    expect((await request(authorize, post(initial.consent, initial.cookie, login, 'https://unrelated.example'))).status).toBe(403);
    const wrong = await request(authorize, post(initial.consent, initial.cookie, { ...login, password: 'wrong' }));
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('set-cookie')).not.toContain('or_session=');

    const signedIn = await request(authorize, post(initial.consent, initial.cookie, login));
    expect(signedIn.status).toBe(303);
    expect(signedIn.headers.get('location')).toBe(authorize);
    const session = cookieOf(signedIn);
    expect(session).toMatch(/^or_session=/);
    expect((await request('/api/me', { headers: { cookie: session } })).status).toBe(200);
    const oldProof = await request(authorize, post(initial.consent, `${session}; ${initial.cookie}`, { via_session: '1' }));
    expect(oldProof.status).toBe(403);

    const fresh = await proofOf(await request(authorize, { headers: { cookie: session } }));
    expect(fresh.html).toContain('alice@openroom.dev');
    const approved = await request(authorize, post(fresh.consent, `${session}; ${fresh.cookie}`, { via_session: '1' }));
    expect(approved.status).toBe(302);
    const target = new URL(approved.headers.get('location')!);
    expect(`${target.origin}${target.pathname}`).toBe(fields.redirect_uri);
    expect(target.searchParams.get('state')).toBe(fields.state);
    expect(target.searchParams.get('code')).toMatch(/^orcode_/);
  });

  it('cannot use the local sign-in action when demo authentication is disabled', async () => {
    // A previously opened form must stop working when the operator disables demo auth.
    const initial = await proofOf(await request(authorize));
    const disabled = await request(authorize, undefined, false);
    expect(await disabled.text()).toContain('Sign-in is not configured on this OpenRoom server.');
    const result = await request(authorize, post(initial.consent, initial.cookie, {
      action: 'demo-sign-in', username: 'alice', password: 'demo',
    }), false);
    expect(result.status).toBe(501);
    expect(result.headers.get('set-cookie')).toBeNull();
  });
});
