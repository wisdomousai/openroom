import { resolveRevealOrder } from '@openroom/schema';
import { json, type ControlEnv } from './auth';
import { requireControlUser } from './control-auth';
import { readJson } from './control-utils';
import { deckAccess, latestContent, sessionAccess, type SessionLauncher } from './delivery/shared';
import { facilitateSessionRoute } from './facilitation';
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
  if (!deck || deck.deleted_at !== null) return json({ error: 'deck-not-found' }, 404);
  const access = await spaceRole(env, guard.user, deck.space_id);
  if (!access) return json({ error: 'deck-not-found' }, 404);
  const existing = await env.DB.prepare('SELECT created_by, deck_id, deck_version, source_outline_json FROM sessions WHERE id = ?1').bind(body.requestId).first<{ created_by: string; deck_id: string; deck_version: number; source_outline_json: string | null }>();
  if (existing && (existing.source_outline_json || existing.created_by !== guard.user.id || existing.deck_id !== deckId)) return json({ error: 'request-id-conflict' }, 409);
  if (access.space.owner_user_id !== guard.user.id && !(await readEntitlements(env, access.space.owner_user_id)).team) {
    const retained = existing && await env.DB.prepare('SELECT code FROM live_sessions WHERE session_id = ?1 AND space_id = ?2 AND collaboration_enabled = 1').bind(body.requestId, deck.space_id).first();
    if (!retained) return json({ error: 'team-required' }, 403);
  }
  const available = await latestContent(env, deckId, existing?.deck_version ?? deck.current_version);
  if (!available) return json({ error: 'deck-content-not-found' }, 409);
  if (body.stepId !== undefined && !available.outline.steps.some((item) => item.id === body.stepId && !item.breakoutOf)) return json({ error: 'activity-not-found' }, 422);
  const now = Date.now();
  await env.DB.prepare(`INSERT OR IGNORE INTO sessions
    (id,space_id,folder_id,deck_id,deck_version,context_id,created_by,title,shape,status,metadata_json,created_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'draft','{}',?10,?10)`)
    .bind(body.requestId, deck.space_id, deck.folder_id, deck.id, deck.current_version, deck.context_id, guard.user.id, deck.title, deck.shape, now).run();
  const session = await sessionAccess(env, guard.user.id, body.requestId);
  if (!session || session.deleted_at !== null) return json({ error: 'session-not-found' }, 404);
  // A racing request may have won INSERT after the initial read.
  if (session.source_outline_json || session.created_by !== guard.user.id || session.deck_id !== deckId) return json({ error: 'request-id-conflict' }, 409);
  const content = await latestContent(env, deckId, session.deck_version);
  if (!content) return json({ error: 'deck-content-not-found' }, 409);
  const step = body.stepId === undefined ? undefined : content.outline.steps.find((item) => item.id === body.stepId && !item.breakoutOf);
  if (body.stepId !== undefined && !step) return json({ error: 'activity-not-found' }, 422);
  return launch({ sessionId: session.id, deckId, contextId: session.context_id, title: session.title, version: content.version,
    outline: content.outline, start: true,
    ...(step ? { cursor: { stepId: step.id, shown: resolveRevealOrder(step, content.outline.interactions).length } } : {}),
    ...(guard.connectionId ? { connectionId: guard.connectionId } : {}),
  }, guard.user);
}

/** A document reference grants nothing. Current account/space access is always checked. */
export async function resumeSessionRoute(request: Request, env: ControlEnv & { SESSIONS: DurableObjectNamespace }, id: string): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const session = await sessionAccess(env, guard.user.id, id);
  if (!session || session.deleted_at !== null) return json({ error: 'session-not-found' }, 404);
  const live = await env.DB.prepare('SELECT code FROM live_sessions WHERE session_id = ?1').bind(id).first<{ code: string }>();
  if (!live) return json({ error: 'session-not-started' }, 409);
  const result = await facilitateSessionRoute(request, env, live.code);
  if (!result.ok) return result;
  return json({ ...await result.json() as object, sessionId: session.id, deckId: session.deck_id, deckVersion: session.deck_version, presentation: presentationComposition(session) });
}
