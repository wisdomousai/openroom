/**
 * WebSocket notify channel: coalesced session.changed broadcasts.
 */
import { describe, expect, it, vi } from 'vitest';

import { BASE, SMOKE_OUTLINE, command, createLiveSession, createSessionWithOutline, join, stateJson, waitFor } from './helpers.js';
import worker from '../src/index.js';
import { SessionDO } from '../src/session-do.js';
import { env } from 'cloudflare:test';

interface SessionChangedFrame {
  v: 1;
  type: 'session.changed';
  revision: number;
}

async function connect(sessionCode: string, token: string): Promise<{ ws: WebSocket; frames: SessionChangedFrame[] }> {
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
    frames.push(JSON.parse(event.data as string));
  });
  return { ws, frames };
}

describe('websocket notify', () => {
  it.each([undefined, 1000])('completes a client close handshake with status %s', async (code) => {
    const session = await createLiveSession();
    const participant = await join(session.code);
    const { ws } = await connect(session.sessionCode, participant.participantToken);
    const closed: number[] = [];
    ws.addEventListener('close', (event: CloseEvent) => { closed.push(event.code); });
    ws.close(code);
    expect(await waitFor(() => ws.readyState === WebSocket.CLOSED, 2000)).toBe(true);
    expect(closed).toEqual([1000]);
  });

  it('notifies a connected participant of session.changed with an increasing revision when the host opens an interaction', async () => {
    const session = await createLiveSession();
    const participant = await join(session.code);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });

    const { ws, frames } = await connect(session.sessionCode, participant.participantToken);
    try {
      const before = await stateJson(session.sessionCode, participant.participantToken, 'participant');

      await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'warmup' });

      const sawIt = await waitFor(
        () => frames.some((frame) => frame.type === 'session.changed' && frame.revision > before.revision),
        2000,
      );
      expect(sawIt).toBe(true);
    } finally {
      ws.close();
    }
  });

  it('coalesces a burst of rapid submissions into far fewer host-facing frames than submissions', async () => {
    // Ballots ride the results channel (1s coalescing) and reach only host and
    // stage sockets — the host watcher here should see a trickle, not the burst.
    const session = await createLiveSession();
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'warmup' });

    const { ws, frames } = await connect(session.sessionCode, session.hostToken);
    try {
      // let the connection settle, and let any broadcast from the open() above drain
      await new Promise((resolve) => setTimeout(resolve, 260));
      frames.length = 0;

      const participants = await Promise.all(Array.from({ length: 10 }, () => join(session.code)));
      const burstStart = Date.now();
      await Promise.all(
        participants.map((p, i) =>
          command(session.sessionCode, p.participantToken, {
            command: 'answer.submit',
            interactionId: 'warmup',
            answer: { kind: 'choice', optionIds: [i % 2 === 0 ? 'a' : 'b'] },
          }),
        ),
      );
      const burstElapsed = Date.now() - burstStart;
      expect(burstElapsed).toBeLessThan(250);

      // give the results coalescing alarm (1s) time to fire and flush the tail
      await new Promise((resolve) => setTimeout(resolve, 1300));

      expect(frames.length).toBeGreaterThan(0);
      expect(frames.length).toBeLessThan(10);
    } finally {
      ws.close();
    }
  });

  it('sends a participant NO frames for ballots while results are hidden', async () => {
    // SMOKE_OUTLINE's warmup normalizes to resultVisibility 'hidden-until-close':
    // a participant can learn nothing from other people's ballots, so their
    // socket must stay silent through joins and submissions alike.
    const session = await createLiveSession();
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'warmup' });

    const watcher = await join(session.code);
    const { ws, frames } = await connect(session.sessionCode, watcher.participantToken);
    try {
      await new Promise((resolve) => setTimeout(resolve, 260));
      frames.length = 0;

      const others = await Promise.all(Array.from({ length: 3 }, () => join(session.code)));
      await Promise.all(
        others.map((p) =>
          command(session.sessionCode, p.participantToken, {
            command: 'answer.submit',
            interactionId: 'warmup',
            answer: { kind: 'choice', optionIds: ['a'] },
          }),
        ),
      );

      // long enough for the 1s results alarm to have flushed to host/stage
      await new Promise((resolve) => setTimeout(resolve, 1300));
      expect(frames.length).toBe(0);
    } finally {
      ws.close();
    }
  });

  it('includes participants in ballot notifications when results are live-visible', async () => {
    const liveOutline = {
      ...SMOKE_OUTLINE,
      interactions: [{ ...SMOKE_OUTLINE.interactions[0], resultVisibility: 'live' }],
    };
    const session = await createSessionWithOutline(liveOutline);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'warmup' });

    const watcher = await join(session.code);
    const { ws, frames } = await connect(session.sessionCode, watcher.participantToken);
    try {
      await new Promise((resolve) => setTimeout(resolve, 260));
      frames.length = 0;

      const other = await join(session.code);
      await command(session.sessionCode, other.participantToken, {
        command: 'answer.submit',
        interactionId: 'warmup',
        answer: { kind: 'choice', optionIds: ['a'] },
      });

      const sawIt = await waitFor(() => frames.length > 0, 2500);
      expect(sawIt).toBe(true);
    } finally {
      ws.close();
    }
  });

  it('answers the SDK keepalive "ping" with "pong" via auto-response, without invoking webSocketMessage', async () => {
    // The runtime's setWebSocketAutoResponse pair must handle the keepalive on
    // its own — webSocketMessage staying untouched is what lets a hibernated
    // session answer pings for free instead of accruing billable duration.
    const messageSpy = vi.spyOn(SessionDO.prototype, 'webSocketMessage');
    const session = await createLiveSession();
    const participant = await join(session.code);

    const res = await worker.fetch(
      new Request(`${BASE}/api/sessions/${session.sessionCode}/ws?token=${encodeURIComponent(participant.participantToken)}`, {
        headers: { upgrade: 'websocket' },
      }),
      env as never,
    );
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    if (ws === null) throw new Error('expected a websocket in the upgrade response');
    ws.accept();
    const raw: string[] = [];
    ws.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data === 'string') raw.push(event.data);
    });
    try {
      ws.send('ping');
      const gotPong = await waitFor(() => raw.includes('pong'), 2000);
      expect(gotPong).toBe(true);
      expect(messageSpy).not.toHaveBeenCalled();
    } finally {
      ws.close();
      messageSpy.mockRestore();
    }
  });

  it('reflects an ended session in the state fetch after session.end', async () => {
    const session = await createLiveSession();
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    const endRes = await command(session.sessionCode, session.hostToken, { command: 'session.end' });
    expect(endRes.status).toBe(200);

    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.status).toBe('ended');
  });
});
