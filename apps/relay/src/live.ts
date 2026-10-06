/**
 * The live plane's HTTP surface, shared by both Workers.
 *
 * The relay (`src/index.ts`) mounts these routes on its own origin with a
 * standalone authority. The control plane (`apps/worker`) mounts the same
 * routes at the openroom.app front door with an authority that rechecks
 * account access in D1. Either way the session itself is one `SessionDO`
 * namespace, owned by the relay script; every route here is a thin
 * token-checked forward to it.
 *
 * Capability tokens (`./tokens.ts`) are the only credential this module
 * understands. Cookies, API tokens, rosters and context links are the control
 * plane's and arrive here, if at all, as a resolved `JoinIdentity`.
 */

import type { Command } from '@openroom/domain';
import type { Outline } from '@openroom/schema';

import { parseExportFormat } from './export.js';
import { joinUrlForCode, type JoinOriginEnv } from './join-url.js';
import { extractToken, signToken, verifyToken, type Role, type TokenPayload } from './tokens.js';

export interface LiveEnv extends JoinOriginEnv {
  SESSIONS: DurableObjectNamespace;
  TOKEN_SECRET: string;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
}

/** Re-emit a DO response with the API security headers attached. */
export function withApiHeaders(response: Response): Response {
  if (response.status === 101 || response.status === 304) return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(JSON_HEADERS)) {
    if (key === 'content-type' && headers.has('content-type')) continue;
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

export function sessionStub(env: LiveEnv, sessionCode: string): DurableObjectStub {
  return env.SESSIONS.get(env.SESSIONS.idFromName(sessionCode));
}

/** Internal DO URL — the hostname is irrelevant, only the path is routed. */
export function sessionDoUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(`https://session.internal${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- authority */

/**
 * What the deployment adds on top of a valid capability token. `G` is the
 * deployment's own grant for a host seat (the control plane's facilitator
 * access); the live routes carry it through without reading it.
 */
export interface LiveAuthority<G = unknown> {
  /** Further checks on a verified host token. */
  host(
    payload: TokenPayload,
    sessionCode: string,
  ): Promise<{ ok: true; grant?: G; canRecover: boolean } | { ok: false; response: Response }>;
  /** May this host seat send this command? Called only when `host` returned a grant. */
  commandAllowed(grant: G, sessionCode: string, command: Command): Promise<boolean>;
  /** Runs after the session accepted `session.end`. */
  sessionEnded(sessionCode: string): Promise<void>;
  /** Does the ballots export include per-participant rows? */
  mayExportBallots(sessionCode: string): Promise<boolean>;
  /** Ballots CSV kept after the session's own storage is gone, if any. */
  archivedBallots(sessionCode: string): Promise<string | null>;
}

export interface Live<G = unknown> {
  env: LiveEnv;
  authority: LiveAuthority<G>;
}

export type LiveAuth<G = unknown> =
  | { ok: true; payload: TokenPayload; grant?: G; canRecover: boolean }
  | { ok: false; response: Response };

export async function authenticate<G>(
  live: Live<G>,
  request: Request,
  url: URL,
  sessionCode: string,
  requiredRole?: Role,
): Promise<LiveAuth<G>> {
  const token = extractToken(request, url);
  if (token === null) {
    return { ok: false, response: json({ error: 'missing-token' }, 401) };
  }
  const verified = await verifyToken(live.env.TOKEN_SECRET, token);
  if (!verified.ok) {
    return { ok: false, response: json({ error: 'invalid-token', reason: verified.reason }, 401) };
  }
  if (verified.payload.sessionCode !== sessionCode) {
    return { ok: false, response: json({ error: 'session-mismatch' }, 403) };
  }
  if (requiredRole !== undefined && verified.payload.role !== requiredRole) {
    return { ok: false, response: json({ error: 'role-mismatch' }, 403) };
  }
  if (verified.payload.role === 'host') {
    const host = await live.authority.host(verified.payload, sessionCode);
    if (!host.ok) return host;
    return {
      ok: true,
      payload: verified.payload,
      canRecover: host.canRecover,
      ...(host.grant === undefined ? {} : { grant: host.grant }),
    };
  }
  return { ok: true, payload: verified.payload, canRecover: false };
}

/* ---------------------------------------------------------------- creation */

export interface SessionInit {
  outline: Outline;
  sessionCode: string;
  /** Absent admits any number of participants. */
  participantLimit?: number;
  facilitator?: { id: string; name: string };
  outlineVersion?: number;
}

/** Initialise the session's Durable Object. 409 `already-initialized` on a repeat. */
export function initSession(env: LiveEnv, init: SessionInit): Promise<Response> {
  return sessionStub(env, init.sessionCode).fetch(sessionDoUrl('/__init'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      outline: init.outline,
      sessionCode: init.sessionCode,
      ...(init.participantLimit === undefined ? {} : { participantLimit: init.participantLimit }),
      ...(init.facilitator === undefined ? {} : { facilitator: init.facilitator }),
      ...(init.outlineVersion === undefined ? {} : { outlineVersion: init.outlineVersion }),
    }),
  });
}

export interface CreatedSession {
  /** The session's identity: the DO's name and the code participants type in. */
  sessionCode: string;
  /** The same string, under the name the join field uses. */
  code: string;
  hostToken: string;
  stageToken: string;
  joinUrl: string;
}

/** Sign the host + stage pair for a freshly initialised session. */
export async function issueSessionTokens(
  env: LiveEnv,
  sessionCode: string,
  host: Pick<TokenPayload, 'facilitatorId' | 'userId' | 'connectionId'> = {},
): Promise<CreatedSession> {
  const [hostToken, stageToken] = await Promise.all([
    signToken(env.TOKEN_SECRET, { sessionCode, role: 'host', ...host }),
    signToken(env.TOKEN_SECRET, { sessionCode, role: 'stage' }),
  ]);
  return { sessionCode, code: sessionCode, hostToken, stageToken, joinUrl: joinUrlForCode(env, sessionCode) };
}

/* -------------------------------------------------------------------- join */

/** A name and seat the deployment resolved from its own invite credential. */
export interface JoinIdentity {
  displayName: string;
  seatKey: string;
}

/**
 * POST /api/join. `resolveIdentity` sees the parsed body and the normalised
 * code; it returns the identity to seat, nothing (anonymous / pseudonymous),
 * or a rejection.
 */
export async function joinRoute(
  env: LiveEnv,
  request: Request,
  normalizeCode: (raw: string) => string,
  resolveIdentity: (
    body: Record<string, unknown>,
    code: string,
  ) => Promise<{ ok: true; identity?: JoinIdentity } | { ok: false; response: Response }>,
): Promise<Response> {
  const body = await readJson(request);
  const rawCode = typeof body?.code === 'string' ? body.code : '';
  if (body === null || rawCode === '') return json({ error: 'missing-code' }, 400);
  const code = normalizeCode(rawCode);
  if (Object.prototype.hasOwnProperty.call(body, 'recoveryHandle') && typeof body.recoveryHandle !== 'string') {
    return json({ error: 'invalid-handle', message: 'Enter your session handle.' }, 400);
  }
  const recoveryHandle = typeof body.recoveryHandle === 'string' ? body.recoveryHandle : undefined;

  const resolved = await resolveIdentity(body, code);
  if (!resolved.ok) return resolved.response;

  const response = await sessionStub(env, code).fetch(sessionDoUrl('/__join'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(recoveryHandle === undefined ? {} : { recoveryHandle }),
      ...(resolved.identity === undefined ? {} : { identity: resolved.identity }),
    }),
  });
  if (!response.ok) return withApiHeaders(response);

  const result = (await response.json()) as {
    sessionCode: string;
    participantId: string;
    identityMode?: string;
    handle?: string;
  };
  const participantToken = await signToken(env.TOKEN_SECRET, {
    sessionCode: result.sessionCode,
    role: 'participant',
    participantId: result.participantId,
  });
  return json({
    sessionCode: result.sessionCode,
    participantToken,
    participantId: result.participantId,
    ...(result.identityMode === undefined ? {} : { identityMode: result.identityMode }),
    ...(result.handle === undefined ? {} : { handle: result.handle }),
  });
}

/* ----------------------------------------------------------------- session */

/** GET /api/sessions/:code/state */
export async function stateRoute<G>(live: Live<G>, request: Request, url: URL, sessionCode: string): Promise<Response> {
  const requestedRole = url.searchParams.get('role');
  const auth = await authenticate(live, request, url, sessionCode);
  if (!auth.ok) return auth.response;
  if (requestedRole !== null && requestedRole !== auth.payload.role) {
    return json({ error: 'role-mismatch' }, 403);
  }

  const params: Record<string, string> = { role: auth.payload.role };
  if (auth.payload.facilitatorId) params.facilitatorId = auth.payload.facilitatorId;
  if (auth.payload.role === 'host') params.canRecover = String(auth.canRecover);
  const after = url.searchParams.get('afterRevision');
  if (after !== null) params.afterRevision = after;
  if (auth.payload.participantId !== undefined) params.participantId = auth.payload.participantId;

  return withApiHeaders(await sessionStub(live.env, sessionCode).fetch(sessionDoUrl('/__state', params)));
}

/** POST /api/sessions/:code/commands */
export async function commandRoute<G>(live: Live<G>, request: Request, url: URL, sessionCode: string): Promise<Response> {
  const auth = await authenticate(live, request, url, sessionCode);
  if (!auth.ok) return auth.response;

  const body = await readJson(request);
  if (body === null) return json({ ok: false, error: 'invalid-json' }, 400);

  // Both client shapes are accepted: the SDK posts { idempotencyKey, command }
  // and the host posts { idempotencyKey, expectedRevision, command }.
  const command = body.command as Command | undefined;
  if (typeof command !== 'object' || command === null || typeof command.command !== 'string') {
    return json({ ok: false, error: { code: 'E_INVALID_COMMAND', message: 'missing command' } }, 422);
  }
  if (auth.grant !== undefined && !(await live.authority.commandAllowed(auth.grant, sessionCode, command))) {
    return json({ ok: false, error: { code: 'E_FORBIDDEN', message: 'Presentation access has changed.' } }, 403);
  }
  const idempotencyKey =
    typeof body.idempotencyKey === 'string' && body.idempotencyKey !== ''
      ? body.idempotencyKey
      : crypto.randomUUID();
  const expectedRevision =
    typeof body.expectedRevision === 'number' && Number.isFinite(body.expectedRevision)
      ? body.expectedRevision
      : undefined;

  // The actor is ALWAYS derived from the verified token; a client-sent actor is
  // ignored outright (PRD §12: never embed host authority in a client).
  const envelope = {
    idempotencyKey,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    actor: {
      role: auth.payload.role,
      ...(auth.payload.facilitatorId ? { facilitatorId: auth.payload.facilitatorId } : {}),
      ...(auth.payload.participantId === undefined ? {} : { participantId: auth.payload.participantId }),
    },
    command,
  };

  const response = await sessionStub(live.env, sessionCode).fetch(sessionDoUrl('/__command'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
  });

  if (response.ok && command.command === 'session.end') {
    await live.authority.sessionEnded(sessionCode);
  }

  return withApiHeaders(response);
}

/** GET /api/sessions/:code/export — host only. */
export async function exportRoute<G>(live: Live<G>, request: Request, url: URL, sessionCode: string): Promise<Response> {
  const auth = await authenticate(live, request, url, sessionCode, 'host');
  if (!auth.ok) return auth.response;
  const format = parseExportFormat(url.searchParams.get('format'));
  const allowBallots = format === 'ballots' && (await live.authority.mayExportBallots(sessionCode));
  const exported = await sessionStub(live.env, sessionCode).fetch(
    sessionDoUrl('/__export', { format, ...(allowBallots ? { allowBallots: '1' } : {}) }),
  );
  if (format === 'ballots' && exported.status === 410) {
    const archived = await live.authority.archivedBallots(sessionCode);
    if (archived !== null) {
      return new Response(archived, {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'cache-control': 'no-store',
          'content-disposition': `attachment; filename="openroom-${sessionCode}-ballots.csv"`,
        },
      });
    }
  }
  return withApiHeaders(exported);
}

/** GET /api/sessions/:code/ws — WebSocket upgrade, any role. */
export async function wsRoute<G>(live: Live<G>, request: Request, url: URL, sessionCode: string): Promise<Response> {
  const auth = await authenticate(live, request, url, sessionCode);
  if (!auth.ok) return auth.response;
  return sessionStub(live.env, sessionCode).fetch(
    sessionDoUrl('/__ws', {
      role: auth.payload.role,
      ...(auth.payload.participantId ? { participantId: auth.payload.participantId } : {}),
    }),
    { headers: request.headers },
  );
}

/**
 * GET /api/sessions/:code/stage-token — the host can always re-mint the
 * projector URL; a console recovered on another machine has no stage token.
 */
export async function stageTokenRoute<G>(live: Live<G>, request: Request, url: URL, sessionCode: string): Promise<Response> {
  const auth = await authenticate(live, request, url, sessionCode, 'host');
  if (!auth.ok) return auth.response;
  const stageToken = await signToken(live.env.TOKEN_SECRET, { sessionCode, role: 'stage' });
  return json({ stageToken });
}

/**
 * /api/sessions/:code/assets/:id — PUT (host) stores a resource the session's
 * outline names; GET/HEAD serve it to every surface without a token.
 */
export async function sessionAssetRoute<G>(
  live: Live<G>,
  request: Request,
  url: URL,
  sessionCode: string,
  resourceId: string,
): Promise<Response> {
  if (request.method === 'PUT') {
    const auth = await authenticate(live, request, url, sessionCode, 'host');
    if (!auth.ok) return auth.response;
  } else if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method-not-allowed' }, 405);
  }
  const headers = new Headers();
  for (const name of ['content-type', 'content-length', 'x-openroom-sha256', 'range']) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const response = await sessionStub(live.env, sessionCode).fetch(
    sessionDoUrl(`/__assets/${encodeURIComponent(resourceId)}`),
    {
      method: request.method,
      headers,
      ...(request.method === 'PUT' ? { body: request.body } : {}),
    },
  );
  return new Response(response.body, { status: response.status, headers: response.headers });
}

/* ------------------------------------------------------------------ static */

/**
 * Serve the participant SPA for `join.*` hosts by mapping `/` → `/join/`.
 * The Vite build uses `base: '/join/'`, so asset URLs already include that
 * prefix and pass through unchanged.
 */
export async function serveJoinHost(request: Request, assets: Fetcher, url: URL): Promise<Response> {
  let path = url.pathname;
  if (path === '/' || path === '') {
    path = '/join/';
  } else if (!path.startsWith('/join/') && path !== '/join') {
    // Client-side route on the join host — serve the SPA shell.
    return assets.fetch(new Request(new URL('/join/index.html', url.origin).toString(), request));
  }
  const assetUrl = new URL(path, url.origin);
  assetUrl.search = url.search;
  const res = await assets.fetch(new Request(assetUrl.toString(), request));
  if (res.status === 404 && request.method === 'GET') {
    return assets.fetch(new Request(new URL('/join/index.html', url.origin).toString(), request));
  }
  return res;
}

/** Paths whose static files the relay serves: the stage and participant apps. */
export function isLivePagePath(pathname: string): boolean {
  return (
    pathname === '/join' ||
    pathname.startsWith('/join/') ||
    pathname === '/stage' ||
    pathname.startsWith('/stage/')
  );
}
