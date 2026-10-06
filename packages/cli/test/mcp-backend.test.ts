import { describe, expect, it } from 'vitest';

import { chooseMcpBackend } from '../src/mcp-backend.js';

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
});
