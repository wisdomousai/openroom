/**
 * One agent-facing MCP process. Probe order:
 *   desktop socket → local .openroom → hosted /api/mcp
 */
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

import { handleMcpMessage, multiplexToolDeps, unavailableHostedDeps } from '@openroom/mcp';

import type { ParsedArgs } from '../args.js';
import { chooseMcpBackend, desktopMcpSocketPath, hostedMcpOrigin } from '../mcp-backend.js';
import { loadOpenRoomBinding } from '../mcp-file.js';
import { clearLock, takeHeadlessLock } from '../mcp-lock.js';
import { proxyStdioToHttp, proxyStdioToSocket, tryConnectSocket } from '../mcp-proxy.js';
import type { Reporter } from '../output.js';

const SERVER_INFO = { name: 'openroom', version: '0.1.0' };

export async function cmdMcp(args: ParsedArgs, reporter: Reporter, cwd = process.cwd()): Promise<number> {
  const fileArg = args.positionals[1];
  const socketPath = desktopMcpSocketPath();
  const socket = await tryConnectSocket(socketPath);
  const backend = chooseMcpBackend({
    ...(fileArg === undefined ? {} : { fileArg: resolve(cwd, fileArg) }),
    desktopSocketPath: socketPath,
    socketExists: () => socket !== null,
    origin: hostedMcpOrigin(),
  });

  if (backend.kind === 'desktop') {
    if (socket === null) {
      reporter.errorLine('error: desktop MCP socket vanished');
      return 1;
    }
    await proxyStdioToSocket(socket);
    return 0;
  }

  socket?.destroy();

  if (backend.kind === 'web') {
    await proxyStdioToHttp(backend.origin);
    return 0;
  }

  const documentPath = backend.documentPath;
  const file = loadOpenRoomBinding(documentPath);
  const taken = takeHeadlessLock(documentPath, file.fileId);
  if (!taken.ok) {
    reporter.errorLine('warning: file is open in OpenRoom Desktop — writes will be refused');
  }

  const deps = multiplexToolDeps(unavailableHostedDeps(), file);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  const release = () => {
    if (taken.ok) clearLock(documentPath, process.pid);
  };
  process.on('exit', release);
  process.on('SIGINT', () => {
    release();
    process.exit(0);
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed) as unknown;
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'parse error' }, id: null })}\n`,
      );
      continue;
    }
    const response = await handleMcpMessage(raw, deps, SERVER_INFO);
    if (response !== null) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
  release();
  return 0;
}
