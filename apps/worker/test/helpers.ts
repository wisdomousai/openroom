/**
 * Shared HTTP-level test helpers for the deep behavioural suite.
 *
 * Every helper talks to the worker exclusively through `worker.fetch` (SELF),
 * mirroring how a real client would — no reaching into SessionDO internals,
 * per the assignment's "test through the HTTP/WS interface" constraint.
 */
import { env } from 'cloudflare:test';

import worker from '../src/index.js';

export const BASE = 'https://openroom.test';

export function call(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`${BASE}${path}`, init), env as never);
}

export const SMOKE_OUTLINE = {
  version: 1,
  meta: { title: 'Helper outline' },
  defaults: { identityMode: 'anonymous', resultVisibility: 'hidden-until-close' },
  interactions: [
    {
      id: 'warmup',
      type: 'choice',
      prompt: 'Pick one',
      options: [
        { id: 'a', label: 'A', correct: true },
        { id: 'b', label: 'B', misconception: 'nope' },
      ],
    },
  ],
};

/** Create a presentation context (required parent for sessions/templates). */
/**
 * A context and the space it brought with it.
 *
 * A space holds one context, so a new context is created in a space of its own
 * — never the caller's home space. Tests that file work alongside the context
 * must use `spaceId` from here, not `/api/my/spaces` [0], or they are naming
 * two different spaces and the cross-boundary check will refuse them.
 */
export interface SmokeContext {
  contextId: string;
  spaceId: string;
}

export async function createSmokeContext(
  request: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<SmokeContext> {
  // Bootstrap personal space first (the new space inherits its settings).
  await request('/api/my/spaces', { method: 'GET' });
  const res = await request('/api/tutoring/contexts', {
    method: 'POST',
    body: JSON.stringify({
      displayName: 'Test context',
      kind: 'person',
      context: { language: 'en', level: 'A1', goals: ['test'] },
    }),
  });
  if (res.status !== 201) {
    throw new Error(`createSmokeContext failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { context: { id: string; spaceId: string } };
  return { contextId: body.context.id, spaceId: body.context.spaceId };
}

export interface CreatedSession {
  sessionCode: string;
  code: string;
  hostToken: string;
  stageToken: string;
}

export async function createSessionWithOutline(outline: unknown): Promise<CreatedSession> {
  const res = await call('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-openroom-admin': 'test-admin' },
    body: JSON.stringify({ outline }),
  });
  if (res.status !== 201) {
    throw new Error(`createSessionWithOutline failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export function createLiveSession(): Promise<CreatedSession> {
  return createSessionWithOutline(SMOKE_OUTLINE);
}

export interface JoinedParticipant {
  sessionCode: string;
  participantToken: string;
  participantId: string;
  identityMode?: string;
  handle?: string;
}

export async function join(code: string, recoveryHandle?: string): Promise<JoinedParticipant> {
  const res = await call('/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, ...(recoveryHandle === undefined ? {} : { recoveryHandle }) }),
  });
  if (res.status !== 200) {
    throw new Error(`join failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export function post(
  sessionCode: string,
  token: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return call(`/api/sessions/${sessionCode}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...extraHeaders },
    body: JSON.stringify(body),
  });
}

export function command(
  sessionCode: string,
  token: string,
  cmd: Record<string, unknown>,
  opts: { idempotencyKey?: string; expectedRevision?: number } = {},
): Promise<Response> {
  return post(sessionCode, token, {
    idempotencyKey: opts.idempotencyKey ?? crypto.randomUUID(),
    ...(opts.expectedRevision === undefined ? {} : { expectedRevision: opts.expectedRevision }),
    command: cmd,
  });
}

export function getState(
  sessionCode: string,
  token: string,
  role: 'host' | 'participant' | 'stage',
  extraParams: Record<string, string> = {},
): Promise<Response> {
  const params = new URLSearchParams({ role, ...extraParams });
  return call(`/api/sessions/${sessionCode}/state?${params.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

export async function stateJson(
  sessionCode: string,
  token: string,
  role: 'host' | 'participant' | 'stage',
  extraParams: Record<string, string> = {},
): Promise<Record<string, any>> {
  const res = await getState(sessionCode, token, role, extraParams);
  if (res.status !== 200) {
    throw new Error(`stateJson failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** Poll a condition up to `timeoutMs`, sleeping `stepMs` between checks. */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
  stepMs = 25,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}
