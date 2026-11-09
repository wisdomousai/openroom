import { resolveRevealOrder } from '@openroom/schema';
import { and, eq } from 'drizzle-orm';
import { json, type ControlEnv } from './auth';
import { requireControlUser } from './control-auth';
import { readJson } from './control-utils';
import { orm } from './db/client';
import { liveSessions, sessions } from './db/schema';
import { deckAccess, identifiedNeedsStudent, latestContent, sessionAccess, type SessionLauncher } from './delivery/shared';
import { requireIdentifiedSessionAccess } from './continuity-access';
import { coHostSessionRoute } from './hosting';
import { spaceRole } from './members';
import { readEntitlements } from './entitlements';
import { presentationComposition } from './presentation-start';

/** One gesture and one durable request identity across network retries and pane reloads. */
export async function startDeckRoute(request: Request, env: ControlEnv, deckId: string, launch: SessionLauncher): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const body = await readJson(request);
  if (!body || typeof body.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.requestId)) return json({ error: 'request-id-required' }, 422);
  const deck = await deckAccess(env, guard.user.id, deckId);
  if (!deck || deck.deletedAt !== null) return json({ error: 'deck-not-found' }, 404);
  const access = await spaceRole(env, guard.user, deck.spaceId);
  if (!access) return json({ error: 'deck-not-found' }, 404);
  const existing = await orm(env)
    .select({ createdBy: sessions.createdBy, deckId: sessions.deckId, deckVersion: sessions.deckVersion, sourceOutlineJson: sessions.sourceOutlineJson })
    .from(sessions)
    .where(eq(sessions.id, body.requestId))
    .get();
  if (existing && (existing.sourceOutlineJson || existing.createdBy !== guard.user.id || existing.deckId !== deckId)) return json({ error: 'request-id-conflict' }, 409);
  if (access.space.owner_user_id !== guard.user.id && !(await readEntitlements(env, access.space.owner_user_id)).team) {
    const retained = existing && await orm(env)
      .select({ code: liveSessions.code })
      .from(liveSessions)
      .where(and(eq(liveSessions.sessionId, body.requestId), eq(liveSessions.spaceId, deck.spaceId), eq(liveSessions.collaborationEnabled, 1)))
      .get();
    if (!retained) return json({ error: 'team-required' }, 403);
  }
  const available = await latestContent(env, deckId, existing?.deckVersion ?? deck.currentVersion);
  if (!available) return json({ error: 'deck-content-not-found' }, 409);
  if (body.stepId !== undefined && !available.outline.steps.some((item) => item.id === body.stepId && !item.breakoutOf)) return json({ error: 'activity-not-found' }, 422);
  // Refuse before the durable row exists: a row filed without a student would
  // keep refusing this requestId after the deck is filed under the student.
  if (!existing && deck.studentId === null && available.outline.defaults?.identityMode === 'identified') {
    return (await requireIdentifiedSessionAccess(env, access.space.owner_user_id)) ?? identifiedNeedsStudent();
  }
  const now = Date.now();
  await orm(env).insert(sessions).values({
    id: body.requestId, spaceId: deck.spaceId, folderId: deck.folderId, deckId: deck.id, deckVersion: deck.currentVersion,
    studentId: deck.studentId, createdBy: guard.user.id, title: deck.title, shape: deck.shape, status: 'draft',
    metadataJson: '{}', createdAt: now, updatedAt: now,
  }).onConflictDoNothing().run();
  const session = await sessionAccess(env, guard.user.id, body.requestId);
  if (!session || session.deletedAt !== null) return json({ error: 'session-not-found' }, 404);
  // A racing request may have won INSERT after the initial read.
  if (session.sourceOutlineJson || session.createdBy !== guard.user.id || session.deckId !== deckId) return json({ error: 'request-id-conflict' }, 409);
  const content = await latestContent(env, deckId, session.deckVersion);
  if (!content) return json({ error: 'deck-content-not-found' }, 409);
  const step = body.stepId === undefined ? undefined : content.outline.steps.find((item) => item.id === body.stepId && !item.breakoutOf);
  if (body.stepId !== undefined && !step) return json({ error: 'activity-not-found' }, 422);
  return launch({ sessionId: session.id, deckId, studentId: session.studentId, title: session.title, version: content.version,
    outline: content.outline, start: true,
    ...(step ? { cursor: { stepId: step.id, shown: resolveRevealOrder(step, content.outline.interactions).length } } : {}),
    ...(guard.connectionId ? { connectionId: guard.connectionId } : {}),
    origin: new URL(request.url).origin,
  }, guard.user);
}

/** A document reference grants nothing. Current account/space access is always checked. */
export async function resumeSessionRoute(request: Request, env: ControlEnv & { SESSIONS: DurableObjectNamespace }, id: string): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const session = await sessionAccess(env, guard.user.id, id);
  if (!session || session.deletedAt !== null) return json({ error: 'session-not-found' }, 404);
  const live = await orm(env).select({ code: liveSessions.code }).from(liveSessions).where(eq(liveSessions.sessionId, id)).get();
  if (!live) return json({ error: 'session-not-started' }, 409);
  const result = await coHostSessionRoute(request, env, live.code);
  if (!result.ok) return result;
  return json({ ...await result.json() as object, sessionId: session.id, deckId: session.deckId, deckVersion: session.deckVersion, presentation: presentationComposition(session) });
}
