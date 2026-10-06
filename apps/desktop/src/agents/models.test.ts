import { describe, expect, it } from 'vitest';

import { createModelCatalog, type AgentModelInfo } from './models.js';

const MODELS: AgentModelInfo[] = [{ id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', isDefault: true }];

function harness(input: { source?: () => Promise<AgentModelInfo[]>; disk?: string }) {
  let clock = 1_000;
  const writes: string[] = [];
  let fetches = 0;
  const catalog = createModelCatalog({
    cacheFile: '/data/agent-models.json',
    ttlMs: 100,
    now: () => clock,
    readCache: () => (input.disk === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(input.disk)),
    writeCache: (_path, text) => {
      writes.push(text);
      return Promise.resolve();
    },
    sources: {
      codex: () => {
        fetches += 1;
        return input.source === undefined ? Promise.resolve(MODELS) : input.source();
      },
    },
  });
  return { catalog, writes, tick: (ms: number) => (clock += ms), fetchCount: () => fetches };
}

describe('createModelCatalog', () => {
  it('fetches once, then serves memory and persists to disk', async () => {
    const { catalog, writes, fetchCount } = harness({});
    expect(await catalog.list('codex')).toEqual(MODELS);
    expect(await catalog.list('codex')).toEqual(MODELS);
    expect(fetchCount()).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('gpt-5.2-codex');
  });

  it('serves a fresh disk cache without spawning the host', async () => {
    const { catalog, fetchCount } = harness({
      disk: JSON.stringify({ codex: { fetchedAt: 990, models: MODELS } }),
    });
    expect(await catalog.list('codex')).toEqual(MODELS);
    expect(fetchCount()).toBe(0);
  });

  it('refetches after the TTL and keeps stale models when the host answers empty', async () => {
    const { catalog, tick, fetchCount } = harness({
      source: () => Promise.resolve(fetchCount() === 1 ? MODELS : []),
    });
    expect(await catalog.list('codex')).toEqual(MODELS);
    tick(200);
    // Signed-out CLI (empty answer) must not blank the picker.
    expect(await catalog.list('codex')).toEqual(MODELS);
    expect(fetchCount()).toBe(2);
  });

  it('answers empty for a host with no source', async () => {
    const { catalog } = harness({});
    expect(await catalog.list('byok')).toEqual([]);
  });
});
