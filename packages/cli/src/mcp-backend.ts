/**
 * Probe order for the one agent-facing MCP process:
 *   1. Desktop socket (app running) — reverse-proxy JSON-RPC there
 *   2. A .openroom path — headless file host
 *   3. Hosted /api/mcp — so "local not installed" is still the web editor
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type McpBackend =
  | { kind: 'desktop'; socketPath: string }
  | { kind: 'file'; documentPath: string }
  | { kind: 'web'; origin: string };

export function desktopMcpSocketPath(home: string = homedir()): string {
  if (process.platform === 'win32') return '\\\\.\\pipe\\openroom-mcp';
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'OpenRoom', 'mcp.sock');
  }
  const runtime = process.env['XDG_RUNTIME_DIR'];
  if (runtime) return join(runtime, 'openroom-mcp.sock');
  return join(home, '.openroom', 'mcp.sock');
}

export function hostedMcpOrigin(): string {
  return (process.env['OPENROOM_ORIGIN'] ?? 'https://openroom.app').replace(/\/$/, '');
}

export function chooseMcpBackend(input: {
  fileArg?: string;
  desktopSocketPath?: string;
  socketExists?: (path: string) => boolean;
  origin?: string;
}): McpBackend {
  const socketPath = input.desktopSocketPath ?? desktopMcpSocketPath();
  const exists = input.socketExists ?? defaultSocketExists;
  if (exists(socketPath)) return { kind: 'desktop', socketPath };
  if (input.fileArg !== undefined && input.fileArg !== '') {
    return { kind: 'file', documentPath: input.fileArg };
  }
  return { kind: 'web', origin: input.origin ?? hostedMcpOrigin() };
}

function defaultSocketExists(path: string): boolean {
  if (process.platform === 'win32') return true;
  return existsSync(path);
}
