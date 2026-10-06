/**
 * API helpers for journey tests — same shape as apps/worker/test/helpers.ts,
 * talking to a real wrangler dev server over HTTP.
 */
import { readFileSync } from 'node:fs';
import { dirname, join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { parse as parseYaml } from 'yaml';

const repoRoot = joinPath(dirname(fileURLToPath(import.meta.url)), '../..');

/** Parse one of the checked-in `examples/*.yaml` session documents. */
export function loadExampleSession(name: string): unknown {
  const file = name.endsWith('.yaml') || name.endsWith('.yml') ? name : `${name}.yaml`;
  const raw = readFileSync(joinPath(repoRoot, 'examples', file), 'utf8');
  return parseYaml(raw);
}

const baseURL = () => (process.env.OPENROOM_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const adminKey = () => process.env.OPENROOM_ADMIN_KEY ?? 'dev-admin';

export interface CreatedSession {
  sessionCode: string;
  code: string;
  hostToken: string;
  stageToken: string;
}

export interface JoinedParticipant {
  sessionCode: string;
  participantToken: string;
  participantId: string;
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseURL()}${path}`, init);
}

export async function createSession(sessionDoc: unknown): Promise<CreatedSession> {
  const res = await call('/api/sessions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-openroom-admin': adminKey(),
    },
    body: JSON.stringify({ outline: sessionDoc }),
  });
  if (res.status !== 201) {
    throw new Error(`createSession failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<CreatedSession>;
}

export async function join(code: string): Promise<JoinedParticipant> {
  const res = await call('/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (res.status !== 200) {
    throw new Error(`join failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<JoinedParticipant>;
}

export async function command(
  sessionCode: string,
  token: string,
  cmd: Record<string, unknown>,
  opts: { idempotencyKey?: string; expectedRevision?: number } = {},
): Promise<Response> {
  const res = await call(`/api/sessions/${sessionCode}/commands`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      idempotencyKey: opts.idempotencyKey ?? crypto.randomUUID(),
      ...(opts.expectedRevision === undefined ? {} : { expectedRevision: opts.expectedRevision }),
      command: cmd,
    }),
  });
  if (!res.ok) {
    throw new Error(`command ${JSON.stringify(cmd)} failed: ${res.status} ${await res.text()}`);
  }
  return res;
}

export function stageUrl(session: CreatedSession): string {
  const u = new URL('/stage/', baseURL());
  u.searchParams.set('session', session.sessionCode);
  u.searchParams.set('token', session.stageToken);
  return u.toString();
}

export function hostUrl(session: CreatedSession): string {
  return `${baseURL()}/host/#/sessions/${encodeURIComponent(session.sessionCode)}?token=${encodeURIComponent(session.hostToken)}`;
}

export function participantUrl(code: string): string {
  const joinBase = process.env.OPENROOM_JOIN_URL?.replace(/\/$/, '') || `${baseURL()}/join`;
  const u = new URL(`${joinBase}/`);
  u.searchParams.set('code', code);
  return u.toString();
}

/**
 * Drive a fresh participant page through the join screen. Since persistent
 * handles landed, ?code= prefills the form but joining is an explicit choice
 * (new participant vs rejoin with a handle).
 */
export async function joinInBrowser(page: Page, code: string): Promise<void> {
  await page.goto(participantUrl(code));
  const join = page.getByRole('button', { name: 'Join', exact: true });
  await join.waitFor({ state: 'visible', timeout: 20_000 });
  await join.click();
}

export async function waitForWorker(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      // Any response from the worker means the process is up (401 on sessions is fine).
      const res = await call('/api/sessions', { method: 'GET' });
      last = String(res.status);
      if (res.status !== 0) return;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Worker not reachable at ${baseURL()} (last: ${last})`);
}
