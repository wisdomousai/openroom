/**
 * OpenRoom control-plane Worker router (hand-rolled).
 *
 * The front door for openroom.app and join.openroom.app. Everything under
 * /api/* is handled here, the live session routes included: they are the
 * relay's implementation (`openroom-relay/live`) run under this deployment's
 * authority, talking to the relay's SessionDO namespace directly (cross-script
 * binding). The stage and participant apps (`/stage/`, `/join/`, the join
 * host) are forwarded to the relay Worker over the RELAY service binding;
 * every other request is served from this Worker's static asset binding.
 * Marketing owns apex `/`. HTML security headers come from `public/_headers`;
 * API responses get `no-store` + JSON content type here. Marketing HTML also negotiates `Accept: text/markdown`
 * into an agent-oriented Markdown twin of the same URL. Well-known discovery (OAuth metadata, RFC 9727 API
 * catalog) is handled before ASSETS so static hosting cannot swallow it.
 */

import { generateSessionCode, normalizeSessionCode } from '@openroom/domain';
import { serveOffice } from './office';
import { resumeSessionRoute } from './deck-start';
import { startPresentationRoute } from './presentation-start';
import { compileOutline, compileToOutline, parseStartOutline, type Outline } from '@openroom/schema';

import {
  authStatusRoute,
  demoLoginRoute,
  desktopRedeemRoute,
  googleCallbackRoute,
  googleStartRoute,
  logoutRoute,
  meRoute,
  type ControlEnv,
  type SessionUser,
} from './auth.js';
import { facilitateSessionRoute, facilitatorAccess, facilitatorCommandAllowed, registerSessionFacilitator, type FacilitatorAccess } from './facilitation.js';
import { accountRecapRoute, forwardRecap } from './recap-route.js';
import { connectionsRoute } from './oauth-connections.js';
import { mySessionsRoute, recordLiveSession, sessionQuotaExceeded } from './control.js';
import { spaceRole } from './members.js';
import { sharingRoute } from './sharing';
import {
  createFolderRoute,
  createFolderDeletionIntentRoute,
  copyFolderRoute,
  deleteFolderRoute,
  getSpaceRoute,
  patchSpaceRoute,
  listTrashedFoldersRoute,
  patchFolderRoute,
  restoreFolderRoute,
  trashFolderRoute,
} from './workspace.js';
import { sessionDictionaryRoute } from './dictionary-route.js';
import { a2aRoute } from './a2a.js';
import { agentCardRoute } from './agent-card.js';
import { apiCatalogRoute, healthRoute, openapiRoute } from './api-catalog/index.js';
import { listTokensRoute, mintTokenRoute, revokeTokenRoute } from './api-tokens.js';
import { mcpRoute, mcpServerCardRoute } from './mcp.js';
import { authMdResponse } from './auth-md.js';
import {
  authorizationServerMetadata,
  authorizeRoute,
  protectedResourceMetadata,
  registerRoute,
  tokenRoute,
  revokeOAuthRoute,
  connectionActive,
} from './mcp-oauth.js';
import { contextIdForSessionCode, verifyContextLink } from './context-links.js';
import {
  listRosterSeats,
  mintRosterSeat,
  requireNamedSessionAccess,
  revokeRosterSeat,
  verifyRosterInvite,
} from './roster.js';
import { handleLearnerApi } from './learner.js';
import { cleanupRetainedMedia } from './operations/retention.js';
import { absolutizeJoinUrl, isJoinHost } from 'openroom-relay/join-url';
import {
  authenticate as authenticateLive,
  commandRoute as liveCommandRoute,
  exportRoute as liveExportRoute,
  initSession,
  isLivePagePath,
  issueSessionTokens,
  joinRoute as liveJoinRoute,
  json,
  readJson,
  sessionAssetRoute as liveSessionAssetRoute,
  sessionDoUrl as doUrl,
  sessionStub as stub,
  stageTokenRoute as liveStageTokenRoute,
  stateRoute as liveStateRoute,
  withApiHeaders,
  wsRoute as liveWsRoute,
  type CreatedSession,
  type JoinIdentity,
  type Live,
  type LiveAuth,
  type LiveAuthority,
} from 'openroom-relay/live';
import type { Role } from 'openroom-relay/tokens';
import { negotiateMarkdown } from './markdown-negotiation.js';
import { umamiWebsiteId, withUmami } from './umami.js';
import {
  confirmPermanentDeletionRoute,
  deletionConfirmationPage,
  handleTutoringApi,
} from './tutoring.js';
import { handleTagApi } from './tags.js';
import { handleAssetApi } from './assets.js';
import { homeRoute } from './home.js';
import { prefsRoute } from './prefs.js';
import { endSessionForCode, type SessionLaunchInput } from './delivery/index.js';
import {
  archivedBallotsCsv,
  downloadArchiveRoute,
  listArchivesRoute,
  maybeArchiveEndedSession,
} from './archives.js';
import { readEntitlements, sessionEntitlementOwner, sessionParticipantLimit } from './entitlements.js';
import { contextOwnerId, ownerHasContinuity, requireIdentifiedSessionAccess } from './continuity-access.js';
import { requireControlUser } from './control-auth.js';
import { paddleWebhookRoute } from './billing/webhook';
import { reconcileBilling } from './billing/reconcile';
import { billingRoute } from './billing/routes';

export type { CreatedSession };

export interface Env extends ControlEnv {
  /** The relay's SessionDO namespace (`script_name: "openroom-relay"`). */
  SESSIONS: DurableObjectNamespace;
  /** The relay Worker: serves the stage and participant apps. */
  RELAY: Fetcher;
  ASSETS: Fetcher;
  /** Uploaded pictures and video for the deck editor media library (assets.ts). */
  MEDIA: R2Bucket;
  TOKEN_SECRET: string;
  ADMIN_KEY: string;
  /** Canonical join origin, e.g. https://join.openroom.app */
  JOIN_ORIGIN?: string;
  /** Plain-text token for OpenAI plugin domain verification. */
  OPENAI_APPS_CHALLENGE?: string;
  /**
   * Umami Cloud website id. When set, public-site HTML loads
   * `cloud.umami.is/script.js`. Unset ships those pages with no tracker.
   * The workspace, join, and stage apps never load it.
   */
  UMAMI_WEBSITE_ID?: string;
}

/**
 * The control plane's authority over the shared live routes. Account-bound
 * host tokens are rechecked against D1 on every call (revoked connection,
 * removed facilitator); `session.end` archives; ballots exports follow the
 * owner's paid access and fall back to the archive.
 */
function controlAuthority(env: Env): LiveAuthority<FacilitatorAccess> {
  return {
    async host(payload, sessionCode) {
      if (payload.userId === undefined) return { ok: true, canRecover: true };
      if (payload.connectionId && !(await connectionActive(env, payload.connectionId, payload.userId))) {
        return { ok: false, response: json({ error: 'connection-revoked' }, 403) };
      }
      const facilitator = await facilitatorAccess(env, sessionCode, payload.userId);
      if (!facilitator) return { ok: false, response: json({ error: 'session-access-revoked' }, 403) };
      return { ok: true, grant: facilitator, canRecover: facilitator.canRecover };
    },
    commandAllowed: (grant, sessionCode, command) => facilitatorCommandAllowed(env, sessionCode, grant, command),
    sessionEnded: (sessionCode) => finishEndedSession(env, sessionCode),
    mayExportBallots: (sessionCode) => ownerMayExportBallots(env, sessionCode),
    archivedBallots: (sessionCode) => archivedBallotsCsv(env, sessionCode),
  };
}

function liveFor(env: Env): Live<FacilitatorAccess> {
  return { env, authority: controlAuthority(env) };
}

function authenticate(
  request: Request,
  url: URL,
  env: Env,
  sessionCode: string,
  requiredRole?: Role,
): Promise<LiveAuth<FacilitatorAccess>> {
  return authenticateLive(liveFor(env), request, url, sessionCode, requiredRole);
}

/* ------------------------------------------------------------------ routes */

/**
 * POST /api/sessions — an authenticated account OR the ops admin key.
 *
 * Cookie, PAT and OAuth clients share account quotas, paid-access checks and
 * ownership. The admin key remains an unquota'd ops override and creates an
 * unowned session with no participant limit. These control-plane checks never
 * run on the ballot hot path.
 */

/**
 * The auth-free core of session creation: init the DO, sign the token pair.
 * Callers own authentication, quota, and D1 ownership records. Direct creation
 * checks paid identity features here; durable launches check before reservation.
 * `outline` must already be validated. Shared by REST and MCP creation.
 */
export async function createSessionFromOutline(
  env: Env,
  outline: Outline,
  options: { outlineVersion?: number; user?: SessionUser; entitlementOwnerId?: string; connectionId?: string; reservedCode?: string; initialFacilitator?: { id: string; name: string } } = {},
): Promise<{ ok: true; session: CreatedSession } | { ok: false; response: Response }> {
  // Durable launches check before reservation. Every direct creation, including MCP,
  // comes through this check before a live audience can be allocated.
  if (!options.reservedCode && outline.defaults?.identityMode === 'roster') {
    const blocked = await requireNamedSessionAccess(env, options.entitlementOwnerId ?? options.user?.id ?? null);
    if (blocked) return { ok: false, response: blocked };
  }
  if (!options.reservedCode && outline.defaults?.identityMode === 'identified') {
    const blocked = await requireIdentifiedSessionAccess(env, options.entitlementOwnerId ?? options.user?.id ?? null);
    if (blocked) return { ok: false, response: blocked };
  }
  const sessionCode = options.reservedCode ?? generateSessionCode();
  // Read once here and carried into the DO, so joins never touch D1. A retried
  // durable launch whose DO already exists keeps the limit it was created with.
  const participantLimit = await sessionParticipantLimit(env, options.entitlementOwnerId ?? options.user?.id ?? null);

  const initResponse = await initSession(env, {
    outline,
    sessionCode,
    ...(participantLimit === null ? {} : { participantLimit }),
    ...(options.initialFacilitator ? { facilitator: options.initialFacilitator } : options.user ? { facilitator: { id: options.user.id, name: options.user.name?.trim().slice(0, 200) || 'Presenter' } } : {}),
    ...(options.outlineVersion === undefined ? {} : { outlineVersion: options.outlineVersion }),
  });
  if (!initResponse.ok) {
    const alreadyInitialized = options.reservedCode && initResponse.status === 409 && (await initResponse.clone().json() as { error?: string }).error === 'already-initialized';
    if (!alreadyInitialized) return { ok: false, response: withApiHeaders(initResponse) };
  }

  const session = await issueSessionTokens(
    env,
    sessionCode,
    options.user
      ? { facilitatorId: options.user.id, userId: options.user.id, ...(options.connectionId ? { connectionId: options.connectionId } : {}) }
      : {},
  );
  return { ok: true, session };
}

/** Shared launch service for browser REST, MCP, and future CLI calls. */
export async function launchSessionForUser(
  env: Env,
  input: SessionLaunchInput,
  user: SessionUser,
): Promise<Response> {
  const validation = compileOutline(input.outline);
  // The stored deck content is what failed, not anything in the request —
  // the same condition, and the same literal, the MCP deck tools answer with.
  if (!validation.ok) return json({ error: 'invalid-deck-content', errors: validation.errors }, 422);
  const now = Date.now();
  type Allocation = { code: string; user_id: string; name: string; deck_version: number; created_at: number; ended: number; collaboration_enabled: number; space_id: string | null };
  const allocation = () => env.DB.prepare(`SELECT l.code,l.user_id,u.name,l.deck_version,l.created_at,l.ended,l.collaboration_enabled,l.space_id
    FROM live_sessions l JOIN users u ON u.id = l.user_id WHERE l.session_id = ?1`).bind(input.sessionId).first<Allocation>();
  let reserved = await allocation();
  // Space-scoped features (the dictionary's language pair among them) resolve
  // a session through its space, so the launch must stamp the deck's.
  const deckSpace =
    typeof input.deckId === 'string' && input.deckId !== ''
      ? await env.DB.prepare('SELECT space_id FROM decks WHERE id = ?1')
          .bind(input.deckId)
          .first<{ space_id: string | null }>()
      : null;
  let collaborationEnabled = false;
  let entitlementOwnerId = user.id;
  if (deckSpace?.space_id) {
    const access = await spaceRole(env, user, deckSpace.space_id);
    if (!access) return json({ error: 'not-found' }, 404);
    entitlementOwnerId = access.space.owner_user_id;
    collaborationEnabled = (await readEntitlements(env, access.space.owner_user_id)).team;
    if (access.space.owner_user_id !== user.id && !collaborationEnabled && !(reserved?.collaboration_enabled && reserved.space_id === deckSpace.space_id)) {
      return json({ error: 'team-required' }, 403);
    }
  }
  if (!reserved) {
    if (validation.outline.defaults?.identityMode === 'roster') {
      const blocked = await requireNamedSessionAccess(env, entitlementOwnerId);
      if (blocked) return blocked;
    }
    if (validation.outline.defaults?.identityMode === 'identified') {
      const blocked = await requireIdentifiedSessionAccess(env, entitlementOwnerId);
      if (blocked) return blocked;
    }
    if (await sessionQuotaExceeded(env, user.id, now)) return json({ error: 'session-quota' }, 429);
    // The unique session_id index chooses one code even for competing start requests.
    // A failed response can retry this same durable session without creating another audience.
    for (let attempt = 0; attempt < 3 && !reserved; attempt++) {
      await env.DB.prepare(`INSERT OR IGNORE INTO live_sessions
        (code,user_id,title,created_at,ended,space_id,deck_id,deck_version,session_id,collaboration_enabled)
        VALUES (?1,?2,?3,?4,0,?5,?6,?7,?8,?9)`)
        .bind(generateSessionCode(), user.id, input.title, now, deckSpace?.space_id ?? null, input.deckId, input.version, input.sessionId, collaborationEnabled ? 1 : 0).run();
      reserved = await allocation();
    }
  }
  if (!reserved) return json({ error: 'session-allocation-failed' }, 503);
  if (reserved.ended) return json({ error: 'session-already-ended' }, 409);
  if (reserved.deck_version !== input.version) return json({ error: 'session-version-conflict' }, 409);
  const before = await stub(env, reserved.code).fetch(doUrl('/__state', { role: 'stage' }));
  if (before.status === 404 && now - reserved.created_at > 10 * 60_000) return json({ error: 'session-expired' }, 410);
  if (before.ok && (await before.json() as { status: string }).status === 'ended') return json({ error: 'session-already-ended' }, 409);
  if (!before.ok && before.status !== 404) return withApiHeaders(before);
  const created = await createSessionFromOutline(env, validation.outline, {
    outlineVersion: input.version,
    user,
    entitlementOwnerId,
    reservedCode: reserved.code,
    initialFacilitator: { id: reserved.user_id, name: reserved.name?.trim().slice(0, 200) || 'Presenter' },
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
  });
  if (!created.ok) return created.response;
  const access = await facilitatorAccess(env, reserved.code, user.id);
  if (!access) return json({ error: 'session-not-found' }, 404);
  const registered = await registerSessionFacilitator(env, reserved.code, access);
  if (!registered.ok) return registered;
  const snapshot = async () => {
    const result = await stub(env, reserved!.code).fetch(doUrl('/__state', { role: 'host', facilitatorId: user.id }));
    if (!result.ok) return null;
    return result.json() as Promise<{ status: 'lobby' | 'live' | 'ended' }>;
  };
  let current = await snapshot();
  if (!current) return json({ error: 'session-unavailable' }, 503);
  let startFailed: string | undefined;
  if (input.start && current.status === 'lobby') {
    const started = await stub(env, created.session.sessionCode).fetch(doUrl('/__command'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: `session-launch-${input.sessionId}`,
        actor: { role: 'host', facilitatorId: user.id },
        command: { command: 'session.start', ...(input.cursor === undefined ? {} : { cursor: input.cursor }) },
      }),
    });
    current = await snapshot();
    if (!started.ok && current?.status !== 'live') {
      startFailed = `session-start-failed:${String(started.status)}`;
    }
  }
  if (!current) return json({ error: 'session-unavailable' }, 503);
  if (current.status === 'ended') return json({ error: 'session-already-ended' }, 409);
  const sessionStatus = current.status === 'live' ? 'live' : 'draft';
  await env.DB.prepare(
    "UPDATE sessions SET status = CASE WHEN status = 'ended' THEN status WHEN status = 'live' AND ?1 = 'draft' THEN status ELSE ?1 END, deck_version = ?2, updated_at = ?3 WHERE id = ?4 AND deleted_at IS NULL",
  )
    .bind(sessionStatus, input.version, now, input.sessionId)
    .run();

  return json({
    ...created.session,
    sessionId: input.sessionId,
    deckId: input.deckId,
    deckVersion: input.version,
    status: sessionStatus,
    started: current.status === 'live',
    ...(startFailed === undefined ? {} : { startFailed }),
  }, 201);
}

/**
 * Does this POST /api/sessions body ask for a durable session of a deck?
 *
 * Reads a clone so the handler that follows still owns the real body. An
 * unreadable or non-object body is not a deck body — the live handler reports
 * the malformed JSON, so the answer stays one error message rather than two.
 */
async function bodyNamesADeck(request: Request): Promise<boolean> {
  try {
    const body: unknown = await request.clone().json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
    const deckId = (body as { deckId?: unknown }).deckId;
    return typeof deckId === 'string' && deckId !== '';
  } catch {
    return false;
  }
}

async function createLiveSessionRoute(request: Request, env: Env): Promise<Response> {
  const adminHeader = request.headers.get('x-openroom-admin');
  let sessionUser: SessionUser | null = null;
  let connectionId: string | undefined;

  if (adminHeader !== null) {
    if (adminHeader !== env.ADMIN_KEY) return json({ ok: false, error: 'unauthorized' }, 401);
  } else {
    const guard = await requireControlUser(request, env, true);
    if (!guard.ok) return guard.response;
    sessionUser = guard.user;
    connectionId = guard.connectionId;
  }
  const ownerId = sessionUser?.id ?? null;

  const body = await readJson(request);
  if (body === null) return json({ ok: false, error: 'invalid-json' }, 400);

  const source = body.outline;
  if (source === undefined) return json({ ok: false, error: 'missing-outline' }, 400);
  const outlineValidation =
    typeof source === 'string' ? parseStartOutline(source) : compileToOutline(source);
  if (!outlineValidation.ok) return json({ ok: false, errors: outlineValidation.errors }, 422);
  const outline = outlineValidation.outline;

  const now = Date.now();
  if (ownerId !== null && (await sessionQuotaExceeded(env, ownerId, now))) {
    return json({ ok: false, error: 'session-quota' }, 429);
  }

  // Any space role — including presenter — may launch sessions in the space.
  let spaceIdForRecord: string | null = null;
  let entitlementOwnerId = ownerId;
  if (sessionUser !== null && typeof body.spaceId === 'string' && body.spaceId !== '') {
    const access = await spaceRole(env, sessionUser, body.spaceId);
    if (access === null) return json({ ok: false, error: 'not-found' }, 404);
    entitlementOwnerId = access.space.owner_user_id;
    if (access.space.owner_user_id !== sessionUser.id && !(await readEntitlements(env, access.space.owner_user_id)).team) {
      return json({ error: 'team-required' }, 403);
    }
    spaceIdForRecord = body.spaceId;
  }

  const created = await createSessionFromOutline(env, outline, { outlineVersion: 1, ...(sessionUser ? { user: sessionUser } : {}), ...(entitlementOwnerId ? { entitlementOwnerId } : {}), ...(connectionId ? { connectionId } : {}) });
  if (!created.ok) return created.response;

  if (ownerId !== null) {
    await recordLiveSession(env, created.session.code, ownerId, outline.meta.title, now, {
      spaceId: spaceIdForRecord,
    });
  }

  return json({ ...created.session }, 201);
}

/**
 * POST /api/join on the front door. Anonymous and pseudonymous joins need
 * nothing beyond the shared live route; an invite credential is verified here
 * against D1 and only its resolved name and seat key reach the session.
 */
function joinRoute(request: Request, env: Env): Promise<Response> {
  return liveJoinRoute(env, request, normalizeSessionCode, (body, code) => resolveJoinIdentity(env, body, code));
}

async function resolveJoinIdentity(
  env: Env,
  body: Record<string, unknown>,
  code: string,
): Promise<{ ok: true; identity?: JoinIdentity } | { ok: false; response: Response }> {
  /*
   * Optional context access link. Two independent checks, both required:
   *
   *  1. the link is live (unrevoked, unexpired, context not trashed), and
   *  2. the link's context is *this* session's originating context.
   *
   * (2) is the security requirement: without it any live link would identify
   * its holder into every session in the deployment. The association is proved
   * through the launch record (`live_sessions.session_id` → `sessions.context_id`); see
   * `contextIdForSessionCode`. A live session with no durable-session edge has no context and
   * therefore never enterable with a link.
   *
   * The link never leaves this function. Only the resolved display name and
   * the link id (a stable seat key, not the token) are forwarded to the
   * Durable Object, so a leaked session capability token can never be walked
   * back into a context credential.
   */
  if (
    Object.prototype.hasOwnProperty.call(body, 'contextLink') &&
    Object.prototype.hasOwnProperty.call(body, 'rosterInvite')
  ) {
    return { ok: false, response: json({ error: 'conflicting-credentials', message: 'Use one kind of invite.' }, 400) };
  }

  if (Object.prototype.hasOwnProperty.call(body, 'rosterInvite')) {
    if (typeof body.rosterInvite !== 'string' || body.rosterInvite === '') {
      return { ok: false, response: json({ error: 'invalid-roster-invite', message: 'That invite is not valid.' }, 400) };
    }
    const seat = await verifyRosterInvite(env, body.rosterInvite, code);
    if (seat === null) {
      return {
        ok: false,
        response: json({ error: 'roster-invite-invalid', message: 'That invite is not valid for this session.' }, 403),
      };
    }
    return { ok: true, identity: { displayName: seat.displayName, seatKey: seat.seatId } };
  }
  if (Object.prototype.hasOwnProperty.call(body, 'contextLink')) {
    if (typeof body.contextLink !== 'string' || body.contextLink === '') {
      return { ok: false, response: json({ error: 'invalid-context-link', message: 'That access link is not valid.' }, 400) };
    }
    const link = await verifyContextLink(env, body.contextLink);
    const sessionContextId = await contextIdForSessionCode(env, code);
    if (link === null || sessionContextId === null || sessionContextId !== link.contextId) {
      // One indistinguishable answer for "bad link", "revoked link", "expired
      // link", and "right link, wrong session": a probing holder learns nothing
      // about which sessions exist or which context a code belongs to.
      return {
        ok: false,
        response: json({ error: 'context-link-invalid', message: 'That access link is not valid for this session.' }, 403),
      };
    }
    return { ok: true, identity: { displayName: link.displayName, seatKey: link.learnerId } };
  }
  return { ok: true };
}

/**
 * GET /api/sessions/:code/context — what this session was launched for.
 *
 * A saved deck has a durable session even without a student context. Return that
 * identity independently so Notes and the Library handoff retain their destination.
 * Context still comes only from the durable session's context_id; it never controls
 * which document tools the console exposes.
 *
 * Host token only: this is the console's own bootstrap, and the answer names a
 * person. It is never on a participant, stage or learner surface.
 */
async function sessionContextRoute(
  request: Request,
  url: URL,
  env: Env,
  sessionCode: string,
): Promise<Response> {
  const auth = await authenticate(request, url, env, sessionCode, 'host');
  if (!auth.ok) return auth.response;

  const row = await env.DB.prepare(
    `SELECT session.id AS session_id, session.title AS session_title,
            ctx.id AS context_id, ctx.kind AS kind, ctx.display_name AS display_name,
            ctx.context_json AS context_json, ctx.next_note AS next_note
       FROM live_sessions ro
       JOIN sessions session ON session.id = ro.session_id
       LEFT JOIN contexts ctx ON ctx.id = session.context_id
      WHERE ro.code = ?1`,
  )
    .bind(sessionCode)
    .first<{
      session_id: string;
      session_title: string;
      context_id: string | null;
      kind: string | null;
      display_name: string | null;
      context_json: string | null;
      next_note: string | null;
    }>();

  if (row === null) return json({ context: null, session: null });

  const session = { id: row.session_id, title: row.session_title };
  if (row.context_id === null) return json({ context: null, session });

  let level: string | null = null;
  try {
    const parsed = JSON.parse(row.context_json ?? '{}') as { level?: unknown };
    if (typeof parsed.level === 'string' && parsed.level !== '') level = parsed.level;
  } catch {
    /* a context with unparseable JSON simply has no level to show */
  }

  // The "for next time" sticky is written from Notes, so it follows `continuity`.
  const nextNote = row.next_note && row.next_note !== ''
    && (await ownerHasContinuity(env, await contextOwnerId(env, row.context_id)))
    ? row.next_note : null;

  return json({
    context: {
      id: row.context_id,
      kind: row.kind,
      displayName: row.display_name,
      level,
      nextNote,
    },
    session,
  });
}

/** Called only after the DO accepts an end command, from REST and MCP alike. */
export async function finishEndedSession(env: Env, sessionCode: string): Promise<void> {
  await endSessionForCode(env, sessionCode);
  await maybeArchiveEndedSession(env, sessionCode, (format, allowBallots) =>
    stub(env, sessionCode).fetch(doUrl('/__export', { format, ...(allowBallots ? { allowBallots: '1' } : {}) })),
  );
}

/**
 * Ops sessions keep the full file. Account sessions use the space owner's
 * paid access, or the creator's when no space is attached.
 */
async function ownerMayExportBallots(env: Env, sessionCode: string): Promise<boolean> {
  const owner = await sessionEntitlementOwner(env, sessionCode);
  if (!owner) return true; // Ops sessions have no account directory row.
  if (!owner.userId) return owner.spaceId === null;
  const entitlements = await readEntitlements(env, owner.userId);
  return entitlements.rawExport;
}

/* ------------------------------------------------------------------ static */

/** Marketing host: SEO landing at `/`, legacy redirects, then ASSETS. */
async function serveMarketingHost(request: Request, env: Env, url: URL): Promise<Response> {
  // Old QR prints and bookmarks: openroom.app/?code=X → join host.
  if ((url.pathname === '/' || url.pathname === '') && url.searchParams.has('code')) {
    const code = url.searchParams.get('code') ?? '';
    const dest = absolutizeJoinUrl(env, `/?code=${code}`);
    return Response.redirect(new URL(dest, url).toString(), 301);
  }
  if (url.pathname === '/about' || url.pathname === '/about/') {
    const dest = new URL('/', url);
    dest.search = url.search;
    return Response.redirect(dest.toString(), 301);
  }
  // Agents requesting Accept: text/markdown get a formatting-stripped twin
  // of the same URL; browsers keep HTML (Cloudflare Markdown-for-Agents shape).
  const asset = await env.ASSETS.fetch(request);
  const page = await negotiateMarkdown(request, asset);
  const websiteId = umamiWebsiteId(env.UMAMI_WEBSITE_ID);
  // HEAD has no body to rewrite. Markdown twins are not text/html, so they
  // pass through withUmami unchanged.
  if (!websiteId || request.method !== 'GET') return page;
  return withUmami(page, url, websiteId);
}

async function serveStatic(request: Request, env: Env, url: URL): Promise<Response> {
  // The stage and participant apps ship with the relay; the join host, /join/
  // and /stage/ forward to it over the service binding. Same origin, so every
  // /api/* call those apps make still lands on this front door.
  if (isJoinHost(url.hostname) || isLivePagePath(url.pathname)) return env.RELAY.fetch(request);
  if (url.pathname === '/billing/pay') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const asset = await env.ASSETS.fetch(new Request(new URL('/host/checkout', url.origin), { method: request.method }));
    const response = new Response(asset.body, asset);
    response.headers.set('cache-control', 'no-store');
    response.headers.set('referrer-policy', 'no-referrer');
    response.headers.set('x-frame-options', 'DENY');
    response.headers.set('content-security-policy', "default-src 'self'; script-src 'self' https://cdn.paddle.com https://pw.paddle.com; connect-src 'self' https://*.paddle.com; frame-src https://*.paddle.com; img-src 'self' data: https://*.paddle.com; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    return response;
  }
  if (url.pathname === '/office' || url.pathname.startsWith('/office/')) return serveOffice(request, env, url);
  return serveMarketingHost(request, env, url);
}

/* ------------------------------------------------------------------ entry */

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (controller.cron === '*/5 * * * *') await reconcileBilling(env);
    else await cleanupRetainedMedia(env);
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = url.origin;

    /* Auth.md + MCP/OAuth/A2A discovery — outside /api/* so ASSETS does not swallow them. */
    if (path === '/auth.md') {
      return authMdResponse(origin);
    }
    if (path === '/.well-known/agent-card.json') {
      return agentCardRoute(origin);
    }
    if (path === '/.well-known/mcp/server-card.json') {
      return mcpServerCardRoute(origin);
    }
    if (
      path === '/.well-known/oauth-protected-resource' ||
      path === '/.well-known/oauth-protected-resource/api/mcp'
    ) {
      return protectedResourceMetadata(origin);
    }
    if (
      path === '/.well-known/oauth-authorization-server' ||
      path === '/.well-known/oauth-authorization-server/api/mcp'
    ) {
      return authorizationServerMetadata(origin);
    }
    if (path === '/.well-known/openai-apps-challenge') {
      const token = env.OPENAI_APPS_CHALLENGE;
      if (typeof token !== 'string' || token === '') {
        return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
      return new Response(token, {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }

    /* RFC 9727 API catalog + OpenAPI — same well-known placement as OAuth discovery. */
    if (path === '/.well-known/api-catalog') {
      return apiCatalogRoute(origin, request.method);
    }
    if (path === '/openapi.json') {
      return openapiRoute(origin, request.method);
    }

    const deletionConfirmationMatch = /^\/confirm-deletion\/([^/]+)$/.exec(path);
    if (deletionConfirmationMatch !== null) {
      const token = decodeURIComponent(deletionConfirmationMatch[1] as string);
      if (request.method === 'GET') return deletionConfirmationPage(request, env, token);
      if (request.method === 'POST') return confirmPermanentDeletionRoute(request, env, token);
      return json({ error: 'method-not-allowed' }, 405);
    }

    /* Browsers still probe /favicon.ico even when HTML links an SVG. */
    if (path === '/favicon.ico') {
      const icon = await env.ASSETS.fetch(new Request(new URL('/favicon.svg', url.origin).toString()));
      if (icon.ok) {
        return new Response(icon.body, {
          status: 200,
          headers: {
            'content-type': 'image/svg+xml',
            'cache-control': 'public, max-age=86400',
          },
        });
      }
    }

    if (!path.startsWith('/api/')) {
      return serveStatic(request, env, url);
    }

    if (path === '/api/health') {
      return healthRoute(request.method);
    }
    // Provider-signed requests have their own credential boundary.
    if (path === '/api/billing/paddle/webhook') return paddleWebhookRoute(request, env);

    /*
     * POST /api/sessions creates a session, and the body says which kind.
     *
     * A `deckId` body files a *durable* session against a deck — nothing goes
     * live, and the delivery plane owns it. An `outline` body
     * starts a *live* session right here and hands back the join code and the
     * host/stage token pair. One path, because both are "create a session";
     * two handlers, because the two answer different things.
     *
     * The peek reads a clone, so the chosen handler still gets an unread body.
     */
    if (path === '/api/sessions' && request.method === 'POST') {
      if (!(await bodyNamesADeck(request))) return createLiveSessionRoute(request, env);
      // Falls through to the delivery plane's `sessionsCollectionRoute`.
    }

    const sessionAssetMatch = /^\/api\/sessions\/([^/]+)\/assets\/([^/]+)$/.exec(path);
    if (sessionAssetMatch !== null) {
      return liveSessionAssetRoute(
        liveFor(env),
        request,
        url,
        normalizeSessionCode(decodeURIComponent(sessionAssetMatch[1] as string)),
        decodeURIComponent(sessionAssetMatch[2] as string),
      );
    }

    /*
     * Media plane. `GET /api/assets/{id}` is public and cacheable, so it is
     * matched here — ahead of every authenticated plane — and its response is
     * returned as built rather than through the `no-store` JSON headers.
     */
    {
      const asset = await handleAssetApi(request, env, url);
      if (asset !== null) return asset;
    }

    /* A2A JSON-RPC (advertised by /.well-known/agent-card.json). */
    if (path === '/api/a2a') {
      return a2aRoute(request, env);
    }

    /* MCP OAuth front door (ChatGPT web etc.) + the tool endpoint itself. */
    if (path === '/api/mcp/register') {
      return registerRoute(request, env);
    }
    if (path === '/api/mcp/authorize') {
      return authorizeRoute(request, url, env);
    }
    if (path === '/api/mcp/token') {
      return tokenRoute(request, env);
    }
    if (path === '/api/mcp/revoke') return revokeOAuthRoute(request, env);
    if (path === '/api/my/connections') return connectionsRoute(request, env);
    if (path === '/api/my/billing' || path.startsWith('/api/my/billing/')) return billingRoute(request, env, url);
    if (path === '/api/presentations/start') return startPresentationRoute(request, env, (input, user) => launchSessionForUser(env, input, user));
    const resumeMatch = /^\/api\/sessions\/([^/]+)\/resume$/.exec(path);
    if (resumeMatch) return resumeSessionRoute(request, env, decodeURIComponent(resumeMatch[1]!));
    const connectionMatch = /^\/api\/my\/connections\/([^/]+)$/.exec(path);
    if (connectionMatch) return connectionsRoute(request, env, decodeURIComponent(connectionMatch[1]!));
    if (path === '/api/mcp') {
      return mcpRoute(request, env);
    }

    if (path === '/api/join' && request.method === 'POST') {
      return joinRoute(request, env);
    }

    /*
     * Learner capability plane. Handled before the control plane so that no
     * `/api/learner/*` path can ever fall through to a cookie- or PAT-
     * authenticated route, and so an unknown learner path 404s here rather
     * than being matched by something below.
     */
    {
      const learner = await handleLearnerApi(request, env, url);
      if (learner !== null) return learner;
    }

    /* ---------------------------------------------- control plane (D1) */

    if (path === '/api/auth/status' && request.method === 'GET') {
      return authStatusRoute(request, env);
    }
    if (path === '/api/auth/demo/login' && request.method === 'POST') {
      return demoLoginRoute(request, env);
    }
    if (path === '/api/auth/google' && request.method === 'GET') {
      return googleStartRoute(request, env);
    }
    if (path === '/api/auth/google/callback' && request.method === 'GET') {
      return googleCallbackRoute(request, env);
    }
    if (path === '/api/auth/desktop/redeem' && request.method === 'POST') {
      return desktopRedeemRoute(request, env);
    }
    if (path === '/api/auth/logout' && request.method === 'POST') {
      return logoutRoute(request, env);
    }
    if (path === '/api/me' && request.method === 'GET') {
      return meRoute(request, env);
    }
    const facilitateMatch = /^\/api\/my\/sessions\/([^/]+)\/facilitate$/.exec(path);
    if (facilitateMatch && request.method === 'POST') return facilitateSessionRoute(request, env, facilitateMatch[1]!);
    const recapMatch = /^\/api\/my\/sessions\/([^/]+)\/recap$/.exec(path);
    if (recapMatch) return accountRecapRoute(request, env, recapMatch[1]!);
    if (path === '/api/my/sessions' && request.method === 'GET') {
      return mySessionsRoute(request, env);
    }
    if (path === '/api/my/prefs') {
      return prefsRoute(request, env);
    }
    if (path === '/api/my/home') {
      return homeRoute(request, env);
    }
    if (path === '/api/my/archives' && request.method === 'GET') {
      return listArchivesRoute(request, env);
    }
    const archiveMatch = /^\/api\/my\/archives\/([^/]+)(?:\/document)?$/.exec(path);
    if (archiveMatch !== null && request.method === 'GET') {
      return downloadArchiveRoute(request, env, decodeURIComponent(archiveMatch[1] as string), url);
    }

    {
      const tutoring = await handleTutoringApi(
        request,
        env,
        url,
        (input, user) => launchSessionForUser(env, input, user),
      );
      if (tutoring !== null) return tutoring;
    }
    /*
     * Tags cut across the folder tree, so they are their own small plane
     * rather than five near-identical sub-routes hanging off each item type.
     */
    {
      const tags = await handleTagApi(request, env, url);
      if (tags !== null) return tags;
    }
    if (path === '/api/my/tokens') {
      if (request.method === 'GET') return listTokensRoute(request, env);
      if (request.method === 'POST') return mintTokenRoute(request, env);
      return json({ error: 'method-not-allowed' }, 405);
    }
    const tokenMatch = /^\/api\/my\/tokens\/([^/]+)$/.exec(path);
    if (tokenMatch !== null) {
      const tokenId = decodeURIComponent(tokenMatch[1] as string);
      if (request.method === 'DELETE') return revokeTokenRoute(request, env, tokenId);
      return json({ error: 'method-not-allowed' }, 405);
    }
    const sharing = await sharingRoute(request, env, url);
    if (sharing) return sharing;
    const spaceMatch = /^\/api\/my\/spaces\/([^/]+)(\/folders)?$/.exec(path);
    if (spaceMatch !== null) {
      const spaceId = decodeURIComponent(spaceMatch[1] as string);
      if (spaceMatch[2] !== undefined) {
        if (request.method === 'POST') return createFolderRoute(request, env, spaceId);
        return json({ error: 'method-not-allowed' }, 405);
      }
      if (request.method === 'GET') return getSpaceRoute(request, env, spaceId, url);
      if (request.method === 'PATCH') return patchSpaceRoute(request, env, spaceId);
      return json({ error: 'method-not-allowed' }, 405);
    }
    const folderCopyMatch = /^\/api\/my\/folders\/([^/]+)\/copy$/.exec(path);
    if (folderCopyMatch !== null) {
      const folderId = decodeURIComponent(folderCopyMatch[1] as string);
      if (request.method === 'POST') return copyFolderRoute(request, env, folderId);
      return json({ error: 'method-not-allowed' }, 405);
    }
    if (path === '/api/my/folders/trash') {
      if (request.method === 'GET') return listTrashedFoldersRoute(request, env);
      return json({ error: 'method-not-allowed' }, 405);
    }
    const folderMatch = /^\/api\/my\/folders\/([^/]+)(\/(?:trash|restore|permanent-deletion))?$/.exec(path);
    if (folderMatch !== null) {
      const folderId = decodeURIComponent(folderMatch[1] as string);
      if (folderMatch[2] === '/trash' && request.method === 'POST') {
        return trashFolderRoute(request, env, folderId);
      }
      if (folderMatch[2] === '/restore' && request.method === 'POST') {
        return restoreFolderRoute(request, env, folderId);
      }
      if (folderMatch[2] === '/permanent-deletion' && request.method === 'POST') {
        return createFolderDeletionIntentRoute(request, env, folderId);
      }
      if (folderMatch[2] !== undefined) return json({ error: 'method-not-allowed' }, 405);
      if (request.method === 'PATCH') return patchFolderRoute(request, env, folderId);
      if (request.method === 'DELETE') return deleteFolderRoute(request, env, folderId);
      return json({ error: 'method-not-allowed' }, 405);
    }

    const rosterSeatMatch = /^\/api\/sessions\/([^/]+)\/roster\/seats(?:\/([^/]+))?$/.exec(path);
    if (rosterSeatMatch !== null) {
      const sessionCode = normalizeSessionCode(decodeURIComponent(rosterSeatMatch[1] as string));
      const seatId = rosterSeatMatch[2] ? decodeURIComponent(rosterSeatMatch[2]) : null;
      const auth = await authenticate(request, url, env, sessionCode, 'host');
      if (!auth.ok) return auth.response;
      const owner = await sessionEntitlementOwner(env, sessionCode);
      if (!owner?.userId) return json({ error: 'not-found' }, 404);
      if (seatId === null && request.method === 'GET') {
        return json({ seats: await listRosterSeats(env, sessionCode) });
      }
      if (seatId === null && request.method === 'POST') {
        const blocked = await requireNamedSessionAccess(env, owner.userId);
        if (blocked !== null) return blocked;
        const body = await readJson(request);
        const name = typeof body?.displayName === 'string' ? body.displayName : '';
        const minted = await mintRosterSeat(env, sessionCode, auth.payload.userId ?? owner.userId, name);
        if (!minted.ok) return json({ error: minted.error }, minted.status);
        return json(
          { id: minted.seatId, displayName: minted.displayName, token: minted.token },
          201,
        );
      }
      if (seatId !== null && request.method === 'DELETE') {
        const revoked = await revokeRosterSeat(env, sessionCode, seatId);
        if (!revoked) return json({ error: 'not-found' }, 404);
        return json({ ok: true });
      }
      return json({ error: 'method-not-allowed' }, 405);
    }

    const sessionMatch =
      /^\/api\/sessions\/([^/]+)\/(state|commands|export|recap|ws|stage-token|context|dictionary)$/.exec(path);
    if (sessionMatch !== null) {
      const sessionCode = normalizeSessionCode(decodeURIComponent(sessionMatch[1] as string));
      const leaf = sessionMatch[2];
      // Live routes: the relay's implementation, under this deployment's
      // authority (account rechecks, archive on end, paid ballots export).
      const live = liveFor(env);
      if (leaf === 'state' && request.method === 'GET') {
        return liveStateRoute(live, request, url, sessionCode);
      }
      if (leaf === 'commands' && request.method === 'POST') {
        return liveCommandRoute(live, request, url, sessionCode);
      }
      if (leaf === 'export' && request.method === 'GET') {
        return liveExportRoute(live, request, url, sessionCode);
      }
      if (leaf === 'recap' && (request.method === 'GET' || request.method === 'POST')) {
        const auth = await authenticate(request, url, env, sessionCode, 'host');
        if (!auth.ok) return auth.response;
        return withApiHeaders(await forwardRecap(request, env, sessionCode));
      }
      if (leaf === 'ws') {
        return liveWsRoute(live, request, url, sessionCode);
      }
      if (leaf === 'context' && request.method === 'GET') {
        return sessionContextRoute(request, url, env, sessionCode);
      }
      /*
       * The learner's own lookup. Any role holding this session's token reaches
       * it — the phone has no other credential, and this is a read that
       * publishes nothing.
       */
      if (leaf === 'dictionary' && request.method === 'POST') {
        const auth = await authenticate(request, url, env, sessionCode);
        if (!auth.ok) return auth.response;
        return sessionDictionaryRoute(
          request,
          env,
          sessionCode,
          auth.payload.participantId ?? auth.payload.role,
        );
      }
      if (leaf === 'stage-token' && request.method === 'GET') {
        return liveStageTokenRoute(live, request, url, sessionCode);
      }
      return json({ error: 'method-not-allowed' }, 405);
    }

    return json({ error: 'not-found' }, 404);
  },
} satisfies ExportedHandler<Env>;
