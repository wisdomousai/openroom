/**
 * A2A Agent Card discovery + minimal JSON-RPC transport.
 */
import { describe, expect, it } from 'vitest';

import { env } from 'cloudflare:test';
import worker from '../src/index.js';
import { BASE, SMOKE_OUTLINE, call } from './helpers.js';
import { account, configured } from './paid-fixtures.js';

describe('GET /.well-known/agent-card.json', () => {
  it('returns a valid A2A Agent Card', async () => {
    const res = await call('/.well-known/agent-card.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);

    const card = (await res.json()) as Record<string, unknown>;
    expect(card['name']).toBe('OpenRoom');
    expect(typeof card['version']).toBe('string');
    expect(typeof card['description']).toBe('string');
    expect((card['description'] as string).length).toBeGreaterThan(10);

    const interfaces = card['supportedInterfaces'] as Array<Record<string, unknown>>;
    expect(Array.isArray(interfaces)).toBe(true);
    expect(interfaces.length).toBeGreaterThan(0);
    expect(interfaces[0]?.['url']).toBe('https://openroom.test/api/a2a');
    expect(interfaces[0]?.['protocolBinding']).toBe('JSONRPC');

    const capabilities = card['capabilities'] as Record<string, unknown>;
    expect(capabilities).toBeTypeOf('object');
    expect(typeof capabilities['streaming']).toBe('boolean');

    const skills = card['skills'] as Array<Record<string, unknown>>;
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(typeof skill['id']).toBe('string');
      expect(typeof skill['name']).toBe('string');
      expect(typeof skill['description']).toBe('string');
    }
  });
});

describe('POST /api/a2a', () => {
  it('answers message/send with an agent message', async () => {
    const res = await call('/api/a2a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            messageId: 'msg-1',
            parts: [{ kind: 'text', text: 'What can you do?' }],
          },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { kind?: string; role?: string; parts?: Array<{ text?: string }> };
      error?: unknown;
    };
    expect(body.error).toBeUndefined();
    expect(body.result?.kind).toBe('message');
    expect(body.result?.role).toBe('agent');
    expect(body.result?.parts?.[0]?.text).toMatch(/OpenRoom/);
  });

  it('validates a YAML outline sent as text', async () => {
    const outline = `version: 1
meta:
  title: A2A check
steps:
  - id: question
    kind: interaction
    interactionId: q1
interactions:
  - id: q1
    type: choice
    prompt: Pick one
    options:
      - id: a
        label: A
      - id: b
        label: B
`;
    const res = await call('/api/a2a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            messageId: 'msg-2',
            parts: [{ kind: 'text', text: outline }],
          },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { parts?: Array<{ text?: string }> };
    };
    const text = body.result?.parts?.[0]?.text ?? '';
    const parsed = JSON.parse(text) as { ok?: boolean };
    expect(parsed.ok).toBe(true);
  });

  it('returns method-not-found for unknown methods', async () => {
    const res = await call('/api/a2a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tasks/cancel', params: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error?: { code?: number } };
    expect(body.error?.code).toBe(-32601);
  });

  it('binds a session-create host token to the connection, so revoking it ends host control', async () => {
    const owner = await account();
    const res = await owner.raw('/api/a2a', 'POST', {
      jsonrpc: '2.0',
      id: 4,
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          messageId: 'msg-4',
          parts: [{ kind: 'data', data: { skill: 'session-create', arguments: { outline: SMOKE_OUTLINE } } }],
        },
      },
    }, 'oauth');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { parts: Array<{ text: string }> } };
    const created = JSON.parse(body.result.parts[0]!.text) as { ok: boolean; sessionCode: string; hostToken: string };
    expect(created.ok).toBe(true);
    const start = () => worker.fetch(new Request(`${BASE}/api/sessions/${created.sessionCode}/commands`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ command: { command: 'session.start' } }),
    }), configured);

    await env.DB.prepare('UPDATE oauth_connections SET revoked_at = ?1 WHERE id = ?2').bind(Date.now(), owner.connectionId).run();
    const revoked = await start();
    expect(revoked.status).toBe(403);
    expect(await revoked.json()).toMatchObject({ error: 'connection-revoked' });
  });
});
