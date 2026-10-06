import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { BASE, call, SMOKE_OUTLINE } from './helpers.js';
import { SESSION_COOKIE, CSRF_HEADER } from '../src/auth.js';
import { signCookieValue } from '../src/tokens.js';
import { sha256Hex } from '../src/api-tokens.js';

async function account() {
  const id = crypto.randomUUID(), authId = crypto.randomUUID(), now = Date.now();
  await env.DB.prepare('INSERT INTO users (id,google_sub,email,name,created_at) VALUES (?1,?1,?2,?3,?4)').bind(id, `${id}@example.test`, 'Presenter', now).run();
  await env.DB.prepare('INSERT INTO auth_sessions (id,user_id,created_at,expires_at) VALUES (?1,?2,?3,?4)').bind(authId, id, now, now + 3600000).run();
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(await signCookieValue('test-secret', authId))}`;
  const request = (path: string, method = 'GET', body?: object) => call(path, { method, headers: { cookie, [CSRF_HEADER]: '1', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { id, cookie, request };
}

const verifier = 'a'.repeat(43);
async function approval(user: Awaited<ReturnType<typeof account>>, clientId = 'openroom-powerpoint', redirectUri = `${BASE}/office/callback.html`) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fields = { response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state: 'test-state', code_challenge: challenge, code_challenge_method: 'S256' };
  const page = await call(`/api/mcp/authorize?${new URLSearchParams(fields)}`, { headers: { cookie: user.cookie } });
  expect(page.status).toBe(200);
  const html = await page.text();
  const consent = /name="consent" value="([^"]+)"/.exec(html)![1]!;
  const nonceCookie = page.headers.get('set-cookie')!.split(';')[0]!;
  const cookie = `${user.cookie}; ${nonceCookie}`;
  const params = { ...fields, consent, via_session: '1' };
  const approve = (patch: Record<string, string> = {}, origin = BASE, sendCookie = true) => call('/api/mcp/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin, ...(sendCookie ? { cookie } : {}) }, body: new URLSearchParams({ ...params, ...patch }) });
  return { approve, fields, cookie, params };
}
async function approvedCode(user: Awaited<ReturnType<typeof account>>, clientId?: string, redirectUri?: string) {
  const flow = await approval(user, clientId, redirectUri);
  const result = await flow.approve(); expect(result.status).toBe(302);
  const code = new URL(result.headers.get('location')!).searchParams.get('code')!;
  const exchange = (patch: Record<string, string> = {}) => call('/api/mcp/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', client_id: flow.fields.client_id, redirect_uri: flow.fields.redirect_uri, code, code_verifier: verifier, ...patch }) });
  return { ...flow, code, exchange };
}

describe('revocable connected applications', () => {
  it('binds browser consent to the exact request and signed-in account', async () => {
    const user = await account(), flow = await approval(user);
    expect((await flow.approve({}, 'https://attacker.test')).status).toBe(403);
    expect((await flow.approve({}, 'null')).status).toBe(403);
    expect((await flow.approve({}, BASE, false)).status).toBe(403);
    expect((await flow.approve({ state: 'changed' })).status).toBe(403);
    expect((await flow.approve({ code_challenge: 'b'.repeat(43) })).status).toBe(403);
    expect((await flow.approve({ redirect_uri: 'https://attacker.test/callback' })).status).toBe(400);
    const other = await account();
    expect((await call('/api/mcp/authorize', { method: 'POST', headers: { cookie: `${other.cookie}; ${flow.cookie.split('; ')[1]}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(flow.params) })).status).toBe(403);
    expect((await flow.approve()).status).toBe(302);
  });

  it('requires the correct client, exact redirect and S256 verifier, and atomically consumes a code once', async () => {
    const flow = await approvedCode(await account());
    const invalid: Record<string, string>[] = [{ client_id: 'another-client' }, { redirect_uri: `${BASE}/office/callback.html?extra=1` }, { code_verifier: 'b'.repeat(43) }, { code_verifier: 'short' }];
    for (const patch of invalid) expect((await flow.exchange(patch)).status).toBe(400);
    const replies = await Promise.all([flow.exchange(), flow.exchange()]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 400]);
    const token = await replies.find((reply) => reply.status === 200)!.json() as { access_token: string; connection_id: string };
    const stored = await env.DB.prepare('SELECT * FROM oauth_connections WHERE id = ?1').bind(token.connection_id).first();
    expect(stored?.token_hash).toBe(await sha256Hex(token.access_token));
    expect(JSON.stringify(stored)).not.toContain(token.access_token);
    expect(await env.DB.prepare('SELECT code_hash FROM oauth_codes WHERE code_hash = ?1').bind(await sha256Hex(flow.code)).first()).toBeNull();
  });

  it('revokes API/MCP and retained host capabilities without changing another connection or the browser session', async () => {
    const user = await account(), other = await account();
    const first = await (await (await approvedCode(user)).exchange()).json() as { access_token: string; connection_id: string };
    const second = await (await (await approvedCode(user)).exchange()).json() as { access_token: string; connection_id: string };
    const api = (token: string, path: string, method = 'GET', body?: object) => call(path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect((await api(first.access_token, '/api/my/spaces')).status).toBe(200);
    const created = await api(first.access_token, '/api/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'session_create', arguments: { outline: SMOKE_OUTLINE } } });
    const rpc = await created.json() as { result: { content: { text: string }[] } };
    const live = JSON.parse(rpc.result.content[0]!.text) as { code: string; hostToken: string };
    expect((await api(live.hostToken, `/api/sessions/${live.code}/state?role=host`)).status).toBe(200);
    const recovered = await (await api(first.access_token, '/api/my/sessions')).json() as { sessions: { hostToken: string }[] };
    const joined = await (await api(first.access_token, `/api/my/sessions/${live.code}/facilitate`, 'POST')).json() as { hostToken: string };
    const spaces = await (await api(first.access_token, '/api/my/spaces')).json() as { spaces: { id: string }[] };
    const deck = await api(first.access_token, '/api/decks', 'POST', { spaceId: spaces.spaces[0]!.id, content: { ...SMOKE_OUTLINE, steps: [{ id: 'warmup-slide', kind: 'interaction', interactionId: 'warmup' }] }, createSession: true });
    expect(deck.status, await deck.clone().text()).toBe(201);
    const { session, deck: savedDeck } = await deck.json() as { session: { id: string }; deck: { id: string } };
    const launch = await api(first.access_token, `/api/sessions/${session.id}/launch`, 'POST', { start: true });
    expect(launch.status).toBe(201);
    const launched = await launch.json() as { sessionCode: string; hostToken: string };
    const resume = await api(first.access_token, `/api/sessions/${session.id}/resume`, 'POST', {});
    expect(resume.status).toBe(200);
    const resumed = await resume.json() as { sessionCode: string; hostToken: string };
    expect(resumed.sessionCode).toBe(launched.sessionCode);
    const peer = async (path: string, body: object) => {
      const response = await api(first.access_token, '/api/mcp', 'POST', { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'openroom_api', arguments: { method: 'POST', path, body } } });
      const rpc = await response.json() as { result: { content: { text: string }[] } };
      return JSON.parse(rpc.result.content[0]!.text) as { ok: boolean; status: number; body: { sessionCode: string; hostToken: string } };
    };
    const requestId = crypto.randomUUID();
    const peerStart = await peer(`/api/decks/${savedDeck.id}/start`, { requestId, stepId: 'warmup-slide' });
    expect(peerStart.status).toBe(201);
    const peerResume = await peer(`/api/sessions/${requestId}/resume`, {});
    expect(peerResume.status).toBe(200);
    expect(peerResume.body.sessionCode).toBe(peerStart.body.sessionCode);
    expect((await api(launched.hostToken, `/api/sessions/${launched.sessionCode}/state?role=host`)).status).toBe(200);
    expect((await other.request(`/api/my/connections/${first.connection_id}`, 'DELETE')).status).toBe(404);
    expect((await call(`/api/my/connections/${first.connection_id}`, { method: 'DELETE', headers: { cookie: user.cookie } })).status).toBe(403);
    expect((await user.request(`/api/my/connections/${first.connection_id}`, 'DELETE')).status).toBe(200);
    expect((await api(first.access_token, '/api/my/spaces')).status).toBe(401);
    expect((await api(first.access_token, '/api/mcp', 'POST', { jsonrpc: '2.0', id: 2, method: 'ping' })).status).toBe(401);
    for (const hostToken of [live.hostToken, recovered.sessions[0]!.hostToken, joined.hostToken]) expect((await api(hostToken, `/api/sessions/${live.code}/state?role=host`)).status).toBe(403);
    expect((await api(launched.hostToken, `/api/sessions/${launched.sessionCode}/commands`, 'POST', { command: { command: 'session.end' }, idempotencyKey: 'after-revocation' })).status).toBe(403);
    expect((await api(resumed.hostToken, `/api/sessions/${resumed.sessionCode}/state?role=host`)).status).toBe(403);
    for (const token of [peerStart.body.hostToken, peerResume.body.hostToken]) expect((await api(token, `/api/sessions/${peerStart.body.sessionCode}/state?role=host`)).status).toBe(403);
    expect((await api(second.access_token, '/api/my/spaces')).status).toBe(200);
    expect((await user.request('/api/my/spaces')).status).toBe(200);
  });

  it('supports registered peer clients with exact redirects, expiration and token revocation', async () => {
    const user = await account(), redirect = 'http://127.0.0.1:12345/callback';
    const registered = await call('/api/mcp/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Agent', redirect_uris: [redirect] }) });
    const { client_id: clientId } = await registered.json() as { client_id: string };
    const flow = await approvedCode(user, clientId, redirect);
    expect((await call(`/api/mcp/authorize?${new URLSearchParams({ ...flow.fields, redirect_uri: 'http://localhost:12345/callback' })}`)).status).toBe(400);
    const result = await (await flow.exchange()).json() as { access_token: string; connection_id: string };
    expect((await call('/api/my/connections', { headers: { authorization: `Bearer ${result.access_token}` } })).status).toBe(200);
    await env.DB.prepare('UPDATE oauth_connections SET expires_at = 0 WHERE id = ?1').bind(result.connection_id).run();
    expect((await call('/api/my/connections', { headers: { authorization: `Bearer ${result.access_token}` } })).status).toBe(401);
    const next = await (await (await approvedCode(user, clientId, redirect)).exchange()).json() as { access_token: string; connection_id: string };
    expect((await call('/api/mcp/revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: next.access_token, client_id: clientId }) })).status).toBe(200);
    expect((await call('/api/my/connections', { headers: { authorization: `Bearer ${next.access_token}` } })).status).toBe(401);
  });
});
