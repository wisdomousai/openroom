import { describe, expect, it } from 'vitest';

import { byokPrefixHash, cacheMiddleware, withCacheBreakpoints, type ByokCallOptions } from './cache-middleware.js';

function params(overrides: Partial<ByokCallOptions> = {}): ByokCallOptions {
  return {
    prompt: [
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: [{ type: 'text', text: 'Earlier ask' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer' }] },
      { role: 'user', content: [{ type: 'text', text: 'Prepare the deck' }] },
    ],
    tools: [
      { type: 'function', name: 'deck_get', inputSchema: { type: 'object' } },
      { type: 'function', name: 'read_file', inputSchema: { type: 'object' } },
    ],
    ...overrides,
  } as ByokCallOptions;
}

function anthropicOf(entry: ByokCallOptions['prompt'][number]): unknown {
  return entry.providerOptions?.anthropic;
}

describe('withCacheBreakpoints', () => {
  it('breaks on the system entry and the last message, and nowhere else', () => {
    const result = withCacheBreakpoints(params());

    expect(anthropicOf(result.prompt[0])).toEqual({ cacheControl: { type: 'ephemeral' } });
    expect(anthropicOf(result.prompt[3])).toEqual({ cacheControl: { type: 'ephemeral' } });
    expect(anthropicOf(result.prompt[1])).toBeUndefined();
    expect(anthropicOf(result.prompt[2])).toBeUndefined();
  });

  it('leaves the default 5-minute window rather than naming a ttl', () => {
    const result = withCacheBreakpoints(params());
    expect(result.prompt[0].providerOptions?.anthropic).not.toHaveProperty('ttl');
  });

  it('sets an OpenAI prompt cache key that is stable for identical params', () => {
    const first = withCacheBreakpoints(params());
    const second = withCacheBreakpoints(params());
    const key = first.providerOptions?.openai?.promptCacheKey;

    expect(key).toMatch(/^openroom:[0-9a-f]{64}$/);
    expect(second.providerOptions?.openai?.promptCacheKey).toBe(key);
  });

  it('is idempotent', () => {
    const once = withCacheBreakpoints(params());
    expect(withCacheBreakpoints(once)).toEqual(once);
  });

  it('preserves provider options that were already there', () => {
    const result = withCacheBreakpoints(
      params({
        providerOptions: { google: { safety: 'off' } },
        prompt: [
          { role: 'system', content: 'SYSTEM', providerOptions: { anthropic: { toolChanges: [] } } },
          { role: 'user', content: [{ type: 'text', text: 'Go' }] },
        ],
      } as Partial<ByokCallOptions>),
    );

    expect(result.providerOptions?.google).toEqual({ safety: 'off' });
    expect(result.prompt[0].providerOptions?.anthropic).toEqual({
      toolChanges: [],
      cacheControl: { type: 'ephemeral' },
    });
  });

  it('attaches unconditionally, since a provider ignores another provider namespace', () => {
    const result = withCacheBreakpoints(params({ tools: undefined }));
    expect(result.providerOptions?.openai).toBeDefined();
    expect(anthropicOf(result.prompt[0])).toBeDefined();
  });
});

describe('byokPrefixHash', () => {
  it('is identical for two identical param sets', () => {
    expect(byokPrefixHash(params())).toBe(byokPrefixHash(params()));
  });

  it('ignores the order the tools arrive in, and the messages after the prefix', () => {
    const swapped = params({
      tools: [
        { type: 'function', name: 'read_file', inputSchema: { type: 'object' } },
        { type: 'function', name: 'deck_get', inputSchema: { type: 'object' } },
      ],
      prompt: [
        { role: 'system', content: 'SYSTEM' },
        { role: 'user', content: [{ type: 'text', text: 'A different turn entirely' }] },
      ],
    } as Partial<ByokCallOptions>);

    expect(byokPrefixHash(swapped)).toBe(byokPrefixHash(params()));
  });

  it('changes when the system text or a tool schema changes', () => {
    const base = byokPrefixHash(params());
    expect(byokPrefixHash(params({ prompt: [{ role: 'system', content: 'OTHER' }] }))).not.toBe(base);
    expect(
      byokPrefixHash(
        params({
          tools: [{ type: 'function', name: 'deck_get', inputSchema: { type: 'string' } }],
        } as Partial<ByokCallOptions>),
      ),
    ).not.toBe(base);
  });
});

describe('cacheMiddleware', () => {
  it('transforms params through the same pure function', async () => {
    const given = params();
    const transformed = await cacheMiddleware.transformParams?.({
      type: 'stream',
      params: given,
      model: {} as never,
    });

    expect(transformed).toEqual(withCacheBreakpoints(given));
  });
});
