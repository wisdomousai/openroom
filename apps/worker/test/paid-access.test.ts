import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { defaultDeckDesign } from '@openroom/schema';
import worker from '../src/index';
import { BASE, SMOKE_OUTLINE as QUESTION_OUTLINE } from './helpers';
import { account, clients, configured, member, subscribe } from './paid-fixtures';

const SMOKE_OUTLINE = { ...QUESTION_OUTLINE, steps: [{ id: 'question', kind: 'interaction', interactionId: 'warmup' }] };

interface Live { sessionCode: string; hostToken: string }
const namedOutline = { ...SMOKE_OUTLINE, defaults: { identityMode: 'roster' } };
const liveRequest = (live: Live, leaf: string, body?: object) => worker.fetch(new Request(`${BASE}/api/sessions/${live.sessionCode}/${leaf}`, {
  method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${live.hostToken}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
}), configured);

describe('paid access across account clients', () => {
  it('uses the subscribed space owner for exports and archives, ends through MCP, and keeps saved work after downgrade', async () => {
    const owner = await account(), editor = await account(), outsider = await account(), change = await subscribe(owner);
    await member(owner, editor);
    const source = await editor.request('/api/decks', 'POST', { spaceId: owner.spaceId, content: SMOKE_OUTLINE }, 'pat');
    expect(source.status, JSON.stringify(source.body)).toBe(201);
    const started = await editor.request(`/api/decks/${source.body.deck.id}/start`, 'POST', { requestId: crypto.randomUUID() }, 'mcp');
    expect(started.status).toBe(201);
    const live = started.body as Live;
    expect((await liveRequest(live, 'export?format=ballots')).status).toBe(200);
    for (const key of ['end-first', 'end-repeat']) {
      const ended = await editor.rpc('session_command', { code: live.sessionCode, command: { command: 'session.end' }, idempotencyKey: key });
      expect(ended.error, JSON.stringify(ended.value)).toBe(false);
    }
    expect(await env.DB.prepare('SELECT ended FROM live_sessions WHERE code=?1').bind(live.sessionCode).first()).toEqual({ ended: 1 });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM session_archives WHERE session_code=?1').bind(live.sessionCode).first<{ n: number }>())!.n).toBe(1);
    await change('canceled');
    for (const client of clients) {
      const listed = await editor.request('/api/my/archives', 'GET', undefined, client);
      expect(listed.status).toBe(200);
      expect(listed.body.archives).toHaveLength(1);
      const id = listed.body.archives[0].id;
      expect((await owner.request(`/api/my/archives/${id}`, 'GET', undefined, client)).status).toBe(200);
      const document = await editor.request(`/api/my/archives/${id}/document`, 'GET', undefined, client);
      expect(document.status).toBe(200);
      expect(document.body).toMatchObject({ file: { deckId: source.body.deck.id, spaceId: owner.spaceId, hasIndividualResponses: true }, results: { questions: [{ prompt: 'Pick one', rows: [{ label: 'A' }, { label: 'B' }] }] } });
      const csv = await editor.request(`/api/my/archives/${id}?format=ballots`, 'GET', undefined, client);
      expect(csv.status).toBe(200); expect(csv.body).toContain('interactionId,prompt,participantId');
      expect((await outsider.request(`/api/my/archives/${id}`, 'GET', undefined, client)).status).toBe(404);
    }
    // A collaborator's personal licence cannot replace the owner's missing capability.
    await subscribe(editor);
    const newStart = await editor.request(`/api/decks/${source.body.deck.id}/start`, 'POST', { requestId: crypto.randomUUID() }, 'oauth');
    expect(newStart.status).toBe(403);
    await env.DB.prepare('DELETE FROM space_members WHERE space_id=?1 AND user_id=?2').bind(owner.spaceId, editor.id).run();
    for (const client of clients) {
      expect((await editor.request('/api/my/archives', 'GET', undefined, client)).body.archives).toEqual([]);
      expect((await editor.request(`/api/my/archives/${live.sessionCode}`, 'GET', undefined, client)).status).toBe(404);
    }
    expect((await liveRequest(live, 'export?format=ballots')).status).toBe(403);
  });

  it('grants brand-kit writes from the owner’s subscription and retains read, trash and restore after downgrade', async () => {
    const owner = await account(), editor = await account(), change = await subscribe(owner);
    await member(owner, editor);
    const collection = `/api/tutoring/spaces/${owner.spaceId}/brand-kits`, document = { name: 'Company', design: defaultDeckDesign('business') };
    const created = await editor.request(collection, 'POST', document, 'mcp');
    expect(created.status).toBe(201);
    const path = `/api/tutoring/brand-kits/${created.body.brandKit.id}`;
    for (let i = 0; i < clients.length; i++) expect((await editor.request(path, 'PATCH', { ...document, baseRevision: i + 1 }, clients[i])).status).toBe(200);
    await change('canceled'); await subscribe(editor);
    for (const client of clients) {
      expect((await editor.request(path, 'PATCH', { ...document, baseRevision: 5 }, client)).status).toBe(403);
      expect((await editor.request(path, 'GET', undefined, client)).status).toBe(200);
    }
    expect((await editor.request(path, 'DELETE', undefined, 'mcp')).status).toBe(200);
    expect((await editor.request(`${path}/restore`, 'POST', {}, 'oauth')).status).toBe(200);
  });

  it('blocks accepting a pending invite after downgrade and resumes the same invitation after payment recovery', async () => {
    const owner = await account(), editor = await account(), change = await subscribe(owner);
    const invite = await owner.request(`/api/my/spaces/${owner.spaceId}/invites`, 'POST', { email: editor.email, role: 'editor' }, 'mcp');
    expect(invite.status).toBe(201);
    const path = `/api/my/invites/${invite.body.id}/accept`;
    await change('canceled');
    for (const client of clients) expect((await editor.request(path, 'POST', {}, client)).status).toBe(403);
    expect(await env.DB.prepare('SELECT role FROM space_members WHERE space_id=?1 AND user_id=?2').bind(owner.spaceId, editor.id).first()).toBeNull();
    await change('active');
    expect((await editor.request(path, 'POST', {}, 'mcp')).status).toBe(200);
    const members = `/api/my/spaces/${owner.spaceId}/members`, person = `${members}/${editor.id}`;
    expect((await owner.request(members, 'GET', undefined, 'mcp')).status).toBe(200);
    expect((await editor.request(person, 'PATCH', { role: 'presenter' }, 'mcp')).status).toBe(403);
    expect((await owner.request(person, 'PATCH', { role: 'presenter' }, 'mcp')).status).toBe(200);
    expect((await owner.request(person, 'DELETE', undefined, 'mcp')).status).toBe(200);
    expect((await editor.request(members, 'GET', undefined, 'mcp')).status).toBe(404);
  });

  it('gates named sessions on every creation path and uses the space owner for invited presenters', async () => {
    const owner = await account(), presenter = await account();
    for (const client of ['cookie', 'pat', 'oauth'] as const) expect((await owner.request('/api/sessions', 'POST', { outline: namedOutline }, client)).status).toBe(403);
    expect((await owner.rpc('session_create', { outline: namedOutline })).error).toBe(true);
    const source = await owner.request('/api/decks', 'POST', { spaceId: owner.spaceId, content: namedOutline });
    expect(source.status).toBe(201);
    for (const client of clients) expect((await owner.request(`/api/decks/${source.body.deck.id}/start`, 'POST', { requestId: crypto.randomUUID() }, client)).status).toBe(403);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM live_sessions WHERE user_id=?1').bind(owner.id).first<{ n: number }>())!.n).toBe(0);
    const change = await subscribe(owner); await member(owner, presenter, 'presenter');
    const started = await presenter.request('/api/sessions', 'POST', { outline: namedOutline, spaceId: owner.spaceId }, 'oauth');
    expect(started.status).toBe(201);
    const live = started.body as Live, seats = 'roster/seats';
    const seat = await liveRequest(live, seats, { displayName: 'Alex' });
    expect(seat.status).toBe(201); const saved = await seat.json() as { id: string };
    await change('canceled');
    expect((await liveRequest(live, seats)).status).toBe(200);
    expect((await liveRequest(live, seats, { displayName: 'Sam' })).status).toBe(403);
    const revoked = await worker.fetch(new Request(`${BASE}/api/sessions/${live.sessionCode}/${seats}/${saved.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${live.hostToken}` } }), configured);
    expect(revoked.status).toBe(200);
  });

  it('keeps account archives separate from live capabilities and rejects a revoked connected client', async () => {
    const owner = await account(); await subscribe(owner);
    const live = (await owner.request('/api/sessions', 'POST', { outline: SMOKE_OUTLINE }, 'oauth')).body as Live;
    expect((await liveRequest(live, 'commands', { command: { command: 'session.end' } })).status).toBe(200);
    const archive = `/api/my/archives/${live.sessionCode}`;
    const leaked = await worker.fetch(new Request(`${BASE}${archive}`, { headers: { authorization: `Bearer ${live.hostToken}` } }), configured);
    expect(leaked.status).toBe(401);
    expect((await owner.request(archive, 'GET', undefined, 'oauth')).status).toBe(200);
    await env.DB.prepare('UPDATE oauth_connections SET revoked_at=?1 WHERE id=?2').bind(Date.now(), owner.connectionId).run();
    expect((await owner.request(archive, 'GET', undefined, 'oauth')).status).toBe(401);
    expect((await owner.request(archive, 'GET', undefined, 'cookie')).status).toBe(200);
  });
});
