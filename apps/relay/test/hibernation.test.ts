/**
 * Local hibernation coverage.
 *
 * Production drops idle SessionDOs from memory while hibernatable WebSockets stay
 * connected; the next event re-runs the constructor and `#load()` rebuilds
 * from SQLite. PRD requires "Hibernation, reinitialization, and reconnect
 * tests" and "no lost accepted ballot".
 *
 * `evictDurableObject` (the official vitest helper) currently times out on
 * SessionDO with "active references", so we cover the wake contract two ways:
 *
 *   1. `abortAllDurableObjects` — full teardown + constructor re-run (closes
 *      sockets; proves SQL reload and auto-response reinstall).
 *   2. `SessionDO.simulateHibernationWakeForTest` — drops in-memory caches while
 *      keeping hibernatable sockets open (proves notify + role tags after wake).
 */
import {
  abortAllDurableObjects,
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';

import {
  BASE,
  command,
  createLiveSession,
  createSessionWithOutline,
  join,
  SMOKE_OUTLINE,
  stateJson,
  waitFor,
} from './helpers.js';
import worker from '../src/index.js';
import { SessionDO } from '../src/session-do.js';

interface Env {
  SESSIONS: DurableObjectNamespace;
}

interface SessionChangedFrame {
  v: 1;
  type: 'session.changed';
  revision: number;
}

function stubFor(sessionCode: string): DurableObjectStub {
  const ns = (env as unknown as Env).SESSIONS;
  return ns.get(ns.idFromName(sessionCode));
}

async function connect(
  sessionCode: string,
  token: string,
): Promise<{ ws: WebSocket; frames: SessionChangedFrame[] }> {
  const res = await worker.fetch(
    new Request(`${BASE}/api/sessions/${sessionCode}/ws?token=${encodeURIComponent(token)}`, {
      headers: { upgrade: 'websocket' },
    }),
    env as never,
  );
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (ws === null) throw new Error('expected a websocket in the upgrade response');
  ws.accept();
  const frames: SessionChangedFrame[] = [];
  ws.addEventListener('message', (event: MessageEvent) => {
    if (typeof event.data !== 'string' || !event.data.startsWith('{')) return;
    frames.push(JSON.parse(event.data));
  });
  return { ws, frames };
}

/** Drop in-memory SessionDO caches without closing hibernatable sockets. */
async function simulateWake(sessionCode: string): Promise<void> {
  await runInDurableObject(stubFor(sessionCode), async (instance: SessionDO) => {
    instance.simulateHibernationWakeForTest();
  });
}

describe('hibernation — abort (constructor re-run)', () => {
  it('reloads SQLite state after abort without losing an accepted ballot', async () => {
    const session = await createLiveSession();
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, {
      command: 'interaction.open',
      interactionId: 'warmup',
    });

    const participant = await join(session.code);
    await command(session.sessionCode, participant.participantToken, {
      command: 'answer.submit',
      interactionId: 'warmup',
      answer: { kind: 'choice', optionIds: ['a'] },
    });

    const before = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(before.ballots.warmup[participant.participantId]).toEqual({
      kind: 'choice',
      optionIds: ['a'],
    });

    await runInDurableObject(stubFor(session.sessionCode), async (instance: SessionDO) => {
      (instance as unknown as { __probeMarker?: number }).__probeMarker = 42;
    });
    await abortAllDurableObjects();

    const marker = await runInDurableObject(stubFor(session.sessionCode), async (instance: SessionDO) => {
      return (instance as unknown as { __probeMarker?: number }).__probeMarker ?? null;
    });
    expect(marker).toBeNull();

    const after = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(after.revision).toBe(before.revision);
    expect(after.status).toBe('live');
    expect(after.interactionStatus).toBe('open');
    expect(after.ballots.warmup[participant.participantId]).toEqual({
      kind: 'choice',
      optionIds: ['a'],
    });

    const closeRes = await command(session.sessionCode, session.hostToken, {
      command: 'interaction.close',
      interactionId: 'warmup',
    });
    expect(closeRes.status).toBe(200);
    const closed = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(closed.interactionStatus).toBe('closed');
    expect(closed.revision).toBe((before.revision as number) + 1);
  });

  it('reinstalls ping/pong auto-response when the constructor re-runs', async () => {
    const messageSpy = vi.spyOn(SessionDO.prototype, 'webSocketMessage');
    const session = await createLiveSession();
    const participant = await join(session.code);

    await abortAllDurableObjects();

    // Fresh socket after abort (abort closes prior connections). Avoid the
    // shared connect() JSON parser — auto-response payloads are raw "pong".
    const res = await worker.fetch(
      new Request(
        `${BASE}/api/sessions/${session.sessionCode}/ws?token=${encodeURIComponent(participant.participantToken)}`,
        { headers: { upgrade: 'websocket' } },
      ),
      env as never,
    );
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    if (ws === null) throw new Error('expected a websocket in the upgrade response');
    ws.accept();

    try {
      const raw: string[] = [];
      ws.addEventListener('message', (event: MessageEvent) => {
        if (typeof event.data === 'string') raw.push(event.data);
      });
      messageSpy.mockClear();
      ws.send('ping');
      const gotPong = await waitFor(() => raw.includes('pong'), 2000);
      expect(gotPong).toBe(true);
      expect(messageSpy).not.toHaveBeenCalled();
    } finally {
      ws.close();
      messageSpy.mockRestore();
    }
  });
});

describe('hibernation — simulated wake (sockets stay open)', () => {
  it('delivers session.changed on hibernated sockets after in-memory reset', async () => {
    const session = await createLiveSession();
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, {
      command: 'interaction.open',
      interactionId: 'warmup',
    });

    const participant = await join(session.code);
    const { ws, frames } = await connect(session.sessionCode, participant.participantToken);
    try {
      await new Promise((resolve) => setTimeout(resolve, 260));
      frames.length = 0;

      await simulateWake(session.sessionCode);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      const before = await stateJson(session.sessionCode, participant.participantToken, 'participant');
      await command(session.sessionCode, session.hostToken, {
        command: 'interaction.close',
        interactionId: 'warmup',
      });

      const sawIt = await waitFor(
        () => frames.some((frame) => frame.type === 'session.changed' && frame.revision > before.revision),
        2500,
      );
      expect(sawIt).toBe(true);
    } finally {
      ws.close();
    }
  });

  // Deliberate settle + silence windows put this past the 5s default under load.
  it('preserves role tags so hidden-results ballots reach host only after wake', { timeout: 20_000 }, async () => {
    const session = await createLiveSession();
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, {
      command: 'interaction.open',
      interactionId: 'warmup',
    });

    const watcher = await join(session.code);
    const hostConn = await connect(session.sessionCode, session.hostToken);
    const participantConn = await connect(session.sessionCode, watcher.participantToken);
    try {
      // Settle past BOTH coalescing intervals (250ms lifecycle, 1s results):
      // under full-suite load the interaction.open lifecycle flush can fire
      // late and land after a shorter clear, breaking the silence assertion.
      await new Promise((resolve) => setTimeout(resolve, 1400));
      hostConn.frames.length = 0;
      participantConn.frames.length = 0;

      await simulateWake(session.sessionCode);

      const other = await join(session.code);
      await command(session.sessionCode, other.participantToken, {
        command: 'answer.submit',
        interactionId: 'warmup',
        answer: { kind: 'choice', optionIds: ['b'] },
      });

      const hostSaw = await waitFor(() => hostConn.frames.length > 0, 2500);
      expect(hostSaw).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(participantConn.frames.length).toBe(0);
    } finally {
      hostConn.ws.close();
      participantConn.ws.close();
    }
  });

  it('flushes a coalesced Q&A results tick after wake using durable meta', async () => {
    const qnaOutline = { ...SMOKE_OUTLINE, qna: { enabled: true } };
    const session = await createSessionWithOutline(qnaOutline);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });

    const participant = await join(session.code);
    const { ws, frames } = await connect(session.sessionCode, participant.participantToken);
    try {
      await new Promise((resolve) => setTimeout(resolve, 260));

      // Make the results channel hot so qna.ask coalesces into an alarm.
      await runInDurableObject(stubFor(session.sessionCode), async (_instance, state) => {
        state.storage.sql.exec(
          "INSERT INTO meta (k, v) VALUES ('lastResults', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
          String(Date.now()),
        );
      });

      frames.length = 0;
      const askRes = await command(session.sessionCode, participant.participantToken, {
        command: 'qna.ask',
        questionId: 'q-hibernate',
        text: 'Will this survive hibernation?',
      });
      expect(askRes.status).toBe(200);

      const armed = await runInDurableObject(stubFor(session.sessionCode), async (_instance, state) => {
        const pendingAt = state.storage.sql
          .exec<{ v: string }>("SELECT v FROM meta WHERE k = 'pendingResultsAt'")
          .toArray()[0]?.v;
        const qnaFlag = state.storage.sql
          .exec<{ v: string }>("SELECT v FROM meta WHERE k = 'pendingResultsQna'")
          .toArray()[0]?.v;
        return { pendingAt: Number(pendingAt ?? 0), qnaFlag: Number(qnaFlag ?? 0) };
      });
      expect(armed.pendingAt).toBeGreaterThan(0);
      expect(armed.qnaFlag).toBe(1);
      expect(frames.length).toBe(0);

      // Drop in-memory pendingRevision / fan-out flag; meta must drive the flush.
      await simulateWake(session.sessionCode);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      expect(await runDurableObjectAlarm(stubFor(session.sessionCode))).toBe(true);

      const sawIt = await waitFor(() => frames.some((frame) => frame.type === 'session.changed'), 2000);
      expect(sawIt).toBe(true);
    } finally {
      ws.close();
    }
  });
});
