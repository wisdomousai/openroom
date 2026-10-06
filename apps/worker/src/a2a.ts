/**
 * POST /api/a2a — minimal A2A JSON-RPC transport (protocolBinding: JSONRPC).
 *
 * Implements message/send (and proto-style SendMessage) enough for discovery
 * clients to reach a live endpoint. Skill work reuses the same ToolDeps path
 * as MCP when the caller sends a structured JSON part; otherwise returns a
 * short capability summary.
 *
 * Auth mirrors MCP: Bearer admin key, personal API token, or MCP OAuth token.
 * Unauthenticated message/send still works for outline-validate and discovery
 * help text; mutating skills require a bearer.
 */

import { handleMcpMessage, type ToolDeps } from '@openroom/mcp';
import { normalizeSessionCode } from '@openroom/domain';
import { compileToOutline } from '@openroom/schema';

import { verifyApiToken } from './api-tokens.js';
import { buildAgentCard } from './agent-card.js';
import { createSessionFromOutline, type Env } from './index.js';
import { recordLiveSession, sessionQuotaExceeded } from './control.js';
import { timingSafeEqualStr, verifyMcpAccessToken } from './mcp-oauth.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
} as const;

type A2aIdentity = { kind: 'admin' } | { kind: 'user'; userId: string } | { kind: 'anon' };

function jsonRpc(id: unknown, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result }), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

function jsonRpcError(id: unknown, code: number, message: string, status = 200): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }),
    { status, headers: JSON_HEADERS },
  );
}

async function resolveIdentity(env: Env, bearer: string): Promise<A2aIdentity> {
  if (bearer === '') return { kind: 'anon' };
  if (timingSafeEqualStr(bearer, env.ADMIN_KEY)) return { kind: 'admin' };
  const pat = await verifyApiToken(env, bearer);
  if (pat !== null) return { kind: 'user', userId: pat.user.id };
  const oauth = await verifyMcpAccessToken(env, bearer);
  if (oauth !== null) {
    return oauth.userId === null ? { kind: 'admin' } : { kind: 'user', userId: oauth.userId };
  }
  return { kind: 'anon' };
}

function makeDeps(env: Env, identity: A2aIdentity): ToolDeps {
  return {
    async createSession(document) {
      if (identity.kind === 'anon') throw new Error('unauthorized');
      const validation = compileToOutline(document);
      if (!validation.ok) throw new Error('invalid-outline');
      if (identity.kind === 'user') {
        const now = Date.now();
        if (await sessionQuotaExceeded(env, identity.userId, now)) {
          throw new Error('session-quota');
        }
        const created = await createSessionFromOutline(env, validation.outline);
        if (!created.ok) throw new Error('session-init-failed');
        await recordLiveSession(env, created.session.code, identity.userId, validation.outline.meta.title, now);
        return created.session;
      }
      const created = await createSessionFromOutline(env, validation.outline);
      if (!created.ok) throw new Error('session-init-failed');
      return created.session;
    },
    async getExport(code) {
      const sessionCode = normalizeSessionCode(code);
      if (identity.kind === 'user') {
        const owned = await env.DB.prepare(
          'SELECT code FROM live_sessions WHERE code = ?1 AND user_id = ?2',
        )
          .bind(sessionCode, identity.userId)
          .first<{ code: string }>();
        if (owned === null) return null;
      }
      if (identity.kind === 'anon') return null;
      const id = env.SESSIONS.idFromName(sessionCode);
      const response = await env.SESSIONS.get(id).fetch(
        'https://session.internal/__export?format=json',
      );
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    },
    async controlRequest() {
      throw new Error('use MCP for tutoring business operations');
    },
    async sessionCommand() {
      throw new Error('use MCP for live session control');
    },
  };
}

function extractText(message: unknown): string {
  if (message === null || typeof message !== 'object') return '';
  const parts = (message as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return '';
  const texts: string[] = [];
  for (const part of parts) {
    if (part === null || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    if (typeof p['text'] === 'string') texts.push(p['text']);
    else if (p['kind'] === 'text' && typeof p['text'] === 'string') texts.push(p['text']);
  }
  return texts.join('\n').trim();
}

function extractData(message: unknown): Record<string, unknown> | null {
  if (message === null || typeof message !== 'object') return null;
  const parts = (message as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    if (part === null || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    if (p['kind'] === 'data' && p['data'] !== null && typeof p['data'] === 'object') {
      return p['data'] as Record<string, unknown>;
    }
    if (p['data'] !== null && typeof p['data'] === 'object' && !('text' in p)) {
      return p['data'] as Record<string, unknown>;
    }
  }
  return null;
}

function agentMessage(text: string, contextId: string | undefined): Record<string, unknown> {
  return {
    kind: 'message',
    role: 'agent',
    messageId: crypto.randomUUID(),
    ...(contextId !== undefined ? { contextId } : {}),
    parts: [{ kind: 'text', text }],
  };
}

async function callTool(
  deps: ToolDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const response = await handleMcpMessage(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    deps,
    { name: 'openroom', version: '0.1.0' },
  );
  if (response === null) return JSON.stringify({ ok: false, error: 'no-response' });
  if ('error' in response && response.error !== undefined) {
    return JSON.stringify({ ok: false, error: response.error });
  }
  const result = (response as { result?: { content?: Array<{ text?: string }>; isError?: boolean } })
    .result;
  const text = result?.content?.[0]?.text ?? JSON.stringify(result ?? {});
  return text;
}

async function handleSendMessage(
  params: Record<string, unknown> | undefined,
  deps: ToolDeps,
  identity: A2aIdentity,
  origin: string,
): Promise<Record<string, unknown>> {
  const message = params?.['message'];
  const contextId =
    (message !== null &&
    typeof message === 'object' &&
    typeof (message as { contextId?: unknown }).contextId === 'string'
      ? (message as { contextId: string }).contextId
      : undefined) ?? crypto.randomUUID();

  const data = extractData(message);
  const text = extractText(message);

  // Structured skill invocation: { skill, arguments } in a data part.
  if (data !== null && typeof data['skill'] === 'string') {
    const skill = data['skill'];
    const args =
      data['arguments'] !== null && typeof data['arguments'] === 'object'
        ? (data['arguments'] as Record<string, unknown>)
        : {};
    const toolName = skill.replaceAll('-', '_');
    const known =
      toolName === 'outline_validate' ||
      toolName === 'session_create' ||
      toolName === 'session_status' ||
      toolName === 'session_results';

    if (known) {
      if (toolName !== 'outline_validate' && identity.kind === 'anon') {
        return agentMessage(
          JSON.stringify({
            ok: false,
            error: 'unauthorized',
            hint: `${skill} requires Authorization: Bearer <token>`,
          }),
          contextId,
        );
      }
      try {
        const out = await callTool(deps, toolName, args);
        return agentMessage(out, contextId);
      } catch (err) {
        return agentMessage(
          JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'error' }),
          contextId,
        );
      }
    }
  }

  // Free-text: if it looks like an outline, validate it (no auth required).
  if (
    text.includes('version:') ||
    text.includes('"version"') ||
    text.trimStart().startsWith('{')
  ) {
    try {
      const out = await callTool(deps, 'outline_validate', { outline: text });
      return agentMessage(out, contextId);
    } catch {
      /* fall through to help text */
    }
  }

  const card = buildAgentCard(origin);
  const skillList = card.skills.map((s) => `- ${s.id}: ${s.name}`).join('\n');
  return agentMessage(
    [
      'OpenRoom A2A agent. Skills:',
      skillList,
      '',
      'Send a data part { "skill": "outline-validate", "arguments": { "outline": "..." } }',
      'or paste a YAML/JSON outline as text to validate. session-create / session-status /',
      'session-results require Authorization: Bearer. Prefer MCP at /api/mcp for tool calls.',
      `Docs: ${origin}/llms.txt`,
    ].join('\n'),
    contextId,
  );
}

export async function a2aRoute(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...JSON_HEADERS,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method-not-allowed' }), {
      status: 405,
      headers: { ...JSON_HEADERS, allow: 'POST' },
    });
  }

  const origin = new URL(request.url).origin;
  const auth = request.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  const identity = await resolveIdentity(env, bearer);
  const deps = makeDeps(env, identity);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonRpcError(null, -32700, 'parse error', 400);
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return jsonRpcError(null, -32600, 'invalid request', 400);
  }

  const body = raw as Record<string, unknown>;
  const id = body['id'];
  const method = typeof body['method'] === 'string' ? body['method'] : '';
  const params =
    body['params'] !== null && typeof body['params'] === 'object' && !Array.isArray(body['params'])
      ? (body['params'] as Record<string, unknown>)
      : undefined;

  if (method === 'message/send' || method === 'SendMessage') {
    const result = await handleSendMessage(params, deps, identity, origin);
    return jsonRpc(id, result);
  }

  if (method === 'agent/getAuthenticatedExtendedCard' || method === 'GetExtendedAgentCard') {
    return jsonRpcError(id, -32001, 'extended agent card not supported');
  }

  return jsonRpcError(id, -32601, `method not found: ${method || '(missing)'}`);
}
