/**
 * BYOK provider catalog and registry.
 *
 * Model ids are the AI SDK's own `providerId:modelId` composites, so the picker
 * value and the registry lookup key are the same string. Provider packages are
 * imported lazily: a teacher with one key never loads the other six.
 */
import { createProviderRegistry, wrapLanguageModel, type LanguageModel } from 'ai';

/** Whatever shape the registry accepts, without depending on @ai-sdk/provider directly. */
type ProviderInstance = Parameters<typeof createProviderRegistry>[0][string];

import { cacheMiddleware } from './cache-middleware.js';
import type { AgentKeyStore, ByokCredential, ByokProviderId } from './keys.js';

export interface ByokProviderField {
  key: 'accountId';
  label: string;
  placeholder: string;
}

export interface ByokProviderInfo {
  id: ByokProviderId;
  label: string;
  /** Where the teacher creates a key. */
  keysUrl: string;
  /** Cost or free-quota fact, shown under the field. */
  note: string;
  fields: ByokProviderField[];
}

export const BYOK_PROVIDERS: readonly ByokProviderInfo[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    keysUrl: 'https://platform.openai.com/api-keys',
    note: 'Paid per token. No free tier.',
    fields: [],
  },
  {
    id: 'google',
    label: 'Google',
    keysUrl: 'https://aistudio.google.com/apikey',
    note: 'Free tier with daily limits.',
    fields: [],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    keysUrl: 'https://platform.claude.com/settings/keys',
    note: 'Paid per token. Max and Team plans include monthly API credits.',
    fields: [],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    keysUrl: 'https://console.mistral.ai/api-keys',
    note: 'Free experiment tier with rate limits.',
    fields: [],
  },
  {
    id: 'groq',
    label: 'Groq',
    keysUrl: 'https://console.groq.com/keys',
    note: 'Free tier with rate limits. Open-weight models.',
    fields: [],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    keysUrl: 'https://openrouter.ai/keys',
    note: 'One key, many models. Some are free.',
    fields: [],
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    keysUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    note: 'Daily free allowance. The token needs Account · Workers AI · Read.',
    fields: [{ key: 'accountId', label: 'Account ID', placeholder: 'Workers AI account ID' }],
  },
];

export function byokProvider(id: ByokProviderId): ByokProviderInfo {
  const info = BYOK_PROVIDERS.find((item) => item.id === id);
  if (info === undefined) throw new Error(`Unknown provider ${id}.`);
  return info;
}

/**
 * OpenRouter and Cloudflare ride the OpenAI-compatible provider rather than their
 * community packages: both vendors ship an OpenAI-shaped endpoint, and a community
 * package that lags a provider-spec bump would break two of seven providers at once.
 */
async function buildProvider(id: ByokProviderId, credential: ByokCredential): Promise<ProviderInstance> {
  const apiKey = credential.apiKey;
  if (id === 'openai') return (await import('@ai-sdk/openai')).createOpenAI({ apiKey }) as ProviderInstance;
  if (id === 'google') {
    return (await import('@ai-sdk/google')).createGoogleGenerativeAI({ apiKey }) as ProviderInstance;
  }
  if (id === 'anthropic') return (await import('@ai-sdk/anthropic')).createAnthropic({ apiKey }) as ProviderInstance;
  if (id === 'mistral') return (await import('@ai-sdk/mistral')).createMistral({ apiKey }) as ProviderInstance;
  if (id === 'groq') return (await import('@ai-sdk/groq')).createGroq({ apiKey }) as ProviderInstance;
  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
  if (id === 'openrouter') {
    return createOpenAICompatible({
      name: 'openrouter',
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    }) as unknown as ProviderInstance;
  }
  const accountId = (credential.accountId ?? '').trim();
  if (accountId === '') throw new Error('Cloudflare Workers AI needs an account ID.');
  return createOpenAICompatible({
    name: 'cloudflare',
    apiKey,
    baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
  }) as unknown as ProviderInstance;
}

export interface ByokRegistry {
  languageModel(id: string): LanguageModel;
  configured: ByokProviderId[];
}

export interface ByokRegistryDeps {
  build?: (id: ByokProviderId, credential: ByokCredential) => Promise<ProviderInstance>;
}

export async function createByokRegistry(
  keys: AgentKeyStore,
  deps: ByokRegistryDeps = {},
): Promise<ByokRegistry> {
  const build = deps.build ?? buildProvider;
  const entries: Record<string, ProviderInstance> = {};
  for (const id of await keys.configured()) {
    const credential = await keys.resolve(id);
    if (credential === null) continue;
    try {
      entries[id] = await build(id, credential);
    } catch {
      // A provider that cannot be built (Cloudflare without an account id) stays absent.
    }
  }
  const registry = createProviderRegistry(entries);
  return {
    languageModel: (id) => registry.languageModel(id as never) as LanguageModel,
    configured: Object.keys(entries) as ByokProviderId[],
  };
}

export function splitModelId(modelId: string): { providerId: string; model: string } | null {
  const separator = modelId.indexOf(':');
  if (separator <= 0 || separator === modelId.length - 1) return null;
  return { providerId: modelId.slice(0, separator), model: modelId.slice(separator + 1) };
}

/**
 * Turn-time model lookup. Every failure names what the tutor has to do next.
 *
 * The cache middleware is applied here rather than at the call site so a second
 * caller (the warm-up) cannot resolve an unwrapped model and write a prefix the
 * real turn will not match.
 *
 * Hosted-mode readiness: hosted mode is a `baseURL` swap in `buildProvider`,
 * pointing at a proxy that holds one shared key instead of the tutor's. Nothing
 * on the prompt side would change — the prefix is already byte-identical across
 * tutors and machines (see cache-middleware.ts), so cross-user cache sharing
 * follows from the key swap alone. That is why the invariant is worth keeping
 * even while every run is BYOK and every cache is private.
 */
export function byokModelResolver(
  keys: AgentKeyStore,
  deps: ByokRegistryDeps = {},
): (modelId: string | null) => Promise<LanguageModel> {
  return async (modelId) => {
    if (modelId === null || modelId.trim() === '') throw new Error('Choose a model for API-key mode.');
    const split = splitModelId(modelId);
    if (split === null) throw new Error(`Model ids look like "openai:gpt-5.1", not "${modelId}".`);
    const info = BYOK_PROVIDERS.find((item) => item.id === split.providerId);
    if (info === undefined) throw new Error(`Unknown provider "${split.providerId}".`);
    const registry = await createByokRegistry(keys, deps);
    if (!registry.configured.includes(info.id)) {
      throw new Error(`Add an API key for ${info.label} in Agent settings.`);
    }
    return wrapLanguageModel({
      model: registry.languageModel(modelId) as Exclude<LanguageModel, string>,
      middleware: cacheMiddleware,
    });
  };
}
