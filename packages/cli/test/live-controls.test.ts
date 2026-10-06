/**
 * CLI parity for the host's live controls: freeze/unfreeze and per-entry
 * hide/unhide, plus the `results` rendering that makes the participantId
 * argument of `hide` discoverable.
 *
 * Same shape as session.test.ts: a throwaway HTTP server records every request
 * so the exact command JSON on the wire can be asserted.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { run } from '../src/run.js';
import type { Io } from '../src/output.js';

interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body: unknown;
}

const received: Recorded[] = [];
let server: Server;
let baseUrl: string;

function handler(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: unknown = null;
    if (raw !== '') {
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        body = raw;
      }
    }
    received.push({
      method: req.method ?? '',
      url: req.url ?? '',
      headers: req.headers as Record<string, string | undefined>,
      body,
    });

    const url = req.url ?? '';
    const send = (status: number, payload: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (req.method === 'POST' && url === '/api/my/sessions/CODE1234/facilitate') {
      send(200, { sessionCode: 'CODE1234', code: 'CODE1234', hostToken: 'joined-host', stageToken: 'joined-stage', facilitation: { canPresent: false } });
      return;
    }
    if (url === '/api/sessions/CODE1234/recap') {
      send(200, req.method === 'GET' ? { revision: 11, title: 'Workshop', results: [], discussion: [], questions: [] } : { title: 'Workshop', results: [], discussionPoints: [], questions: [], discussion: '', followUp: 'Run a pilot' });
      return;
    }
    if (req.method === 'POST' && url === '/api/sessions') {
      send(200, {
        sessionCode: 'CODE1234',
        code: 'CODE1234',
        hostToken: 'host-token',
        stageToken: 'stage-token',
        joinUrl: `${baseUrl}/?code=CODE1234`,
      });
      return;
    }
    if (req.method === 'POST' && url.endsWith('/commands')) {
      send(200, { ok: true, revision: 11 });
      return;
    }
    if (req.method === 'GET' && url.includes('/state')) {
      send(200, {
        role: 'host',
        revision: 11,
        status: 'live',
        frozen: true,
        sessionCode: 'CODE1234',
        code: 'CODE1234',
        activeInteractionId: 'reflect',
        participantCount: 3,
        answeredCount: 3,
        interactions: [
          {
            id: 'reflect',
            type: 'text',
            prompt: 'One word',
            status: 'open',
            answered: 2,
            aggregate: {
              kind: 'text',
              entries: [
                { participantId: 'p-alpha', text: 'curious', hidden: false },
                { participantId: 'p-beta', text: 'rude thing', hidden: true },
              ],
              total: 2,
            },
          },
          {
            id: 'priorities',
            type: 'ranking',
            prompt: 'Order these',
            status: 'closed',
            answered: 4,
            aggregate: {
              kind: 'ranking',
              scores: { alpha: 9, beta: 8, gamma: 7 },
              avgRank: { alpha: 1.75, beta: 2, gamma: 2.25 },
              total: 4,
              dontKnow: 1,
            },
          },
          {
            id: 'vote',
            type: 'choice',
            prompt: 'Peer instruction vote',
            status: 'open',
            answered: 3,
            round: 2,
            aggregate: { kind: 'choice', counts: { right: 3, wrong: 0 }, total: 3, dontKnow: 0 },
            round1Aggregate: {
              kind: 'choice',
              counts: { right: 1, wrong: 2 },
              total: 3,
              dontKnow: 0,
            },
          },
          {
            id: 'ask',
            type: 'qna',
            prompt: 'Ask anything',
            status: 'open',
            answered: 1,
            aggregate: {
              kind: 'qna',
              entries: [{ participantId: 'p-gamma', text: 'Why now?', hidden: false, votes: 4 }],
              total: 1,
            },
          },
        ],
      });
      return;
    }
    send(404, { ok: false, error: { code: 'E_NOT_FOUND', message: 'nope' } });
  });
}

beforeAll(async () => {
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let dir: string;
const previousCwd = process.cwd();

beforeEach(() => {
  received.length = 0;
  dir = mkdtempSync(join(tmpdir(), 'openroom-cli-live-'));
  process.chdir(dir);
});

afterAll(() => {
  process.chdir(previousCwd);
});

function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }, out, err };
}

async function startSession(): Promise<void> {
  await run(['init'], { io: capture().io });
  const code = await run(
    ['session', 'start', 'session.yaml', '--url', baseUrl, '--admin-key', 'secret'],
    { io: capture().io },
  );
  expect(code).toBe(0);
}

function commandsSent(): Record<string, unknown>[] {
  return received
    .filter((r) => r.url.endsWith('/commands'))
    .map((r) => (r.body as { command: Record<string, unknown> }).command);
}

it('reads recap choices, sends an explicit selection with host authority and writes the shareable artifact', async () => {
  await startSession();
  const captured = capture();
  expect(await run(['session', 'recap'], { io: captured.io })).toBe(0);
  expect(JSON.parse(captured.out[0]!)).toMatchObject({ revision: 11 });
  const selection = { revision: 11, title: 'Workshop', resultIds: [], discussionIds: [], questionIds: [], discussion: '', followUp: 'Run a pilot' };
  writeFileSync(join(dir, 'selection.json'), JSON.stringify(selection));
  expect(await run(['session', 'recap', '--selection', 'selection.json', '--format', 'html', '--out', 'recap.html'], { io: capture().io })).toBe(0);
  expect(received.at(-1)).toMatchObject({ method: 'POST', url: '/api/sessions/CODE1234/recap', headers: { authorization: 'Bearer host-token' }, body: selection });
  expect(readFileSync(join(dir, 'recap.html'), 'utf8')).toContain('Run a pilot');
});

describe('session theme over the CLI', () => {
  it('sends session.theme for every built-in id', async () => {
    await startSession();
    for (const theme of ['default', 'chalkboard', 'paper', 'projector', 'sherbet']) {
      expect(await run(['session', 'theme', theme], { io: capture().io })).toBe(0);
    }
    expect(commandsSent()).toEqual([
      { command: 'session.theme', theme: 'default' },
      { command: 'session.theme', theme: 'chalkboard' },
      { command: 'session.theme', theme: 'paper' },
      { command: 'session.theme', theme: 'projector' },
      { command: 'session.theme', theme: 'sherbet' },
    ]);
  });

  it('a missing or unknown theme is a usage error (exit 2) and sends nothing', async () => {
    await startSession();
    const missing = capture();
    expect(await run(['session', 'theme'], { io: missing.io })).toBe(2);
    const unknown = capture();
    expect(await run(['session', 'theme', 'neon'], { io: unknown.io })).toBe(2);
    expect(unknown.err.join('\n')).toContain('neon');
    expect(commandsSent()).toEqual([]);
  });

  it('--json reports the command that was sent', async () => {
    await startSession();
    const io = capture();
    expect(await run(['session', 'theme', 'chalkboard', '--json'], { io: io.io })).toBe(0);
    const payload = JSON.parse(io.out.join('')) as {
      ok: boolean;
      command: { command: string; theme: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.command).toEqual({ command: 'session.theme', theme: 'chalkboard' });
  });

});

describe('host live controls over the CLI', () => {
  it('assigns and dissolves a group using the stored host capability', async () => {
    await startSession();
    const group = { id: 'north', name: 'North', memberIds: ['participant-1'], spokespersonId: 'participant-1' };
    writeFileSync('group.json', JSON.stringify(group));
    expect(await run(['session', 'group-set', 'group.json'], { io: capture().io })).toBe(0);
    expect(await run(['session', 'group-remove', 'north'], { io: capture().io })).toBe(0);
    expect(commandsSent()).toEqual([{ command: 'group.set', group }, { command: 'group.remove', groupId: 'north' }]);
    expect(received.filter((item) => item.url.endsWith('/commands')).every((item) => item.headers.authorization === 'Bearer host-token')).toBe(true);
  });

  it('facilitates using account auth then hands off with its session capability', async () => {
    expect(await run(['session', 'facilitate', 'CODE1234', '--url', baseUrl, '--token', 'orpat_personal'], { io: capture().io })).toBe(0);
    expect(received[0]?.url).toBe('/api/my/sessions/CODE1234/facilitate');
    expect(received[0]?.headers.authorization).toBe('Bearer orpat_personal');
    expect(await run(['session', 'handoff', 'other'], { io: capture().io })).toBe(0);
    expect(await run(['session', 'recover'], { io: capture().io })).toBe(0);
    expect(commandsSent()).toEqual([{ command: 'presentation.handoff', facilitatorId: 'other' }, { command: 'presentation.recover' }]);
    expect(received.filter((item) => item.url.endsWith('/commands')).every((item) => item.headers.authorization === 'Bearer joined-host')).toBe(true);
  });

  it('freeze and unfreeze send the bare session commands', async () => {
    await startSession();
    expect(await run(['session', 'freeze'], { io: capture().io })).toBe(0);
    expect(await run(['session', 'unfreeze'], { io: capture().io })).toBe(0);

    expect(commandsSent()).toEqual([{ command: 'session.freeze' }, { command: 'session.unfreeze' }]);

    const sent = received.filter((r) => r.url.endsWith('/commands'));
    expect(sent[0]?.url).toBe('/api/sessions/CODE1234/commands');
    expect(sent[0]?.headers['authorization']).toBe('Bearer host-token');
    const keys = sent.map((r) => (r.body as { idempotencyKey: string }).idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  it('hide and unhide send text.hide / text.unhide with both ids', async () => {
    await startSession();
    expect(await run(['session', 'hide', 'reflect', 'p-beta'], { io: capture().io })).toBe(0);
    expect(await run(['session', 'unhide', 'reflect', 'p-beta'], { io: capture().io })).toBe(0);

    expect(commandsSent()).toEqual([
      { command: 'text.hide', interactionId: 'reflect', participantId: 'p-beta' },
      { command: 'text.unhide', interactionId: 'reflect', participantId: 'p-beta' },
    ]);
  });

  it('the envelope carries nothing but the key and the command', async () => {
    await startSession();
    const cap = capture();
    expect(await run(['session', 'hide', 'reflect', 'p-beta', '--json'], { io: cap.io })).toBe(0);

    const sent = received.find((r) => r.url.endsWith('/commands'));
    const envelope = sent?.body as { idempotencyKey: string };
    expect(Object.keys(envelope).sort()).toEqual(['command', 'idempotencyKey']);
    expect(envelope.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(JSON.parse(cap.out[0] as string)).toMatchObject({
      ok: true,
      command: { command: 'text.hide', interactionId: 'reflect', participantId: 'p-beta' },
    });
  });

  it('hide without a participantId is a usage error (exit 2)', async () => {
    await startSession();
    const cap = capture();
    expect(await run(['session', 'hide', 'reflect'], { io: cap.io })).toBe(2);
    expect(cap.err.join('\n')).toContain('usage: openroom session hide <interactionId> <participantId>');
    expect(commandsSent()).toEqual([]);
  });

  it('results prints the participantId and hidden flag of text and Q&A entries', async () => {
    await startSession();
    const cap = capture();
    expect(await run(['results'], { io: cap.io })).toBe(0);
    const output = cap.out.join('\n');
    expect(output).toContain('[p-alpha] curious');
    expect(output).toContain('[p-beta] (hidden) rude thing');
    expect(output).toContain('[p-gamma] Why now? (+4)');
  });

  it('revote sends interaction.revote for the given interaction', async () => {
    await startSession();
    expect(await run(['session', 'revote', 'vote'], { io: capture().io })).toBe(0);
    expect(commandsSent()).toEqual([{ command: 'interaction.revote', interactionId: 'vote' }]);
  });

  it('revote without an interactionId is a usage error (exit 2)', async () => {
    await startSession();
    const cap = capture();
    expect(await run(['session', 'revote'], { io: cap.io })).toBe(2);
    expect(cap.err.join('\n')).toContain('usage: openroom session revote <interactionId>');
    expect(commandsSent()).toEqual([]);
  });

  it('results renders a ranking aggregate as an ordered list with scores', async () => {
    await startSession();
    const cap = capture();
    expect(await run(['results'], { io: cap.io })).toBe(0);
    const output = cap.out.join('\n');
    expect(output).toContain('priorities [ranking/closed] answered=4');
    expect(output).toContain('1. alpha: 9 pts (avg rank 1.75)');
    expect(output).toContain('2. beta: 8 pts (avg rank 2.00)');
    expect(output).toContain('3. gamma: 7 pts (avg rank 2.25)');
    expect(output).toContain("total 4, don't know 1");
  });

});
