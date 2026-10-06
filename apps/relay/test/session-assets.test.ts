import { defaultDeckDesign, encodeVoiceWav } from '@openroom/schema';
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { SessionDO } from '../src/session-do';

import { call, command, createSessionWithOutline, join, stateJson } from './helpers.js';

const resourceId = '2ec03e9e-8ed8-4ddd-94ed-11847531dd8f';
const outline = {
  version: 1,
  meta: { title: 'Embedded handout' },
  steps: [
    { id: 'welcome', kind: 'title', title: 'Handout' },
    {
      id: 'handout',
      kind: 'blank',
      elements: [{
        id: 'pdf-1',
        type: 'pdf',
        resourceId,
        title: 'Selected exercises',
        box: { x: 0, y: 0, w: 100, h: 100 },
      }],
    },
    { id: 'check', kind: 'interaction', interactionId: 'check' },
  ],
  interactions: [{
    id: 'check',
    type: 'choice',
    prompt: 'Ready?',
    options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
  }],
};

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('ephemeral session resources', () => {
  it('cannot replace an asset when the session starts while its upload body is still arriving', async () => {
    const session = await createSessionWithOutline(outline);
    const original = new TextEncoder().encode('%PDF-1.4\noriginal\n%%EOF');
    const replacement = new TextEncoder().encode('%PDF-1.4\nreplacement\n%%EOF');
    expect((await call(`/api/sessions/${session.sessionCode}/assets/${resourceId}`, {
      method: 'PUT', headers: { authorization: `Bearer ${session.hostToken}`, 'content-type': 'application/pdf', 'x-openroom-sha256': await sha256(original) }, body: original,
    })).status).toBe(201);
    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    const replacementHash = await sha256(replacement);
    const stub = env.SESSIONS.get(env.SESSIONS.idFromName(session.sessionCode));
    await runInDurableObject(stub, async (instance: SessionDO) => {
      let entered!: () => void;
      let release!: () => void;
      const reading = new Promise<void>((resolve) => { entered = resolve; });
      const pendingBody = new Promise<void>((resolve) => { release = resolve; });
      const upload = new Request(`https://session.test/__assets/${resourceId}`, {
        method: 'PUT', headers: { 'content-type': 'application/pdf', 'x-openroom-sha256': replacementHash }, body: replacement,
      });
      vi.spyOn(upload, 'arrayBuffer').mockImplementation(async () => {
        entered(); await pendingBody;
        const copy = new Uint8Array(replacement.byteLength);
        copy.set(replacement);
        return copy.buffer;
      });
      const pending = instance.fetch(upload);
      await reading;
      try {
        const start = await instance.fetch(new Request('https://session.test/__command', { method: 'POST', body: JSON.stringify({
          actor: { role: 'host', facilitatorId: host.facilitation.yourId }, idempotencyKey: 'start-during-upload', command: { command: 'session.start' },
        }) }));
        expect(start.status).toBe(200);
        release();
        expect((await pending).status).toBe(409);
      } finally { release(); await pending; }
    });
    const served = await call(`/api/sessions/${session.sessionCode}/assets/${resourceId}`);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(original);
  });

  it('requires and serves master backgrounds, logos and per-slide design images', async () => {
    const ids = [resourceId, '4bfd3a43-d9fd-4d17-a861-dbb261bf172d', 'a5765fa0-27e6-4dd0-8de6-6b225409f23d'];
    const image = (resourceId: string) => ({ kind: 'image', resourceId, focal: { x: 40, y: 60 }, overlay: { color: '#FFFFFF', opacity: 0.7 } });
    const design = defaultDeckDesign();
    const deck = { version: 1, meta: { title: 'School workshop' }, design: { ...design, masters: [{ ...design.masters[0], background: image(ids[0]!), logo: { resourceId: ids[1], alt: 'School logo' } }] }, interactions: [], steps: [
      { id: 'opening', kind: 'title', title: 'Discuss the evidence' },
      { id: 'closing', kind: 'title', title: 'Make a decision', design: { background: image(ids[2]!) } },
    ] };
    const response = await call('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-relay-key' }, body: JSON.stringify({ outline: deck }) });
    expect(response.status).toBe(201);
    const created = await response.json() as { sessionCode: string; code: string; hostToken: string; stageToken: string };
    const blocked = await command(created.sessionCode, created.hostToken, { command: 'session.start' });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ resourceIds: ids });
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    for (const id of ids) expect((await call(`/api/sessions/${created.sessionCode}/assets/${id}`, { method: 'PUT', headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'image/png', 'x-openroom-sha256': await sha256(bytes) }, body: bytes })).status).toBe(201);
    expect((await command(created.sessionCode, created.hostToken, { command: 'session.start' })).status).toBe(200);
    const learner = await join(created.code);
    const views = () => Promise.all([
      stateJson(created.sessionCode, created.stageToken, 'stage'),
      stateJson(created.sessionCode, learner.participantToken, 'participant'),
    ]);
    for (const view of await views()) expect(view.outline).toMatchObject({ design: {
      background: { url: `/api/sessions/${created.sessionCode}/assets/${ids[0]}` },
      logo: { url: `/api/sessions/${created.sessionCode}/assets/${ids[1]}`, alt: 'School logo' },
    } });
    await command(created.sessionCode, created.hostToken, { command: 'outline.next' });
    for (const view of await views()) expect(view.outline).toMatchObject({ design: { background: { url: `/api/sessions/${created.sessionCode}/assets/${ids[2]}` } } });
    const served = await call(`/api/sessions/${created.sessionCode}/assets/${ids[2]}`);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);
  });
  it('carries portable audio into a live session and serves seekable bytes', async () => {
    const audioOutline = { version: 1, meta: { title: 'Portable listening' }, interactions: [], steps: [{
      id: 'audio', kind: 'media', media: { type: 'audio', resourceId, alt: 'An appointment', listening: { mode: 'individual', transcript: 'Private until shown' } },
    }] };
    const createdResponse = await call('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-relay-key' }, body: JSON.stringify({ outline: audioOutline }) });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { sessionCode: string; code: string; hostToken: string; stageToken: string };
    const bytes = encodeVoiceWav(new Float32Array(16000));
    const upload = await call(`/api/sessions/${created.sessionCode}/assets/${resourceId}`, { method: 'PUT', headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'audio/wav', 'x-openroom-sha256': await sha256(bytes) }, body: bytes });
    expect(upload.status).toBe(201);
    expect((await command(created.sessionCode, created.hostToken, { command: 'session.start' })).status).toBe(200);
    const learner = await join(created.code);
    const views = async () => Promise.all([
      stateJson(created.sessionCode, created.hostToken, 'host'),
      stateJson(created.sessionCode, created.stageToken, 'stage'),
      stateJson(created.sessionCode, learner.participantToken, 'participant'),
    ]);
    const hidden = await views();
    for (const view of hidden) expect(view.listening).toEqual({ stepId: 'audio', mode: 'individual', transcriptShown: false });
    for (const view of hidden.slice(1)) expect(JSON.stringify(view)).not.toContain('Private until shown');
    expect((await command(created.sessionCode, created.hostToken, { command: 'listening.set', stepId: 'audio', mode: 'room', transcriptShown: true })).status).toBe(200);
    for (const view of await views()) {
      expect(view.listening).toEqual({ stepId: 'audio', mode: 'room', transcriptShown: true });
      expect(JSON.stringify(view.outline)).toContain('Private until shown');
    }
    const response = await call(`/api/sessions/${created.sessionCode}/assets/${resourceId}`, { headers: { range: 'bytes=44-75' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.slice(44, 76));
  });

  it('requires referenced bytes before start and serves PDF ranges from the session object', async () => {
    const createdResponse = await call('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-relay-key' },
      body: JSON.stringify({ outline }),
    });
    if (createdResponse.status !== 201) throw new Error(await createdResponse.text());
    const created = await createdResponse.json() as { sessionCode: string; hostToken: string };

    const blocked = await command(created.sessionCode, created.hostToken, { command: 'session.start' });
    expect(blocked.status).toBe(409);
    await expect(blocked.json()).resolves.toEqual(expect.objectContaining({ resourceIds: [resourceId] }));

    const bytes = new TextEncoder().encode('%PDF-1.4\nselected pages\n%%EOF');
    const uploaded = await call(`/api/sessions/${created.sessionCode}/assets/${resourceId}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${created.hostToken}`,
        'content-type': 'application/pdf',
        'x-openroom-sha256': await sha256(bytes),
      },
      body: bytes,
    });
    expect(uploaded.status).toBe(201);

    const ranged = await call(`/api/sessions/${created.sessionCode}/assets/${resourceId}`, {
      headers: { range: 'bytes=0-7' },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(bytes.slice(0, 8));

    const started = await command(created.sessionCode, created.hostToken, { command: 'session.start' });
    expect(started.status).toBe(200);
    const lateUpload = await call(`/api/sessions/${created.sessionCode}/assets/${resourceId}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${created.hostToken}`,
        'content-type': 'application/pdf',
        'x-openroom-sha256': await sha256(bytes),
      },
      body: bytes,
    });
    expect(lateUpload.status).toBe(409);
  });
});
