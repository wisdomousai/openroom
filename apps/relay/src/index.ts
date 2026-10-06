/**
 * OpenRoom relay — the live plane as its own Worker.
 *
 * Owns the `SessionDO` class and serves, on one origin:
 *
 *   POST /api/sessions                      create (Bearer RELAY_KEY)
 *   POST /api/join                          anonymous / pseudonymous join
 *   GET  /api/sessions/:code/state          snapshot (any capability token)
 *   POST /api/sessions/:code/commands       command (any capability token)
 *   GET  /api/sessions/:code/ws             WebSocket (any capability token)
 *   GET  /api/sessions/:code/export         export (host token)
 *   GET  /api/sessions/:code/stage-token    stage token (host token)
 *   PUT|GET|HEAD /api/sessions/:code/assets/:id
 *   /stage/*, /join/*, join.* host          the stage and participant apps
 *
 * Self-hosted alone, this is the whole live system: no D1, no accounts, no
 * limits beyond the ones the key holder sets. Hosted next to the control
 * plane, openroom.app is the front door: it binds this script's SessionDO
 * namespace (`script_name`) and forwards the static live pages here through
 * the RELAY service binding, so this Worker needs no public route of its own.
 */

import { generateSessionCode, normalizeSessionCode } from '@openroom/domain';
import { compileToOutline, parseStartOutline } from '@openroom/schema';

import { isJoinHost } from './join-url.js';
import {
  commandRoute,
  exportRoute,
  initSession,
  issueSessionTokens,
  joinRoute,
  json,
  readJson,
  serveJoinHost,
  sessionAssetRoute,
  stageTokenRoute,
  stateRoute,
  withApiHeaders,
  wsRoute,
  type Live,
  type LiveAuthority,
  type LiveEnv,
} from './live.js';
import { SessionDO } from './session-do.js';

export { SessionDO };

export interface Env extends LiveEnv {
  ASSETS: Fetcher;
  /** Bearer key for POST /api/sessions. Unset: creation is disabled. */
  RELAY_KEY?: string;
}

/** The host seat on a relay session is the one its creator holds. */
const RELAY_FACILITATOR_ID = 'creator';

/**
 * Standalone authority: the capability token is the whole credential.
 * Account-bound host tokens belong to the control plane, which rechecks them
 * in D1 on every call; they are refused here.
 */
const relayAuthority: LiveAuthority<never> = {
  async host(payload) {
    if (payload.userId !== undefined) {
      return { ok: false, response: json({ error: 'account-session' }, 403) };
    }
    return { ok: true, canRecover: true };
  },
  async commandAllowed() {
    return true;
  },
  async sessionEnded() {},
  async mayExportBallots() {
    return true;
  },
  async archivedBallots() {
    return null;
  },
};

const encoder = new TextEncoder();

async function keyMatches(presented: string, expected: string): Promise<boolean> {
  // Equal-length digests, compared in constant time inside the runtime.
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(presented)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? (match[1] as string).trim() : null;
}

/**
 * POST /api/sessions — `{ outline, participantLimit? }` with
 * `Authorization: Bearer <RELAY_KEY>`. No limit unless the body sets one.
 */
async function createSessionRoute(request: Request, env: Env): Promise<Response> {
  const relayKey = env.RELAY_KEY?.trim() ?? '';
  if (relayKey === '') return json({ ok: false, error: 'creation-disabled' }, 403);
  const presented = bearer(request);
  if (presented === null || !(await keyMatches(presented, relayKey))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = await readJson(request);
  if (body === null) return json({ ok: false, error: 'invalid-json' }, 400);
  const source = body.outline;
  if (source === undefined) return json({ ok: false, error: 'missing-outline' }, 400);
  const validation = typeof source === 'string' ? parseStartOutline(source) : compileToOutline(source);
  if (!validation.ok) return json({ ok: false, errors: validation.errors }, 422);
  const outline = validation.outline;

  // Identified and roster sessions verify invites against workspace records.
  const identityMode = outline.defaults?.identityMode;
  if (identityMode === 'identified' || identityMode === 'roster') {
    return json({ ok: false, error: 'identity-mode-unavailable', identityMode }, 422);
  }

  let participantLimit: number | undefined;
  if (body.participantLimit !== undefined) {
    if (!Number.isInteger(body.participantLimit) || (body.participantLimit as number) < 1) {
      return json({ ok: false, error: 'invalid-participant-limit' }, 400);
    }
    participantLimit = body.participantLimit as number;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sessionCode = generateSessionCode();
    const init = await initSession(env, {
      outline,
      sessionCode,
      outlineVersion: 1,
      facilitator: { id: RELAY_FACILITATOR_ID, name: 'Presenter' },
      ...(participantLimit === undefined ? {} : { participantLimit }),
    });
    if (init.status === 409) continue; // code already taken — draw another
    if (!init.ok) return withApiHeaders(init);
    const created = await issueSessionTokens(env, sessionCode, { facilitatorId: RELAY_FACILITATOR_ID });
    return json(created, 201);
  }
  return json({ ok: false, error: 'session-allocation-failed' }, 503);
}

async function joinRelayRoute(request: Request, env: Env): Promise<Response> {
  return joinRoute(env, request, normalizeSessionCode, async (body) => {
    if (
      Object.prototype.hasOwnProperty.call(body, 'contextLink') ||
      Object.prototype.hasOwnProperty.call(body, 'rosterInvite')
    ) {
      return {
        ok: false,
        response: json(
          { error: 'identified-join-unavailable', message: 'This server takes anonymous and pseudonymous joins only.' },
          403,
        ),
      };
    }
    return { ok: true };
  });
}

async function serveStatic(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === '/favicon.ico') {
    const icon = await env.ASSETS.fetch(new Request(new URL('/favicon.svg', url.origin).toString()));
    if (icon.ok) {
      return new Response(icon.body, {
        status: 200,
        headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' },
      });
    }
  }
  if (isJoinHost(url.hostname)) return serveJoinHost(request, env.ASSETS, url);
  if (url.pathname === '/' || url.pathname === '') {
    const dest = new URL('/join/', url);
    dest.search = url.search;
    return Response.redirect(dest.toString(), 302);
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith('/api/')) return serveStatic(request, env, url);

    if (path === '/api/health') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'method-not-allowed' }, 405);
      return json({ status: 'ok' });
    }
    if (path === '/api/sessions') {
      if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
      return createSessionRoute(request, env);
    }
    if (path === '/api/join') {
      if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
      return joinRelayRoute(request, env);
    }

    const live: Live<never> = { env, authority: relayAuthority };

    const assetMatch = /^\/api\/sessions\/([^/]+)\/assets\/([^/]+)$/.exec(path);
    if (assetMatch !== null) {
      return sessionAssetRoute(
        live,
        request,
        url,
        normalizeSessionCode(decodeURIComponent(assetMatch[1] as string)),
        decodeURIComponent(assetMatch[2] as string),
      );
    }

    const sessionMatch = /^\/api\/sessions\/([^/]+)\/(state|commands|export|ws|stage-token)$/.exec(path);
    if (sessionMatch !== null) {
      const sessionCode = normalizeSessionCode(decodeURIComponent(sessionMatch[1] as string));
      const leaf = sessionMatch[2];
      if (leaf === 'state' && request.method === 'GET') return stateRoute(live, request, url, sessionCode);
      if (leaf === 'commands' && request.method === 'POST') return commandRoute(live, request, url, sessionCode);
      if (leaf === 'export' && request.method === 'GET') return exportRoute(live, request, url, sessionCode);
      if (leaf === 'ws') return wsRoute(live, request, url, sessionCode);
      if (leaf === 'stage-token' && request.method === 'GET') return stageTokenRoute(live, request, url, sessionCode);
      return json({ error: 'method-not-allowed' }, 405);
    }

    return json({ error: 'not-found' }, 404);
  },
} satisfies ExportedHandler<Env>;
