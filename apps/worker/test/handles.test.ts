/**
 * Pseudonymous mode (identityMode: 'pseudonymous') — session-local handles.
 *
 * Contract under test:
 *  - join assigns a unique "Adjective Animal 1234" handle and returns it (+ identityMode)
 *  - anonymous sessions return no handle and no handles map anywhere
 *  - the handle is stable: host snapshot maps participantId -> handle
 *  - handles never reach the stage or other participants (leak check on the
 *    serialized wire payloads, not just the expected fields)
 *  - CSV export gains a `handle` column only in pseudonymous sessions
 */
import { describe, expect, it } from 'vitest';

import { call, command, createLiveSession, createSessionWithOutline, join, stateJson } from './helpers.js';

const PSEUDO_OUTLINE = {
  version: 1,
  meta: { title: 'Handles outline' },
  defaults: { identityMode: 'pseudonymous' },
  interactions: [
    {
      id: 'chat',
      type: 'text',
      prompt: 'Say something',
      resultVisibility: 'live',
    },
  ],
};

const HANDLE_RE = /^[A-Z][a-z]+ [A-Z][a-z]+ \d{4}$/;

describe('pseudonymous mode', () => {
  it('join returns identityMode and a well-formed handle', async () => {
    const session = await createSessionWithOutline(PSEUDO_OUTLINE);
    const joined = (await join(session.code)) as Record<string, any>;
    expect(joined.identityMode).toBe('pseudonymous');
    expect(joined.handle).toMatch(HANDLE_RE);
  });

  it('anonymous sessions return no handle', async () => {
    const session = await createLiveSession();
    const joined = (await join(session.code)) as Record<string, any>;
    expect(joined.identityMode).toBe('anonymous');
    expect(joined.handle).toBeUndefined();
  });

  it('sessions with no identity setting now default to pseudonymous handles', async () => {
    const session = await createSessionWithOutline({
      version: 1,
      meta: { title: 'Default identity' },
      interactions: [{ id: 'chat', type: 'text', prompt: 'Say something' }],
    });
    const joined = await join(session.code);

    expect(joined.identityMode).toBe('pseudonymous');
    expect(joined.handle).toMatch(HANDLE_RE);
  });

  it('handles are unique per session and stable in the host snapshot', async () => {
    const session = await createSessionWithOutline(PSEUDO_OUTLINE);
    const a = (await join(session.code)) as Record<string, any>;
    const b = (await join(session.code)) as Record<string, any>;
    expect(a.handle).not.toBe(b.handle);

    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.handles).toEqual({
      [a.participantId]: a.handle,
      [b.participantId]: b.handle,
    });
  });

  it('recovers the original participant by a case-insensitive session handle', async () => {
    const session = await createSessionWithOutline(PSEUDO_OUTLINE);
    const original = await join(session.code);
    const recovered = await join(
      session.code,
      `  ${original.handle?.toLocaleLowerCase('en').replace(/ /g, '  ')}  `,
    );

    expect(recovered.participantId).toBe(original.participantId);
    expect(recovered.handle).toBe(original.handle);

    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.participantCount).toBe(1);
  });

  it('keeps the participant answer when a recovered handle receives a new capability', async () => {
    const session = await createSessionWithOutline(PSEUDO_OUTLINE);
    const original = await join(session.code);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, {
      command: 'interaction.open',
      interactionId: 'chat',
    });
    await command(session.sessionCode, original.participantToken, {
      command: 'answer.submit',
      interactionId: 'chat',
      answer: { kind: 'text', text: 'still here' },
    });

    const recovered = await join(session.code, original.handle);
    const snapshot = await stateJson(session.sessionCode, recovered.participantToken, 'participant', {
      participantId: recovered.participantId,
    });

    expect(snapshot.participantId).toBe(original.participantId);
    expect(snapshot.ownAnswer).toMatchObject({ kind: 'text', text: 'still here' });
  });

  it('does not create a participant for an unknown recovery handle', async () => {
    const session = await createSessionWithOutline(PSEUDO_OUTLINE);
    await join(session.code);

    const res = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code, recoveryHandle: 'Missing Otter 9999' }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'handle-not-found' });
    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.participantCount).toBe(1);
  });

  it('rejects a malformed recovery handle instead of silently joining as new', async () => {
    const session = await createSessionWithOutline(PSEUDO_OUTLINE);
    const res = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code, recoveryHandle: 4827 }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid-handle' });
    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.participantCount).toBe(0);
  });

  it('keeps explicit anonymous sessions on the non-recoverable path', async () => {
    const session = await createLiveSession();
    const res = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code, recoveryHandle: 'Amber Fox 4827' }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'handle-recovery-unavailable' });
  });

  it('rate-limits repeated failed handle recovery attempts per session', async () => {
    const session = await createSessionWithOutline(PSEUDO_OUTLINE);
    await join(session.code);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const res = await call('/api/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: session.code, recoveryHandle: `Missing Otter ${attempt + 1000}` }),
      });
      expect(res.status).toBe(404);
    }

    const limited = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code, recoveryHandle: 'Missing Otter 9999' }),
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: 'recovery-rate-limited' });
  });

  it('handles never leak to stage or other participants, even with live results', async () => {
    const session = await createSessionWithOutline(PSEUDO_OUTLINE);
    const a = (await join(session.code)) as Record<string, any>;
    const b = (await join(session.code)) as Record<string, any>;
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'chat' });
    await command(
      session.sessionCode,
      a.participantToken,
      { command: 'answer.submit', interactionId: 'chat', answer: { kind: 'text', text: 'hello' } },
    );

    const stage = await stateJson(session.sessionCode, session.stageToken, 'stage');
    expect(JSON.stringify(stage)).not.toContain(a.handle);
    expect(JSON.stringify(stage)).not.toContain(b.handle);

    const peer = await stateJson(session.sessionCode, b.participantToken, 'participant', {
      participantId: b.participantId,
    });
    const serialized = JSON.stringify(peer);
    expect(serialized).not.toContain(a.handle);
    expect(peer.yourHandle).toBe(b.handle);
  });

  it('CSV export carries the handle column only in pseudonymous sessions', async () => {
    const session = await createSessionWithOutline(PSEUDO_OUTLINE);
    const a = (await join(session.code)) as Record<string, any>;
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'chat' });
    await command(
      session.sessionCode,
      a.participantToken,
      { command: 'answer.submit', interactionId: 'chat', answer: { kind: 'text', text: 'hello' } },
    );

    const res = await call(`/api/sessions/${session.sessionCode}/export?format=ballots`, {
      headers: { authorization: `Bearer ${session.hostToken}` },
    });
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv.split('\n')[0]).toBe('interactionId,prompt,participantId,handle,answer,hidden');
    expect(csv).toContain(`"${a.handle}"`);

    const anonSession = await createLiveSession();
    const anonCsv = await (
      await call(`/api/sessions/${anonSession.sessionCode}/export?format=ballots`, {
        headers: { authorization: `Bearer ${anonSession.hostToken}` },
      })
    ).text();
    expect(anonCsv.split('\n')[0]).toBe('interactionId,prompt,participantId,answer,hidden');
  });
});
