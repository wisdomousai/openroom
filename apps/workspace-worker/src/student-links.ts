/**
 * Student access links — the learner-side capability credential.
 *
 * A student access link is a bearer secret scoped to exactly ONE student. It is
 * deliberately *not* an account (PRD §"No separate participant account system"):
 * there is no `users` row, no session, no space membership, and nothing derived
 * from a space role. It is the third credential family in the product, and the
 * `auth.ts` header rule applies to it verbatim:
 *
 *   • the `or_session` cookie proves *who the tutor is* and only ever unlocks
 *     the control plane;
 *   • a session capability token (tokens.ts) unlocks exactly one live session;
 *   • a student access link (`orlnk_…`) unlocks exactly one student's
 *     learner-visible records, and nothing else.
 *
 * None of the three is ever accepted where another belongs. Concretely:
 * `verifyStudentLink` resolves to a `VerifiedStudentLink`, never to a
 * `SessionUser`, so a link physically cannot be handed to `requireControlUser`,
 * to `/api/tutoring/*`, or to `/api/my/*`. The blast radius of a leaked link is
 * exactly one student.
 *
 * Format: `orlnk_<id>_<secret>` — mirrors `orpat_` (api-tokens.ts) so the two
 * are visually distinguishable in logs and cannot be confused by shape checks.
 * Only `sha256Hex(token)` is ever stored; the raw token is shown once, at mint.
 */

import { normalizeSessionCode } from '@openroom/domain';
import { joinUrlForCode, type JoinOriginEnv } from 'openroom-relay/join-url';

import { sha256Hex } from './api-tokens.js';
import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { readJson } from './control-utils.js';
import {
  clearLearnerAuthFailures,
  learnerClientKey,
  learnerOverBudget,
  learnerRateLimitedResponse,
  readLearnerAttempts,
  recordLearnerAuthFailure,
} from './learner-rate-limit.js';
import { roleAtLeast, spaceRole } from './members.js';
import { studentOwnerId, ownerHasContinuity, requireStudentContinuity } from './continuity-access.js';

export const STUDENT_LINK_PREFIX = 'orlnk_';

/**
 * Bound live credentials in one teaching student. Several links may point to
 * the same stable learner; replacing a credential never replaces their work.
 */
export const MAX_LINKS_PER_STUDENT = 10;

/**
 * Default lifetime: 180 days ≈ one school year / one tutoring engagement.
 * Long enough that nobody re-mints mid-term (the failure mode that makes people
 * paste links into group chats), short enough that an abandoned link dies on
 * its own rather than sitting valid forever like a PAT does.
 */
export const STUDENT_LINK_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const MIN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TTL_MS = 365 * 24 * 60 * 60 * 1000;

const PREFIX_LEN = 12;

function randomBase64Url(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let binary = '';
  for (const b of buf) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `orlnk_<id>_<secret>` — id ~22 chars (16 bytes), secret ~43 chars (32 bytes). */
function isValidLinkShape(raw: string): boolean {
  return /^orlnk_[A-Za-z0-9_-]{8,64}_[A-Za-z0-9_-]{16,128}$/.test(raw);
}

/**
 * What a valid link resolves to. Note what is *absent*: no user id, no email,
 * no space id, no role. There is nothing here that another subsystem could
 * mistake for an authenticated staff caller.
 */
export interface VerifiedStudentLink {
  linkId: string;
  learnerId: string;
  studentId: string;
  displayName: string;
}

/**
 * Verify a raw bearer as a live student access link.
 *
 * Every liveness condition is in the SQL, so there is no code path where a
 * revoked, expired, or orphaned link resolves: the link must exist, be
 * unrevoked, be unexpired, and point at a student that is not in the trash.
 */
export async function verifyStudentLink(
  env: ControlEnv,
  raw: string,
  now: number = Date.now(),
): Promise<VerifiedStudentLink | null> {
  if (!isValidLinkShape(raw)) return null;
  const hash = await sha256Hex(raw);
  const row = await env.DB.prepare(
    `SELECT l.id AS id, l.student_id AS student_id, l.learner_id AS learner_id,
            person.display_name AS display_name
       FROM student_access_links l
       JOIN students c ON c.id = l.student_id
       JOIN student_learners person ON person.id = l.learner_id AND person.student_id = l.student_id
      WHERE l.token_hash = ?1
        AND l.revoked_at IS NULL
        AND (l.expires_at IS NULL OR l.expires_at > ?2)
        AND c.deleted_at IS NULL`,
  )
    .bind(hash, now)
    .first<{ id: string; student_id: string; learner_id: string; display_name: string }>();
  if (row === null) return null;
  return { linkId: row.id, learnerId: row.learner_id, studentId: row.student_id, displayName: row.display_name };
}

/**
 * Which student, if any, a live session provably belongs to.
 *
 * This is the whole live-session↔student association problem, and the schema
 * answers it exactly once: `live_sessions.session_id` is written by
 * `recordLiveSession` on the launch path (`launchSessionForUser`), and
 * `sessions.student_id` is the durable session's linked student. That chain is
 * server-written at launch and is the only association a live session has —
 * `live_sessions` itself has no `student_id`, and the Durable Object's
 * `SessionState` has no notion of a student at all.
 *
 * Consequences we accept rather than paper over:
 *
 *  - A live session created by `POST /api/sessions` from a bare outline, with no
 *    durable session behind it, has no `session_id`, so it has no student and NO
 *    link can ever identify into it. That is the tight answer, not a limitation
 *    to route around: without the durable-session edge there is nothing that ties
 *    a code to a student, and accepting a link on the strength of "it is a valid
 *    link" would let one student's holder identify into every session in the
 *    product.
 *  - `deleteSessionPermanently` nulls `live_sessions.session_id`, which correctly severs the
 *    association.
 *
 * Returns null when the live session does not exist, was not launched from a
 * durable session, or that session has no linked student.
 */
export async function studentIdForSessionCode(
  env: ControlEnv,
  code: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT r.student_id AS student_id
       FROM live_sessions ro
       JOIN sessions r ON r.id = ro.session_id
      WHERE ro.code = ?1`,
  )
    .bind(code)
    .first<{ student_id: string | null }>();
  return row?.student_id ?? null;
}

export type LearnerGuard =
  | { ok: true; link: VerifiedStudentLink }
  | { ok: false; response: Response };

/**
 * Guard for `/api/learner/*`.
 *
 * The ONLY accepted credential is `Authorization: Bearer orlnk_…`. A session
 * cookie is ignored outright — it is never read here, so no amount of cookie
 * jar contents can promote a browser into a learner response. A `orpat_` PAT
 * fails the shape check and then the hash lookup.
 *
 * The per-client throttle (learner-rate-limit.ts) lives here rather than in the
 * individual routes so that every learner route — including ones not written
 * yet — is covered by construction rather than by remembering to add it. It executes
 * before the credential is looked at, so the 429 carries no information about
 * *why* a credential failed: absent, malformed, unknown, expired and revoked all
 * reach it on identical terms, exactly as they all reach the same 401.
 */
export async function requireStudentLink(
  request: Request,
  env: ControlEnv,
  now: number = Date.now(),
): Promise<LearnerGuard> {
  const clientKey = await learnerClientKey(request, env);
  const attempts = await readLearnerAttempts(env, clientKey);
  if (learnerOverBudget(attempts, now)) {
    return { ok: false, response: learnerRateLimitedResponse() };
  }

  const header = request.headers.get('authorization') ?? '';
  const link = header.startsWith('Bearer ')
    ? await verifyStudentLink(env, header.slice('Bearer '.length), now)
    : null;
  /*
   * A link whose student owner no longer holds `continuity` is answered exactly
   * like a revoked one: the same 401 body, and it spends the same budget. A
   * distinct answer would tell a link holder something about the tutor's
   * account and would make "valid but lapsed" a probe-able state. Nothing is
   * deleted; the link works again once the owner's access returns.
   */
  const usable = link !== null && (await ownerHasContinuity(env, await studentOwnerId(env, link.studentId)));
  if (link === null || !usable) {
    await recordLearnerAuthFailure(env, clientKey, now);
    return { ok: false, response: json({ error: 'unauthorized' }, 401) };
  }
  // Success spends no budget and clears what was spent — but only touches D1
  // when there is actually something to clear.
  if (attempts !== null) await clearLearnerAuthFailures(env, clientKey);
  return { ok: true, link };
}

/* ------------------------------------------------------------- tutor side */

interface StudentForLinks {
  kind: string;
  id: string;
  space_id: string;
  display_name: string;
  deleted_at: number | null;
}

/**
 * Tutor-side authorization for link management: space member, editor or above.
 * Minting a credential is a privilege escalation primitive, so a `presenter`
 * (who may host a session but not change the library) must not be able to.
 */
async function linkAdminAccess(
  request: Request,
  env: ControlEnv,
  studentId: string,
  mutating: boolean,
  paid = true,
): Promise<
  | { ok: true; student: StudentForLinks }
  | { ok: false; response: Response }
> {
  const guard = await requireControlUser(request, env, mutating);
  if (!guard.ok) return { ok: false, response: guard.response };
  const student = await env.DB.prepare(
    `SELECT c.id AS id, c.kind AS kind, c.space_id AS space_id, c.display_name AS display_name,
            c.deleted_at AS deleted_at
       FROM students c
       JOIN space_members m ON m.space_id = c.space_id AND m.user_id = ?2
      WHERE c.id = ?1`,
  )
    .bind(studentId, guard.user.id)
    .first<StudentForLinks>();
  if (student === null) return { ok: false, response: json({ error: 'not-found' }, 404) };
  const access = await spaceRole(env, guard.user, student.space_id);
  if (access === null || !roleAtLeast(access.role, 'editor')) {
    return { ok: false, response: json({ error: 'forbidden' }, 403) };
  }
  if (paid) {
    const blocked = await requireStudentContinuity(env, studentId);
    if (blocked) return { ok: false, response: blocked };
  }
  return { ok: true, student };
}

interface LinkRow {
  id: string;
  token_prefix: string;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
  learner_id: string;
  display_name: string;
}

/** People are student-local; this control-plane read carries no credentials. */
export async function listStudentLearnersRoute(request: Request, env: ControlEnv, studentId: string): Promise<Response> {
  const access = await linkAdminAccess(request, env, studentId, false);
  if (!access.ok) return access.response;
  const { results } = await env.DB.prepare('SELECT id, display_name FROM student_learners WHERE student_id = ?1 ORDER BY display_name, id')
    .bind(studentId).all<{ id: string; display_name: string }>();
  return json({ learners: (results ?? []).map((person) => ({ id: person.id, displayName: person.display_name })) });
}

/** GET /api/tutoring/students/:id/links */
export async function listStudentLinksRoute(
  request: Request,
  env: ControlEnv,
  studentId: string,
): Promise<Response> {
  const access = await linkAdminAccess(request, env, studentId, false);
  if (!access.ok) return access.response;

  const { results } = await env.DB.prepare(
    `SELECT l.id, l.token_prefix, l.created_at, l.expires_at, l.revoked_at, l.learner_id, person.display_name
       FROM student_access_links l
       JOIN student_learners person ON person.id = l.learner_id AND person.student_id = l.student_id
      WHERE l.student_id = ?1
      ORDER BY l.created_at DESC`,
  )
    .bind(studentId)
    .all<LinkRow>();

  return json({
    links: (results ?? []).map((row) => ({
      id: row.id,
      tokenPrefix: row.token_prefix,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      learnerId: row.learner_id,
      displayName: row.display_name,
    })),
  });
}

/**
 * POST /api/tutoring/students/:id/links  body { learnerId? | displayName?, expiresInDays?, sessionCode? }
 *
 * Returns the raw token exactly once. Nothing stores it, nothing can read it
 * back, and `GET .../links` deliberately exposes only the prefix — a tutor who
 * loses the link selects the same learner, mints a new one, and revokes the old.
 *
 * The answer also carries the URLs built from that token, so an agent can hand
 * them on without knowing their shapes: `learnerUrl` (the student's own page)
 * and, when `sessionCode` names a session of this student, `joinUrl` (the
 * session's join page with the link in it — the only usable join URL of an
 * identified session). The token is already in the same answer, so the URLs
 * expose nothing new; nothing stores them.
 */
export async function mintStudentLinkRoute(
  request: Request,
  env: ControlEnv,
  studentId: string,
  now: number = Date.now(),
): Promise<Response> {
  const access = await linkAdminAccess(request, env, studentId, true);
  if (!access.ok) return access.response;
  if (access.student.deleted_at !== null) {
    return json({ error: 'resource-in-trash' }, 409);
  }

  const body = (await readJson(request)) ?? {};
  const requestedId = body.learnerId;
  const requestedName = body.displayName;
  if (requestedId !== undefined && (typeof requestedId !== 'string' || requestedId === '')) return json({ error: 'invalid-learner' }, 422);
  if (requestedName !== undefined && (typeof requestedName !== 'string' || requestedName.trim() === '' || requestedName.length > 200)) return json({ error: 'invalid-learner-name' }, 422);
  if (requestedId !== undefined && requestedName !== undefined) return json({ error: 'choose-learner-or-name' }, 422);
  let sessionCode: string | undefined;
  if (body.sessionCode !== undefined) {
    if (typeof body.sessionCode !== 'string' || body.sessionCode.trim() === '') return json({ error: 'invalid-session-code' }, 422);
    sessionCode = normalizeSessionCode(body.sessionCode);
    // The caller administers this student, so saying "not one of yours" names
    // nothing about any other student.
    if ((await studentIdForSessionCode(env, sessionCode)) !== studentId) return json({ error: 'session-not-in-student' }, 422);
  }
  let learnerId: string;
  let displayName: string;
  let createLearner = false;
  if (typeof requestedId === 'string') {
    const person = await env.DB.prepare('SELECT id, display_name FROM student_learners WHERE id = ?1 AND student_id = ?2')
      .bind(requestedId, studentId).first<{ id: string; display_name: string }>();
    if (!person) return json({ error: 'learner-not-found' }, 404);
    learnerId = person.id; displayName = person.display_name;
  } else {
    if (requestedName === undefined && access.student.kind !== 'person') return json({ error: 'learner-name-required' }, 422);
    learnerId = requestedName === undefined ? `person-${studentId}` : randomBase64Url(16);
    displayName = typeof requestedName === 'string' ? requestedName.trim().replace(/\s+/g, ' ') : access.student.display_name;
    createLearner = true;
  }
  let ttl = STUDENT_LINK_TTL_MS;
  if (body.expiresInDays !== undefined) {
    const days = body.expiresInDays;
    if (typeof days !== 'number' || !Number.isFinite(days)) {
      return json({ error: 'invalid-expiry' }, 422);
    }
    ttl = Math.round(days * 24 * 60 * 60 * 1000);
    if (ttl < MIN_TTL_MS || ttl > MAX_TTL_MS) return json({ error: 'invalid-expiry' }, 422);
  }

  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM student_access_links
      WHERE student_id = ?1 AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?2)`,
  )
    .bind(studentId, now)
    .first<{ n: number }>();
  if ((countRow?.n ?? 0) >= MAX_LINKS_PER_STUDENT) {
    return json({ error: 'link-limit', max: MAX_LINKS_PER_STUDENT }, 429);
  }

  const id = randomBase64Url(16);
  const secret = randomBase64Url(32);
  const token = `${STUDENT_LINK_PREFIX}${id}_${secret}`;
  const hash = await sha256Hex(token);
  const prefix = token.slice(0, PREFIX_LEN);
  const expiresAt = now + ttl;

  const statements = [];
  if (createLearner) statements.push(env.DB.prepare(
    'INSERT INTO student_learners (id, student_id, display_name, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name',
  ).bind(learnerId, studentId, displayName, now));
  statements.push(env.DB.prepare(
    `INSERT INTO student_access_links
       (id, student_id, learner_id, token_hash, token_prefix, created_at, expires_at, revoked_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)`,
  ).bind(id, studentId, learnerId, hash, prefix, now, expiresAt));
  await env.DB.batch(statements);

  const origin = new URL(request.url).origin;
  const join = sessionCode === undefined ? undefined : joinUrlForCode(env as ControlEnv & JoinOriginEnv, sessionCode);
  return json(
    {
      id,
      tokenPrefix: prefix,
      createdAt: now,
      expiresAt,
      token,
      learnerId,
      displayName,
      learnerUrl: `${origin}/host/#/learn?token=${encodeURIComponent(token)}`,
      ...(join === undefined
        ? {}
        : { joinUrl: `${join.startsWith('/') ? origin : ''}${join}&link=${encodeURIComponent(token)}` }),
    },
    201,
  );
}

/**
 * DELETE /api/tutoring/students/:id/links/:linkId
 *
 * Sets `revoked_at`. The row is never hard-deleted: the audit trail of which
 * capability existed, when, and when it was withdrawn is the point of a
 * revocable credential.
 */
export async function revokeStudentLinkRoute(
  request: Request,
  env: ControlEnv,
  studentId: string,
  linkId: string,
  now: number = Date.now(),
): Promise<Response> {
  // Withdrawing a credential is never paid.
  const access = await linkAdminAccess(request, env, studentId, true, false);
  if (!access.ok) return access.response;

  const result = await env.DB.prepare(
    `UPDATE student_access_links SET revoked_at = ?1
      WHERE id = ?2 AND student_id = ?3 AND revoked_at IS NULL`,
  )
    .bind(now, linkId, studentId)
    .run();
  if ((result.meta.changes ?? 0) === 0) return json({ error: 'not-found' }, 404);
  return json({ ok: true });
}
