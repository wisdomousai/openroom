/**
 * Shared helpers for the control-plane modules (tutoring, delivery).
 * Nothing here touches the ballot hot path.
 */
import type { ControlEnv, SessionUser } from './auth.js';
import { ensureWorkspace } from './workspace.js';

export const DELETION_INTENT_TTL_MS = 15 * 60 * 1000;

export function randomId(): string {
  return crypto.randomUUID();
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let binary = '';
  for (const byte of buf) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function parseJson(value: string, fallback: unknown): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function plainObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function compactArray(value: unknown, max = 50): unknown[] | null {
  return Array.isArray(value) && value.length <= max ? value : null;
}

export async function memberOfSpace(env: ControlEnv, userId: string, spaceId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 AS ok FROM space_members WHERE space_id = ?1 AND user_id = ?2',
  )
    .bind(spaceId, userId)
    .first();
  return row !== null;
}

/**
 * Link a context into a space.
 *
 * One row per space — the primary key is `space_id`, which is how "a space
 * holds one context" is enforced rather than remembered. `context_id` is not
 * unique: the same person linked from a second space is how a context is
 * reused, and since the language pair lives on the space, it is also how one
 * student is taught two languages.
 *
 * Callers must have checked the space is free; a plain INSERT is used so a
 * mistake surfaces instead of silently evicting the space's current context.
 */
export async function linkContext(
  env: ControlEnv,
  spaceId: string,
  contextId: string,
  now: number,
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO space_contexts (space_id, context_id, created_at) VALUES (?1, ?2, ?3)',
  )
    .bind(spaceId, contextId, now)
    .run();
}

/** The context a space holds, or null when it holds none. */
export async function contextOfSpace(env: ControlEnv, spaceId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT context_id FROM space_contexts WHERE space_id = ?1')
    .bind(spaceId)
    .first<{ context_id: string }>();
  return row?.context_id ?? null;
}

export async function resolveSpace(
  env: ControlEnv,
  user: SessionUser,
  requested: unknown,
): Promise<string | null> {
  const home = await ensureWorkspace(env, user);
  if (typeof requested !== 'string' || requested === '') return home.spaceId;
  return (await memberOfSpace(env, user.id, requested)) ? requested : null;
}
