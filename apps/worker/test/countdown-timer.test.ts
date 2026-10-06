/**
 * Optional countdown window. Outline `timerSec` arms `closesAt` as an advisory
 * drain. The multiplexed DO alarm must not auto-close at zero.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { command, createSessionWithOutline, stateJson } from './helpers.js';
import type { SessionDO } from '../src/session-do.js';

interface Env {
  SESSIONS: DurableObjectNamespace;
}

const TIMER_OUTLINE = {
  version: 1,
  meta: { title: 'Countdown outline' },
  interactions: [
    {
      id: 'timed',
      type: 'choice',
      prompt: 'Quick poll',
      timerSec: 1,
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    },
    {
      id: 'untimed',
      type: 'choice',
      prompt: 'No timer',
      options: [
        { id: 'x', label: 'X' },
        { id: 'y', label: 'Y' },
      ],
    },
  ],
};

function stubFor(sessionCode: string): DurableObjectStub {
  const ns = (env as unknown as Env).SESSIONS;
  return ns.get(ns.idFromName(sessionCode));
}

describe('countdown timer alarm does not auto-close', () => {
  it('leaves an open interaction open after timerSec elapses', async () => {
    const session = await createSessionWithOutline(TIMER_OUTLINE);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, {
      command: 'interaction.open',
      interactionId: 'timed',
    });

    const before = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(before.interactionStatus).toBe('open');
    expect(typeof before.closesAt).toBe('number');
    expect((before.closesAt as number) - Date.now()).toBeLessThanOrEqual(1_000);

    // Wall-clock past closesAt, then invoke the multiplexed alarm handler directly
    // (same path as storage alarms — avoids racing runDurableObjectAlarm scheduling).
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await runInDurableObject(stubFor(session.sessionCode), async (instance: SessionDO) => {
      await instance.alarm();
    });

    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.interactionStatus).toBe('open');
    expect(typeof host.closesAt).toBe('number');
    const timed = (host.interactions as { id: string; status: string; closesAt?: number }[]).find(
      (i) => i.id === 'timed',
    );
    expect(timed?.status).toBe('open');
    expect(typeof timed?.closesAt).toBe('number');
  });

  it('does not close an open interaction without closesAt', async () => {
    const session = await createSessionWithOutline(TIMER_OUTLINE);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, {
      command: 'interaction.open',
      interactionId: 'untimed',
    });

    const before = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(before.interactionStatus).toBe('open');
    expect(before.closesAt).toBeUndefined();

    await runInDurableObject(stubFor(session.sessionCode), async (instance: SessionDO) => {
      await instance.alarm();
    });

    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.interactionStatus).toBe('open');
  });
});
