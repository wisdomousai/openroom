/**
 * Auth/capability boundary tests (API-05, INT-05).
 *
 * Every check goes through the HTTP router — tokens are minted with the same
 * `tokens.ts` module the router uses, but always over the wire.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { signToken } from 'openroom-relay/tokens';
import { call, command, createLiveSession, createSessionWithOutline, getState, join, SMOKE_OUTLINE } from './helpers.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

describe('auth boundaries', () => {
  it('rejects participant token on every host-only mutation (403 E_FORBIDDEN)', async () => {
    const session = await createLiveSession();
    const participant = await join(session.code);

    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    const open = await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'warmup' });
    expect(open.status).toBe(200);

    const hostOnly: Record<string, unknown>[] = [
      { command: 'interaction.open', interactionId: 'warmup' },
      { command: 'interaction.close', interactionId: 'warmup' },
      { command: 'interaction.reveal', interactionId: 'warmup' },
      { command: 'session.end' },
      { command: 'session.freeze' },
      { command: 'session.unfreeze' },
      { command: 'text.hide', interactionId: 'warmup', participantId: participant.participantId },
      { command: 'session.advance' },
    ];
    for (const cmd of hostOnly) {
      const res = await command(session.sessionCode, participant.participantToken, cmd);
      expect(res.status).toBe(403);
      const body = (await res.json()) as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('E_FORBIDDEN');
    }
  });

  it('rejects every mutation from a stage token, including participant-only commands', async () => {
    const session = await createLiveSession();
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'warmup' });

    const attempts: Record<string, unknown>[] = [
      { command: 'session.start' },
      { command: 'interaction.close', interactionId: 'warmup' },
      { command: 'session.freeze' },
      { command: 'answer.submit', interactionId: 'warmup', answer: { kind: 'choice', optionIds: ['a'] } },
    ];
    for (const cmd of attempts) {
      const res = await command(session.sessionCode, session.stageToken, cmd);
      expect(res.status).toBe(403);
    }
  });

  it('rejects a stage-role snapshot request made with a participant token', async () => {
    const session = await createLiveSession();
    const participant = await join(session.code);
    const res = await getState(session.sessionCode, participant.participantToken, 'stage');
    expect([401, 403]).toContain(res.status);
  });

  it('rejects a participant-role snapshot request made with a stage token', async () => {
    const session = await createLiveSession();
    const res = await getState(session.sessionCode, session.stageToken, 'participant');
    expect([401, 403]).toContain(res.status);
  });

  it('rejects a host token minted for a different session (session-mismatch)', async () => {
    const sessionA = await createLiveSession();
    const sessionB = await createSessionWithOutline(SMOKE_OUTLINE);
    expect(sessionA.sessionCode).not.toBe(sessionB.sessionCode);

    const res = await getState(sessionB.sessionCode, sessionA.hostToken, 'host');
    expect(res.status).toBe(403);

    const mutate = await command(sessionB.sessionCode, sessionA.hostToken, { command: 'session.start' });
    expect(mutate.status).toBe(403);
  });

  it('rejects an expired token', async () => {
    const session = await createLiveSession();
    const expiredToken = await signToken(
      TOKEN_SECRET,
      { sessionCode: session.sessionCode, role: 'host', exp: Math.floor(Date.now() / 1000) - 10 },
    );
    const res = await getState(session.sessionCode, expiredToken, 'host');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; reason?: string };
    expect(body.reason).toBe('expired');
  });

  it('rejects malformed / unsigned / wrong-secret tokens', async () => {
    const session = await createLiveSession();

    const garbage = await getState(session.sessionCode, 'not-a-token-at-all', 'host');
    expect(garbage.status).toBe(401);

    // well-formed shape, but the "signature" half is garbage bytes
    const [body] = (await signToken(TOKEN_SECRET, { sessionCode: session.sessionCode, role: 'host' })).split('.');
    const unsigned = `${body}.${btoa('not-a-real-signature').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    const unsignedRes = await getState(session.sessionCode, unsigned, 'host');
    expect(unsignedRes.status).toBe(401);

    const wrongSecretToken = await signToken('a-totally-different-secret', {
      sessionCode: session.sessionCode,
      role: 'host',
    });
    const wrongSecretRes = await getState(session.sessionCode, wrongSecretToken, 'host');
    expect(wrongSecretRes.status).toBe(401);
  });

  it('rejects POST /api/sessions with a missing or wrong admin key', async () => {
    const missing = await call('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outline: SMOKE_OUTLINE }),
    });
    expect(missing.status).toBe(401);

    const wrong = await call('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-openroom-admin': 'nope' },
      body: JSON.stringify({ outline: SMOKE_OUTLINE }),
    });
    expect(wrong.status).toBe(401);
  });

  it('returns 404 for joining an unknown session code', async () => {
    const res = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'ZZZZZZZZ' }),
    });
    expect(res.status).toBe(404);
  });
});
