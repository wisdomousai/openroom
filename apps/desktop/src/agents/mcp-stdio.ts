/**
 * Sidecar: stdio JSON-RPC ↔ Desktop mcp.sock.
 * Spawned with ELECTRON_RUN_AS_NODE=1 so agent CLIs do not need `openroom` on PATH.
 */
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';

import {
  apiCallNeedingConfirmation,
  CONFIRMATION_ID_PREFIX,
  confirmationAllowed,
  confirmationRefusal,
  confirmationRequest,
  confirmationResponseId,
  filterSidebarMcpResponse,
  inspectSidebarMcpRequest,
} from './mcp-tool-filter.js';

const flag = process.argv.indexOf('--socket');
const socketPath = flag >= 0 ? process.argv[flag + 1] : undefined;
if (socketPath === undefined || socketPath === '') {
  process.stderr.write('usage: mcp-stdio --socket <path>\n');
  process.exit(1);
}

const deniedTools = new Set<string>();
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] !== '--deny-tool') continue;
  const name = process.argv[index + 1];
  if (name !== undefined && name !== '') deniedTools.add(name);
}
const toolsListIds = new Set<string>();
/** `--confirm-api`: hold account-level openroom_api writes for the tutor's answer in the pane. */
const confirmApi = process.argv.includes('--confirm-api');
const confirmations = new Map<string, (line: string) => void>();

const socket = createConnection(socketPath);
socket.setEncoding('utf8');
socket.on('error', (err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
const responses = createInterface({ input: socket, crlfDelay: Infinity });
responses.on('line', (line) => {
  const confirmationId = confirmationResponseId(line);
  const waiting = confirmationId === null ? undefined : confirmations.get(confirmationId);
  if (confirmationId !== null && waiting !== undefined) {
    confirmations.delete(confirmationId);
    waiting(line);
    return;
  }
  process.stdout.write(`${filterSidebarMcpResponse(line, deniedTools, toolsListIds)}\n`);
});

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
socket.once('connect', () => {
  void (async () => {
    for await (const line of lines) {
      if (line.trim() === '') continue;
      const inspected = inspectSidebarMcpRequest(line, deniedTools);
      if (!inspected.forward) {
        if (inspected.response !== null) process.stdout.write(`${inspected.response}\n`);
        continue;
      }
      const call = confirmApi ? apiCallNeedingConfirmation(line) : null;
      if (call !== null) {
        const id = `${CONFIRMATION_ID_PREFIX}${randomUUID()}`;
        const answer = await new Promise<string>((resolve) => {
          confirmations.set(id, resolve);
          socket.write(`${confirmationRequest(id, call)}\n`);
        });
        if (!confirmationAllowed(answer)) {
          if (call.id !== undefined) process.stdout.write(`${confirmationRefusal(call.id)}\n`);
          continue;
        }
      }
      if (inspected.toolsListId !== null) toolsListIds.add(inspected.toolsListId);
      socket.write(`${line}\n`);
    }
    socket.end();
  })();
});
