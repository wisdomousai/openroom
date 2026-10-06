/**
 * Retention schedule (PRD DATA-04): ballots purged 30 min after a session ends,
 * the whole session deleted 24 h after.
 *
 * Same shape as expiry.test.ts — the retention clock lives in the DO's `meta`
 * table, so we backdate `endedAt` there directly (the one documented escape
 * hatch into DO internals) and then force the multiplexed alarm to run with
 * `runDurableObjectAlarm`.
 */
import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { call, command, createSessionWithOutline, getState, join, stateJson } from './helpers.js';

interface Env {
  SESSIONS: DurableObjectNamespace;
}

const TEXT_OUTLINE = {
  version: 1,
  meta: { title: 'Retention outline' },
  interactions: [
    {
      id: 'warmup',
      type: 'choice',
      prompt: 'Pick one',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    },
    { id: 'reflect', type: 'text', prompt: 'One word' },
  ],
};

interface Session {
  sessionCode: string;
  code: string;
  hostToken: string;
}

/** A finished session with a choice answer and two text answers on record. */
async function endedSessionWithAnswers(): Promise<Session> {
  const session = await createSessionWithOutline(TEXT_OUTLINE);
  await command(session.sessionCode, session.hostToken, { command: 'session.start' });

  const alice = await join(session.code);
  const bob = await join(session.code);

  await command(session.sessionCode, session.hostToken, {
    command: 'interaction.open',
    interactionId: 'warmup',
  });
  await command(session.sessionCode, alice.participantToken, {
    command: 'answer.submit',
    interactionId: 'warmup',
    answer: { kind: 'choice', optionIds: ['a'] },
  });
  await command(session.sessionCode, bob.participantToken, {
    command: 'answer.submit',
    interactionId: 'warmup',
    answer: { kind: 'choice', optionIds: ['a'] },
  });

  await command(session.sessionCode, session.hostToken, {
    command: 'interaction.open',
    interactionId: 'reflect',
  });
  await command(session.sessionCode, alice.participantToken, {
    command: 'answer.submit',
    interactionId: 'reflect',
    answer: { kind: 'text', text: 'curious' },
  });
  await command(session.sessionCode, bob.participantToken, {
    command: 'answer.submit',
    interactionId: 'reflect',
    answer: { kind: 'text', text: 'hopeful' },
  });

  await command(session.sessionCode, session.hostToken, { command: 'session.end' });
  return session;
}

function stubFor(sessionCode: string): DurableObjectStub {
  const ns = (env as unknown as Env).SESSIONS;
  return ns.get(ns.idFromName(sessionCode));
}

/**
 * Rewrite the DO's retention clock so a deadline is already in the past.
 *
 * The pending-broadcast alarm from the last command is cleared and the alarm is
 * pushed an hour out first: otherwise it could fire on its own between this
 * helper and `runDurableObjectAlarm`, and the test would be asserting on an
 * alarm run it did not trigger.
 */
async function backdateEndedAt(sessionCode: string, agoMs: number): Promise<void> {
  await runInDurableObject(stubFor(sessionCode), async (_instance, state) => {
    state.storage.sql.exec(
      "INSERT INTO meta (k, v) VALUES ('endedAt', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      String(Date.now() - agoMs),
    );
    state.storage.sql.exec(
      "INSERT INTO meta (k, v) VALUES ('pendingBroadcastAt', '0') ON CONFLICT(k) DO UPDATE SET v = excluded.v",
    );
    await state.storage.setAlarm(Date.now() + 60 * 60 * 1000);
  });
}

const THIRTY_ONE_MINUTES = 31 * 60 * 1000;
const TWENTY_FIVE_HOURS = 25 * 60 * 60 * 1000;

describe('ballot purge 30 minutes after a session ends', () => {
  it('drops ballots and participants but keeps the aggregates, with text anonymized', async () => {
    const session = await endedSessionWithAnswers();
    const before = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(before.purgedAt).toBeUndefined();
    expect(Object.keys(before.ballots.reflect as Record<string, unknown>)).toHaveLength(2);

    await backdateEndedAt(session.sessionCode, THIRTY_ONE_MINUTES);
    expect(await runDurableObjectAlarm(stubFor(session.sessionCode))).toBe(true);

    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.status).toBe('ended');
    expect(typeof host.purgedAt).toBe('number');
    expect(host.revision).toBe((before.revision as number) + 1);

    // Ballots, participants and facilitator identities are gone.
    expect(host.ballots.warmup).toEqual({});
    expect(host.ballots.reflect).toEqual({});
    expect(host.participantCount).toBe(0);
    expect(host.facilitation).toEqual({ presenterId: '', facilitators: [], yourId: '', canPresent: false, canRecover: false });
    expect((await command(session.sessionCode, session.hostToken, { command: 'session.start' })).status).toBe(403);

    // the aggregate of the still-active interaction survives, anonymized
    expect(host.aggregate).toEqual({
      kind: 'text',
      total: 2,
      entries: [
        { participantId: 'purged-1', text: 'curious', hidden: false },
        { participantId: 'purged-2', text: 'hopeful', hidden: false },
      ],
    });

    // ballot-derived counts survive in the JSON export
    const exported = await call(`/api/sessions/${session.sessionCode}/export?format=json`, {
      headers: { authorization: `Bearer ${session.hostToken}` },
    });
    expect(exported.status).toBe(200);
    const body = (await exported.json()) as {
      interactions: { id: string; aggregate: { counts?: Record<string, number>; total: number } }[];
    };
    const warmup = body.interactions.find((item) => item.id === 'warmup');
    expect(warmup?.aggregate.counts).toEqual({ a: 2, b: 0 });
    expect(warmup?.aggregate.total).toBe(2);
  });

  it('answers the per-ballot CSV export with 410 ballots-purged once purged', async () => {
    const session = await endedSessionWithAnswers();
    await backdateEndedAt(session.sessionCode, THIRTY_ONE_MINUTES);
    await runDurableObjectAlarm(stubFor(session.sessionCode));

    const counts = await call(`/api/sessions/${session.sessionCode}/export?format=csv`, {
      headers: { authorization: `Bearer ${session.hostToken}` },
    });
    expect(counts.status).toBe(200);
    expect((await counts.text()).split('\n')[0]).toBe(
      'interactionId,prompt,type,status,total,summary',
    );

    const csv = await call(`/api/sessions/${session.sessionCode}/export?format=ballots`, {
      headers: { authorization: `Bearer ${session.hostToken}` },
    });
    expect(csv.status).toBe(410);
    expect(await csv.json()).toEqual({ ok: false, error: 'ballots-purged' });
  });

  it('is idempotent: a second alarm run does not purge (or bump the revision) again', async () => {
    const session = await endedSessionWithAnswers();
    await backdateEndedAt(session.sessionCode, THIRTY_ONE_MINUTES);
    await runDurableObjectAlarm(stubFor(session.sessionCode));
    const once = await stateJson(session.sessionCode, session.hostToken, 'host');

    await runDurableObjectAlarm(stubFor(session.sessionCode));
    const twice = await stateJson(session.sessionCode, session.hostToken, 'host');

    expect(twice.revision).toBe(once.revision);
    expect(twice.purgedAt).toBe(once.purgedAt);
    expect(twice.aggregate).toEqual(once.aggregate);
  });
});

describe('full session deletion 24 hours after a session ends', () => {
  it('wipes storage so join and state behave like an unknown session', async () => {
    const session = await endedSessionWithAnswers();
    await backdateEndedAt(session.sessionCode, TWENTY_FIVE_HOURS);
    expect(await runDurableObjectAlarm(stubFor(session.sessionCode))).toBe(true);

    const joinRes = await call('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: session.code }),
    });
    expect(joinRes.status).toBe(404);

    const stateRes = await getState(session.sessionCode, session.hostToken, 'host');
    expect(stateRes.status).toBe(404);
    expect(await stateRes.json()).toEqual({ error: 'session-not-found' });
  });

  it('leaves no alarm behind — there is nothing more to do for a deleted session', async () => {
    const session = await endedSessionWithAnswers();
    await backdateEndedAt(session.sessionCode, TWENTY_FIVE_HOURS);
    await runDurableObjectAlarm(stubFor(session.sessionCode));
    expect(await runDurableObjectAlarm(stubFor(session.sessionCode))).toBe(false);
  });
});
