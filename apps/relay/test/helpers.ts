/**
 * Shared HTTP-level helpers for the relay suite.
 *
 * Every helper talks to the relay exclusively through `worker.fetch`,
 * mirroring how a real client would — no reaching into SessionDO internals.
 * Sessions are created the self-hosted way: `POST /api/sessions` with the
 * relay key.
 */
import { env } from 'cloudflare:test';

import worker from '../src/index.js';

export const BASE = 'https://relay.test';

/** RELAY_KEY bound in vitest.config.ts. */
export const RELAY_KEY = 'test-relay-key';

export const RELAY_AUTH = { authorization: `Bearer ${RELAY_KEY}` };

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

export interface CreatedSession {
  sessionCode: string;
  code: string;
  hostToken: string;
  stageToken: string;
  joinUrl: string;
}

export function createRequest(outline: unknown, extra: Record<string, unknown> = {}): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...RELAY_AUTH },
    body: JSON.stringify({ outline, ...extra }),
  };
}

export async function createSessionWithOutline(
  outline: unknown,
  extra: Record<string, unknown> = {},
): Promise<CreatedSession> {
  const res = await call('/api/sessions', createRequest(outline, extra));
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
