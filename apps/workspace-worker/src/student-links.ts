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
import { and, asc, count, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { joinUrlForCode, type JoinOriginEnv } from 'openroom-relay/join-url';

import { sha256Hex } from './api-tokens.js';
import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { readJson } from './control-utils.js';
import { orm } from './db/client.js';
import { liveSessions, sessions, spaceMembers, studentAccessLinks, studentLearners, students } from './db/schema.js';
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
  const row = await orm(env)
    .select({
      linkId: studentAccessLinks.id,
      learnerId: studentAccessLinks.learnerId,
      studentId: studentAccessLinks.studentId,
      displayName: studentLearners.displayName,
    })
    .from(studentAccessLinks)
    .innerJoin(students, eq(students.id, studentAccessLinks.studentId))
    .innerJoin(
      studentLearners,
      and(eq(studentLearners.id, studentAccessLinks.learnerId), eq(studentLearners.studentId, studentAccessLinks.studentId)),
    )
    .where(
      and(
        eq(studentAccessLinks.tokenHash, hash),
        isNull(studentAccessLinks.revokedAt),
        or(isNull(studentAccessLinks.expiresAt), gt(studentAccessLinks.expiresAt, now)),
        isNull(students.deletedAt),
      ),
    )
    .get();
  return row ?? null;
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
  const row = await orm(env)
    .select({ studentId: sessions.studentId })
    .from(liveSessions)
    .innerJoin(sessions, eq(sessions.id, liveSessions.sessionId))
    .where(eq(liveSessions.code, code))
    .get();
  return row?.studentId ?? null;
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

type StudentForLinks = Pick<typeof students.$inferSelect, 'kind' | 'id' | 'spaceId' | 'displayName' | 'deletedAt'>;

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
  const student = await orm(env)
    .select({
      id: students.id,
      kind: students.kind,
      spaceId: students.spaceId,
      displayName: students.displayName,
      deletedAt: students.deletedAt,
    })
    .from(students)
    .innerJoin(spaceMembers, and(eq(spaceMembers.spaceId, students.spaceId), eq(spaceMembers.userId, guard.user.id)))
    .where(eq(students.id, studentId))
    .get();
  if (student === undefined) return { ok: false, response: json({ error: 'not-found' }, 404) };
  const access = await spaceRole(env, guard.user, student.spaceId);
  if (access === null || !roleAtLeast(access.role, 'editor')) {
    return { ok: false, response: json({ error: 'forbidden' }, 403) };
  }
  if (paid) {
    const blocked = await requireStudentContinuity(env, studentId);
    if (blocked) return { ok: false, response: blocked };
  }
  return { ok: true, student };
}

/** People are student-local; this control-plane read carries no credentials. */
export async function listStudentLearnersRoute(request: Request, env: ControlEnv, studentId: string): Promise<Response> {
  const access = await linkAdminAccess(request, env, studentId, false);
  if (!access.ok) return access.response;
  const learners = await orm(env)
    .select({ id: studentLearners.id, displayName: studentLearners.displayName })
    .from(studentLearners)
    .where(eq(studentLearners.studentId, studentId))
    .orderBy(asc(studentLearners.displayName), asc(studentLearners.id));
  return json({ learners });
}

/** GET /api/tutoring/students/:id/links */
export async function listStudentLinksRoute(
  request: Request,
  env: ControlEnv,
  studentId: string,
): Promise<Response> {
  const access = await linkAdminAccess(request, env, studentId, false);
  if (!access.ok) return access.response;

  const links = await orm(env)
    .select({
      id: studentAccessLinks.id,
      tokenPrefix: studentAccessLinks.tokenPrefix,
      createdAt: studentAccessLinks.createdAt,
      expiresAt: studentAccessLinks.expiresAt,
      revokedAt: studentAccessLinks.revokedAt,
      learnerId: studentAccessLinks.learnerId,
      displayName: studentLearners.displayName,
    })
    .from(studentAccessLinks)
    .innerJoin(
      studentLearners,
      and(eq(studentLearners.id, studentAccessLinks.learnerId), eq(studentLearners.studentId, studentAccessLinks.studentId)),
    )
    .where(eq(studentAccessLinks.studentId, studentId))
    .orderBy(desc(studentAccessLinks.createdAt));

  return json({ links });
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
  const db = orm(env);
  if (access.student.deletedAt !== null) {
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
    const person = await db
      .select({ id: studentLearners.id, displayName: studentLearners.displayName })
      .from(studentLearners)
      .where(and(eq(studentLearners.id, requestedId), eq(studentLearners.studentId, studentId)))
      .get();
    if (!person) return json({ error: 'learner-not-found' }, 404);
    learnerId = person.id; displayName = person.displayName;
  } else {
    if (requestedName === undefined && access.student.kind !== 'person') return json({ error: 'learner-name-required' }, 422);
    learnerId = requestedName === undefined ? `person-${studentId}` : randomBase64Url(16);
    displayName = typeof requestedName === 'string' ? requestedName.trim().replace(/\s+/g, ' ') : access.student.displayName;
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

  const countRow = await db
    .select({ n: count() })
    .from(studentAccessLinks)
    .where(
      and(
        eq(studentAccessLinks.studentId, studentId),
        isNull(studentAccessLinks.revokedAt),
        or(isNull(studentAccessLinks.expiresAt), gt(studentAccessLinks.expiresAt, now)),
      ),
    )
    .get();
  if ((countRow?.n ?? 0) >= MAX_LINKS_PER_STUDENT) {
    return json({ error: 'link-limit', max: MAX_LINKS_PER_STUDENT }, 429);
  }

  const id = randomBase64Url(16);
  const secret = randomBase64Url(32);
  const token = `${STUDENT_LINK_PREFIX}${id}_${secret}`;
  const hash = await sha256Hex(token);
  const prefix = token.slice(0, PREFIX_LEN);
  const expiresAt = now + ttl;

  const insertLink = db.insert(studentAccessLinks).values({
    id,
    studentId,
    learnerId,
    tokenHash: hash,
    tokenPrefix: prefix,
    createdAt: now,
    expiresAt,
    revokedAt: null,
  });
  const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = createLearner
    ? [
        db
          .insert(studentLearners)
          .values({ id: learnerId, studentId, displayName, createdAt: now })
          .onConflictDoUpdate({ target: studentLearners.id, set: { displayName } }),
        insertLink,
      ]
    : [insertLink];
  await db.batch(statements);

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

  const result = await orm(env)
    .update(studentAccessLinks)
    .set({ revokedAt: now })
    .where(and(eq(studentAccessLinks.id, linkId), eq(studentAccessLinks.studentId, studentId), isNull(studentAccessLinks.revokedAt)))
    .run();
  if ((result.meta.changes ?? 0) === 0) return json({ error: 'not-found' }, 404);
  return json({ ok: true });
}
