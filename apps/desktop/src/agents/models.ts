/**
 * Dynamic model catalogs. Nothing is hardcoded: each host is asked for its
 * own list the first time the tutor opens the picker, then the answer is
 * cached in memory and on disk so later sessions start instantly.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

import { query as sdkQuery, type Options } from '@anthropic-ai/claude-agent-sdk';

import { sanitizedEnv } from './hosts/claude.js';
import type { AgentHostId } from './types.js';

export interface AgentModelInfo {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
}

const FETCH_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

/** `codex app-server` speaks JSONL JSON-RPC and serves the same model/list the Codex TUI uses. */
export function listCodexModels(bin: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<AgentModelInfo[]> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const finish = (models: AgentModelInfo[]) => {
      clearTimeout(timer);
      if (!child.killed) child.kill();
      resolve(models);
    };
    const timer = setTimeout(() => finish([]), timeoutMs);
    child.on('error', () => finish([]));
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => {
      let parsed: { id?: unknown; result?: { data?: unknown } };
      try {
        parsed = JSON.parse(line) as typeof parsed;
      } catch {
        return;
      }
      if (parsed.id !== 2 || !Array.isArray(parsed.result?.data)) return;
      const rows = parsed.result.data as Array<{
        id?: unknown;
        displayName?: unknown;
        description?: unknown;
        hidden?: unknown;
        isDefault?: unknown;
      }>;
      finish(
        rows
          .filter((row) => typeof row.id === 'string' && row.hidden !== true)
          .map((row) => ({
            id: row.id as string,
            label: typeof row.displayName === 'string' ? row.displayName : (row.id as string),
            ...(typeof row.description === 'string' ? { description: row.description } : {}),
            ...(row.isDefault === true ? { isDefault: true } : {}),
          })),
      );
    });
    child.stdin.write(
      [
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { clientInfo: { name: 'openroom', title: 'OpenRoom', version: '0.1.0' } },
        }),
        JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'model/list', params: {} }),
        '',
      ].join('\n'),
    );
  });
}

type QueryFn = (input: { prompt: AsyncIterable<never>; options: Options }) => {
  supportedModels(): Promise<Array<{ value: string; displayName: string; description?: string }>>;
  interrupt(): Promise<void>;
};

/** The Claude Agent SDK exposes the signed-in account's model list on a live query handle. */
export async function listClaudeModels(
  cwd: string,
  timeoutMs = FETCH_TIMEOUT_MS,
  queryFn: QueryFn = sdkQuery as unknown as QueryFn,
): Promise<AgentModelInfo[]> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  // eslint-disable-next-line @typescript-eslint/require-await
  async function* prompts(): AsyncGenerator<never> {
    await gate;
  }
  try {
    const handle = queryFn({
      prompt: prompts(),
      options: { cwd, env: sanitizedEnv() } as Options,
    });
    const models = await Promise.race([
      handle.supportedModels(),
      new Promise<null>((resolveRace) => setTimeout(() => resolveRace(null), timeoutMs)),
    ]);
    release();
    await handle.interrupt().catch(() => undefined);
    if (models === null) return [];
    return models.map((model) => ({
      id: model.value,
      label: model.displayName,
      ...(typeof model.description === 'string' ? { description: model.description } : {}),
    }));
  } catch {
    release();
    return [];
  }
}

export interface ModelCatalogDeps {
  cacheFile: string;
  sources: Partial<Record<AgentHostId, () => Promise<AgentModelInfo[]>>>;
  ttlMs?: number;
  now?: () => number;
  readCache?: (path: string) => Promise<string>;
  writeCache?: (path: string, text: string) => Promise<void>;
}

export interface AgentModelCatalog {
  list(host: AgentHostId): Promise<AgentModelInfo[]>;
}

interface CacheEntry {
  fetchedAt: number;
  models: AgentModelInfo[];
}

export function createModelCatalog(deps: ModelCatalogDeps): AgentModelCatalog {
  const ttl = deps.ttlMs ?? CACHE_TTL_MS;
  const now = deps.now ?? Date.now;
  const read = deps.readCache ?? ((path: string) => readFile(path, 'utf8'));
  const write = deps.writeCache ?? ((path: string, text: string) => writeFile(path, text, 'utf8'));
  const memory = new Map<AgentHostId, CacheEntry>();
  const inflight = new Map<AgentHostId, Promise<AgentModelInfo[]>>();
  let disk: Partial<Record<AgentHostId, CacheEntry>> | null = null;

  const loadDisk = async (): Promise<Partial<Record<AgentHostId, CacheEntry>>> => {
    if (disk !== null) return disk;
    try {
      disk = JSON.parse(await read(deps.cacheFile)) as Partial<Record<AgentHostId, CacheEntry>>;
    } catch {
      disk = {};
    }
    return disk;
  };

  return {
    async list(host) {
      const fresh = (entry: CacheEntry | undefined): boolean =>
        entry !== undefined && entry.models.length > 0 && now() - entry.fetchedAt < ttl;
      const cachedMemory = memory.get(host);
      if (cachedMemory !== undefined && fresh(cachedMemory)) return cachedMemory.models;
      const cachedDisk = (await loadDisk())[host];
      if (cachedDisk !== undefined && fresh(cachedDisk)) {
        memory.set(host, cachedDisk);
        return cachedDisk.models;
      }
      const running = inflight.get(host);
      if (running !== undefined) return running;
      const source = deps.sources[host];
      if (source === undefined) return [];
      const fetching = source()
        .catch(() => [] as AgentModelInfo[])
        .then(async (models) => {
          inflight.delete(host);
          if (models.length === 0) {
            // Keep stale data over nothing: a signed-out CLI should not blank the picker.
            return cachedMemory?.models ?? cachedDisk?.models ?? [];
          }
          const entry = { fetchedAt: now(), models };
          memory.set(host, entry);
          const stored = { ...(await loadDisk()), [host]: entry };
          disk = stored;
          await write(deps.cacheFile, JSON.stringify(stored)).catch(() => undefined);
          return models;
        });
      inflight.set(host, fetching);
      return fetching;
    },
  };
}
