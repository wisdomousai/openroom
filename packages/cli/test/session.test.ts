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
    const send = (status: number, payload: unknown, contentType = 'application/json'): void => {
      res.writeHead(status, { 'content-type': contentType });
      res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
    };

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
      send(200, { ok: true, revision: 7 });
      return;
    }
    if (req.method === 'GET' && url.includes('/state')) {
      send(200, {
        role: 'host',
        revision: 7,
        status: 'live',
        frozen: false,
        sessionCode: 'CODE1234',
        code: 'CODE1234',
        activeInteractionId: 'warm-up',
        participantCount: 12,
        answeredCount: 9,
        interactions: [
          {
            id: 'warm-up',
            type: 'choice',
            prompt: 'p',
            status: 'open',
            answered: 9,
            aggregate: {
              kind: 'choice',
              counts: { 'need-an-idea': 5, 'need-funding': 4 },
              total: 9,
              dontKnow: 0,
            },
          },
        ],
      });
      return;
    }
    if (req.method === 'GET' && url.includes('/export')) {
      if (url.includes('format=csv')) {
        send(200, 'interactionId,optionId,count\nwarm-up,need-an-idea,5\n', 'text/csv');
      } else {
        send(200, { sessionCode: 'CODE1234', results: [] });
      }
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
  dir = mkdtempSync(join(tmpdir(), 'openroom-cli-session-'));
  process.chdir(dir);
});

function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }, out, err };
}

afterAll(() => {
  process.chdir(previousCwd);
});

async function startSession(): Promise<void> {
  await run(['init'], { io: capture().io });
  const cap = capture();
  const code = await run(
    ['session', 'start', 'session.yaml', '--url', baseUrl, '--admin-key', 'secret'],
    { io: cap.io },
  );
  expect(code).toBe(0);
}

describe('session commands against a mock server', () => {
  it('start posts the session with the admin header and saves state', async () => {
    await startSession();

    const create = received.find((r) => r.url === '/api/sessions');
    expect(create?.method).toBe('POST');
    expect(create?.headers['x-openroom-admin']).toBe('secret');
    const body = create?.body as { outline: { version: number; interactions: unknown[] } };
    expect(body.outline.version).toBe(1);
    expect(body.outline.interactions).toHaveLength(3);

    const state = JSON.parse(readFileSync(join(dir, '.openroom.json'), 'utf8')) as {
      sessionCode: string;
      code: string;
      hostToken: string;
      url: string;
      stageUrl: string;
    };
    expect(state).toMatchObject({
      sessionCode: 'CODE1234',
      code: 'CODE1234',
      hostToken: 'host-token',
      url: baseUrl,
    });
    expect(state.stageUrl).toContain('/stage/?session=CODE1234&token=stage-token');
  });

  it('open sends { idempotencyKey, command } with a bearer host token', async () => {
    await startSession();
    const cap = capture();
    expect(await run(['session', 'open', 'warm-up', '--json'], { io: cap.io })).toBe(0);

    const sent = received.find((r) => r.url.endsWith('/commands'));
    expect(sent?.url).toBe('/api/sessions/CODE1234/commands');
    expect(sent?.headers['authorization']).toBe('Bearer host-token');
    const envelope = sent?.body as { idempotencyKey: string; command: Record<string, unknown> };
    expect(Object.keys(envelope).sort()).toEqual(['command', 'idempotencyKey']);
    expect(envelope.command).toEqual({ command: 'interaction.open', interactionId: 'warm-up' });
    expect(envelope.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    expect(cap.out).toHaveLength(1);
    expect(JSON.parse(cap.out[0] as string)).toMatchObject({ ok: true });
  });

  it('advance and end send the session commands, each with a fresh key', async () => {
    await startSession();
    await run(['session', 'advance'], { io: capture().io });
    await run(['session', 'end'], { io: capture().io });

    const commands = received.filter((r) => r.url.endsWith('/commands'));
    expect(commands.map((c) => (c.body as { command: { command: string } }).command.command)).toEqual(
      ['session.advance', 'session.end'],
    );
    const keys = commands.map((c) => (c.body as { idempotencyKey: string }).idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  it('navigates outline steps and inserts a tutor-approved generated step', async () => {
    await startSession();
    await run(['session', 'outline-next'], { io: capture().io });
    await run(['session', 'outline-previous'], { io: capture().io });
    await run(['session', 'outline-goto', 'practice'], { io: capture().io });
    writeFileSync(join(dir, 'step.yaml'), `id: extra-words
kind: cards
title: Pick three words
items:
  - text: toujours
  - text: parfois
  - text: jamais
`, 'utf8');
    await run(
      ['session', 'outline-insert', 'step.yaml', '--after', 'practice', '--show'],
      { io: capture().io },
    );

    const commands = received
      .filter((r) => r.url.endsWith('/commands'))
      .map((entry) => (entry.body as { command: Record<string, unknown> }).command);
    expect(commands).toEqual([
      { command: 'outline.next' },
      { command: 'outline.previous' },
      { command: 'outline.goto', stepId: 'practice' },
      {
        command: 'outline.insert',
        afterStepId: 'practice',
        show: true,
        step: {
          id: 'extra-words',
          kind: 'cards',
          title: 'Pick three words',
          items: [{ text: 'toujours' }, { text: 'parfois' }, { text: 'jamais' }],
        },
      },
    ]);
  });

  it('status and results read the host snapshot', async () => {
    await startSession();
    const status = capture();
    expect(await run(['session', 'status'], { io: status.io })).toBe(0);
    expect(received.some((r) => r.url === '/api/sessions/CODE1234/state?role=host')).toBe(true);
    expect(status.out.join('\n')).toContain('joined:   12   answered: 9');

    const results = capture();
    expect(await run(['results'], { io: results.io })).toBe(0);
    expect(results.out.join('\n')).toContain('need-an-idea: 5');
  });

  it('export writes csv to --out', async () => {
    await startSession();
    const cap = capture();
    expect(await run(['export', '--format', 'csv', '--out', 'out.csv'], { io: cap.io })).toBe(0);
    expect(readFileSync(join(dir, 'out.csv'), 'utf8')).toContain('warm-up,need-an-idea,5');
  });

  it('fails with exit 1 when no session state exists', async () => {
    const cap = capture();
    expect(await run(['session', 'status', '--json'], { io: cap.io })).toBe(1);
    expect(JSON.parse(cap.out[0] as string)).toMatchObject({ ok: false });
  });
});
