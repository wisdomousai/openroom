/**
 * Personal API tokens: mint / list / revoke + MCP acceptance with ownership.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import { signCookieValue } from '../src/tokens.js';
import worker from '../src/index.js';
import { BASE, call, command, join } from './helpers.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

interface Signed {
  userId: string;
  cookie: string;
}

let counter = 0;

async function seedSession(): Promise<Signed> {
  counter += 1;
  const userId = `pat-user-${counter}-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, created_at, entitlements)
     VALUES (?1, ?2, ?3, ?4, ?5, '{}')`,
  )
    .bind(userId, `sub-${userId}`, `${userId}@example.com`, 'PAT Host', now)
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

function asUser(session: Signed, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('cookie', session.cookie);
  headers.set('content-type', 'application/json');
  headers.set(CSRF_HEADER, '1');
  return worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env as never);
}

async function mcp(body: unknown, token: string): Promise<Response> {
  return call('/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

const OUTLINE_YAML = `version: 1
meta:
  title: PAT session
interactions:
  - id: q1
    type: choice
    prompt: One?
    options:
      - id: a
        label: A
      - id: b
        label: B
`;

describe('personal API tokens', () => {
  it('requires a session to list or mint', async () => {
    const list = await call('/api/my/tokens');
    expect(list.status).toBe(401);
    const mint = await call('/api/my/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CSRF_HEADER]: '1' },
      body: '{}',
    });
    expect(mint.status).toBe(401);
  });

  it('mints a token once, lists prefix only, revokes it', async () => {
    const session = await seedSession();

    const minted = await asUser(session, '/api/my/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'Claude' }),
    });
    expect(minted.status).toBe(201);
    const body = (await minted.json()) as {
      id: string;
      name: string;
      prefix: string;
      token: string;
    };
    expect(body.name).toBe('Claude');
    expect(body.token.startsWith('orpat_')).toBe(true);
    expect(body.prefix).toBe(body.token.slice(0, 12));

    const listed = await asUser(session, '/api/my/tokens');
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      tokens: { id: string; name: string; prefix: string; token?: string }[];
    };
    expect(listBody.tokens).toHaveLength(1);
    expect(listBody.tokens[0]!.id).toBe(body.id);
    expect(listBody.tokens[0]!.prefix).toBe(body.prefix);
    expect(listBody.tokens[0]!.token).toBeUndefined();

    // MCP accepts the raw token
    const ping = await mcp({ jsonrpc: '2.0', id: 1, method: 'ping' }, body.token);
    expect(ping.status).toBe(200);

    const revoked = await asUser(session, `/api/my/tokens/${body.id}`, { method: 'DELETE' });
    expect(revoked.status).toBe(200);

    const after = await asUser(session, '/api/my/tokens');
    expect(((await after.json()) as { tokens: unknown[] }).tokens).toHaveLength(0);

    const denied = await mcp({ jsonrpc: '2.0', id: 2, method: 'ping' }, body.token);
    expect(denied.status).toBe(401);
  });

  it('PAT session_create records ownership and scopes status/results', async () => {
    const owner = await seedSession();
    const other = await seedSession();

    const mintRes = await asUser(owner, '/api/my/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'Agent' }),
    });
    const { token: ownerToken } = (await mintRes.json()) as { token: string };

    const otherMint = await asUser(other, '/api/my/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'Other' }),
    });
    const { token: otherToken } = (await otherMint.json()) as { token: string };

    const createRes = await mcp(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'session_create', arguments: { outline: OUTLINE_YAML } },
      },
      ownerToken,
    );
    expect(createRes.status).toBe(200);
    const createBody = (await createRes.json()) as any;
    expect(createBody.error).toBeUndefined();
    const created = JSON.parse(createBody.result.content[0].text) as {
      ok: boolean;
      code: string;
      hostToken: string;
      sessionCode: string;
    };
    expect(created.ok).toBe(true);

    const dir = await env.DB.prepare('SELECT user_id FROM live_sessions WHERE code = ?1')
      .bind(created.code)
      .first<{ user_id: string }>();
    expect(dir?.user_id).toBe(owner.userId);

    // Owner can read status
    const status = await mcp(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'session_status', arguments: { code: created.code } },
      },
      ownerToken,
    );
    const statusBody = (await status.json()) as any;
    expect(statusBody.result.isError).toBeFalsy();
    expect(JSON.parse(statusBody.result.content[0].text).code).toBe(created.code);

    // Other user's PAT cannot see it (tool error session-not-found)
    const blocked = await mcp(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'session_status', arguments: { code: created.code } },
      },
      otherToken,
    );
    const blockedBody = (await blocked.json()) as any;
    expect(blockedBody.result.isError).toBe(true);
    expect(JSON.parse(blockedBody.result.content[0].text).error).toBe('session-not-found');

    // Drive a little so results path is exercised
    await command(created.sessionCode, created.hostToken, { command: 'session.start' });
    await command(created.sessionCode, created.hostToken, {
      command: 'interaction.open',
      interactionId: 'q1',
    });
    const participant = await join(created.code);
    await command(created.sessionCode, participant.participantToken, {
      command: 'answer.submit',
      interactionId: 'q1',
      answer: { kind: 'choice', optionIds: ['a'] },
    });

    const results = await mcp(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'session_results', arguments: { code: created.code } },
      },
      ownerToken,
    );
    expect(((await results.json()) as any).result.isError).toBeFalsy();
  });

  it('rejects a wrong bearer that only looks vaguely token-shaped', async () => {
    const res = await mcp(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      'orpat_notreal_notrealsecreteitherxx',
    );
    expect(res.status).toBe(401);
  });
});
