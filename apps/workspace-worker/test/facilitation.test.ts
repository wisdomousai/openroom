import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import { signCookieValue } from '../src/cookies.js';
import { BASE, command, join, stateJson, SMOKE_OUTLINE } from './helpers.js';

async function account(name: string) {
  const id = crypto.randomUUID(), authId = crypto.randomUUID(), now = Date.now();
  await env.DB.prepare('INSERT INTO users (id,google_sub,email,name,created_at,entitlements) VALUES (?1,?1,?2,?3,?4,?5)')
    .bind(id, `${id}@example.test`, name, now, '{}').run();
  await env.DB.prepare('INSERT INTO auth_sessions (id,user_id,created_at,expires_at) VALUES (?1,?2,?3,?4)').bind(authId, id, now, now + 3600000).run();
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(await signCookieValue('test-secret', authId))}`;
  const request = (path: string, method = 'GET', body?: object, csrf = true) => worker.fetch(new Request(`${BASE}${path}`, {
    method, headers: { cookie, 'content-type': 'application/json', ...(csrf ? { [CSRF_HEADER]: '1' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env as never);
  return { id, request };
}

async function fixture() {
  const owner = await account('Alex'), helper = await account('Sam');
  await env.DB.prepare('UPDATE users SET entitlements = ?1 WHERE id = ?2').bind('{"team":true}', owner.id).run();
  const spaceResponse = await owner.request('/api/my/spaces', 'POST', { name: 'Workshop', experience: 'training' });
  expect(spaceResponse.status).toBe(201);
  const space = await spaceResponse.json() as { id: string };
  await env.DB.prepare('INSERT INTO space_members (space_id,user_id,role,created_at) VALUES (?1,?2,?3,?4)').bind(space.id, helper.id, 'presenter', Date.now()).run();
  const created = await owner.request('/api/sessions', 'POST', { outline: SMOKE_OUTLINE, spaceId: space.id });
  expect(created.status).toBe(201);
  const session = await created.json() as { code: string; hostToken: string; stageToken: string };
  const facilitate = (who: typeof owner) => who.request(`/api/my/sessions/${session.code}/facilitate`, 'POST');
  return { owner, helper, space, session, facilitate };
}

describe('account-backed co-facilitation', () => {
  it('joins through space access, moderates, hands off explicitly, preserves state and recovers', async () => {
    const { owner, helper, session, facilitate } = await fixture();
    const listed = await (await helper.request('/api/my/sessions')).json() as { sessions: { code: string; shared: boolean; hostToken?: string }[] };
    expect(listed.sessions).toContainEqual(expect.objectContaining({ code: session.code, shared: true }));
    expect(listed.sessions.find((item) => item.code === session.code)?.hostToken).toBeUndefined();
    expect((await helper.request(`/api/my/sessions/${session.code}/facilitate`, 'POST', undefined, false)).status).toBe(403);
    const joinedResponse = await facilitate(helper);
    expect(joinedResponse.status).toBe(200);
    const joined = await joinedResponse.json() as { hostToken: string; facilitation: object };
    expect(joined.facilitation).toMatchObject({ yourId: helper.id, canPresent: false, canRecover: false });
    const h = (cmd: Record<string, unknown>) => command(session.code, joined.hostToken, cmd);
    expect((await h({ command: 'session.start' })).status).toBe(403);
    expect((await command(session.code, session.hostToken, { command: 'presentation.handoff', facilitatorId: { invalid: true } })).status).toBe(403);
    expect((await h({ command: 'group.set', group: { id: 'a', name: 'Team A', memberIds: [], spokespersonId: null } })).status).toBe(200);
    expect((await command(session.code, session.hostToken, { command: 'session.start' })).status).toBe(200);
    const before = await stateJson(session.code, session.hostToken, 'host');
    expect((await command(session.code, session.hostToken, { command: 'presentation.handoff', facilitatorId: helper.id })).status).toBe(200);
    const after = await stateJson(session.code, joined.hostToken, 'host');
    expect(after.outline).toEqual(before.outline);
    expect(after.groups).toEqual(before.groups);
    expect(after.facilitation).toMatchObject({ presenterId: helper.id, canPresent: true });
    expect((await command(session.code, session.hostToken, { command: 'session.end' })).status).toBe(403);
    expect((await h({ command: 'presentation.recover' })).status).toBe(403);
    expect((await h({ command: 'session.freeze' })).status).toBe(200);
    expect((await command(session.code, session.hostToken, { command: 'presentation.recover' })).status).toBe(200);
    expect((await stateJson(session.code, session.hostToken, 'host')).facilitation).toMatchObject({ presenterId: owner.id, canPresent: true });
    const participant = await join(session.code);
    expect((await stateJson(session.code, participant.participantToken, 'participant')).facilitation).toBeUndefined();
    expect((await stateJson(session.code, session.stageToken, 'stage')).facilitation).toBeUndefined();
    const asCapability = await worker.fetch(new Request(`${BASE}/api/my/sessions/${session.code}/facilitate`, { method: 'POST', headers: { authorization: `Bearer ${joined.hostToken}` } }), env as never);
    expect(asCapability.status).toBe(401);
  });

  it('revokes removed members immediately and preserves an existing session across a billing downgrade', async () => {
    const { owner, helper, space, session, facilitate } = await fixture();
    const joined = await (await facilitate(helper)).json() as { hostToken: string };
    expect((await command(session.code, session.hostToken, { command: 'session.start' })).status).toBe(200);
    await env.DB.prepare('DELETE FROM space_members WHERE space_id = ?1 AND user_id = ?2').bind(space.id, helper.id).run();
    const state = await worker.fetch(new Request(`${BASE}/api/sessions/${session.code}/state?afterRevision=999999&facilitatorId=${owner.id}`, { headers: { authorization: `Bearer ${joined.hostToken}` } }), env as never);
    expect(state.status).toBe(403);
    expect((await command(session.code, joined.hostToken, { command: 'group.remove', groupId: 'a' })).status).toBe(403);
    expect((await facilitate(helper)).status).toBe(404);
    expect((await helper.request(`/api/my/sessions/${session.code}/recap`)).status).toBe(404);
    expect((await worker.fetch(new Request(`${BASE}/api/sessions/${session.code}/recap`, { headers: { authorization: `Bearer ${joined.hostToken}` } }), env as never)).status).toBe(403);
    expect((await command(session.code, session.hostToken, { command: 'presentation.handoff', facilitatorId: helper.id })).status).toBe(403);
    await env.DB.prepare('INSERT INTO space_members (space_id,user_id,role,created_at) VALUES (?1,?2,?3,?4)').bind(space.id, helper.id, 'editor', Date.now()).run();
    await env.DB.prepare('UPDATE users SET entitlements = ?1 WHERE id = ?2').bind('{}', owner.id).run();
    expect((await facilitate(helper)).status).toBe(200);
    expect((await command(session.code, joined.hostToken, { command: 'group.set', group: { id: 'after-downgrade', name: 'Discussion', memberIds: [], spokespersonId: null } })).status).toBe(200);
    expect((await facilitate(owner)).status).toBe(200);
    expect((await helper.request('/api/sessions', 'POST', { outline: SMOKE_OUTLINE, spaceId: space.id })).status).toBe(403);
  });

  it('does not let a former presenter replay or forge presentation authority', async () => {
    const { owner, helper, session, facilitate } = await fixture();
    const joined = await (await facilitate(helper)).json() as { hostToken: string };
    const send = (token: string, cmd: object, key: string, actorId: string) => worker.fetch(new Request(`${BASE}/api/sessions/${session.code}/commands`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ command: cmd, idempotencyKey: key, actor: { role: 'host', facilitatorId: actorId } }),
    }), env as never);
    expect((await send(session.hostToken, { command: 'session.start' }, 'start', owner.id)).status).toBe(200);
    await command(session.code, session.hostToken, { command: 'presentation.handoff', facilitatorId: helper.id });
    expect((await send(session.hostToken, { command: 'session.start' }, 'start', helper.id)).status).toBe(403);
    expect((await send(session.hostToken, { command: 'outline.next' }, 'next', helper.id)).status).toBe(403);
    expect((await send(joined.hostToken, { command: 'session.freeze' }, 'start', helper.id)).status).toBe(200);
    expect((await stateJson(session.code, joined.hostToken, 'host')).frozen).toBe(true);
  });

  it('uses the same account authority through MCP and lets the space owner recover a member-created session', async () => {
    const { owner, helper, space } = await fixture();
    const created = await helper.request('/api/sessions', 'POST', { outline: SMOKE_OUTLINE, spaceId: space.id });
    expect(created.status).toBe(201);
    const session = await created.json() as { code: string; hostToken: string };
    const minted = await owner.request('/api/my/tokens', 'POST', { name: 'Co-facilitator test' });
    const { token } = await minted.json() as { token: string };
    const tool = async (name: string, args: object) => {
      const response = await worker.fetch(new Request(`${BASE}/api/mcp`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      }), env as never);
      expect(response.status).toBe(200);
      const body = await response.json() as { result: { content: { text: string }[] } };
      return JSON.parse(body.result.content[0]!.text);
    };
    expect(await tool('session_facilitate', { code: session.code })).toMatchObject({ ok: true, body: { facilitation: { canPresent: false, canRecover: true } } });
    expect(await tool('session_command', { code: session.code, command: { command: 'session.start' } })).toMatchObject({ ok: false, status: 403 });
    expect(await tool('session_command', { code: session.code, command: { command: 'presentation.recover' } })).toMatchObject({ ok: true });
    expect(await tool('session_command', { code: session.code, command: { command: 'session.start' } })).toMatchObject({ ok: true });
    expect((await owner.request(`/api/my/spaces/${space.id}/members/${helper.id}`, 'DELETE')).status).toBe(200);
    expect((await command(session.code, session.hostToken, { command: 'presentation.recover' })).status).toBe(403);
    expect((await helper.request(`/api/my/sessions/${session.code}/facilitate`, 'POST')).status).toBe(404);
  });
});
