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

describe('tutoring CLI parity', () => {
  it('sends an allowlisted business API request with the user bearer', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ learner: { id: 'learner-1' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    };
    const output = capture();
    const code = await run([
      'api',
      'POST',
      '/api/tutoring/contexts',
      '--url',
      'https://openroom.test',
      '--token',
      'orpat_secret',
      '--body',
      '{"displayName":"Camille"}',
      '--json',
    ], { io: output.io, fetchImpl });
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://openroom.test/api/tutoring/contexts');
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer orpat_secret');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ displayName: 'Camille' });
    expect(JSON.parse(output.out[0] as string)).toMatchObject({ ok: true, status: 201 });
  });

  it('returns private audio without interpreting binary bytes as UTF-8 text', async () => {
    const bytes = new Uint8Array([82, 73, 70, 70, 0, 128, 255]);
    const output = capture();
    const code = await run(['api', 'GET', '/api/tutoring/contexts/person/work/response/audio', '--url', 'https://openroom.test', '--token', 'orpat_secret', '--json'], {
      io: output.io,
      fetchImpl: async (_url, init) => {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer orpat_secret');
        return new Response(bytes, { headers: { 'content-type': 'audio/wav' } });
      },
    });
    expect(code).toBe(0);
    const result = JSON.parse(output.out[0]!);
    expect(result.body).toMatchObject({ encoding: 'base64', mimeType: 'audio/wav' });
    expect(new Uint8Array(Buffer.from(result.body.data, 'base64'))).toEqual(bytes);
  });

  it('cannot call the browser-only permanent confirmation endpoint', async () => {
    let called = false;
    const output = capture();
    const code = await run([
      'api',
      'POST',
      '/confirm-deletion/token',
      '--url',
      'https://openroom.test',
      '--token',
      'orpat_secret',
      '--json',
    ], {
      io: output.io,
      fetchImpl: async () => {
        called = true;
        return new Response();
      },
    });
    expect(code).toBe(1);
    expect(called).toBe(false);
    expect(JSON.parse(output.out[0] as string)).toMatchObject({
      ok: false,
      error: { code: 'E_API_PATH' },
    });
  });

  it('validates a typed Outline locally', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'openroom-cli-outline-'));
    writeFileSync(join(cwd, 'outline.yaml'), `version: 1
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
    type: choice
    prompt: Pick one
    options:
      - id: a
        label: A
      - id: b
        label: B
`, 'utf8');
    const output = capture();
    expect(await run(['outline', 'validate', 'outline.yaml', '--json'], { cwd, io: output.io })).toBe(0);
    expect(JSON.parse(output.out[0] as string)).toMatchObject({
      ok: true,
      title: 'French B1',
      stepCount: 2,
      interactionCount: 1,
    });
  });
});
