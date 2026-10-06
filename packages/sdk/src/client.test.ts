import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createSessionClient, joinSession } from './client.js';
import type { FetchLike, WebSocketLike } from './client.js';
import type { ParticipantSnapshot } from './types.js';

function snap(revision: number, open = true): ParticipantSnapshot {
  return {
    revision,
    status: 'live',
    frozen: false,
    interaction: { id: 'q1', type: 'text', prompt: 'Hi?' },
    interactionStatus: open ? 'open' : 'closed',
    answered: false,
    ownAnswer: null,
    aggregate: null,
  };
}

interface Call {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

class FakeSocket implements WebSocketLike {
  static last: FakeSocket | null = null;
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  closed = false;
  sent: string[] = [];
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(data: string): void {
    this.sent.push(data);
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  message(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  fail(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.last = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createSessionClient', () => {
  it('fetches the initial snapshot with role + bearer token and reports live on WS open', async () => {
    const calls: Call[] = [];
    const fetchFake: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return jsonRes(200, snap(4));
    };
    const statuses: string[] = [];
    const changes: number[] = [];
    const client = createSessionClient<ParticipantSnapshot>({
      baseUrl: 'https://api.test',
      sessionCode: 'SESS1234',
      token: 'tok',
      role: 'participant',
      fetch: fetchFake,
      WebSocket: FakeSocket,
      onStatus: (s) => statuses.push(s),
      onChange: (s) => changes.push(s.revision),
    });
    await flush();

    expect(calls[0]?.url).toBe('https://api.test/api/sessions/SESS1234/state?role=participant');
    expect(calls[0]?.init?.headers?.authorization).toBe('Bearer tok');
    expect(changes).toEqual([4]);
    expect(statuses[0]).toBe('connecting');

    FakeSocket.last?.open();
    await flush();
    expect(client.getStatus()).toBe('live');
    // Second call is the catch-up fetch, carrying afterRevision.
    expect(calls[1]?.url).toContain('afterRevision=4');
    client.close();
  });

  it('sends a "ping" keepalive every 30s while live and stops after close', async () => {
    const fetchFake: FetchLike = async () => jsonRes(200, snap(4));
    const client = createSessionClient<ParticipantSnapshot>({
      baseUrl: 'https://api.test',
      sessionCode: 'SESS1234',
      token: 'tok',
      role: 'participant',
      fetch: fetchFake,
      WebSocket: FakeSocket,
    });
    await flush();
    const sock = FakeSocket.last;
    if (!sock) throw new Error('expected a socket');
    sock.open();
    await flush();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(sock.sent).toEqual(['ping']);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sock.sent).toEqual(['ping', 'ping']);

    // The server's auto-response answers with a bare "pong" — not JSON, must be ignored.
    sock.message('pong');
    await flush();
    expect(client.getStatus()).toBe('live');

    client.close();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sock.sent).toEqual(['ping', 'ping']);
  });

  it('stops the keepalive when the socket drops, and resumes it on the reconnected socket', async () => {
    const fetchFake: FetchLike = async () => jsonRes(200, snap(4));
    const client = createSessionClient<ParticipantSnapshot>({
      baseUrl: 'https://api.test',
      sessionCode: 'SESS1234',
      token: 'tok',
      role: 'participant',
      fetch: fetchFake,
      WebSocket: FakeSocket,
    });
    await flush();
    const first = FakeSocket.last;
    if (!first) throw new Error('expected a socket');
    first.open();
    await flush();

    first.fail();
    await vi.advanceTimersByTimeAsync(1100); // WS retry #1
    const second = FakeSocket.last;
    if (!second || second === first) throw new Error('expected a reconnected socket');
    second.open();
    await flush();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(first.sent).toEqual([]);
    expect(second.sent).toEqual(['ping']);
    client.close();
  });

  it('refetches on session.changed with a higher revision and ignores stale ones', async () => {
    let rev = 4;
    let fetches = 0;
    const fetchFake: FetchLike = async () => {
      fetches++;
      return jsonRes(200, snap(rev));
    };
    const client = createSessionClient<ParticipantSnapshot>({
      baseUrl: 'https://api.test',
      sessionCode: 'r',
      token: 't',
      role: 'participant',
      fetch: fetchFake,
      WebSocket: FakeSocket,
    });
    await flush();
    FakeSocket.last?.open();
    await flush();
    const baseline = fetches;

    FakeSocket.last?.message({ v: 1, type: 'session.changed', revision: 4 });
    await flush();
    expect(fetches).toBe(baseline); // not newer → no refetch

    rev = 5;
    FakeSocket.last?.message({ v: 1, type: 'session.changed', revision: 5 });
    await flush();
    expect(fetches).toBe(baseline + 1);
    expect(client.getSnapshot()?.revision).toBe(5);
    client.close();
  });

  it('falls back to polling after two WS failures and restores on reconnect', async () => {
    let fetches = 0;
    const fetchFake: FetchLike = async () => {
      fetches++;
      return jsonRes(200, snap(1));
    };
    const statuses: string[] = [];
    const client = createSessionClient<ParticipantSnapshot>({
      baseUrl: 'https://api.test',
      sessionCode: 'r',
      token: 't',
      role: 'participant',
      fetch: fetchFake,
      WebSocket: FakeSocket,
      isHidden: () => false,
      onStatus: (s) => statuses.push(s),
    });
    await flush();

    FakeSocket.last?.fail();
    await flush();
    expect(client.getStatus()).not.toBe('polling');

    await vi.advanceTimersByTimeAsync(1100); // WS retry #1
    FakeSocket.last?.fail();
    await flush();
    expect(client.getStatus()).toBe('polling');

    const before = fetches;
    await vi.advanceTimersByTimeAsync(1600); // 1.5s active poll
    expect(fetches).toBeGreaterThan(before);

    // WS comes back → polling stops.
    await vi.advanceTimersByTimeAsync(2100);
    FakeSocket.last?.open();
    await flush();
    expect(client.getStatus()).toBe('live');
    const afterRestore = fetches;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetches).toBe(afterRestore);
    expect(statuses).toContain('polling');
    client.close();
  });

  it('polls slower when the interaction is closed and slowest when hidden', async () => {
    let hidden = false;
    let fetches = 0;
    const fetchFake: FetchLike = async () => {
      fetches++;
      return jsonRes(200, snap(1, false));
    };
    const client = createSessionClient<ParticipantSnapshot>({
      baseUrl: 'https://api.test',
      sessionCode: 'r',
      token: 't',
      role: 'participant',
      fetch: fetchFake,
      WebSocket: null, // no WS support at all → straight to polling
      isHidden: () => hidden,
    });
    await flush();
    expect(client.getStatus()).toBe('polling');

    let before = fetches;
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetches).toBe(before); // idle interval is 6s, not 1.5s
    await vi.advanceTimersByTimeAsync(4500);
    expect(fetches).toBeGreaterThan(before);

    hidden = true;
    await vi.advanceTimersByTimeAsync(6500); // drain the already-scheduled tick
    before = fetches;
    await vi.advanceTimersByTimeAsync(9000);
    expect(fetches).toBe(before); // hidden interval is 15s
    await vi.advanceTimersByTimeAsync(7000);
    expect(fetches).toBeGreaterThan(before);
    client.close();
  });

  it('submits with an auto idempotency key and retries once with the SAME key', async () => {
    const bodies: string[] = [];
    let posts = 0;
    const fetchFake: FetchLike = async (url, init) => {
      if (init?.method === 'POST') {
        posts++;
        bodies.push(init.body ?? '');
        if (posts === 1) throw new TypeError('network down');
        return jsonRes(200, { ok: true, revision: 9 });
      }
      return jsonRes(200, snap(1));
    };
    const client = createSessionClient<ParticipantSnapshot>({
      baseUrl: 'https://api.test',
      sessionCode: 'r',
      token: 't',
      role: 'participant',
      fetch: fetchFake,
      WebSocket: null,
      randomUUID: () => 'fixed-key',
    });
    await flush();

    const result = await client.submit({
      command: 'answer.submit',
      interactionId: 'q1',
      answer: { kind: 'text', text: 'hello' },
    });
    expect(result).toEqual({ ok: true, revision: 9 });
    expect(posts).toBe(2);
    expect(JSON.parse(bodies[0]!).idempotencyKey).toBe('fixed-key');
    expect(JSON.parse(bodies[1]!).idempotencyKey).toBe('fixed-key');
    client.close();
  });

  it('surfaces domain errors from a rejected command', async () => {
    const fetchFake: FetchLike = async (_url, init) =>
      init?.method === 'POST'
        ? jsonRes(409, { ok: false, error: { code: 'E_REVISION_CONFLICT', message: 'stale' } })
        : jsonRes(200, snap(1));
    const client = createSessionClient<ParticipantSnapshot>({
      baseUrl: 'https://api.test',
      sessionCode: 'r',
      token: 't',
      role: 'participant',
      fetch: fetchFake,
      WebSocket: null,
    });
    await flush();
    const res = await client.submit({ command: 'session.advance' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('E_REVISION_CONFLICT');
    client.close();
  });

  it('treats a 304 as "no change" and stops all work after close()', async () => {
    let fetches = 0;
    const fetchFake: FetchLike = async () => {
      fetches++;
      return fetches === 1 ? jsonRes(200, snap(3)) : jsonRes(304, {});
    };
    const changes: number[] = [];
    const client = createSessionClient<ParticipantSnapshot>({
      baseUrl: 'https://api.test',
      sessionCode: 'r',
      token: 't',
      role: 'participant',
      fetch: fetchFake,
      WebSocket: null,
      onChange: (s) => changes.push(s.revision),
    });
    await flush();
    await vi.advanceTimersByTimeAsync(1600);
    await flush();
    expect(changes).toEqual([3]);

    client.close();
    const after = fetches;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetches).toBe(after);
  });
});

describe('joinSession', () => {
  it('POSTs an uppercased code to /api/join', async () => {
    const calls: Call[] = [];
    const fetchFake: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return jsonRes(200, { sessionCode: 'AB', participantToken: 'p', participantId: 'x' });
    };
    const res = await joinSession('https://api.test/', ' ab12cd34 ', fetchFake);
    expect(calls[0]?.url).toBe('https://api.test/api/join');
    expect(JSON.parse(calls[0]?.init?.body ?? '{}').code).toBe('AB12CD34');
    expect(res.participantToken).toBe('p');
  });

  it('throws a JoinError carrying the server message', async () => {
    const fetchFake: FetchLike = async () =>
      jsonRes(404, { error: { code: 'E_NOT_FOUND', message: 'No such session' } });
    await expect(joinSession('https://api.test', 'ZZZZZZZZ', fetchFake)).rejects.toThrow(
      'No such session',
    );
  });

  it('sends a trimmed recovery handle when rejoining', async () => {
    const calls: Call[] = [];
    const fetchFake: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return jsonRes(200, {
        sessionCode: 'AB12CD34',
        participantToken: 'p2',
        participantId: 'same-participant',
        handle: 'Amber Fox 4827',
      });
    };

    await joinSession('https://api.test', 'ab12cd34', {
      fetch: fetchFake,
      recoveryHandle: '  Amber Fox 4827  ',
    });

    expect(JSON.parse(calls[0]?.init?.body ?? '{}')).toEqual({
      code: 'AB12CD34',
      recoveryHandle: 'Amber Fox 4827',
    });
  });

  it('uses a top-level server message for handle recovery errors', async () => {
    const fetchFake: FetchLike = async () =>
      jsonRes(404, { error: 'handle-not-found', message: 'That handle is not in this session.' });

    await expect(
      joinSession('https://api.test', 'AB12CD34', {
        fetch: fetchFake,
        recoveryHandle: 'Amber Fox 4827',
      }),
    ).rejects.toThrow('That handle is not in this session.');
  });
});
