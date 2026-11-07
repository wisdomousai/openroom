/**
 * Nickname mode (identityMode: 'nickname') — session-local names.
 *
 * Contract under test:
 *  - join assigns a unique "Adjective Animal 1234" name and returns it (+ identityMode)
 *  - anonymous sessions return no name and no names map anywhere
 *  - the name is stable: host snapshot maps participantId -> name
 *  - names never reach the stage or other participants (leak check on the
 *    serialized wire payloads, not just the expected fields)
 *  - CSV export gains a `name` column only in nickname sessions
 */
import { describe, expect, it } from 'vitest';

import { call, command, createLiveSession, createSessionWithOutline, join, stateJson } from './helpers.js';

const PSEUDO_OUTLINE = {
  version: 1,
  meta: { title: 'Names outline' },
  defaults: { identityMode: 'nickname' },
  interactions: [
    {
      id: 'chat',
      type: 'text',
      prompt: 'Say something',
      resultVisibility: 'live',
    },
  ],
};

const NAME_RE = /^[A-Z][a-z]+ [A-Z][a-z]+ \d{4}$/;

describe('nickname mode', () => {
  it('join returns identityMode and a well-formed name', async () => {
    const session = await createSessionWithOutline(PSEUDO_OUTLINE);
    const joined = (await join(session.code)) as Record<string, any>;
    expect(joined.identityMode).toBe('nickname');
    expect(joined.name).toMatch(NAME_RE);
  });

  it('anonymous sessions return no name', async () => {
    const session = await createLiveSession();
    const joined = (await join(session.code)) as Record<string, any>;
    expect(joined.identityMode).toBe('anonymous');
    expect(joined.name).toBeUndefined();
  });

  it('sessions with no identity setting now default to nicknames', async () => {
    const session = await createSessionWithOutline({
      version: 1,
      meta: { title: 'Default identity' },
      interactions: [{ id: 'chat', type: 'text', prompt: 'Say something' }],
    });
    const joined = await join(session.code);

    expect(joined.identityMode).toBe('nickname');
    expect(joined.name).toMatch(NAME_RE);
  });

  it('names are unique per session and stable in the host snapshot', async () => {
    const session = await createSessionWithOutline(PSEUDO_OUTLINE);
    const a = (await join(session.code)) as Record<string, any>;
    const b = (await join(session.code)) as Record<string, any>;
    expect(a.name).not.toBe(b.name);

    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.names).toEqual({
      [a.participantId]: a.name,
      [b.participantId]: b.name,
    });
  });

  it('recovers the original participant by a case-insensitive session name', async () => {
    const session = await createSessionWithOutline(PSEUDO_OUTLINE);
    const original = await join(session.code);
    const recovered = await join(
      session.code,
      `  ${original.name?.toLocaleLowerCase('en').replace(/ /g, '  ')}  `,
    );

    expect(recovered.participantId).toBe(original.participantId);
    expect(recovered.name).toBe(original.name);

    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.participantCount).toBe(1);
  });

  it('keeps the participant answer when a recovered name receives a new capability', async () => {
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

    const recovered = await join(session.code, original.name);
    const snapshot = await stateJson(session.sessionCode, recovered.participantToken, 'participant', {
      participantId: recovered.participantId,
    });

    expect(snapshot.participantId).toBe(original.participantId);
    expect(snapshot.ownAnswer).toMatchObject({ kind: 'text', text: 'still here' });
  });

  it('does not create a participant for an unknown recovery name', async () => {
    const session = await createSessionWithOutline(PSEUDO_OUTLINE);
    await join(session.code);

    const res = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code, recoveryName: 'Missing Otter 9999' }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'name-not-found' });
    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.participantCount).toBe(1);
  });

  it('rejects a malformed recovery name instead of silently joining as new', async () => {
    const session = await createSessionWithOutline(PSEUDO_OUTLINE);
    const res = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code, recoveryName: 4827 }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid-name' });
    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.participantCount).toBe(0);
  });

  it('keeps explicit anonymous sessions on the non-recoverable path', async () => {
    const session = await createLiveSession();
    const res = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code, recoveryName: 'Amber Fox 4827' }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'name-recovery-unavailable' });
  });

  it('rate-limits repeated failed name recovery attempts per session', async () => {
    const session = await createSessionWithOutline(PSEUDO_OUTLINE);
    await join(session.code);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const res = await call('/api/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: session.code, recoveryName: `Missing Otter ${attempt + 1000}` }),
      });
      expect(res.status).toBe(404);
    }

    const limited = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code, recoveryName: 'Missing Otter 9999' }),
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: 'recovery-rate-limited' });
  });

  it('names never leak to stage or other participants, even with live results', async () => {
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
    expect(JSON.stringify(stage)).not.toContain(a.name);
    expect(JSON.stringify(stage)).not.toContain(b.name);

    const peer = await stateJson(session.sessionCode, b.participantToken, 'participant', {
      participantId: b.participantId,
    });
    const serialized = JSON.stringify(peer);
    expect(serialized).not.toContain(a.name);
    expect(peer.yourName).toBe(b.name);
  });

  it('a Q&A asker or text author name never reaches peers or the stage, so it cannot be replayed as a recovery name', async () => {
    const session = await createSessionWithOutline({
      version: 1,
      meta: { title: 'Deck with Q&A' },
      qna: { enabled: true },
      steps: [
        { id: 'welcome', kind: 'title', title: 'Welcome' },
        { id: 'chat-step', kind: 'interaction', interactionId: 'chat' },
      ],
      interactions: [{ id: 'chat', type: 'text', prompt: 'Say something', resultVisibility: 'live' }],
    });
    const a = (await join(session.code)) as Record<string, any>;
    const b = (await join(session.code)) as Record<string, any>;
    expect(a.identityMode).toBe('nickname');
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'qna.stage', mode: 'list' });
    expect((await command(session.sessionCode, a.participantToken, { command: 'qna.ask', questionId: 'q1', text: 'Why?' })).status).toBe(200);
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'chat' });
    expect((await command(
      session.sessionCode,
      a.participantToken,
      { command: 'answer.submit', interactionId: 'chat', answer: { kind: 'text', text: 'hello' } },
    )).status).toBe(200);

    const peer = await stateJson(session.sessionCode, b.participantToken, 'participant');
    expect(peer.qna.questions).toHaveLength(1);
    expect(JSON.stringify(peer)).not.toContain(a.name);
    const stage = await stateJson(session.sessionCode, session.stageToken, 'stage');
    expect(stage.qna.questions).toHaveLength(1);
    expect(JSON.stringify(stage)).not.toContain(a.name);
  });

  it('CSV export carries the name column only in nickname sessions', async () => {
    const session = await createSessionWithOutline(PSEUDO_OUTLINE);
    const a = (await join(session.code)) as Record<string, any>;
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'chat' });
    await command(
      session.sessionCode,
      a.participantToken,
      { command: 'answer.submit', interactionId: 'chat', answer: { kind: 'text', text: 'hello' } },
    );

    const res = await call(`/api/sessions/${session.sessionCode}/export?format=answers`, {
      headers: { authorization: `Bearer ${session.hostToken}` },
    });
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv.split('\n')[0]).toBe('interactionId,prompt,participantId,name,answer,hidden');
    expect(csv).toContain(`"${a.name}"`);

    const anonSession = await createLiveSession();
    const anonCsv = await (
      await call(`/api/sessions/${anonSession.sessionCode}/export?format=answers`, {
        headers: { authorization: `Bearer ${anonSession.hostToken}` },
      })
    ).text();
    expect(anonCsv.split('\n')[0]).toBe('interactionId,prompt,participantId,answer,hidden');
  });
});
