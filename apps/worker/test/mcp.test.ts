/**
 * POST /api/mcp — stateless MCP endpoint (PRD API-08).
 *
 * Auth is the ops admin key as a bearer; tools are thin wrappers over the same
 * paths as the REST API. The adversarial part: results/status must NEVER carry
 * pre-reveal answer keys or per-participant ballots (API-06 / DATA-03) — we
 * plant sentinel strings in the outline and assert textual absence.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { sha256Hex } from '../src/api-tokens.js';

import { OUTLINE_SCHEMA_RESOURCE_URI } from '@openroom/mcp';

import { BASE, call, command, join } from './helpers.js';

const SENTINEL_OPTION = 'SENTINEL_CORRECT_OPTION_LABEL';

async function oauthPat(): Promise<string> {
  const id = crypto.randomUUID(), token = `orpat_${crypto.randomUUID()}_${crypto.randomUUID()}`;
  await env.DB.prepare('INSERT INTO users (id, google_sub, email, name, created_at) VALUES (?1,?1,?2,?3,?4)').bind(id, `${id}@example.test`, 'Agent owner', Date.now()).run();
  await env.DB.prepare('INSERT INTO api_tokens (id,user_id,name,token_hash,token_prefix,created_at) VALUES (?1,?2,?3,?4,?5,?6)').bind(crypto.randomUUID(), id, 'Agent', await sha256Hex(token), token.slice(0, 12), Date.now()).run();
  return token;
}

async function oauthConsent(fields: Record<string, string>) {
  const page = await call(`/api/mcp/authorize?${new URLSearchParams(fields)}`);
  expect(page.status).toBe(200);
  const html = await page.text();
  return { consent: /name="consent" value="([^"]+)"/.exec(html)![1]!, cookie: page.headers.get('set-cookie')!.split(';')[0]! };
}

const QUIZ_OUTLINE_YAML = `version: 1
meta:
  title: MCP quiz
steps:
  - id: question
    kind: interaction
    interactionId: quiz
interactions:
  - id: quiz
    type: choice
    prompt: Pick the right one
    notes: PRIVATE_TEACHING_GUIDANCE
    options:
      - id: a
        label: Wrong answer
      - id: b
        label: ${SENTINEL_OPTION}
        correct: true
`;

async function mcp(body: unknown, token = 'test-admin'): Promise<Response> {
  return call('/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === '' ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

async function callTool(name: string, args: Record<string, unknown>, token = 'test-admin'): Promise<any> {
  const res = await mcp(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    token,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.error).toBeUndefined();
  return { isError: body.result.isError, value: JSON.parse(body.result.content[0].text) };
}

describe('POST /api/mcp', () => {
  it('rejects missing or wrong bearer with 401', async () => {
    const missing = await mcp({ jsonrpc: '2.0', id: 1, method: 'ping' }, '');
    expect(missing.status).toBe(401);
    const wrong = await mcp({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'not-the-key');
    expect(wrong.status).toBe(401);
  });

  it('rejects non-POST with 405', async () => {
    const res = await call('/api/mcp', { headers: { authorization: 'Bearer test-admin' } });
    expect(res.status).toBe(405);
  });

  it('initialize handshake and tools/list work over HTTP', async () => {
    const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(init.status).toBe(200);
    const initBody = (await init.json()) as any;
    expect(initBody.result.protocolVersion).toBe('2025-06-18');
    expect(initBody.result.capabilities).toEqual({ tools: {}, resources: {} });

    const notification = await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notification.status).toBe(202);

    const list = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = ((await list.json()) as any).result.tools.map((t: any) => t.name);
    expect(names).toEqual([
      'outline_validate',
      'session_create',
      'session_status',
      'session_results',
      'openroom_api',
      'deck_get',
      'deck_preview',
      'deck_save_version',
      'deck_draft_put',
      'deck_start',
      'session_facilitate',
      'session_recap',
      'session_command',
      'picture_search',
    ]);

    const resources = await mcp({ jsonrpc: '2.0', id: 3, method: 'resources/list' });
    const listed = ((await resources.json()) as any).result.resources;
    const descriptor = listed.find((r: any) => r.uri === 'ui://openroom/deck-preview/v1.html');
    expect(descriptor).toMatchObject({
      uri: 'ui://openroom/deck-preview/v1.html',
      mimeType: 'text/html+skybridge',
    });
    const resource = await mcp({
      jsonrpc: '2.0', id: 4, method: 'resources/read',
      params: { uri: 'ui://openroom/deck-preview/v1.html' },
    });
    expect(((await resource.json()) as any).result.contents[0].text).toContain('<div id="app"');
  });

  it('serves the outline schema over the same endpoint, so nothing need be installed', async () => {
    const resources = await mcp({ jsonrpc: '2.0', id: 3, method: 'resources/list' });
    const listed = ((await resources.json()) as any).result.resources;
    expect(listed).toContainEqual(
      expect.objectContaining({ uri: OUTLINE_SCHEMA_RESOURCE_URI, mimeType: 'application/schema+json' }),
    );

    const schemaRead = await mcp({
      jsonrpc: '2.0', id: 4, method: 'resources/read',
      params: { uri: OUTLINE_SCHEMA_RESOURCE_URI },
    });
    const schema = JSON.parse(((await schemaRead.json()) as any).result.contents[0].text);
    expect(schema.$defs.step.oneOf).toHaveLength(13);
    expect(schema.required).toEqual(expect.arrayContaining(['version', 'meta', 'steps', 'interactions']));
  });

  it('outline_validate names an unknown step kind instead of every branch it is not', async () => {
    const { value } = await callTool('outline_validate', {
      outline: {
        version: 1,
        meta: { title: 'Passé composé' },
        steps: [{ id: 's1', kind: 'exercise', prompt: 'Nous ___ au zoo.' }],
        interactions: [
          {
            id: 'q1', type: 'choice', prompt: 'Nous ___ au zoo.',
            options: [{ id: 'a', label: 'sommes allés' }, { id: 'b', label: 'allons' }],
          },
        ],
      },
    });
    expect(value.ok).toBe(false);
    expect(value.errors).toHaveLength(1);
    expect(value.errors[0].code).toBe('E_UNKNOWN_KIND');
    expect(value.errors[0].message).toContain('term');
  });

  it('outline_validate returns stable errors for a bad outline', async () => {
    const { value } = await callTool('outline_validate', { outline: 'version: 2\nmeta:\n  title: x\n' });
    expect(value.ok).toBe(false);
    expect(value.errors[0]).toHaveProperty('code');
    expect(value.errors[0]).toHaveProperty('path');
  });

  it('full flow: create → status → answer via REST → results, without leaking answer keys', async () => {
    const created = await callTool('session_create', { outline: QUIZ_OUTLINE_YAML });
    expect(created.isError).toBe(false);
    const { code, sessionCode, hostToken } = created.value;
    expect(code).toHaveLength(8);
    expect(typeof hostToken).toBe('string');

    // status: lobby, one pending interaction, no aggregates, no sentinel
    const status1 = await callTool('session_status', { code });
    expect(status1.value.status).toBe('lobby');
    expect(status1.value.interactions).toEqual([
      { id: 'quiz', prompt: 'Pick the right one', type: 'choice', status: 'pending' },
    ]);
    expect(JSON.stringify(status1.value)).not.toContain(SENTINEL_OPTION);
    expect(JSON.stringify(status1.value)).not.toContain('"correct"');

    // drive the session over REST, exactly as docs/AGENT.md prescribes
    await command(sessionCode, hostToken, { command: 'session.start' });
    await command(sessionCode, hostToken, { command: 'interaction.open', interactionId: 'quiz' });
    const participant = await join(code);
    await command(sessionCode, participant.participantToken, {
      command: 'answer.submit',
      interactionId: 'quiz',
      answer: { kind: 'choice', optionIds: ['b'] },
    });

    // pre-reveal: results carry the aggregate but no answer key, no ballots
    const preReveal = await callTool('session_results', { code });
    const preSerialized = JSON.stringify(preReveal.value);
    expect(preReveal.value.summary.questions[0].rows).toEqual([
      { label: 'Wrong answer', value: 0 }, { label: SENTINEL_OPTION, value: 1 },
    ]);
    expect(preSerialized).not.toContain('PRIVATE_TEACHING_GUIDANCE');
    expect(preSerialized).not.toContain('"correct"');
    expect(preSerialized).not.toContain('"ballots"');
    expect(preSerialized).not.toContain(participant.participantId);

    await command(sessionCode, hostToken, { command: 'interaction.reveal', interactionId: 'quiz' });

    // post-reveal: counts are there; the export shape still carries no outline options
    const results = await callTool('session_results', { code, interactionId: 'quiz' });
    expect(results.value.interactions).toHaveLength(1);
    expect(results.value.interactions[0].status).toBe('revealed');
    expect(results.value.interactions[0].aggregate).toMatchObject({ kind: 'choice', total: 1 });
    expect(JSON.stringify(results.value)).not.toContain(participant.participantId);
  });

  it('session_status on an unknown code is an isError tool result', async () => {
    const { isError, value } = await callTool('session_status', { code: 'ZZZZZZZZ' });
    expect(isError).toBe(true);
    expect(value.error).toBe('session-not-found');
  });

  it('401 advertises OAuth protected-resource metadata for discovery clients', async () => {
    const missing = await mcp({ jsonrpc: '2.0', id: 1, method: 'ping' }, '');
    expect(missing.status).toBe(401);
    const www = missing.headers.get('www-authenticate') ?? '';
    expect(www).toContain('resource_metadata=');
    expect(www).toContain('/.well-known/oauth-protected-resource');
  });

  it('unauthenticated tools/call returns a ChatGPT linking payload', async () => {
    const res = await mcp(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'deck_get', arguments: { deckId: 'x' } } },
      '',
    );
    expect(res.status).toBe(200);
    const www = res.headers.get('www-authenticate') ?? '';
    expect(www).toContain('resource_metadata=');
    const body = (await res.json()) as any;
    expect(body.result.isError).toBe(true);
    expect(body.result._meta['mcp/www_authenticate'][0]).toContain('resource_metadata=');
  });
});

describe('MCP Server Card discovery (SEP-1649)', () => {
  it('serves /.well-known/mcp/server-card.json with transport and capabilities', async () => {
    const res = await call('/.well-known/mcp/server-card.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');

    const card = (await res.json()) as any;
    expect(card.serverInfo).toEqual(
      expect.objectContaining({ name: 'openroom', version: '1.0.0' }),
    );
    expect(card.protocolVersion).toBe('2025-06-18');
    expect(card.transport).toEqual({
      type: 'streamable-http',
      endpoint: `${BASE}/api/mcp`,
    });
    expect(card.capabilities).toEqual({
      tools: true,
      resources: true,
      prompts: false,
    });
    expect(card.tools.map((t: { name: string }) => t.name)).toEqual([
      'outline_validate',
      'session_create',
      'session_status',
      'session_results',
      'openroom_api',
      'deck_get',
      'deck_preview',
      'deck_save_version',
      'deck_draft_put',
      'deck_start',
      'session_facilitate',
      'session_recap',
      'session_command',
      'picture_search',
    ]);
    expect(card.authentication).toEqual({
      required: true,
      schemes: ['bearer', 'oauth2'],
    });
  });

  it('openai-apps-challenge is absent until the portal token is configured', async () => {
    const res = await call('/.well-known/openai-apps-challenge');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
  });
});

describe('MCP OAuth front door', () => {
  it('serves auth.md and OAuth discovery with agent_auth', async () => {
    const md = await call('/auth.md');
    expect(md.status).toBe(200);
    expect(md.headers.get('content-type')).toMatch(/text\/markdown/);
    const body = await md.text();
    expect(body.startsWith('# auth.md')).toBe(true);
    expect(body).toContain('/api/mcp/register');
    expect(body).toContain('Authorization: Bearer');

    const pr = await call('/.well-known/oauth-protected-resource');
    expect(pr.status).toBe(200);
    const prBody = (await pr.json()) as any;
    expect(prBody.resource).toBe(`${BASE}/api/mcp`);
    expect(prBody.resource_name).toBe('OpenRoom');
    expect(prBody.authorization_servers).toEqual([BASE]);
    expect(prBody.scopes_supported).toEqual(['mcp']);
    expect(prBody.bearer_methods_supported).toEqual(['header']);

    const as = await call('/.well-known/oauth-authorization-server');
    expect(as.status).toBe(200);
    const asBody = (await as.json()) as any;
    expect(asBody.issuer).toBe(BASE);
    expect(asBody.authorization_endpoint).toBe(`${BASE}/api/mcp/authorize`);
    expect(asBody.token_endpoint).toBe(`${BASE}/api/mcp/token`);
    expect(asBody.registration_endpoint).toBe(`${BASE}/api/mcp/register`);
    expect(asBody.code_challenge_methods_supported).toContain('S256');
    expect(asBody.agent_auth).toEqual({
      skill: `${BASE}/auth.md`,
      register_uri: `${BASE}/api/mcp/register`,
      claim_uri: `${BASE}/api/mcp/authorize`,
      identity_types_supported: ['identity_assertion'],
      identity_assertion: {
        assertion_types_supported: ['verified_email'],
        credential_types_supported: ['access_token', 'api_key'],
      },
    });
    expect(body).toContain('verified_email');
    expect(body).toContain('identity_types_supported');
  });

  it('dynamic registration → authorize → token → MCP call with access token', async () => {
    // PKCE pair
    const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
    const verifier = btoa(String.fromCharCode(...verifierBytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const challengeDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeDigest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const redirectUri = 'https://chatgpt.com/connector/oauth/callback';
    const reg = await call('/api/mcp/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'ChatGPT',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
      }),
    });
    expect(reg.status).toBe(201);
    const { client_id: clientId } = (await reg.json()) as { client_id: string };
    expect(typeof clientId).toBe('string');

    // Consent form (GET)
    const authorizeQs = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state: 'st-1',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const form = await call(`/api/mcp/authorize?${authorizeQs}`);
    expect(form.status).toBe(200);
    expect(form.headers.get('content-type')).toMatch(/text\/html/);
    const html = await form.text();
    const consent = /name="consent" value="([^"]+)"/.exec(html)![1]!;
    const cookie = form.headers.get('set-cookie')!.split(';')[0]!;
    const credential = await oauthPat();
    expect(html).toContain('Connect ChatGPT');
    expect(html).toContain('ChatGPT');
    const methods = await (await call('/api/auth/status')).json() as { google: boolean; demo: boolean };
    expect(html.includes('/api/auth/google?returnTo=')).toBe(methods.google);
    expect(html.includes('Sign in with demo account')).toBe(methods.demo);
    expect(html).toContain('Personal API token');
    expect(html).toContain('You can revoke this connection in Settings');

    // Wrong key → form again with error
    const bad = await call('/api/mcp/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        state: 'st-1',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        consent,
        credential: 'nope',
      }).toString(),
    });
    expect(bad.status).toBe(401);
    expect(await bad.text()).toContain('valid personal API token');

    // Approve with a user credential and the form's CSRF proof.
    const approved = await call('/api/mcp/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        state: 'st-1',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        consent,
        credential,
      }).toString(),
      redirect: 'manual',
    });
    expect(approved.status).toBe(302);
    const location = approved.headers.get('location') ?? '';
    expect(location.startsWith(redirectUri)).toBe(true);
    const code = new URL(location).searchParams.get('code');
    expect(code).toBeTruthy();
    expect(new URL(location).searchParams.get('state')).toBe('st-1');

    // Exchange code + verifier for access token
    const tokenRes = await call('/api/mcp/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        client_id: clientId,
      }).toString(),
    });
    expect(tokenRes.status).toBe(200);
    const tokenBody = (await tokenRes.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };
    expect(tokenBody.token_type).toBe('Bearer');
    expect(tokenBody.expires_in).toBeGreaterThan(0);
    expect(typeof tokenBody.access_token).toBe('string');

    // MCP accepts the OAuth access token
    const ping = await mcp({ jsonrpc: '2.0', id: 9, method: 'ping' }, tokenBody.access_token);
    expect(ping.status).toBe(200);
  });

  it('allows either loopback host when both exact redirects were registered', async () => {
    const verifier = 'a'.repeat(43);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const registered = 'http://127.0.0.1:39053/callback/BKj9umzr4ef_';
    const authorized = 'http://localhost:39053/callback/BKj9umzr4ef_';

    const reg = await call('/api/mcp/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Codex', redirect_uris: [registered, authorized] }),
    });
    expect(reg.status).toBe(201);
    const body = (await reg.json()) as { client_id: string; redirect_uris: string[] };
    expect(body.redirect_uris).toEqual(expect.arrayContaining([registered, authorized]));

    const proof = await oauthConsent({ response_type: 'code', client_id: body.client_id, redirect_uri: authorized, code_challenge: challenge, code_challenge_method: 'S256' });

    const approved = await call('/api/mcp/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: proof.cookie },
      body: new URLSearchParams({
        response_type: 'code',
        client_id: body.client_id,
        redirect_uri: authorized,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        consent: proof.consent,
        credential: await oauthPat(),
      }).toString(),
      redirect: 'manual',
    });
    expect(approved.status).toBe(302);
    const location = approved.headers.get('location') ?? '';
    expect(location.startsWith(authorized)).toBe(true);
    const code = new URL(location).searchParams.get('code');
    expect(code).toBeTruthy();

    const tokenRes = await call('/api/mcp/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: authorized,
        code_verifier: verifier,
        client_id: body.client_id,
      }).toString(),
    });
    expect(tokenRes.status).toBe(200);
  });

  it('rejects token exchange with a bad PKCE verifier', async () => {
    const verifier = 'a'.repeat(43);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const redirectUri = 'http://127.0.0.1:9/callback';

    const reg = await call('/api/mcp/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [redirectUri] }),
    });
    const { client_id: clientId } = (await reg.json()) as { client_id: string };

    const proof = await oauthConsent({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256' });

    const approved = await call('/api/mcp/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: proof.cookie },
      body: new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        consent: proof.consent,
        credential: await oauthPat(),
      }).toString(),
      redirect: 'manual',
    });
    const code = new URL(approved.headers.get('location')!).searchParams.get('code')!;

    const bad = await call('/api/mcp/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: 'b'.repeat(43),
        client_id: clientId,
      }).toString(),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error).toBe('invalid_grant');
  });
});
