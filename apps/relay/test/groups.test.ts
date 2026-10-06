import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import type { SessionDO } from '../src/session-do.js';
import worker from '../src/index.js';
import { BASE, command, createSessionWithOutline, join, stateJson, waitFor } from './helpers.js';

const outline = { version: 1, meta: { title: 'Workshop decisions' },
  defaults: { identityMode: 'pseudonymous', resultVisibility: 'hidden-until-close' },
  interactions: [{ id: 'decision', type: 'text', prompt: 'What should we try?', responseMode: 'group',
    notes: 'Private facilitator note', pedagogy: { explanation: 'Private debrief guidance' } }],
  steps: [{ id: 'decision', kind: 'interaction', interactionId: 'decision' }] };

describe('group responses over HTTP and WebSocket', () => {
  it('notifies only the group for hidden answers and preserves a queued private update through wake', { timeout: 15_000 }, async () => {
    const session = await createSessionWithOutline(outline);
    const speaker = await join(session.code), teammate = await join(session.code), outsider = await join(session.code);
    await command(session.code, session.hostToken, { command: 'group.set', group: { id: 'private', name: 'Private', memberIds: [speaker.participantId, teammate.participantId], spokespersonId: speaker.participantId } });
    await command(session.code, session.hostToken, { command: 'session.start' });
    await command(session.code, session.hostToken, { command: 'interaction.open', interactionId: 'decision' });
    const connect = async (token: string) => {
      // Supplying another seat id in the public URL must never affect socket tags.
      const response = await worker.fetch(new Request(`${BASE}/api/sessions/${session.code}/ws?token=${encodeURIComponent(token)}&participantId=${teammate.participantId}`, { headers: { upgrade: 'websocket' } }), env as never);
      expect(response.status).toBe(101);
      const ws = response.webSocket!; ws.accept();
      const frames: number[] = [];
      ws.addEventListener('message', (event) => { frames.push(JSON.parse(event.data as string).revision); });
      return { ws, frames };
    };
    const own = await connect(teammate.participantToken), other = await connect(outsider.participantToken);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1400));
      own.frames.length = 0; other.frames.length = 0;
      const submit = (text: string) => command(session.code, speaker.participantToken, { command: 'answer.submit', interactionId: 'decision', groupId: 'private', answer: { kind: 'text', text } });
      const first = await (await submit('First proposal')).json() as { revision: number };
      expect(await waitFor(() => own.frames.includes(first.revision))).toBe(true);
      const second = await (await submit('Agreed proposal')).json() as { revision: number };
      await runInDurableObject(env.SESSIONS.get(env.SESSIONS.idFromName(session.code)), async (instance: SessionDO) => { instance.simulateHibernationWakeForTest(); });
      expect(await waitFor(() => own.frames.includes(second.revision))).toBe(true);
      expect(other.frames).toEqual([]);
      expect((await stateJson(session.code, teammate.participantToken, 'participant')).ownAnswer).toMatchObject({ text: 'Agreed proposal' });
    } finally { own.ws.close(); other.ws.close(); }
  });

  it('rejects participant assignment, shares one answer only with its group, pushes hidden-answer updates and hands off', { timeout: 20_000 }, async () => {
    const session = await createSessionWithOutline(outline);
    const one = await join(session.code), two = await join(session.code), outside = await join(session.code);
    const group = { id: 'north', name: 'North', memberIds: [one.participantId, two.participantId], spokespersonId: one.participantId };
    expect((await command(session.code, two.participantToken, { command: 'group.set', group })).status).toBe(403);
    expect((await command(session.code, session.hostToken, { command: 'group.set', group })).status).toBe(200);
    await command(session.code, session.hostToken, { command: 'session.start' });
    await command(session.code, session.hostToken, { command: 'interaction.open', interactionId: 'decision' });
    const res = await worker.fetch(new Request(`${BASE}/api/sessions/${session.code}/ws?token=${encodeURIComponent(two.participantToken)}`, { headers: { upgrade: 'websocket' } }), env as never);
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    const revisions: number[] = [];
    ws.addEventListener('message', (event) => { revisions.push(JSON.parse(event.data as string).revision); });
    try {
      const submit = { command: 'answer.submit', interactionId: 'decision', groupId: 'north', answer: { kind: 'text', text: 'Pilot the new process' } };
      expect((await command(session.code, two.participantToken, submit)).status).toBe(403);
      expect((await command(session.code, outside.participantToken, submit)).status).toBe(403);
      const accepted = await command(session.code, one.participantToken, submit, { idempotencyKey: 'shared-answer' });
      expect(accepted.status).toBe(200);
      const receipt = await accepted.json() as { revision: number };
      expect(await waitFor(() => revisions.some((revision) => revision >= receipt.revision))).toBe(true);
      const teammate = await stateJson(session.code, two.participantToken, 'participant');
      expect(teammate).toMatchObject({ aggregate: null, answered: true, ownAnswer: { text: 'Pilot the new process' }, yourGroup: { name: 'North', isSpokesperson: false } });
      expect(teammate.interaction).not.toHaveProperty('pedagogy');
      expect(teammate.interaction).not.toHaveProperty('notes');
      expect(teammate).not.toHaveProperty('groups');
      expect(teammate).not.toHaveProperty('participants');
      expect(teammate.yourGroup).not.toHaveProperty('memberIds');
      expect(await stateJson(session.code, outside.participantToken, 'participant')).toMatchObject({ aggregate: null, ownAnswer: null, answered: false });
      const stage = await stateJson(session.code, session.stageToken, 'stage');
      expect(stage).toMatchObject({ aggregate: null, answeredCount: 1, expectedAnswerCount: 1 });
      expect(stage.interaction).not.toHaveProperty('pedagogy');
      expect(stage).not.toHaveProperty('groups');
      const retry = await command(session.code, one.participantToken, submit, { idempotencyKey: 'shared-answer' });
      expect(await retry.json()).toEqual({ ok: true, revision: receipt.revision });
      await command(session.code, session.hostToken, { command: 'group.set', group: { ...group, spokespersonId: two.participantId } });
      expect((await command(session.code, one.participantToken, submit)).status).toBe(403);
      expect((await command(session.code, two.participantToken, { ...submit, answer: { kind: 'text', text: 'Start with one team' } })).status).toBe(200);
      const host = await stateJson(session.code, session.hostToken, 'host');
      expect(host.aggregate).toMatchObject({ total: 1 });
      expect(host.ballots.decision).toEqual({ 'group:north': { kind: 'text', text: 'Start with one team', hidden: false } });
      expect(host.groups).toEqual([{ ...group, spokespersonId: two.participantId }]);
      await command(session.code, session.hostToken, { command: 'interaction.reveal', interactionId: 'decision' });
      expect((await stateJson(session.code, outside.participantToken, 'participant')).aggregate).toMatchObject({ total: 1, entries: [{ text: 'Start with one team', handle: 'North' }] });
    } finally { ws.close(); }
  });

  it('rejects group Q&A at outline validation', async () => {
    const res = await worker.fetch(new Request(`${BASE}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-relay-key' },
      body: JSON.stringify({ outline: { ...outline, interactions: [{ id: 'decision', type: 'qna', prompt: 'Ask a question', responseMode: 'group' }] } }) }), env as never);
    expect(res.status).toBe(422);
  });
});
