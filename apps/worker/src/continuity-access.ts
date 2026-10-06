/**
 * The paid `continuity` capability: the teaching loop that carries one lesson
 * into the next — session records (Notes, the "for next time" sticky and the
 * homework published on the record), learner people and access links, learner
 * work, practice and returned work, feedback, identified sessions and the whole
 * learner plane. It applies to every workspace experience alike.
 *
 * Contexts themselves ("who it is for") are free for every kind, as are decks,
 * live sessions, the results recap and the shared lookup tools.
 *
 * Billing follows the space owner, exactly like `team`: an editor in a paid
 * owner's space works under the owner's capability, and a collaborator's own
 * subscription never substitutes for a missing one. Something outside a space
 * bills its owning user.
 *
 * Lapsed access never destroys or hides data from deletion: trash, restore,
 * permanent deletion and link revocation stay open, and everything is retained
 * for when access returns. Self-hosted deployments (no billing configured)
 * resolve every owner to entitled in `readEntitlements`.
 */
import { json, type ControlEnv } from './auth.js';
import { readEntitlements } from './entitlements.js';

export const CONTINUITY_REQUIRED = 'continuity-required';

export function continuityRequiredResponse(): Response {
  return json({ ok: false, error: CONTINUITY_REQUIRED }, 403);
}

export async function ownerHasContinuity(env: ControlEnv, userId: string | null): Promise<boolean> {
  if (userId === null) return false;
  return (await readEntitlements(env, userId)).continuity;
}

export async function spaceOwnerId(env: ControlEnv, spaceId: string | null): Promise<string | null> {
  if (spaceId === null) return null;
  const row = await env.DB.prepare('SELECT owner_user_id FROM spaces WHERE id = ?1')
    .bind(spaceId)
    .first<{ owner_user_id: string }>();
  return row?.owner_user_id ?? null;
}

/** A context bills the owner of the space it was created in. */
export async function contextOwnerId(env: ControlEnv, contextId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT s.owner_user_id AS owner FROM contexts c JOIN spaces s ON s.id = c.space_id WHERE c.id = ?1',
  )
    .bind(contextId)
    .first<{ owner: string }>();
  return row?.owner ?? null;
}

/** `null` when the space owner holds `continuity`; otherwise the 403 to return. */
export async function requireSpaceContinuity(env: ControlEnv, spaceId: string | null): Promise<Response | null> {
  return (await ownerHasContinuity(env, await spaceOwnerId(env, spaceId))) ? null : continuityRequiredResponse();
}

/** `null` when the context's owner holds `continuity`; otherwise the 403 to return. */
export async function requireContextContinuity(env: ControlEnv, contextId: string): Promise<Response | null> {
  return (await ownerHasContinuity(env, await contextOwnerId(env, contextId))) ? null : continuityRequiredResponse();
}

/**
 * Identified sessions are part of the loop; checked when a session is created or
 * first allocated, never per join — the same rule as named (`roster`) sessions.
 * `null` owner means the ops admin key, which carries no account.
 */
export async function requireIdentifiedSessionAccess(
  env: ControlEnv,
  ownerId: string | null,
): Promise<Response | null> {
  if (ownerId === null) return null;
  return (await ownerHasContinuity(env, ownerId)) ? null : continuityRequiredResponse();
}
