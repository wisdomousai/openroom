/**
 * `POST /api/tutoring/dictionary` — the tutor's word lookup.
 *
 * A console convenience, deliberately kept off the agent surface (see the
 * comment in `packages/schema/src/tutoring-paths.ts`). The learner's lookup is
 * a different route on a different credential: a learner in a live session holds a
 * session capability token and never a control session.
 *
 * The languages are not request parameters. The caller names a scope — the
 * deck it is editing, or the session it is running — and the pair is read from
 * that scope's space. So a caller cannot ask for a dictionary in a language its
 * space did not configure, and no surface has to be taught the pair.
 */
import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { readJson } from './control-utils.js';
import { isLookupWord, resolveEntry } from './dictionary.js';
import { spaceRole } from './members.js';
import { spaceSettings } from './workspace.js';

const LOOKUP_LIMIT = 30;
const LOOKUP_WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

function allow(userId: string, now: number): boolean {
  const current = buckets.get(userId);
  if (current === undefined || now >= current.resetAt) {
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
    buckets.set(userId, { count: 1, resetAt: now + LOOKUP_WINDOW_MS });
    return true;
  }
  if (current.count >= LOOKUP_LIMIT) return false;
  current.count += 1;
  return true;
}

/**
 * The space a scope belongs to, or null when the scope does not resolve.
 *
 * A session may predate spaces or have been opened outside one, so its `space_id`
 * is nullable; a deck's is not. Either way an unresolved scope is a miss, not
 * a fallback — there is no space-less dictionary to fall back to.
 */
async function scopeSpaceId(env: ControlEnv, scope: unknown): Promise<string | null> {
  if (scope === null || typeof scope !== 'object') return null;
  const { deckId, sessionCode } = scope as { deckId?: unknown; sessionCode?: unknown };
  if (typeof deckId === 'string' && deckId !== '') {
    const row = await env.DB.prepare(
      'SELECT space_id FROM decks WHERE id = ?1 AND deleted_at IS NULL',
    )
      .bind(deckId)
      .first<{ space_id: string | null }>();
    return row?.space_id ?? null;
  }
  if (typeof sessionCode === 'string' && sessionCode !== '') {
    // A session launched from a deck belongs to that deck's space even when the
    // launch predates space stamping — resolving through the deck completes the
    // scope; it is not a space-less fallback.
    const row = await env.DB.prepare(
      `SELECT COALESCE(ls.space_id, d.space_id) AS space_id
         FROM live_sessions ls
         LEFT JOIN decks d ON d.id = ls.deck_id AND d.deleted_at IS NULL
        WHERE ls.code = ?1`,
    )
      .bind(sessionCode)
      .first<{ space_id: string | null }>();
    return row?.space_id ?? null;
  }
  return null;
}

export async function dictionaryRoute(
  request: Request,
  env: ControlEnv,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  const guard = await requireControlUser(request, env);
  if (!guard.ok) return guard.response;
  if (!allow(guard.user.id, now)) return json({ error: 'lookup-rate-limited' }, 429);

  const body = (await readJson(request)) ?? {};
  const word = typeof body.word === 'string' ? body.word.trim() : '';
  if (word === '' || !isLookupWord(word)) return json({ error: 'invalid-word' }, 422);

  const spaceId = await scopeSpaceId(env, body.scope);
  if (spaceId === null) return json({ error: 'not-found' }, 404);
  /*
   * Membership at any role, not editor: reading a dictionary is a read. The
   * 404 on a non-member is the same "you cannot tell it exists" answer the
   * rest of the workspace gives.
   */
  const access = await spaceRole(env, guard.user, spaceId);
  if (access === null) return json({ error: 'not-found' }, 404);

  const { languages } = await spaceSettings(env, spaceId);
  /*
   * The 422 carries the space it needed and whether this caller may fix it.
   * Both were resolved above to get here, and handing them back is what lets
   * the console offer the pair picker in place: a tutor mid-session should not
   * have to leave the session to find a setting the failure already identified.
   * `canEdit` is the server's answer, not a hint — the write re-checks it.
   */
  if (languages === undefined) {
    return json(
      {
        error: 'languages-not-configured',
        spaceId,
        canEdit: access.role === 'owner' || access.role === 'editor',
      },
      422,
    );
  }

  const result = await resolveEntry(
    { word, lang: languages.taught, meaningLang: languages.native },
    fetchImpl,
    now,
  );
  return json(result);
}

/* ------------------------------------------------------------ the learner */

/**
 * The in-session learner lookup.
 *
 * Session-scoped on purpose. The obvious home, `/api/learner/*`, is authenticated
 * by a context access link, and the participant app is built never to keep one
 * (`forgetLinkInUrl()` executes the moment it joins). A learner in a live session
 * holds a session capability token and nothing else, so putting this behind the
 * context link would mean persisting a context-wide credential beside a
 * session-scoped one — the exact collapse `AGENTS.md` forbids.
 *
 * No role restriction: host, stage and participant all reach it with the token
 * they already hold, and nothing new is minted.
 *
 * Each learner looks up alone. Nothing is broadcast, nothing enters session
 * state, and nothing is logged.
 */
const learnerBuckets = new Map<string, { count: number; resetAt: number }>();
const LEARNER_LIMIT = 20;

export async function sessionDictionaryRoute(
  request: Request,
  env: ControlEnv,
  sessionCode: string,
  participantId: string,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<Response> {
  const body = (await readJson(request)) ?? {};
  const word = typeof body.word === 'string' ? body.word.trim() : '';
  if (word === '' || !isLookupWord(word)) return json({ error: 'invalid-word' }, 422);

  /*
   * A tutoring session is one launched from a session that has a context. That, not
   * the identity mode, is the gate: the phone surface only *offers* a lookup
   * on the identified surface, but a lookup is a read and the route has no
   * reason to be narrower than the session class it belongs to.
   *
   * The 404 rather than a 403 is deliberate: in a plain poll session this route
   * does not exist, so there is nothing for a phone to discover.
   */
  const session = await env.DB.prepare(
    `SELECT r.space_id AS space_id, ru.context_id AS context_id
       FROM live_sessions r LEFT JOIN sessions ru ON ru.id = r.session_id
      WHERE r.code = ?1`,
  )
    .bind(sessionCode)
    .first<{ space_id: string | null; context_id: string | null }>();
  if (session === null || session.context_id === null) return json({ error: 'not-found' }, 404);
  if (session.space_id === null) return json({ error: 'languages-not-configured' }, 422);

  const { languages } = await spaceSettings(env, session.space_id);
  if (languages === undefined) return json({ error: 'languages-not-configured' }, 422);

  /*
   * Keyed on both ids off the verified token, so one learner cannot spend
   * another's budget and no IP hashing is needed. A cache hit inside
   * `resolveEntry` still costs a slot: the budget is on asking, not on
   * fetching, which is what makes it predictable for the learner.
   */
  const key = `${sessionCode}:${participantId}`;
  const bucket = learnerBuckets.get(key);
  if (bucket === undefined || now >= bucket.resetAt) {
    for (const [k, b] of learnerBuckets) {
      if (now >= b.resetAt) learnerBuckets.delete(k);
    }
    learnerBuckets.set(key, { count: 1, resetAt: now + LOOKUP_WINDOW_MS });
  } else if (bucket.count >= LEARNER_LIMIT) {
    return json({ error: 'lookup-rate-limited' }, 429);
  } else {
    bucket.count += 1;
  }

  const result = await resolveEntry(
    { word, lang: languages.taught, meaningLang: languages.native },
    fetchImpl,
    now,
  );
  return json(result);
}
