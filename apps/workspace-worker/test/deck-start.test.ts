import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { call, createSessionWithOutline, SMOKE_OUTLINE } from './helpers';
import { signCookieValue } from '../src/cookies.js';
import { SESSION_COOKIE, CSRF_HEADER } from '../src/auth';

async function user() {
  const id = crypto.randomUUID(), authId = crypto.randomUUID(), now = Date.now();
  await env.DB.prepare('INSERT INTO users (id,google_sub,email,name,created_at,entitlements) VALUES (?1,?1,?2,?3,?4,?5)').bind(id, `${id}@example.test`, 'Trainer', now, '{"team":true}').run();
  await env.DB.prepare('INSERT INTO auth_sessions (id,user_id,created_at,expires_at) VALUES (?1,?2,?3,?4)').bind(authId, id, now, now + 3600000).run();
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(await signCookieValue('test-secret', authId))}`;
  return { id, cookie, request: (path: string, body?: object) => call(path, { method: body ? 'POST' : 'GET', headers: { cookie, [CSRF_HEADER]: '1', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }) };
}
async function deck(owner: Awaited<ReturnType<typeof user>>) {
  const space = (await (await owner.request('/api/my/spaces')).json() as { spaces: { id: string }[] }).spaces[0]!;
  const created = await owner.request('/api/decks', { spaceId: space.id, content: { ...SMOKE_OUTLINE, steps: [{ id: 'welcome', kind: 'statement', title: 'Welcome', body: 'Discuss together' }, { id: 'question', kind: 'interaction', interactionId: 'warmup' }] } });
  expect(created.status).toBe(201);
  return { ...(await created.json() as { deck: { id: string } }).deck, spaceId: space.id };
}
interface Live { sessionId: string; sessionCode: string; hostToken: string }
const host = (live: Live, path = 'state?role=host', body?: object) => call(`/api/sessions/${live.sessionCode}/${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${live.hostToken}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

describe('retry-safe deck start and authorized recovery', () => {
  it('retains the durable Notes destination without a student context and keeps it host-only', async () => {
    const owner = await user(), source = await deck(owner);
    const live = await (await owner.request(`/api/decks/${source.id}/start`, { requestId: crypto.randomUUID() })).json() as Live;
    const read = async () => {
      const response = await host(live, 'context');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ context: null, session: { id: live.sessionId, title: SMOKE_OUTLINE.meta.title } });
    };
    await read();
    const joined = await (await call('/api/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: live.sessionCode }) })).json() as { participantToken: string };
    expect((await call(`/api/sessions/${live.sessionCode}/context`, { headers: { authorization: `Bearer ${joined.participantToken}` } })).status).toBe(403);
    await host(live, 'commands', { command: { command: 'session.end' }, idempotencyKey: 'end' });
    await read();
    const temporary = await createSessionWithOutline(SMOKE_OUTLINE);
    const response = await call(`/api/sessions/${temporary.code}/context`, { headers: { authorization: `Bearer ${temporary.hostToken}` } });
    expect(await response.json()).toEqual({ context: null, session: null });
  });

  it('allocates one audience for competing starts and preserves its current question, reveal and answers on retries', async () => {
    const owner = await user(), source = await deck(owner), requestId = crypto.randomUUID();
    const replies = await Promise.all([1, 2, 3].map(() => owner.request(`/api/decks/${source.id}/start`, { requestId, stepId: 'question' })));
    for (const reply of replies) expect(reply.status, await reply.clone().text()).toBe(201);
    const results = await Promise.all(replies.map((reply) => reply.json() as Promise<Live>)), live = results[0]!;
    expect(new Set(results.map((value) => value.sessionCode)).size).toBe(1);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM live_sessions WHERE session_id = ?1').bind(requestId).first<{ n: number }>())!.n).toBe(1);
    const joined = await (await call('/api/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: live.sessionCode }) })).json() as { participantToken: string };
    const answer = await call(`/api/sessions/${live.sessionCode}/commands`, { method: 'POST', headers: { authorization: `Bearer ${joined.participantToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'answer', command: { command: 'answer.submit', interactionId: 'warmup', answer: { kind: 'choice', optionIds: ['a'] } } }) });
    expect(answer.status, await answer.clone().text()).toBe(200);
    expect((await host(live, 'commands', { idempotencyKey: 'reveal', command: { command: 'interaction.reveal', interactionId: 'warmup' } })).status).toBe(200);
    const before = await (await host(live)).json();
    const replay = await owner.request(`/api/decks/${source.id}/start`, { requestId, stepId: 'welcome' });
    expect(replay.status).toBe(201);
    expect(await (await host(live)).json()).toEqual(before);
    const resumed = await owner.request(`/api/sessions/${requestId}/resume`, {});
    expect(resumed.status).toBe(200);
    expect((await resumed.json() as Live).sessionCode).toBe(live.sessionCode);
  });

  it('does not resurrect ended or expired sessions and uses a fresh request for another audience', async () => {
    const owner = await user(), source = await deck(owner), requestId = crypto.randomUUID();
    const live = await (await owner.request(`/api/decks/${source.id}/start`, { requestId })).json() as Live;
    await host(live, 'commands', { command: { command: 'session.end' }, idempotencyKey: 'end' });
    expect((await owner.request(`/api/decks/${source.id}/start`, { requestId })).status).toBe(409);
    const next = await (await owner.request(`/api/decks/${source.id}/start`, { requestId: crypto.randomUUID() })).json() as Live;
    expect(next.sessionCode).not.toBe(live.sessionCode);
    const pending = await owner.request('/api/sessions', { deckId: source.id });
    const { session } = await pending.json() as { session: { id: string } };
    await env.DB.prepare('INSERT INTO live_sessions (code,user_id,created_at,deck_id,deck_version,session_id,space_id) VALUES (?1,?2,?3,?4,1,?5,?6)').bind('2HJK3MNP', owner.id, Date.now() - 11 * 60_000, source.id, session.id, source.spaceId).run();
    expect((await owner.request(`/api/sessions/${session.id}/launch`, { start: true })).status).toBe(410);
  });

  it('checks current access for new starts and keeps recovery available after a billing downgrade', async () => {
    const owner = await user(), helper = await user(), stranger = await user(), source = await deck(owner);
    const path = `/api/decks/${source.id}/start`;
    expect((await stranger.request(path, { requestId: crypto.randomUUID() })).status).toBe(404);
    expect((await call(path, { method: 'POST', headers: { cookie: owner.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID() }) })).status).toBe(403);
    await env.DB.prepare('INSERT INTO space_members (space_id,user_id,role,created_at) VALUES (?1,?2,?3,?4)').bind(source.spaceId, helper.id, 'presenter', Date.now()).run();
    const requestId = crypto.randomUUID(), created = await helper.request(path, { requestId });
    expect(created.status).toBe(201); const live = await created.json() as Live;
    expect((await owner.request(`/api/sessions/${requestId}/resume`, {})).status).toBe(200);
    expect((await stranger.request(`/api/sessions/${requestId}/resume`, {})).status).toBe(404);
    await env.DB.prepare("UPDATE users SET entitlements = '{}' WHERE id = ?1").bind(owner.id).run();
    const rejectedId = crypto.randomUUID();
    expect((await helper.request(path, { requestId: rejectedId })).status).toBe(403);
    expect(await env.DB.prepare('SELECT id FROM sessions WHERE id = ?1').bind(rejectedId).first()).toBeNull();
    expect((await helper.request(`/api/sessions/${requestId}/resume`, {})).status).toBe(200);
    const retried = await helper.request(path, { requestId });
    expect(retried.status).toBe(201);
    expect((await retried.json() as Live).sessionCode).toBe(live.sessionCode);
    expect((await host(live)).status).toBe(200);
    await env.DB.prepare('DELETE FROM space_members WHERE space_id=?1 AND user_id=?2').bind(source.spaceId, helper.id).run();
    expect((await helper.request(`/api/sessions/${requestId}/resume`, {})).status).toBe(404);
    expect((await host(live)).status).toBe(403);
  });
});
