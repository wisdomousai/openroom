import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { chooseMcpBackend, readDesktopPipeName } from '../src/mcp-backend.js';

describe('chooseMcpBackend', () => {
  it('prefers a live desktop socket over a file and over the web', () => {
    expect(
      chooseMcpBackend({
        fileArg: '/tmp/french-b1.openroom',
        desktopSocketPath: '/tmp/mcp.sock',
        socketExists: () => true,
        origin: 'https://openroom.app',
      }),
    ).toEqual({ kind: 'desktop', socketPath: '/tmp/mcp.sock' });
  });

  it('uses the file when desktop is not running', () => {
    expect(
      chooseMcpBackend({
        fileArg: '/tmp/french-b1.openroom',
        desktopSocketPath: '/tmp/mcp.sock',
        socketExists: () => false,
      }),
    ).toEqual({ kind: 'file', documentPath: '/tmp/french-b1.openroom' });
  });

  it('falls through to the hosted MCP so a missing install is not a blackout', () => {
    expect(
      chooseMcpBackend({
        desktopSocketPath: '/tmp/mcp.sock',
        socketExists: () => false,
        origin: 'https://openroom.app',
      }),
    ).toEqual({ kind: 'web', origin: 'https://openroom.app' });
  });

  it('skips Desktop when it has published no socket', () => {
    expect(
      chooseMcpBackend({ desktopSocketPath: null, socketExists: () => true, origin: 'https://openroom.app' }),
    ).toEqual({ kind: 'web', origin: 'https://openroom.app' });
  });
});

describe('readDesktopPipeName', () => {
  it('reads only an OpenRoom per-launch pipe name from the file Desktop writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openroom-pipe-'));
    const file = join(dir, 'mcp-pipe');
    expect(readDesktopPipeName(file)).toBeNull();
    const pipe = `\\\\.\\pipe\\openroom-mcp-${'ab'.repeat(16)}`;
    writeFileSync(file, `${pipe}\n`);
    expect(readDesktopPipeName(file)).toBe(pipe);
    writeFileSync(file, '\\\\.\\pipe\\openroom-mcp');
    expect(readDesktopPipeName(file)).toBeNull();
  });
});
