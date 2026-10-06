import { createConnection, type Socket } from 'node:net';
import { createInterface } from 'node:readline';

export function tryConnectSocket(path: string, timeoutMs = 200): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    const finish = (value: Socket | null) => {
      socket.removeAllListeners();
      if (value === null) {
        socket.destroy();
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      finish(socket);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      finish(null);
    });
  });
}

/** Copy stdio JSON-RPC lines onto an already-connected desktop socket. */
export async function proxyStdioToSocket(socket: Socket): Promise<void> {
  const incoming = createInterface({ input: process.stdin, crlfDelay: Infinity });
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    process.stdout.write(chunk);
  });
  const closed = new Promise<void>((resolve) => {
    socket.once('close', () => resolve());
    socket.once('end', () => resolve());
  });
  for await (const line of incoming) {
    if (line.trim() === '') continue;
    socket.write(`${line}\n`);
  }
  socket.end();
  await closed;
}

export async function proxyStdioToHttp(origin: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const incoming = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of incoming) {
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
    const response = await fetchImpl(`${origin}/api/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(raw),
    });
    const text = await response.text();
    if (text.trim() === '') continue;
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  }
}
