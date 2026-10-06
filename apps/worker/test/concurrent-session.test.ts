import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { SessionDO } from '../src/session-do';
import { command, createLiveSession, join, stateJson } from './helpers';

/** A network body can yield after the handler enters but before JSON is available. */
async function interleave(instance: SessionDO, path: string, slowBody: unknown, fastPath: string, fastBody: unknown) {
  let release!: () => void;
  let entered!: () => void;
  const pendingBody = new Promise<void>((resolve) => { release = resolve; });
  const readingBody = new Promise<void>((resolve) => { entered = resolve; });
  const request = new Request(`https://session.test${path}`, { method: 'POST', body: '{}' });
  vi.spyOn(request, 'json').mockImplementation(async () => { entered(); await pendingBody; return slowBody; });
  const slow = instance.fetch(request);
  await readingBody;
  try {
    const fast = await instance.fetch(new Request(`https://session.test${fastPath}`, { method: 'POST', body: JSON.stringify(fastBody) }));
    const fastResult = { status: fast.status, body: await fast.json() };
    release();
    const resumed = await slow;
    return { fast: fastResult, slow: { status: resumed.status, body: await resumed.json() } };
  } finally { release(); await slow; }
}

describe('concurrent session mutations across body decoding', () => {
  it('retains both successful joins when one request body arrives late', async () => {
    const session = await createLiveSession();
    const stub = env.SESSIONS.get(env.SESSIONS.idFromName(session.sessionCode));
    const result = await runInDurableObject(stub, (instance: SessionDO) => interleave(instance, '/__join', {}, '/__join', {}));
    expect(result.fast.status).toBe(200);
    expect(result.slow.status).toBe(200);
    const state = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(state.participantCount).toBe(2);
    expect(state.revision).toBe(2);
  });

  it('retains every acknowledged answer and increasing revisions across a delayed command body', async () => {
    const session = await createLiveSession();
    const first = await join(session.code);
    const second = await join(session.code);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'warmup' });
    const envelope = (participantId: string, option: string) => ({
      actor: { role: 'participant', participantId }, idempotencyKey: participantId,
      command: { command: 'answer.submit', interactionId: 'warmup', answer: { kind: 'choice', optionIds: [option] } },
    });
    const stub = env.SESSIONS.get(env.SESSIONS.idFromName(session.sessionCode));
    const result = await runInDurableObject(stub, (instance: SessionDO) => interleave(instance,
      '/__command', envelope(first.participantId, 'a'), '/__command', envelope(second.participantId, 'b')));
    expect(result.fast.status).toBe(200);
    expect(result.slow.status).toBe(200);
    const state = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(state.aggregate).toMatchObject({ total: 2, counts: { a: 1, b: 1 } });
    expect(state.ballots.warmup).toEqual({
      [first.participantId]: { kind: 'choice', optionIds: ['a'] },
      [second.participantId]: { kind: 'choice', optionIds: ['b'] },
    });
    expect(state.revision).toBe(6);
  });

  it('registers a facilitator without reverting a concurrent participant join', async () => {
    const session = await createLiveSession();
    const stub = env.SESSIONS.get(env.SESSIONS.idFromName(session.sessionCode));
    const result = await runInDurableObject(stub, (instance: SessionDO) => interleave(instance,
      '/__facilitator', { id: 'second-facilitator', name: 'Second facilitator', canRecover: false }, '/__join', {}));
    expect(result.fast.status).toBe(200);
    expect(result.slow.status).toBe(200);
    const state = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(state.participantCount).toBe(1);
    expect(state.facilitation.facilitators).toEqual(expect.arrayContaining([{ id: 'second-facilitator', name: 'Second facilitator' }]));
    expect(state.revision).toBe(2);
  });
});
