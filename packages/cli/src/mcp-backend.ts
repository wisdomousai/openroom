/**
 * Probe order for the one agent-facing MCP process:
 *   1. Desktop socket (app running) — reverse-proxy JSON-RPC there
 *   2. A .openroom path — headless file host
 *   3. Hosted /api/mcp — so "local not installed" is still the web editor
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type McpBackend =
  | { kind: 'desktop'; socketPath: string }
  | { kind: 'file'; documentPath: string }
  | { kind: 'web'; origin: string };

/**
 * Desktop's socket, or null when Desktop has not published one. On Windows the
 * pipe name is random per launch (a fixed one could be squatted by another
 * user); Desktop leaves it in its userData folder, which only this user reads.
 */
export function desktopMcpSocketPath(home: string = homedir()): string | null {
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming');
    return readDesktopPipeName(join(appData, 'OpenRoom', 'mcp-pipe'));
  }
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'OpenRoom', 'mcp.sock');
  }
  const runtime = process.env['XDG_RUNTIME_DIR'];
  if (runtime) return join(runtime, 'openroom-mcp.sock');
  return join(home, '.openroom', 'mcp.sock');
}

export function readDesktopPipeName(file: string): string | null {
  try {
    const name = readFileSync(file, 'utf8').trim();
    return /^\\\\\.\\pipe\\openroom-mcp-[0-9a-f]{32}$/.test(name) ? name : null;
  } catch {
    return null;
  }
}

export function hostedMcpOrigin(): string {
  return (process.env['OPENROOM_ORIGIN'] ?? 'https://openroom.app').replace(/\/$/, '');
}

export function chooseMcpBackend(input: {
  fileArg?: string;
  desktopSocketPath?: string | null;
  socketExists?: (path: string) => boolean;
  origin?: string;
}): McpBackend {
  const socketPath = input.desktopSocketPath === undefined ? desktopMcpSocketPath() : input.desktopSocketPath;
  const exists = input.socketExists ?? defaultSocketExists;
  if (socketPath !== null && exists(socketPath)) return { kind: 'desktop', socketPath };
  if (input.fileArg !== undefined && input.fileArg !== '') {
    return { kind: 'file', documentPath: input.fileArg };
  }
  return { kind: 'web', origin: input.origin ?? hostedMcpOrigin() };
}

function defaultSocketExists(path: string): boolean {
  if (process.platform === 'win32') return true;
  return existsSync(path);
}
