import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import type { RecapCandidates } from '@openroom/schema';
import { BASE, call, command, createSessionWithOutline, join, SMOKE_OUTLINE } from './helpers.js';
import { signCookieValue } from '../src/tokens.js';
import { SESSION_COOKIE, CSRF_HEADER } from '../src/auth.js';

const outline = { ...SMOKE_OUTLINE, qna: { enabled: true }, interactions: [...SMOKE_OUTLINE.interactions,
  { id: 'idea', type: 'text', prompt: 'What shall we try?', notes: 'PRIVATE coaching note' },
  { id: 'number', type: 'numeric', prompt: 'Estimate the effort' },
] };

async function populated() {
  const session = await createSessionWithOutline(outline);
  const first = await join(session.code), second = await join(session.code);
  const host = async (cmd: Record<string, unknown>) => expect((await command(session.code, session.hostToken, cmd)).status).toBe(200);
  await host({ command: 'session.start' });
  await host({ command: 'interaction.open', interactionId: 'warmup' });
  for (const person of [first, second]) expect((await command(session.code, person.participantToken, { command: 'answer.submit', interactionId: 'warmup', answer: { kind: 'choice', optionIds: ['a'] } })).status).toBe(200);
  await host({ command: 'interaction.open', interactionId: 'idea' });
  for (const [person, text] of [[first, 'Try a pilot'], [second, 'MODERATED response']] as const) expect((await command(session.code, person.participantToken, { command: 'answer.submit', interactionId: 'idea', answer: { kind: 'text', text } })).status).toBe(200);
  await host({ command: 'text.hide', interactionId: 'idea', participantId: second.participantId });
  await host({ command: 'interaction.open', interactionId: 'number' });
  for (const [person, value] of [[first, 11], [second, 29]] as const) expect((await command(session.code, person.participantToken, { command: 'answer.submit', interactionId: 'number', answer: { kind: 'numeric', value } })).status).toBe(200);
  expect((await command(session.code, first.participantToken, { command: 'qna.ask', questionId: 'q-one', text: 'Who can help?' })).status).toBe(200);
  expect((await command(session.code, second.participantToken, { command: 'qna.ask', questionId: 'q-two', text: 'HIDDEN question' })).status).toBe(200);
  await host({ command: 'qna.hide', questionId: 'q-two' });
  const recap = (body?: unknown, token = session.hostToken) => call(`/api/sessions/${session.code}/recap`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { session, first, second, host, recap };
}

describe('facilitator-selected recap HTTP boundary', () => {
  it('projects only safe candidates and exports only explicit selections without identity or private teaching content', async () => {
    const { session, first, second, recap } = await populated();
    const source = await (await recap()).json() as RecapCandidates;
    expect(source.results).toMatchObject([{ rows: [{ label: 'A', value: 2 }, { label: 'B', value: 0 }] }, { rows: [{ label: 'Mean', value: 20 }, { label: 'Median', value: 20 }] }]);
    expect(source.discussion).toEqual([{ id: 'd1-0', prompt: 'What shall we try?', text: 'Try a pilot' }]);
    expect(source.questions).toHaveLength(1);
    for (const secret of [first.participantId, second.participantId, 'PRIVATE', 'MODERATED', 'HIDDEN', 'misconception', 'correct', 'values']) expect(JSON.stringify(source)).not.toContain(secret);
    expect((await recap(undefined, session.stageToken)).status).toBe(403);
    expect((await recap(undefined, first.participantToken)).status).toBe(403);
    const selected = { revision: source.revision, title: 'Workshop decisions', resultIds: ['r0'], discussionIds: ['d1-0'], questionIds: [source.questions[0]!.id], discussion: 'A small experiment', followUp: 'Review the pilot' };
    const response = await recap(selected);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ title: 'Workshop decisions', results: [{ prompt: 'Pick one', responses: 2, unit: 'responses', measure: 'Responses', rows: [{ label: 'A', value: 2 }, { label: 'B', value: 0 }] }], discussionPoints: [{ prompt: 'What shall we try?', text: 'Try a pilot' }], questions: [{ prompt: 'Audience Q&A', text: 'Who can help?' }], discussion: 'A small experiment', followUp: 'Review the pilot' });
    expect((await recap({ ...selected, resultIds: [], discussionIds: [], questionIds: [], discussion: '', followUp: '' })).status).toBe(422);
    expect((await recap({ ...selected, discussionIds: ['d1-1'] })).status).toBe(422);
    expect((await recap({ ...selected, followUp: 'x'.repeat(100000) })).status).toBe(422);
  });

  it('refuses stale selections after moderation and exports after the session has ended', async () => {
    const { recap, host, first } = await populated();
    const source = await (await recap()).json() as RecapCandidates;
    const selection = { revision: source.revision, title: 'Recap', resultIds: [], discussionIds: ['d1-0'], questionIds: [], discussion: '', followUp: '' };
    await host({ command: 'text.hide', interactionId: 'idea', participantId: first.participantId });
    expect(await (await recap(selection)).json()).toEqual({ error: 'recap-source-changed' });
    await host({ command: 'session.end' });
    const latest = await (await recap()).json() as RecapCandidates;
    expect((await recap({ ...selection, revision: latest.revision, discussionIds: [] , followUp: 'Agreed next steps' })).status).toBe(200);
  });

  it('uses account/PAT/MCP authority separately from session capabilities and rechecks ownership', async () => {
    const id = crypto.randomUUID(), authId = crypto.randomUUID(), now = Date.now();
    await env.DB.prepare('INSERT INTO users (id,google_sub,email,name,created_at,entitlements) VALUES (?1,?1,?2,?3,?4,?5)').bind(id, `${id}@example.test`, 'Facilitator', now, '{"team":true}').run();
    await env.DB.prepare('INSERT INTO auth_sessions (id,user_id,created_at,expires_at) VALUES (?1,?2,?3,?4)').bind(authId, id, now, now + 3600000).run();
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(await signCookieValue('test-secret', authId))}`;
    const account = (path: string, method = 'GET', body?: object) => call(path, { method, headers: { cookie, [CSRF_HEADER]: '1', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const created = await account('/api/sessions', 'POST', { outline });
    const session = await created.json() as { code: string; hostToken: string };
    expect(created.status).toBe(201);
    const path = `/api/my/sessions/${session.code}/recap`;
    const source = await (await account(path)).json() as RecapCandidates;
    const selection = { revision: source.revision, title: 'Recap', resultIds: [], discussionIds: [], questionIds: [], discussion: '', followUp: 'Shared action' };
    expect((await call(path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(selection) })).status).toBe(403);
    expect((await call(path, { headers: { authorization: `Bearer ${session.hostToken}` } })).status).toBe(401);
    const minted = await (await account('/api/my/tokens', 'POST', { name: 'Recap' })).json() as { token: string };
    const response = await call('/api/mcp', { method: 'POST', headers: { authorization: `Bearer ${minted.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'session_recap', arguments: { code: session.code, selection } } }) });
    const rpc = await response.json() as { result: { content: { text: string }[] } };
    expect(JSON.parse(rpc.result.content[0]!.text)).toMatchObject({ ok: true, body: { followUp: 'Shared action' } });
    await env.DB.prepare('UPDATE live_sessions SET user_id = NULL WHERE code = ?1').bind(session.code).run();
    expect((await account(path)).status).toBe(404);
  });
});
