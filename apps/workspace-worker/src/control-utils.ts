/**
 * Shared helpers for the control-plane modules (tutoring, delivery).
 * Nothing here touches the answer hot path.
 */
import { and, eq, sql } from 'drizzle-orm';

import type { ControlEnv, SessionUser } from './auth.js';
import { orm } from './db/client.js';
import { spaceMembers, spaceStudents } from './db/schema.js';
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
  const row = await orm(env)
    .select({ ok: sql`1` })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
    .get();
  return row !== undefined;
}

/**
 * Link a student into a space.
 *
 * One row per space — the primary key is `space_id`, which is how "a space
 * holds one student" is enforced rather than remembered. `student_id` is not
 * unique: the same person linked from a second space is how a student is
 * reused, and since the language pair lives on the space, it is also how one
 * student is taught two languages.
 *
 * Callers must have checked the space is free; a plain INSERT is used so a
 * mistake surfaces instead of silently evicting the space's current student.
 */
export async function linkStudent(
  env: ControlEnv,
  spaceId: string,
  studentId: string,
  now: number,
): Promise<void> {
  await orm(env).insert(spaceStudents).values({ spaceId, studentId, createdAt: now }).run();
}

/** The student a space holds, or null when it holds none. */
export async function studentOfSpace(env: ControlEnv, spaceId: string): Promise<string | null> {
  const row = await orm(env)
    .select({ studentId: spaceStudents.studentId })
    .from(spaceStudents)
    .where(eq(spaceStudents.spaceId, spaceId))
    .get();
  return row?.studentId ?? null;
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
