import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { defaultDeckDesign, type PresentationComposition } from '@openroom/schema';
import { call, SMOKE_OUTLINE } from './helpers';
import { signCookieValue } from '../src/tokens';
import { SESSION_COOKIE, CSRF_HEADER } from '../src/auth';
import { startPresentationRoute } from '../src/presentation-start';

async function account() {
  const id = crypto.randomUUID(), authId = crypto.randomUUID(), now = Date.now();
  await env.DB.prepare('INSERT INTO users (id,google_sub,email,name,created_at,entitlements) VALUES (?1,?1,?2,?3,?4,?5)').bind(id, `${id}@example.test`, 'Trainer', now, '{"team":true}').run();
  await env.DB.prepare('INSERT INTO auth_sessions (id,user_id,created_at,expires_at) VALUES (?1,?2,?3,?4)').bind(authId, id, now, now + 3600000).run();
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(await signCookieValue('test-secret', authId))}`;
  const request = (path: string, body?: object) => call(path, { method: body ? 'POST' : 'GET', headers: { cookie, [CSRF_HEADER]: '1', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const { spaces } = await (await request('/api/my/spaces')).json() as { spaces: { id: string }[] };
  return { id, cookie, request, spaceId: spaces[0]!.id };
}
async function source(owner: Awaited<ReturnType<typeof account>>, family: 'clean' | 'board' = 'clean') {
  const reply = await owner.request('/api/decks', { spaceId: owner.spaceId, content: { ...SMOKE_OUTLINE, design: defaultDeckDesign(family), steps: [{ id: 'question', kind: 'interaction', interactionId: 'warmup', tutorNotes: 'private facilitator note' }] } });
  expect(reply.status).toBe(201);
  return (await reply.json() as { deck: { id: string } }).deck;
}
interface Live { sessionId: string; sessionCode: string; hostToken: string; stageToken: string; presentation: PresentationComposition }
const activity = (owner: { spaceId: string }, deck: { id: string }, slideId: string) => ({ slideId, spaceId: owner.spaceId, deckId: deck.id, stepId: 'question' });
const state = async (live: Live, role = 'host') => (await call(`/api/sessions/${live.sessionCode}/state?role=${role}`, { headers: { authorization: `Bearer ${role === 'host' ? live.hostToken : live.stageToken}` } })).json() as Promise<any>;
const command = (live: Live, command: object, token = live.hostToken) => call(`/api/sessions/${live.sessionCode}/commands`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), command }) });

describe('one audience for a PowerPoint presentation', () => {
  it('starts with an embedded content slide, opens answers on a question, and returns to content', async () => {
    const owner = await account();
    const reply = await owner.request('/api/decks', { spaceId: owner.spaceId, content: { ...SMOKE_OUTLINE, steps: [
      { id: 'welcome', kind: 'title', title: 'Welcome to the workshop', tutorNotes: 'Private opening guidance' },
      { id: 'question', kind: 'interaction', interactionId: 'warmup' },
      { id: 'detail', kind: 'statement', body: 'Discuss your reasoning', breakoutOf: { stepId: 'question', afterKey: 'header' } },
    ] } });
    expect(reply.status).toBe(201);
    const { deck } = await reply.json() as { deck: { id: string } };
    const started = await owner.request('/api/presentations/start', { requestId: crypto.randomUUID(), presentationId: crypto.randomUUID(), activities: [
      { ...activity(owner, deck, '42'), stepId: 'welcome' }, activity(owner, deck, '88'), { ...activity(owner, deck, '99'), stepId: 'detail' },
    ], slideId: '42' });
    expect(started.status, await started.clone().text()).toBe(201);
    const live = await started.json() as Live;
    expect((await state(live)).activeInteractionId).toBeNull();
    expect((await state(live, 'stage')).outline.currentStep.title).toBe('Welcome to the workshop');
    expect(JSON.stringify(await state(live, 'stage'))).not.toContain('Private opening guidance');
    await command(live, { command: 'outline.goto', stepId: live.presentation.activities[1]!.sessionStepId });
    expect(await state(live)).toMatchObject({ activeInteractionId: 'activity-2-question-1', interactionStatus: 'open' });
    await command(live, { command: 'outline.goto', stepId: live.presentation.activities[2]!.sessionStepId });
    expect((await state(live)).activeInteractionId).toBeNull();
    expect((await state(live, 'stage')).outline.currentStep.body).toBe('Discuss your reasoning');
  });
  it('launches the frozen composition through the shared session API after interruption before live allocation', async () => {
    const owner = await account(), first = await source(owner), second = await source(owner, 'board');
    const body = { requestId: crypto.randomUUID(), presentationId: crypto.randomUUID(), activities: [activity(owner, first, '42'), activity(owner, second, '88')] };
    const pending = await startPresentationRoute(new Request('https://openroom.test/api/presentations/start', { method: 'POST', headers: { cookie: owner.cookie, [CSRF_HEADER]: '1', 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, async () => new Response('Interrupted before allocation', { status: 503 }));
    expect(pending.status).toBe(503);
    expect((await owner.request(`/api/sessions/${body.requestId}/launch`, { version: 2, start: true })).status).toBe(409);
    const resumed = await owner.request(`/api/sessions/${body.requestId}/launch`, { start: true });
    expect(resumed.status).toBe(201);
    const live = await resumed.json() as Live;
    expect((await state(live)).outline.content.steps.map((step: any) => step.id)).toEqual(['activity-1-step-1', 'activity-2-step-1']);
    const recovered = await (await owner.request(`/api/sessions/${body.requestId}/resume`, {})).json() as Live;
    expect(recovered.presentation.activities.map((item) => item.deckId)).toEqual([first.id, second.id]);
  });
  it('freezes several decks, gives copied questions independent answers, and preserves state across retries and revisits', async () => {
    const owner = await account(), first = await source(owner), second = await source(owner, 'board');
    const body = { requestId: crypto.randomUUID(), presentationId: crypto.randomUUID(), activities: [activity(owner, first, '42'), activity(owner, second, '88'), activity(owner, first, '99')], slideId: '88' };
    const replies = await Promise.all([1, 2].map(() => owner.request('/api/presentations/start', body)));
    for (const reply of replies) expect(reply.status, await reply.clone().text()).toBe(201);
    const [live, raced] = await Promise.all(replies.map((reply) => reply.json() as Promise<Live>));
    expect(live!.sessionCode).toBe(raced!.sessionCode);
    const initial = await state(live!);
    expect(initial.outline.content.steps.map((step: any) => step.id)).toEqual(live!.presentation.activities.map((item) => item.sessionStepId));
    expect(initial.activeInteractionId).toBe('activity-2-question-1');
    expect(initial.outline.content.interactions).toHaveLength(3);
    expect(initial.outline.content.design.masters).toHaveLength(2);
    const joined = await (await call('/api/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: live!.sessionCode }) })).json() as { participantToken: string };
    expect((await command(live!, { command: 'answer.submit', interactionId: initial.activeInteractionId, answer: { kind: 'choice', optionIds: ['a'] } }, joined.participantToken)).status).toBe(200);
    expect((await state(live!)).answeredCount).toBe(1);
    await command(live!, { command: 'outline.goto', stepId: live!.presentation.activities[2]!.sessionStepId });
    expect((await state(live!)).answeredCount).toBe(0);
    await command(live!, { command: 'outline.goto', stepId: live!.presentation.activities[1]!.sessionStepId });
    expect((await state(live!)).answeredCount).toBe(1);
    await command(live!, { command: 'interaction.reveal', interactionId: initial.activeInteractionId });
    const before = await state(live!);
    // Remove a source from the library; the running frozen composition survives.
    await env.DB.prepare('UPDATE decks SET deleted_at = ?1 WHERE id = ?2').bind(Date.now(), second.id).run();
    const retry = await owner.request('/api/presentations/start', { requestId: body.requestId, presentationId: body.presentationId, activities: [activity(owner, first, '42')], slideId: '42' });
    expect(retry.status).toBe(201);
    expect((await retry.json() as Live).presentation).toEqual(live!.presentation);
    expect(await state(live!)).toEqual(before);
    const recovered = await owner.request(`/api/sessions/${body.requestId}/resume`, {});
    expect((await recovered.json() as Live).presentation).toEqual(live!.presentation);
    expect((await owner.request(`/api/decks/${first.id}/start`, { requestId: body.requestId })).status).toBe(409);
    expect(JSON.stringify(await state(live!, 'stage'))).not.toContain('private facilitator note');
    const detail = await (await owner.request(`/api/sessions/${body.requestId}`)).json() as { session: object };
    expect(detail.session).not.toHaveProperty('source_outline_json');
  });

  it('uses current membership and owner-paid collaboration, retains paid live recovery and rejects revoked access', async () => {
    const owner = await account(), helper = await account(), stranger = await account(), first = await source(owner);
    await env.DB.prepare('INSERT INTO space_members (space_id,user_id,role,created_at) VALUES (?1,?2,?3,?4)').bind(owner.spaceId, helper.id, 'presenter', Date.now()).run();
    const body = { requestId: crypto.randomUUID(), presentationId: crypto.randomUUID(), activities: [activity(owner, first, '42')] };
    expect((await stranger.request('/api/presentations/start', body)).status).toBe(404);
    expect((await call('/api/presentations/start', { method: 'POST', headers: { cookie: owner.cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(403);
    const reply = await helper.request('/api/presentations/start', body);
    expect(reply.status).toBe(201); const live = await reply.json() as Live;
    expect((await owner.request(`/api/sessions/${body.requestId}/resume`, {})).status).toBe(200);
    await env.DB.prepare("UPDATE users SET entitlements = '{}' WHERE id = ?1").bind(owner.id).run();
    expect((await helper.request('/api/presentations/start', { ...body, requestId: crypto.randomUUID() })).status).toBe(403);
    expect((await helper.request('/api/presentations/start', body)).status).toBe(201);
    await env.DB.prepare('DELETE FROM space_members WHERE space_id = ?1 AND user_id = ?2').bind(owner.spaceId, helper.id).run();
    expect((await helper.request(`/api/sessions/${body.requestId}/resume`, {})).status).toBe(404);
    expect((await helper.request('/api/presentations/start', body)).status).toBe(409);
    expect((await command(live, { command: 'interaction.close', interactionId: 'activity-1-question-1' })).status).toBe(403);
  });

  it('rejects duplicate slides and different spaces before writing a session; new audiences get new state', async () => {
    const owner = await account(), first = await source(owner), otherOwner = await account(), other = await source(otherOwner);
    await env.DB.prepare('INSERT INTO space_members (space_id,user_id,role,created_at) VALUES (?1,?2,?3,?4)').bind(otherOwner.spaceId, owner.id, 'presenter', Date.now()).run();
    const body = { requestId: crypto.randomUUID(), presentationId: crypto.randomUUID(), activities: [activity(owner, first, '42')] };
    expect((await owner.request('/api/presentations/start', { ...body, activities: [body.activities[0], body.activities[0]] })).status).toBe(422);
    expect((await owner.request('/api/presentations/start', { ...body, activities: [body.activities[0], activity(otherOwner, other, '88')] })).status).toBe(422);
    expect(await env.DB.prepare('SELECT id FROM sessions WHERE id = ?1').bind(body.requestId).first()).toBeNull();
    const live = await (await owner.request('/api/presentations/start', body)).json() as Live;
    await command(live, { command: 'session.end' });
    expect((await owner.request('/api/presentations/start', body)).status).toBe(409);
    const next = await (await owner.request('/api/presentations/start', { ...body, requestId: crypto.randomUUID() })).json() as Live;
    expect(next.sessionCode).not.toBe(live.sessionCode);
    expect((await state(next)).answeredCount).toBe(0);
  });
});
