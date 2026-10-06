import { join, resolve } from 'node:path';
import type { CreatedSession, WalkthroughJourney, WalkthroughRuntime } from './types';

const origin = (process.env.OPENROOM_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const adminKey = process.env.OPENROOM_ADMIN_KEY ?? 'dev-admin';

async function call(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${origin}${path}`, init);
}

async function createSession(outline: unknown): Promise<CreatedSession> {
  const response = await call('/api/sessions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-openroom-admin': adminKey,
    },
    body: JSON.stringify({ outline }),
  });
  if (response.status !== 201) {
    throw new Error(`Could not seed walkthrough session: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<CreatedSession>;
}

async function sendCommand(sessionCode: string, token: string, command: Record<string, unknown>): Promise<void> {
  const response = await call(`/api/sessions/${encodeURIComponent(sessionCode)}/commands`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      idempotencyKey: crypto.randomUUID(),
      command,
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not seed session command: ${response.status} ${await response.text()}`);
  }
}

function pathsFor(session: CreatedSession): WalkthroughRuntime['paths'] {
  const hostToken = encodeURIComponent(session.hostToken);
  const stageToken = encodeURIComponent(session.stageToken);
  const sessionCode = encodeURIComponent(session.sessionCode);
  const stage = new URL('/stage/', origin);
  stage.searchParams.set('session', session.sessionCode);
  stage.searchParams.set('token', session.stageToken);
  const participant = new URL('/join/', origin);
  participant.searchParams.set('code', session.code);
  return {
    host: `${origin}/host/#/sessions/${sessionCode}?token=${hostToken}`,
    stage: stage.toString(),
    participant: participant.toString(),
    qna: `${origin}/host/#/sessions/${sessionCode}/qna?token=${hostToken}`,
  };
}

export async function seedJourney(
  journey: WalkthroughJourney,
  outputDir: string,
): Promise<WalkthroughRuntime | null> {
  if (!journey.seed) return null;
  const seedPath = resolve(import.meta.dir, '../seeds', `${journey.seed}.json`);
  const outline = await Bun.file(seedPath).json();
  const session = await createSession(outline);
  if (journey.seed === 'qna-session') {
    await sendCommand(session.sessionCode, session.hostToken, { command: 'session.start' });
  }
  const runtime: WalkthroughRuntime = {
    ...session,
    journeyId: journey.id,
    createdAt: new Date().toISOString(),
    paths: pathsFor(session),
  };
  await Bun.write(join(outputDir, 'runtime.json'), `${JSON.stringify(runtime, null, 2)}\n`);
  return runtime;
}
