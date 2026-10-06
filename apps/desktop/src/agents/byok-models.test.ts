import { describe, expect, it } from 'vitest';

import { BYOK_MODELS, byokModelRows, cheapModelFor } from './byok-models.js';
import { BYOK_PROVIDERS, splitModelId } from './providers.js';

describe('byokModelRows', () => {
  it('lists only configured providers', () => {
    const rows = byokModelRows(['google']);
    expect(rows.every((row) => row.id.startsWith('google:'))).toBe(true);
    expect(rows).toHaveLength(BYOK_MODELS.google.length);
    expect(byokModelRows([])).toEqual([]);
  });

  it('emits ids the registry can look up and labels naming the provider', () => {
    const rows = byokModelRows(['anthropic']);
    for (const row of rows) {
      const split = splitModelId(row.id);
      expect(split?.providerId).toBe('anthropic');
      expect(BYOK_MODELS.anthropic.some((entry) => entry.model === split?.model)).toBe(true);
      expect(row.label.startsWith('Anthropic · ')).toBe(true);
    }
  });

  it('keeps Cloudflare model ids intact even though they contain slashes', () => {
    const rows = byokModelRows(['cloudflare']);
    const split = splitModelId(rows[0].id);
    expect(split?.model).toBe(BYOK_MODELS.cloudflare[0].model);
  });
});

describe('cheapModelFor', () => {
  it('answers a composite id the curated list actually contains', () => {
    for (const provider of BYOK_PROVIDERS) {
      const id = cheapModelFor(provider.id);
      if (id === null) continue;
      const split = splitModelId(id);
      expect(split?.providerId).toBe(provider.id);
      expect(BYOK_MODELS[provider.id].some((entry) => entry.model === split?.model)).toBe(true);
    }
  });

  it('answers null for a provider with no cheaper tier and for an unknown one', () => {
    expect(cheapModelFor('cloudflare')).toBeNull();
    expect(cheapModelFor('deepmind')).toBeNull();
  });

  it('picks the small model, not the default', () => {
    expect(cheapModelFor('anthropic')).toBe('anthropic:claude-haiku-4-5');
    expect(cheapModelFor('google')).toBe('google:gemini-3.5-flash-lite');
  });
});
