/**
 * The relay's own surface: key-gated creation, anonymous and pseudonymous
 * joins, the refusals that keep identified sessions on the control plane, and
 * the participant limit a key holder sets.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import worker from '../src/index.js';
import { signToken } from '../src/tokens.js';
import {
  BASE,
  SMOKE_OUTLINE,
  call,
  createRequest,
  createSessionWithOutline,
  join,
  stateJson,
} from './helpers.js';

function withOutlineMode(identityMode: string) {
  return { ...SMOKE_OUTLINE, defaults: { ...SMOKE_OUTLINE.defaults, identityMode } };
}

function joinBody(body: Record<string, unknown>): Promise<Response> {
  return call('/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/sessions', () => {
  it('requires the relay key', async () => {
    const missing = await call('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outline: SMOKE_OUTLINE }),
    });
    expect(missing.status).toBe(401);

    const wrong = await call('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer not-the-key' },
      body: JSON.stringify({ outline: SMOKE_OUTLINE }),
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('is disabled when no relay key is configured', async () => {
    const response = await worker.fetch(
      new Request(`${BASE}/api/sessions`, createRequest(SMOKE_OUTLINE)),
      { ...env, RELAY_KEY: '' } as never,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'creation-disabled' });
  });

  it('returns the code, the host and stage tokens, and the join link', async () => {
    const created = await createSessionWithOutline(SMOKE_OUTLINE);
    expect(created.sessionCode).toMatch(/^[A-Z0-9]+$/);
    expect(created.code).toBe(created.sessionCode);
    expect(created.joinUrl).toBe(`https://join.openroom.app/?code=${created.sessionCode}`);

    const host = await stateJson(created.sessionCode, created.hostToken, 'host');
    expect(host.status).toBe('lobby');
    const stage = await stateJson(created.sessionCode, created.stageToken, 'stage');
    expect(stage.status).toBe('lobby');
  });

  it('accepts a YAML outline', async () => {
    const yaml = [
      'version: 1',
      'meta:',
      '  title: YAML outline',
      'interactions:',
      '  - id: q',
      '    type: choice',
      '    prompt: Pick',
      '    options:',
      '      - { id: a, label: A }',
      '      - { id: b, label: B }',
    ].join('\n');
    const response = await call('/api/sessions', createRequest(yaml));
    expect(response.status).toBe(201);
  });

  it('refuses identified and roster sessions', async () => {
    for (const mode of ['identified', 'roster']) {
      const response = await call('/api/sessions', createRequest(withOutlineMode(mode)));
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: 'identity-mode-unavailable', identityMode: mode });
    }
  });

  it('rejects an invalid participant limit', async () => {
    for (const participantLimit of [0, -1, 1.5, 'ten']) {
      const response = await call('/api/sessions', createRequest(SMOKE_OUTLINE, { participantLimit }));
      expect(response.status).toBe(400);
    }
  });
});

describe('POST /api/join', () => {
  it('seats anonymous participants with no limit by default', async () => {
    const created = await createSessionWithOutline(SMOKE_OUTLINE);
    const joined = await Promise.all([1, 2, 3, 4, 5].map(() => join(created.code)));
    expect(new Set(joined.map((p) => p.participantId)).size).toBe(5);
    const host = await stateJson(created.sessionCode, created.hostToken, 'host');
    expect(host.participantCount).toBe(5);
  });

  it('hands out a recovery handle in a pseudonymous session', async () => {
    const created = await createSessionWithOutline(withOutlineMode('pseudonymous'));
    const first = await join(created.code);
    expect(first.identityMode).toBe('pseudonymous');
    expect(typeof first.handle).toBe('string');

    const again = await join(created.code, first.handle);
    expect(again.participantId).toBe(first.participantId);
  });

  it('refuses context links and roster invites', async () => {
    const created = await createSessionWithOutline(SMOKE_OUTLINE);
    for (const credential of [{ contextLink: 'cl_x' }, { rosterInvite: 'ri_x' }]) {
      const response = await joinBody({ code: created.code, ...credential });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: 'identified-join-unavailable' });
    }
  });

  it('honours the participant limit the creator sets', async () => {
    const created = await createSessionWithOutline(SMOKE_OUTLINE, { participantLimit: 2 });
    await join(created.code);
    await join(created.code);
    const third = await joinBody({ code: created.code });
    expect(third.status).toBe(409);
    expect(await third.json()).toMatchObject({ error: 'session-full' });
  });
});

describe('session routes', () => {
  it('refuses account-bound host tokens', async () => {
    const created = await createSessionWithOutline(SMOKE_OUTLINE);
    const accountToken = await signToken(env.TOKEN_SECRET, {
      sessionCode: created.sessionCode,
      role: 'host',
      facilitatorId: 'user-1',
      userId: 'user-1',
    });
    const response = await call(`/api/sessions/${created.sessionCode}/state?role=host`, {
      headers: { authorization: `Bearer ${accountToken}` },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'account-session' });
  });

  it('re-mints the stage token for the host only', async () => {
    const created = await createSessionWithOutline(SMOKE_OUTLINE);
    const minted = await call(`/api/sessions/${created.sessionCode}/stage-token`, {
      headers: { authorization: `Bearer ${created.hostToken}` },
    });
    expect(minted.status).toBe(200);
    const { stageToken } = (await minted.json()) as { stageToken: string };
    expect((await stateJson(created.sessionCode, stageToken, 'stage')).status).toBe('lobby');

    const asStage = await call(`/api/sessions/${created.sessionCode}/stage-token`, {
      headers: { authorization: `Bearer ${created.stageToken}` },
    });
    expect(asStage.status).toBe(403);
  });

  it('exports ballots to the host', async () => {
    const created = await createSessionWithOutline(SMOKE_OUTLINE);
    const response = await call(`/api/sessions/${created.sessionCode}/export?format=ballots`, {
      headers: { authorization: `Bearer ${created.hostToken}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
  });
});

describe('front door', () => {
  it('reports health', async () => {
    const response = await call('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('sends the bare origin to the participant app, keeping the code', async () => {
    const response = await call('/?code=ABCD1234', { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${BASE}/join/?code=ABCD1234`);
  });

  it('answers unknown API paths with 404', async () => {
    const response = await call('/api/my/home');
    expect(response.status).toBe(404);
  });
});
