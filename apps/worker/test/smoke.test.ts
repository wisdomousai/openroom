/**
 * Wiring smoke tests — proof that the router + SessionDO + domain session in workerd.
 * The deep behavioural suite lives elsewhere; keep this file small.
 */
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import worker from '../src/index.js';

const OUTLINE = {
  version: 1,
  meta: { title: 'Smoke outline' },
  defaults: { resultVisibility: 'hidden-until-close' },
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

const BASE = 'https://openroom.test';

function call(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`${BASE}${path}`, init), env as never);
}

async function createLiveSession(): Promise<{ sessionCode: string; code: string; hostToken: string; stageToken: string }> {
  const res = await call('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-openroom-admin': 'test-admin' },
    body: JSON.stringify({ outline: OUTLINE }),
  });
  expect(res.status).toBe(201);
  return res.json();
}

async function join(code: string): Promise<{ participantToken: string; participantId: string }> {
  const res = await call('/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  expect(res.status).toBe(200);
  return res.json();
}

function post(sessionCode: string, token: string, body: unknown): Promise<Response> {
  return call(`/api/sessions/${sessionCode}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe('worker smoke', () => {
  it('sessions create → join → open → submit and reflects the answer in the snapshot', async () => {
    const session = await createLiveSession();
    const participant = await join(session.code);

    const start = await post(session.sessionCode, session.hostToken, {
      idempotencyKey: crypto.randomUUID(),
      command: { command: 'session.start' },
    });
    expect(start.status).toBe(200);

    const open = await post(session.sessionCode, session.hostToken, {
      idempotencyKey: crypto.randomUUID(),
      expectedRevision: ((await start.json()) as { revision: number }).revision,
      command: { command: 'interaction.open', interactionId: 'warmup' },
    });
    expect(open.status).toBe(200);

    const submit = await post(session.sessionCode, participant.participantToken, {
      idempotencyKey: crypto.randomUUID(),
      command: {
        command: 'answer.submit',
        interactionId: 'warmup',
        answer: { kind: 'choice', optionIds: ['a'] },
      },
    });
    expect(submit.status).toBe(200);

    const stateRes = await call(`/api/sessions/${session.sessionCode}/state?role=participant`, {
      headers: { authorization: `Bearer ${participant.participantToken}` },
    });
    expect(stateRes.status).toBe(200);
    const snapshot = (await stateRes.json()) as Record<string, unknown>;
    expect(snapshot.answered).toBe(true);
    expect(snapshot.ownAnswer).toEqual({ kind: 'choice', optionIds: ['a'] });
    // hidden-until-close: no results before reveal
    expect(snapshot.aggregate).toBeNull();
    expect(typeof snapshot.revision).toBe('number');
    // pre-reveal safety: no correct flags leak
    expect(JSON.stringify(snapshot.interaction)).not.toContain('correct');
  });

  it('replays a duplicate idempotency key with an identical result', async () => {
    const session = await createLiveSession();
    const key = crypto.randomUUID();
    const first = await post(session.sessionCode, session.hostToken, {
      idempotencyKey: key,
      command: { command: 'session.start' },
    });
    const second = await post(session.sessionCode, session.hostToken, {
      idempotencyKey: key,
      command: { command: 'session.start' },
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
  });

  it('rejects a host-only command sent with a participant token (403)', async () => {
    const session = await createLiveSession();
    const participant = await join(session.code);
    const res = await post(session.sessionCode, participant.participantToken, {
      idempotencyKey: crypto.randomUUID(),
      command: { command: 'session.start' },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('E_FORBIDDEN');
  });

  it('serves stage/host snapshots and 304s an unchanged revision, and reveals correct answers', async () => {
    const session = await createLiveSession();
    await join(session.code);
    for (const command of [
      { command: 'session.start' },
      { command: 'interaction.open', interactionId: 'warmup' },
      { command: 'interaction.reveal', interactionId: 'warmup' },
    ]) {
      const res = await post(session.sessionCode, session.hostToken, {
        idempotencyKey: crypto.randomUUID(),
        command,
      });
      expect(res.status).toBe(200);
    }

    const stage = await call(`/api/sessions/${session.sessionCode}/state?role=stage`, {
      headers: { authorization: `Bearer ${session.stageToken}` },
    });
    const stageSnap = (await stage.json()) as Record<string, any>;
    expect(stageSnap.code).toBe(session.code);
    expect(stageSnap.joinUrl).toBe(`https://join.openroom.app/?code=${session.code}`);
    expect(stageSnap.participantCount).toBe(1);
    expect(stageSnap.aggregate).not.toBeNull();
    // post-reveal the stage gets the correctness markers back
    expect(stageSnap.interaction.options[0].correct).toBe(true);
    expect(stageSnap.interaction.options[1].misconception).toBe('nope');

    const notModified = await call(
      `/api/sessions/${session.sessionCode}/state?role=stage&afterRevision=${stageSnap.revision}`,
      { headers: { authorization: `Bearer ${session.stageToken}` } },
    );
    expect(notModified.status).toBe(304);

    const host = await call(`/api/sessions/${session.sessionCode}/state?role=host`, {
      headers: { authorization: `Bearer ${session.hostToken}` },
    });
    const hostSnap = (await host.json()) as Record<string, any>;
    expect(hostSnap.interactions[0].status).toBe('revealed');

    // participant token must not be usable as a host token
    const wrongRole = await call(`/api/sessions/${session.sessionCode}/state?role=host`, {
      headers: { authorization: `Bearer ${session.stageToken}` },
    });
    expect(wrongRole.status).toBe(403);
  });

  it('exports CSV and JSON for the host only, and rejects bad outlines', async () => {
    const session = await createLiveSession();
    const csv = await call(`/api/sessions/${session.sessionCode}/export?format=csv`, {
      headers: { authorization: `Bearer ${session.hostToken}` },
    });
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-disposition')).toContain('.csv');
    expect(await csv.text()).toContain('interactionId,prompt,type,status,total,summary');

    const forbidden = await call(`/api/sessions/${session.sessionCode}/export?format=json`, {
      headers: { authorization: `Bearer ${session.stageToken}` },
    });
    expect(forbidden.status).toBe(403);

    const bad = await call('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-openroom-admin': 'test-admin' },
      body: JSON.stringify({ outline: { version: 1, meta: {}, interactions: [] } }),
    });
    expect(bad.status).toBe(422);
    expect((await bad.json() as { ok: boolean }).ok).toBe(false);

    const unauthorized = await call('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outline: OUTLINE }),
    });
    expect(unauthorized.status).toBe(401);

    const missing = await SELF.fetch(`${BASE}/api/nope`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/json');
  });

  it('advertises RFC 8288/9727 agent discovery Link headers on /', async () => {
    const res = await SELF.fetch(`${BASE}/`);
    if (res.status === 404) return;
    const link = res.headers.get('link') ?? '';
    expect(link).toMatch(/rel="api-catalog"/);
    expect(link).toMatch(/rel="service-desc"/);
    expect(link).toMatch(/rel="service-doc"/);
    expect(link).toMatch(/rel="describedby"/);

    const catalog = await SELF.fetch(`${BASE}/.well-known/api-catalog`);
    expect(catalog.status).toBe(200);
    expect(catalog.headers.get('content-type') ?? '').toMatch(/linkset\+json/);
    const body = (await catalog.json()) as { linkset?: unknown[] };
    expect(Array.isArray(body.linkset)).toBe(true);
    expect(body.linkset!.length).toBeGreaterThan(0);

    const openapi = await SELF.fetch(`${BASE}/openapi.json`);
    expect(openapi.status).toBe(200);
    const spec = (await openapi.json()) as { openapi?: string };
    expect(spec.openapi).toMatch(/^3\./);
  });

  it('negotiates Markdown for Accept: text/markdown on the marketing home', async () => {
    const res = await SELF.fetch(`${BASE}/`, {
      headers: { accept: 'text/markdown, text/html;q=0.8, */*;q=0.5' },
    });
    if (res.status === 404) return; // site dist not collected yet
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(res.headers.get('vary')?.toLowerCase()).toContain('accept');
    expect(res.headers.get('x-markdown-tokens')).toMatch(/^\d+$/);
    const body = await res.text();
    expect(body).not.toMatch(/^\s*</);
  });

  it('redirects legacy apex ?code= and /about/ to the join/marketing homes', async () => {
    const joinCode = await SELF.fetch(`${BASE}/?code=ABCD1234`, { redirect: 'manual' });
    expect(joinCode.status).toBe(301);
    expect(joinCode.headers.get('location')).toBe('https://join.openroom.app/?code=ABCD1234');

    const about = await SELF.fetch(`${BASE}/about/`, { redirect: 'manual' });
    expect(about.status).toBe(301);
    expect(about.headers.get('location')).toBe(`${BASE}/`);
  });
});
