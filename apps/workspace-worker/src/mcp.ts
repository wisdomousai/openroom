import { facilitateSessionRoute, facilitatorAccess, facilitatorCommandAllowed } from './facilitation.js';
import { accountRecapRoute } from './recap-route.js';
import { sharingRoute } from './sharing';
import { listArchivesRoute, downloadArchiveRoute } from './archives.js';
import { resumeSessionRoute } from './deck-start.js';
/**
 * POST /api/mcp — the stateless remote MCP endpoint (PRD API-08).
 *
 * Transport: Streamable HTTP, JSON responses only (no SSE, no sessions —
 * every request is independent). Protocol/tool logic lives in @openroom/mcp;
 * this file owns HTTP and authentication and implements ToolDeps on top of
 * the exact same plumbing the REST routes use.
 *
 * Auth (any of):
 *   - `Authorization: Bearer <ADMIN_KEY>` — ops god-mode (no session ownership)
 *   - `Authorization: Bearer <orpat_…>` — personal API token (quota + ownership)
 *   - `Authorization: Bearer <orauth_…>` — revocable account-bound OAuth token
 *     (the account's current ownership, membership and entitlements apply)
 */

import {
  DEFAULT_SERVER_INFO,
  buildMcpServerCard,
  handleMcpMessage,
  ToolError,
  type ToolDeps,
} from '@openroom/mcp';
import { normalizeSessionCode } from '@openroom/domain';
import { compileToOutline } from '@openroom/schema';

import { verifyApiToken } from './api-tokens.js';
import { createSessionFromOutline, launchSessionForUser, finishEndedSession, type Env } from './index.js';
import { recordLiveSession, sessionQuotaExceeded } from './control.js';
import { timingSafeEqualStr, verifyMcpAccessToken } from './mcp-oauth.js';
import { handleTutoringApi } from './tutoring.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
} as const;

const SERVER_INFO = DEFAULT_SERVER_INFO;

/** SEP-1649 discovery document — public, cacheable, CORS-open for browser agents. */
export function mcpServerCardRoute(origin: string): Response {
  return new Response(JSON.stringify(buildMcpServerCard({ origin, serverInfo: SERVER_INFO })), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    },
  });
}


type McpIdentity =
  | { kind: 'admin' }
  | { kind: 'user'; userId: string; connectionId?: string };

async function responseBody(response: Response): Promise<unknown> {
  if (response.ok && response.headers.get('content-type')?.split(';')[0] === 'audio/wav') {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
    return { encoding: 'base64', mimeType: 'audio/wav', data: btoa(chunks.join('')) };
  }
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function tutoringRequest(
  env: Env,
  bearer: string,
  origin: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const url = new URL(path, origin);
  const headers = new Headers({ authorization: `Bearer ${bearer}` });
  if (body !== undefined) headers.set('content-type', 'application/json');
  const request = new Request(url, {
    method,
    headers,
    ...(body === undefined || method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });

  const sharing = await sharingRoute(request, env, url);
  if (sharing) return { status: sharing.status, body: await responseBody(sharing) };

  const archiveMatch = /^\/api\/my\/archives(?:\/([^/]+)(?:\/document)?)?$/.exec(url.pathname);
  if (archiveMatch) {
    if (method !== 'GET') return { status: 405, body: { error: 'method-not-allowed' } };
    const response = archiveMatch[1] ? await downloadArchiveRoute(request, env, decodeURIComponent(archiveMatch[1]), url) : await listArchivesRoute(request, env);
    return { status: response.status, body: await responseBody(response) };
  }

  const facilitateMatch = /^\/api\/my\/sessions\/([^/]+)\/facilitate$/.exec(path);
  const resumeMatch = /^\/api\/sessions\/([^/]+)\/resume$/.exec(path);
  if (resumeMatch) {
    const response = await resumeSessionRoute(request, env, resumeMatch[1]!);
    return { status: response.status, body: await responseBody(response) };
  }
  if (facilitateMatch && method === 'POST') {
    const response = await facilitateSessionRoute(request, env, facilitateMatch[1]!);
    return { status: response.status, body: await responseBody(response) };
  }
  const recapMatch = /^\/api\/my\/sessions\/([^/]+)\/recap$/.exec(path);
  if (recapMatch) {
    const response = await accountRecapRoute(request, env, recapMatch[1]!);
    return { status: response.status, body: await responseBody(response) };
  }
  const response = await handleTutoringApi(
    request,
    env,
    url,
    (input, user) => launchSessionForUser(env, input, user),
  );
  if (response === null) throw new ToolError('path is outside the tutoring API allowlist');
  return { status: response.status, body: await responseBody(response) };
}

function makeDeps(env: Env, identity: McpIdentity, bearer: string, origin: string): ToolDeps {
  return {
    appOrigin: origin,
    async createSession(document) {
      const validation = compileToOutline(document);
      if (!validation.ok) throw new ToolError('invalid-outline');
      if (identity.kind === 'user') {
        const now = Date.now();
        if (await sessionQuotaExceeded(env, identity.userId, now)) {
          throw new ToolError('session-quota');
        }
        const user = await env.DB.prepare('SELECT id, name, email FROM users WHERE id = ?1').bind(identity.userId).first<{ id: string; name: string | null; email: string }>();
        if (!user) throw new ToolError('unauthorized');
        const created = await createSessionFromOutline(env, validation.outline, { user, ...(identity.connectionId ? { connectionId: identity.connectionId } : {}) });
        if (!created.ok) throw new ToolError('session-init-failed');
        await recordLiveSession(env, created.session.code, identity.userId, validation.outline.meta.title, now);
        return created.session;
      }

      const created = await createSessionFromOutline(env, validation.outline);
      if (!created.ok) throw new ToolError('session-init-failed');
      return created.session;
    },
    async getExport(code) {
      const sessionCode = normalizeSessionCode(code);
      if (identity.kind === 'user') {
        if (!await facilitatorAccess(env, sessionCode, identity.userId)) return null;
      }
      const id = env.SESSIONS.idFromName(sessionCode);
      const response = await env.SESSIONS.get(id).fetch(
        'https://session.internal/__export?format=json',
      );
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    },
    async controlRequest(method, path, body) {
      if (identity.kind !== 'user') throw new ToolError('a user-scoped token is required');
      return tutoringRequest(env, bearer, origin, method, path, body);
    },
    async sessionCommand(code, command, options) {
      const sessionCode = normalizeSessionCode(code);
      if (identity.kind === 'user') {
        const access = await facilitatorAccess(env, sessionCode, identity.userId);
        if (!access) throw new ToolError('session-not-found');
        if (!await facilitatorCommandAllowed(env, sessionCode, access, command as import('@openroom/domain').Command)) throw new ToolError('presentation-access-denied');
      }
      const idempotencyKey =
        typeof options?.idempotencyKey === 'string' && options.idempotencyKey !== ''
          ? options.idempotencyKey
          : crypto.randomUUID();
      const expectedRevision =
        typeof options?.expectedRevision === 'number' && Number.isFinite(options.expectedRevision)
          ? options.expectedRevision
          : undefined;
      const response = await env.SESSIONS.get(env.SESSIONS.idFromName(sessionCode)).fetch(
        'https://session.internal/__command',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            idempotencyKey,
            ...(expectedRevision === undefined ? {} : { expectedRevision }),
            actor: { role: 'host', facilitatorId: identity.kind === 'user' ? identity.userId : 'creator' },
            command,
          }),
        },
      );
      if (response.ok && command.command === 'session.end') await finishEndedSession(env, sessionCode);
      const body = await responseBody(response);
      return { ok: response.ok, status: response.status, body };
    },
  };
}

function wwwAuthenticate(origin: string): string {
  // RFC 9728: point OAuth-only clients (ChatGPT web) at protected-resource metadata.
  const metadataUrl = `${origin}/.well-known/oauth-protected-resource`;
  return (
    'Bearer ' +
    'resource' +
    '_' +
    'metadata' +
    `="${metadataUrl}", error="invalid_token", error_description="You need to sign in to OpenRoom to continue"`
  );
}

function unauthorized(origin: string, raw?: unknown): Response {
  const challenge = wwwAuthenticate(origin);
  const headers = {
    ...JSON_HEADERS,
    'www-authenticate': challenge,
  };

  const parsed =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  if (parsed?.['method'] === 'tools/call' && parsed['id'] !== undefined) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: parsed['id'],
        result: {
          content: [
            {
              type: 'text',
              text: 'Authentication required: no access token provided.',
            },
          ],
          isError: true,
          _meta: { 'mcp/www_authenticate': [challenge] },
        },
      }),
      { status: 200, headers },
    );
  }

  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: parsed?.['id'] ?? null,
      error: { code: -32001, message: 'unauthorized' },
    }),
    {
      status: 401,
      headers,
    },
  );
}

async function resolveIdentity(env: Env, bearer: string): Promise<McpIdentity | null> {
  if (bearer === '') return null;
  if (timingSafeEqualStr(bearer, env.ADMIN_KEY)) return { kind: 'admin' };
  const pat = await verifyApiToken(env, bearer);
  if (pat !== null) return { kind: 'user', userId: pat.user.id };
  const oauth = await verifyMcpAccessToken(env, bearer);
  if (oauth !== null) {
    return { kind: 'user', userId: oauth.userId, connectionId: oauth.connectionId };
  }
  return null;
}

export async function mcpRoute(request: Request, env: Env): Promise<Response> {
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

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    if (identity === null) return unauthorized(origin);
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'parse error' },
      }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  if (identity === null) {
    return unauthorized(origin, raw);
  }

  const response = await handleMcpMessage(raw, makeDeps(env, identity, bearer, origin), SERVER_INFO);
  if (response === null) return new Response(null, { status: 202 });
  return new Response(JSON.stringify(response), { status: 200, headers: JSON_HEADERS });
}
