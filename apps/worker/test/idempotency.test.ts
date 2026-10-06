/**
 * Idempotency + retry semantics (LIVE-04, PART-03, INT-06).
 */
import { describe, expect, it } from 'vitest';

import { command, createLiveSession, getState, join, stateJson } from './helpers.js';

describe('idempotency and retries', () => {
  it('replays a duplicate idempotencyKey byte-identically and leaves state unchanged', async () => {
    const session = await createLiveSession();
    const participant = await join(session.code);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'warmup' });

    const key = crypto.randomUUID();
    const submitCmd = { command: 'answer.submit', interactionId: 'warmup', answer: { kind: 'choice', optionIds: ['a'] } };

    const first = await command(session.sessionCode, participant.participantToken, submitCmd, { idempotencyKey: key });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const second = await command(session.sessionCode, participant.participantToken, submitCmd, { idempotencyKey: key });
    expect(second.status).toBe(200);
    const secondBody = await second.json();

    expect(secondBody).toEqual(firstBody);

    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.aggregate.total).toBe(1);
    expect(host.aggregate.counts.a).toBe(1);
  });

  it('replaces the answer (not duplicates) when the same participant submits under a different key', async () => {
    const session = await createLiveSession();
    const participant = await join(session.code);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'warmup' });

    await command(session.sessionCode, participant.participantToken, {
      command: 'answer.submit',
      interactionId: 'warmup',
      answer: { kind: 'choice', optionIds: ['a'] },
    });
    await command(session.sessionCode, participant.participantToken, {
      command: 'answer.submit',
      interactionId: 'warmup',
      answer: { kind: 'choice', optionIds: ['b'] },
    });

    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.aggregate.total).toBe(1);
    expect(host.aggregate.counts.a ?? 0).toBe(0);
    expect(host.aggregate.counts.b ?? 0).toBe(1);
  });

  it('does not store a failed (revision-conflict) command, so a retry with the same key can succeed', async () => {
    const session = await createLiveSession();
    const startRes = await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    const { revision: afterStart } = (await startRes.json()) as { revision: number };

    const key = crypto.randomUUID();
    const badRevision = afterStart + 99;

    const failed = await command(
      session.sessionCode,
      session.hostToken,
      { command: 'interaction.open', interactionId: 'warmup' },
      { idempotencyKey: key, expectedRevision: badRevision },
    );
    expect(failed.status).toBe(409);
    const failedBody = (await failed.json()) as { ok: boolean; error: { code: string } };
    expect(failedBody.ok).toBe(false);
    expect(failedBody.error.code).toBe('E_REVISION_CONFLICT');

    // retry the SAME key with the correct expectedRevision — must succeed, proving
    // the failed attempt above was never persisted under that key.
    const retried = await command(
      session.sessionCode,
      session.hostToken,
      { command: 'interaction.open', interactionId: 'warmup' },
      { idempotencyKey: key, expectedRevision: afterStart },
    );
    expect(retried.status).toBe(200);

    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.interactionStatus).toBe('open');
  });

  it('rejects a stale expectedRevision with 409', async () => {
    const session = await createLiveSession();
    const res = await command(
      session.sessionCode,
      session.hostToken,
      { command: 'session.start' },
      { expectedRevision: 999 },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('E_REVISION_CONFLICT');
  });

  it('re-opening an already-open interaction is a no-op success WITHOUT a revision bump', async () => {
    const session = await createLiveSession();
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'warmup' });

    const before = await stateJson(session.sessionCode, session.hostToken, 'host');

    const reopen = await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'warmup' });
    expect(reopen.status).toBe(200);
    const reopenBody = (await reopen.json()) as { ok: boolean; revision: number };
    expect(reopenBody.revision).toBe(before.revision);

    const after = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(after.revision).toBe(before.revision);
    expect(after).toEqual(before);
  });
});
