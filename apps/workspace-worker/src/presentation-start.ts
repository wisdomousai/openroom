import { composePresentation, resolveRevealOrder, type ActivitySource, type Outline, type PresentationComposition } from '@openroom/schema';
import { json, type ControlEnv } from './auth';
import { requireControlUser } from './control-auth';
import { readJson } from './control-utils';
import { deckAccess, latestContent, sessionAccess, type SessionRow, type SessionLauncher } from './delivery/shared';
import { readEntitlements } from './entitlements';
import { spaceRole } from './members';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const reference = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
export function presentationComposition(session: SessionRow): PresentationComposition | null {
  if (!session.source_outline_json) return null;
  return (JSON.parse(session.metadata_json) as { presentation: PresentationComposition }).presentation;
}

/** Same control-plane start permission as a deck. No editable library object is created. */
export async function startPresentationRoute(request: Request, env: ControlEnv, launch: SessionLauncher): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const body = await readJson(request);
  if (!body || !uuid(body.requestId) || !uuid(body.presentationId)) return json({ error: 'presentation-reference-required' }, 422);
  let session = await sessionAccess(env, guard.user.id, body.requestId);
  if (!session) {
    // Do not turn an inaccessible existing retry identity into a new session.
    if (await env.DB.prepare('SELECT id FROM sessions WHERE id = ?1').bind(body.requestId).first()) return json({ error: 'request-id-conflict' }, 409);
    if (!Array.isArray(body.activities) || !body.activities.length || body.activities.length > 200) return json({ error: 'invalid-presentation-activities' }, 422);
    const sources: ActivitySource[] = [];
    const decks = new Map<string, NonNullable<Awaited<ReturnType<typeof deckAccess>>>>();
    const contents = new Map<string, NonNullable<Awaited<ReturnType<typeof latestContent>>>>();
    let sourceSize = 0;
    for (const activity of body.activities) {
      if (!activity || typeof activity !== 'object' || Array.isArray(activity) || Object.keys(activity).length !== 4 || !reference(activity.slideId) || !reference(activity.spaceId) || !reference(activity.deckId) || !reference(activity.stepId)) return json({ error: 'invalid-presentation-activities' }, 422);
      const deck = decks.get(activity.deckId) ?? await deckAccess(env, guard.user.id, activity.deckId);
      if (!deck || deck.deleted_at !== null || deck.space_id !== activity.spaceId) return json({ error: 'deck-not-found' }, 404);
      if (sources[0] && sources[0].spaceId !== deck.space_id) return json({ error: 'presentation-space-mismatch' }, 422);
      const content = contents.get(deck.id) ?? await latestContent(env, deck.id, deck.current_version);
      if (!content) return json({ error: 'deck-content-not-found' }, 409);
      if (!contents.has(deck.id)) {
        sourceSize += JSON.stringify(content.outline).length;
        if (sourceSize > 8_000_000) return json({ error: 'presentation-too-large' }, 413);
      }
      decks.set(deck.id, deck); contents.set(deck.id, content);
      sources.push({ slideId: activity.slideId, spaceId: deck.space_id, deckId: deck.id, stepId: activity.stepId, deckVersion: content.version, outline: content.outline });
    }
    const anchor = decks.get(sources[0]!.deckId)!;
    // One session cannot represent several students or silently adopt the first one.
    if ([...decks.values()].some((deck) => deck.context_id !== anchor.context_id)) return json({ error: 'presentation-context-mismatch' }, 422);
    const access = await spaceRole(env, guard.user, anchor.space_id);
    if (!access) return json({ error: 'deck-not-found' }, 404);
    if (access.space.owner_user_id !== guard.user.id && !(await readEntitlements(env, access.space.owner_user_id)).team) return json({ error: 'team-required' }, 403);
    let composed: ReturnType<typeof composePresentation>;
    try { composed = composePresentation(sources); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'invalid-presentation-content' }, 422); }
    if (body.slideId !== undefined && !composed.activities.some((activity) => activity.slideId === body.slideId)) return json({ error: 'activity-not-found' }, 422);
    const source = JSON.stringify(composed.outline);
    if (source.length > 2_000_000) return json({ error: 'presentation-too-large' }, 413);
    const metadata = JSON.stringify({ presentation: { id: body.presentationId, activities: composed.activities } });
    const now = Date.now();
    await env.DB.prepare(`INSERT OR IGNORE INTO sessions
      (id,space_id,folder_id,deck_id,deck_version,context_id,created_by,title,shape,status,metadata_json,source_outline_json,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'draft',?10,?11,?12,?12)`)
      .bind(body.requestId, anchor.space_id, anchor.folder_id, anchor.id, sources[0]!.deckVersion, anchor.context_id, guard.user.id, composed.outline.meta.title, anchor.shape, metadata, source, now).run();
    session = await sessionAccess(env, guard.user.id, body.requestId);
  }
  if (!session || session.deleted_at !== null) return json({ error: 'session-not-found' }, 404);
  const presentation = presentationComposition(session);
  if (session.created_by !== guard.user.id || presentation?.id !== body.presentationId) return json({ error: 'request-id-conflict' }, 409);
  const outline = JSON.parse(session.source_outline_json!) as Outline;
  const selected = presentation.activities.find((activity) => activity.slideId === body.slideId) ?? presentation.activities[0]!;
  const step = outline.steps.find((item) => item.id === selected.sessionStepId)!;
  const response = await launch({ sessionId: session.id, deckId: session.deck_id, contextId: session.context_id, title: session.title,
    version: session.deck_version, outline, start: true,
    cursor: { stepId: step.id, shown: resolveRevealOrder(step, outline.interactions).length },
    ...(guard.connectionId ? { connectionId: guard.connectionId } : {}),
  }, guard.user);
  if (!response.ok) return response;
  return json({ ...await response.json() as object, presentation }, response.status);
}
