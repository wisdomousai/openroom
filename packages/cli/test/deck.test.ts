import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../src/api.js';
import type { Io } from '../src/output.js';
import { run } from '../src/run.js';

function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) }, out, err };
}

const PLAN = `version: 1
meta:
  title: French B1
steps:
  - id: welcome
    kind: title
    title: Bonjour
  - id: check
    kind: interaction
    interactionId: q1
interactions:
  - id: q1
    type: text
    prompt: Comment ca va?
`;

const OUTLINE = {
  version: 1,
  meta: { title: 'French B1' },
  steps: [
    { id: 'welcome', kind: 'title', title: 'Bonjour' },
    { id: 'check', kind: 'interaction', interactionId: 'q1' },
  ],
  interactions: [{ id: 'q1', type: 'text', prompt: 'Comment ca va?' }],
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Route by path so a test states what each round trip answers, not its order. */
function router(
  routes: (call: Call) => { status: number; body: unknown },
): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const raw = init?.body;
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: typeof raw === 'string' && raw !== '' ? JSON.parse(raw) : undefined,
    };
    calls.push(call);
    const { status, body } = routes(call);
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchImpl, calls };
}

const AUTH = ['--url', 'https://openroom.test', '--token', 'orpat_secret'];

function planDir(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'openroom-cli-deck-'));
  writeFileSync(join(cwd, 'plan.yaml'), PLAN, 'utf8');
  return cwd;
}

describe('openroom deck', () => {
  it('get prints the plan file as YAML on stdout and the summary on stderr', async () => {
    const { fetchImpl, calls } = router(() => ({
      status: 200,
      body: {
        deck: { id: 'd1', title: 'French B1', currentVersion: 3 },
        spaceName: 'Teaching',
        folderName: 'Camille',
        contentVersion: 3,
        content: OUTLINE,
      },
    }));
    const output = capture();
    expect(await run(['deck', 'get', 'd1', '--yaml', ...AUTH], { io: output.io, fetchImpl })).toBe(0);
    expect(calls[0]?.url).toBe('https://openroom.test/api/decks/d1');
    const yaml = output.out.join('\n');
    expect(yaml).toContain('title: French B1');
    expect(yaml).not.toContain('#');
    expect(output.err.join('\n')).toContain('version 3');
  });

  it('get passes --version through and refuses a deck with no content', async () => {
    const withVersion = router(() => ({
      status: 200,
      body: { deck: { id: 'd1' }, contentVersion: 2, content: OUTLINE },
    }));
    const first = capture();
    expect(
      await run(['deck', 'get', 'd1', '--version', '2', ...AUTH], {
        io: first.io,
        fetchImpl: withVersion.fetchImpl,
      }),
    ).toBe(0);
    expect(withVersion.calls[0]?.url).toBe('https://openroom.test/api/decks/d1?version=2');

    const empty = router(() => ({
      status: 200,
      body: { deck: { id: 'd1' }, contentVersion: null, content: null },
    }));
    const second = capture();
    expect(
      await run(['deck', 'get', 'd1', '--json', ...AUTH], {
        io: second.io,
        fetchImpl: empty.fetchImpl,
      }),
    ).toBe(1);
    expect(JSON.parse(second.out[0] as string)).toMatchObject({
      ok: false,
      error: { code: 'E_NO_CONTENT' },
    });
  });

  it('save validates locally and never sends a broken plan file', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'openroom-cli-deck-'));
    writeFileSync(join(cwd, 'plan.yaml'), 'version: 1\nmeta: {}\n', 'utf8');
    let called = false;
    const output = capture();
    const code = await run(['deck', 'save', 'd1', '--file', 'plan.yaml', '--base', '3', ...AUTH, '--json'], {
      cwd,
      io: output.io,
      fetchImpl: async () => {
        called = true;
        return new Response('{}');
      },
    });
    expect(code).toBe(1);
    expect(called).toBe(false);
    expect(JSON.parse(output.out[0] as string)).toMatchObject({
      ok: false,
      error: { code: 'E_OUTLINE_INVALID' },
    });
  });

  it('save defaults --base to the deck’s current version, read first', async () => {
    const { fetchImpl, calls } = router((call) =>
      call.method === 'GET'
        ? { status: 200, body: { deck: { id: 'd1', currentVersion: 7 } } }
        : { status: 201, body: { deckId: 'd1', version: 8 } },
    );
    const output = capture();
    const code = await run(['deck', 'save', 'd1', '--file', 'plan.yaml', ...AUTH, '--json'], {
      cwd: planDir(),
      io: output.io,
      fetchImpl,
    });
    expect(code).toBe(0);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'GET /api/decks/d1',
      'POST /api/decks/d1/versions',
    ]);
    const sent = calls[1]?.body as { content: { meta: { title: string } }; baseVersion: number };
    expect(sent.baseVersion).toBe(7);
    // The compiled outline, not the raw text: the CLI parses before it sends.
    expect(sent.content.meta.title).toBe('French B1');
    expect(JSON.parse(output.out[0] as string)).toMatchObject({ ok: true, version: 8, baseVersion: 7 });
  });

  it('save with an explicit --base skips the read and names a version conflict', async () => {
    const { fetchImpl, calls } = router(() => ({
      status: 409,
      body: { error: 'version-conflict', latestVersion: 9 },
    }));
    const output = capture();
    const code = await run(
      ['deck', 'save', 'd1', '--file', 'plan.yaml', '--base', '3', ...AUTH, '--json'],
      { cwd: planDir(), io: output.io, fetchImpl },
    );
    expect(code).toBe(1);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(output.out[0] as string)).toMatchObject({
      ok: false,
      error: { code: 'E_VERSION_CONFLICT', latestVersion: 9 },
    });
  });

  it('save reports an unchanged save without claiming a new version', async () => {
    const { fetchImpl } = router(() => ({
      status: 200,
      body: { deckId: 'd1', version: 3, unchanged: true },
    }));
    const output = capture();
    expect(
      await run(['deck', 'save', 'd1', '--file', 'plan.yaml', '--base', '3', ...AUTH, '--json'], {
        cwd: planDir(),
        io: output.io,
        fetchImpl,
      }),
    ).toBe(0);
    expect(JSON.parse(output.out[0] as string)).toMatchObject({ unchanged: true, version: 3 });
  });

  it('draft put sends the raw source untouched, even when it does not parse', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'openroom-cli-deck-'));
    writeFileSync(join(cwd, 'plan.yaml'), 'version: 1\nmeta:\n  tit', 'utf8');
    const { fetchImpl, calls } = router((call) =>
      call.method === 'GET'
        ? { status: 200, body: { deck: { id: 'd1', currentVersion: 2 } } }
        : { status: 200, body: { deckId: 'd1', savedAt: 1700 } },
    );
    const output = capture();
    expect(
      await run(['deck', 'draft', 'put', 'd1', '--file', 'plan.yaml', ...AUTH, '--json'], {
        cwd,
        io: output.io,
        fetchImpl,
      }),
    ).toBe(0);
    expect(calls[1]?.method).toBe('PUT');
    expect(calls[1]?.body).toEqual({ source: 'version: 1\nmeta:\n  tit', baseVersion: 2 });
  });

  it('draft get prints the working text and discard deletes it', async () => {
    const got = router(() => ({
      status: 200,
      body: { deckId: 'd1', source: 'version: 1\nmeta:\n  tit', baseVersion: 2, updatedAt: 1 },
    }));
    const output = capture();
    expect(await run(['deck', 'draft', 'get', 'd1', ...AUTH], { io: output.io, fetchImpl: got.fetchImpl })).toBe(0);
    expect(output.out.join('\n')).toContain('version: 1');

    const dropped = router(() => ({ status: 204, body: undefined }));
    const second = capture();
    expect(
      await run(['deck', 'draft', 'discard', 'd1', ...AUTH, '--json'], {
        io: second.io,
        fetchImpl: dropped.fetchImpl,
      }),
    ).toBe(0);
    expect(dropped.calls[0]?.method).toBe('DELETE');
    expect(JSON.parse(second.out[0] as string)).toMatchObject({ ok: true, discarded: true });
  });

  it('versions lists the stamped history newest first', async () => {
    const { fetchImpl, calls } = router(() => ({
      status: 200,
      body: {
        deckId: 'd1',
        versions: [
          { version: 2, createdAt: 1700000000000, createdBy: 'u1' },
          { version: 1, createdAt: 1600000000000, createdBy: 'u1' },
        ],
      },
    }));
    const output = capture();
    expect(await run(['deck', 'versions', 'd1', ...AUTH, '--json'], { io: output.io, fetchImpl })).toBe(0);
    expect(calls[0]?.url).toBe('https://openroom.test/api/decks/d1/versions');
    expect(JSON.parse(output.out[0] as string).versions).toHaveLength(2);
  });

  it('start files a session, launches it and prints the join URL', async () => {
    const { fetchImpl, calls } = router((call) =>
      call.url.endsWith('/launch')
        ? {
            status: 201,
            body: {
              sessionCode: 'CODE1234',
              code: 'CODE1234',
              joinUrl: 'https://openroom.test/?code=CODE1234',
              hostToken: 'h',
              stageToken: 's',
              deckVersion: 3,
              started: true,
            },
          }
        : { status: 201, body: { session: { id: 'sess-9' } } },
    );
    const output = capture();
    expect(await run(['deck', 'start', 'd1', ...AUTH], { io: output.io, fetchImpl })).toBe(0);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/api/sessions',
      '/api/sessions/sess-9/launch',
    ]);
    expect(calls[1]?.body).toEqual({ start: true });
    const printed = output.out.join('\n');
    expect(printed).toContain('session CODE1234');
    expect(printed).toContain('https://openroom.test/?code=CODE1234');
  });

  it('an unknown subcommand is a usage error, not a request', async () => {
    let called = false;
    const output = capture();
    const code = await run(['deck', 'publish', 'd1', ...AUTH, '--json'], {
      io: output.io,
      fetchImpl: async () => {
        called = true;
        return new Response('{}');
      },
    });
    expect(code).toBe(2);
    expect(called).toBe(false);
  });
});
