/**
 * Desktop-hosted MCP: the hosted `/api/mcp` tools plus desktop-only
 * `ask_question`. Local agents reverse-proxy here when this socket exists.
 * Hosted calls use the Electron session cookie.
 */
import { createServer, type Server } from 'node:net';
import { mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { session } from 'electron';

import { multiplexToolDeps, type FileBinding, type ToolDeps } from '@openroom/mcp';
import { handleDesktopMcpMessage } from './agents/ask-question.js';
import { stampedDeckId } from './mcp-saved.js';
import type { AgentQuestionAnswer } from './agents/types.js';
import {
  editableOutlineForOpenRoomFile,
  parseOpenRoomFile,
  stringifyOpenRoomFile,
  updateOpenRoomFileOutline,
  validateOutline,
  type OpenRoomFileV1,
  type Outline,
} from '@openroom/schema';

const SERVER_INFO = { name: 'openroom-desktop', version: '0.1.0' };

export interface DesktopDocument {
  path: string | null;
  source: string | null;
  write(source: string): Promise<void>;
}

export function desktopMcpSocketPath(userData: string): string {
  if (process.platform === 'win32') return '\\\\.\\pipe\\openroom-mcp';
  return `${userData.replace(/\/$/, '')}/mcp.sock`;
}

export function startDesktopMcpServer(input: {
  socketPath: string;
  origin: string;
  currentDocument: () => DesktopDocument | null;
  ask: (args: Record<string, unknown>) => Promise<AgentQuestionAnswer[]>;
  /** Fires after any agent stamps a deck version, so open editors can adopt it. */
  onDeckSaved?: (deckId: string) => void;
}): Promise<Server> {
  const deps = multiplexToolDeps(hostedDeps(input.origin), liveFileBinding(input.currentDocument));
  return listen(input.socketPath, deps, input.ask, input.onDeckSaved);
}

function liveFileBinding(currentDocument: () => DesktopDocument | null): FileBinding | null {
  const binding: FileBinding = {
    get fileId() {
      return snapshot()?.file.fileId ?? '';
    },
    get localRevision() {
      return snapshot()?.file.localRevision ?? 0;
    },
    get title() {
      return snapshot()?.file.outline.meta.title ?? '';
    },
    getOutline() {
      const snap = snapshot();
      if (snap === null) return { version: 1, meta: { title: '' }, steps: [], interactions: [] };
      return editableOutlineForOpenRoomFile(snap.file);
    },
    saveOutline(outline, baseRevision) {
      const snap = snapshot();
      if (snap === null) return { ok: false, errors: [{ message: 'no-open-file' }] };
      if (baseRevision !== snap.file.localRevision) {
        return { ok: false, conflict: true, latestVersion: snap.file.localRevision };
      }
      const parsed = validateOutline(outline);
      if (!parsed.ok) return { ok: false, errors: parsed.errors };
      const next: OpenRoomFileV1 = {
        ...updateOpenRoomFileOutline(snap.file, parsed.outline as Outline),
        localRevision: snap.file.localRevision + 1,
      };
      void snap.doc.write(stringifyOpenRoomFile(next));
      return { ok: true, version: next.localRevision };
    },
  };
  return binding;

  function snapshot(): { doc: DesktopDocument; file: OpenRoomFileV1 } | null {
    const doc = currentDocument();
    if (doc === null || (doc.source ?? '') === '') return null;
    const parsed = parseOpenRoomFile(doc.source ?? '');
    if (!parsed.ok) return null;
    return { doc, file: parsed.file };
  }
}

function hostedDeps(origin: string): ToolDeps {
  const hostTokens = new Map<string, string>();
  return {
    appOrigin: origin,
    async createSession(outline) {
      const response = await api(origin, 'POST', '/api/sessions', { outline });
      if (response.status !== 201) throw new Error('sign-in-required');
      const created = response.body as {
        sessionCode: string;
        code: string;
        joinUrl: string;
        hostToken: string;
        stageToken: string;
      };
      hostTokens.set(created.code, created.hostToken);
      return created;
    },
    async getExport(code) {
      const token = hostTokens.get(code) ?? (await recoverHostToken(origin, code));
      if (token === null) return null;
      const response = await session.defaultSession
        .fetch(`${origin}/api/sessions/${encodeURIComponent(code)}/export?format=json`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(HOSTED_TIMEOUT_MS),
        })
        .catch(() => null);
      if (response === null) return null;
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    },
    async controlRequest(method, path, body) {
      return api(origin, method, path, body);
    },
    async sessionCommand(code, command, options) {
      const token = hostTokens.get(code) ?? (await recoverHostToken(origin, code));
      if (token === null) throw new Error('sign-in-required');
      return api(origin, 'POST', `/api/sessions/${encodeURIComponent(code)}/commands`, {
        command,
        ...(options?.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
        ...(options?.expectedRevision === undefined ? {} : { expectedRevision: options.expectedRevision }),
      }, token);
    },
  };
}

async function recoverHostToken(origin: string, code: string): Promise<string | null> {
  const listed = await api(origin, 'GET', '/api/my/sessions');
  if (listed.status !== 200) return null;
  const sessions = (listed.body as { sessions?: Array<{ code?: string; hostToken?: string }> }).sessions ?? [];
  const match = sessions.find((item) => item.code === code && typeof item.hostToken === 'string');
  return match?.hostToken ?? null;
}

/** A dead or unreachable origin must answer the agent quickly, not hang past its tool timeout. */
const HOSTED_TIMEOUT_MS = 15_000;

async function api(
  origin: string,
  method: string,
  path: string,
  body?: unknown,
  bearer?: string,
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers({ accept: 'application/json', 'x-openroom-csrf': '1' });
  if (bearer !== undefined) headers.set('authorization', `Bearer ${bearer}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  let response: Response;
  try {
    response = await session.defaultSession.fetch(`${origin}${path}`, {
      method,
      headers,
      signal: AbortSignal.timeout(HOSTED_TIMEOUT_MS),
      ...(body === undefined || method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { status: 503, body: { error: 'openroom-unreachable', detail: `${origin}: ${detail}` } };
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, body: parsed };
}

async function listen(
  socketPath: string,
  deps: ToolDeps,
  ask: (args: Record<string, unknown>) => Promise<AgentQuestionAnswer[]>,
  onDeckSaved?: (deckId: string) => void,
): Promise<Server> {
  if (process.platform !== 'win32') {
    await mkdir(dirname(socketPath), { recursive: true });
    await unlink(socketPath).catch(() => undefined);
  }
  const server = createServer((socket) => {
    const lines = createInterface({ input: socket, crlfDelay: Infinity });
    void (async () => {
      for await (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        let raw: unknown;
        try {
          raw = JSON.parse(trimmed) as unknown;
        } catch {
          socket.write(
            `${JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'parse error' }, id: null })}\n`,
          );
          continue;
        }
        const response = await handleDesktopMcpMessage(raw, deps, SERVER_INFO, ask);
        if (response !== null) socket.write(`${JSON.stringify(response)}\n`);
        if (onDeckSaved !== undefined) {
          const deckId = stampedDeckId(raw, response);
          if (deckId !== null) onDeckSaved(deckId);
        }
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });
  return server;
}
