import { describe, expect, it, vi } from 'vitest';

import type { AgentKeyStore, ByokCredential, ByokProviderId } from './keys.js';
import { byokModelResolver, createByokRegistry, splitModelId } from './providers.js';

/** Call options the fake models were handed, after any middleware ran. */
const generated: {
  prompt: { role: string; providerOptions?: Record<string, Record<string, unknown>> }[];
  providerOptions?: Record<string, Record<string, unknown>>;
}[] = [];

/** A provider is only ever asked for a language model here. */
function fakeProvider(id: string) {
  return {
    // Both versions are declared: without them the SDK wraps the fake in a
    // compatibility proxy, and the test would stop exercising the v4 path.
    specificationVersion: 'v4',
    languageModel: (model: string) => ({
      specificationVersion: 'v4',
      provider: id,
      modelId: model,
      supportedUrls: {},
      doGenerate: (options: (typeof generated)[number]) => {
        generated.push(options);
        return Promise.resolve({ content: [], finishReason: 'stop', usage: {}, warnings: [] });
      },
      doStream: () => {
        throw new Error('not used');
      },
    }),
    textEmbeddingModel: () => {
      throw new Error('not used');
    },
    imageModel: () => {
      throw new Error('not used');
    },
  };
}

function fakeKeys(credentials: Partial<Record<ByokProviderId, ByokCredential>>): AgentKeyStore {
  const ids = Object.keys(credentials) as ByokProviderId[];
  return {
    available: () => true,
    list: () => Promise.resolve([]),
    set: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    resolve: (id) => Promise.resolve(credentials[id] ?? null),
    configured: () => Promise.resolve(ids),
  };
}

describe('splitModelId', () => {
  it('splits on the first colon so slashed model ids survive', () => {
    expect(splitModelId('cloudflare:@cf/openai/gpt-oss-120b')).toEqual({
      providerId: 'cloudflare',
      model: '@cf/openai/gpt-oss-120b',
    });
    expect(splitModelId('gpt-5.6-terra')).toBeNull();
    expect(splitModelId('openai:')).toBeNull();
  });
});

describe('createByokRegistry', () => {
  it('holds only providers that have a key', async () => {
    const build = vi.fn((id: ByokProviderId) => Promise.resolve(fakeProvider(id) as never));
    const registry = await createByokRegistry(fakeKeys({ google: { apiKey: 'k' } }), { build });

    expect(registry.configured).toEqual(['google']);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('leaves out a provider that cannot be built', async () => {
    const registry = await createByokRegistry(fakeKeys({ cloudflare: { apiKey: 'k' } }), {
      build: () => Promise.reject(new Error('Cloudflare Workers AI needs an account ID.')),
    });

    expect(registry.configured).toEqual([]);
  });
});

describe('byokModelResolver', () => {
  const build = (id: ByokProviderId) => Promise.resolve(fakeProvider(id) as never);

  it('resolves a model from a configured provider', async () => {
    const resolve = byokModelResolver(fakeKeys({ openai: { apiKey: 'sk' } }), { build });
    const model = await resolve('openai:gpt-5.6-terra');

    expect(model.provider).toBe('openai');
    expect(model.modelId).toBe('gpt-5.6-terra');
  });

  /**
   * Every caller has to get the cache breakpoints, so they are attached at the
   * resolver rather than at each call site.
   */
  it('returns a model wrapped in the cache middleware', async () => {
    const resolve = byokModelResolver(fakeKeys({ anthropic: { apiKey: 'sk' } }), { build });
    const model = (await resolve('anthropic:claude-opus-5')) as unknown as {
      doGenerate(options: unknown): Promise<unknown>;
    };

    await model.doGenerate({
      prompt: [
        { role: 'system', content: 'SYSTEM' },
        { role: 'user', content: [{ type: 'text', text: 'Go' }] },
      ],
      tools: [{ type: 'function', name: 'deck_get', inputSchema: { type: 'object' } }],
    });

    const seen = generated.at(-1);
    expect(seen?.prompt[0].providerOptions?.anthropic).toEqual({
      cacheControl: { type: 'ephemeral' },
    });
    expect(seen?.prompt[1].providerOptions?.anthropic).toEqual({
      cacheControl: { type: 'ephemeral' },
    });
    expect(seen?.providerOptions?.openai?.promptCacheKey).toMatch(/^openroom:[0-9a-f]{64}$/);
  });

  it('names the missing key rather than failing at the provider', async () => {
    const resolve = byokModelResolver(fakeKeys({}), { build });
    await expect(resolve('anthropic:claude-opus-5')).rejects.toThrow(
      'Add an API key for Anthropic in Agent settings.',
    );
  });

  it('refuses an empty or unqualified model id', async () => {
    const resolve = byokModelResolver(fakeKeys({ openai: { apiKey: 'sk' } }), { build });
    await expect(resolve(null)).rejects.toThrow('Choose a model for API-key mode.');
    await expect(resolve('gpt-5.6-terra')).rejects.toThrow(/Model ids look like/);
    await expect(resolve('acme:x')).rejects.toThrow('Unknown provider "acme".');
  });
});
