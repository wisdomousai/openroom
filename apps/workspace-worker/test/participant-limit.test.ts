/**
 * Free live sessions admit FREE_SESSION_PARTICIPANT_LIMIT participants; the
 * space owner's `largeSessions` lifts it. The limit is captured at session start
 * and travels into the DO, so a billing change never alters a running session.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { FREE_SESSION_PARTICIPANT_LIMIT as LIMIT } from '@openroom/schema';

import worker, { type Env } from '../src/index';
import { BASE, SMOKE_OUTLINE } from './helpers';
import { account, configured, member, subscribe, type Account } from './paid-fixtures';

const selfHosted: Env = { ...configured, PADDLE_ENVIRONMENT: undefined };
const outline = (identityMode: string) => ({ ...SMOKE_OUTLINE, defaults: { ...SMOKE_OUTLINE.defaults, identityMode }, steps: [{ id: 'question', kind: 'interaction', interactionId: 'warmup' }] });

async function join(code: string, body: object = {}, target: Env = configured): Promise<{ status: number; body: any }> {
  const response = await worker.fetch(new Request(`${BASE}/api/join`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, ...body }),
  }), target);
  return { status: response.status, body: await response.json() };
}

async function admit(code: string, count: number, target: Env = configured) {
  const joined = [];
  for (let i = 0; i < count; i++) {
    const result = await join(code, {}, target);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    joined.push(result.body as { participantId: string; handle?: string });
  }
  return joined;
}

async function startDeck(starter: Account, spaceId: string, identityMode = 'anonymous'): Promise<string> {
  const deck = await starter.request('/api/decks', 'POST', { spaceId, content: outline(identityMode) });
  expect(deck.status, JSON.stringify(deck.body)).toBe(201);
  const started = await starter.request(`/api/decks/${deck.body.deck.id}/start`, 'POST', { requestId: crypto.randomUUID() });
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  return started.body.code as string;
}

describe('free session participant limit', () => {
  it('admits the limit, refuses the next new participant, and always readmits a handle', async () => {
    const owner = await account();
    const code = await startDeck(owner, owner.spaceId, 'pseudonymous');
    const admitted = await admit(code, LIMIT);
    expect(await join(code)).toEqual({ status: 409, body: { error: 'session-full', message: 'This session is full.' } });

    const back = await join(code, { recoveryHandle: admitted[0]!.handle });
    expect(back.status).toBe(200);
    expect(back.body.participantId).toBe(admitted[0]!.participantId);
    expect((await join(code)).status).toBe(409);
  });

  it('readmits an identified seat at the limit and refuses a new seat', async () => {
    const owner = await account();
    await env.DB.prepare('UPDATE users SET entitlements = ?1 WHERE id = ?2').bind(JSON.stringify({ roster: true }), owner.id).run();
    const created = await owner.request('/api/sessions', 'POST', { outline: outline('roster') });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    // The Worker verifies the roster invite and forwards only the seat; seats are driven directly here.
    const stub = env.SESSIONS.get(env.SESSIONS.idFromName(created.body.sessionCode));
    const seat = async (n: number) => {
      const response = await stub.fetch('https://session.internal/__join', { method: 'POST', body: JSON.stringify({ identity: { displayName: `Seat ${n}`, seatKey: `seat-${n}` } }) });
      return { status: response.status, body: await response.json() as { participantId?: string; error?: string } };
    };
    const first = await seat(0);
    for (let n = 1; n < LIMIT; n++) expect((await seat(n)).status).toBe(200);
    expect(await seat(LIMIT)).toMatchObject({ status: 409, body: { error: 'session-full' } });
    expect(await seat(0)).toMatchObject({ status: 200, body: { participantId: first.body.participantId } });
  });

  it('shows the limit to the host console of a free session', async () => {
    const owner = await account();
    const deck = await owner.request('/api/decks', 'POST', { spaceId: owner.spaceId, content: outline('anonymous') });
    const started = await owner.request(`/api/decks/${deck.body.deck.id}/start`, 'POST', { requestId: crypto.randomUUID() });
    const state = await worker.fetch(new Request(`${BASE}/api/sessions/${started.body.sessionCode}/state?role=host`, { headers: { authorization: `Bearer ${started.body.hostToken}` } }), configured);
    expect((await state.json() as { participantLimit?: number }).participantLimit).toBe(LIMIT);
  });
});

describe('largeSessions', () => {
  it('lets a member start an unlimited session in a paid owner’s space, and a lapse keeps it unlimited', async () => {
    const owner = await account(), editor = await account(), change = await subscribe(owner);
    await member(owner, editor);
    const code = await startDeck(editor, owner.spaceId);
    await admit(code, LIMIT);
    await change('canceled');
    expect((await join(code)).status).toBe(200);
  });

  it('keeps a free session’s limit after the owner subscribes mid-session', async () => {
    const owner = await account();
    const code = await startDeck(owner, owner.spaceId);
    await subscribe(owner);
    await admit(code, LIMIT);
    expect((await join(code)).body.error).toBe('session-full');
  });

  it('is held by every account on a self-hosted deployment', async () => {
    const owner = await account(selfHosted);
    const created = await owner.raw('/api/sessions', 'POST', { outline: outline('anonymous') });
    expect(created.status).toBe(201);
    const { code } = await created.json() as { code: string };
    await admit(code, LIMIT + 1, selfHosted);
  });

  it('leaves owner-less admin-key sessions unlimited', async () => {
    const created = await worker.fetch(new Request(`${BASE}/api/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-openroom-admin': env.ADMIN_KEY }, body: JSON.stringify({ outline: outline('anonymous') }),
    }), configured);
    expect(created.status).toBe(201);
    const { code } = await created.json() as { code: string };
    await admit(code, LIMIT + 1);
  });
});
