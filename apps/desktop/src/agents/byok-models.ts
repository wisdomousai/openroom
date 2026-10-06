/**
 * Starter model catalog for the API-key host.
 *
 * Curated rather than fetched: seven providers means seven list endpoints, each
 * returning embeddings, moderation and deprecated snapshots that an allowlist
 * would filter anyway, and a live list needs a working key at picker-open time —
 * a rate-limited key would blank the picker. The picker also accepts a free-text
 * `provider:model` id, which is the escape hatch for anything not listed here and
 * for ids that move on before this file does.
 *
 * Only models that can call tools belong here: the agent's whole job is MCP calls.
 */
import type { AgentModelInfo } from './models.js';
import type { AgentKeyStore, ByokProviderId } from './keys.js';
import { BYOK_PROVIDERS } from './providers.js';

export interface ByokModelEntry {
  model: string;
  label: string;
  description?: string;
  isDefault?: boolean;
}

export const BYOK_MODELS: Record<ByokProviderId, readonly ByokModelEntry[]> = {
  openai: [
    { model: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', isDefault: true },
    { model: 'gpt-5.6-terra-pro', label: 'GPT-5.6 Terra Pro' },
    { model: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { model: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  ],
  google: [
    { model: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', isDefault: true },
    { model: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
    { model: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { model: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
  ],
  anthropic: [
    { model: 'claude-opus-5', label: 'Claude Opus 5', isDefault: true },
    { model: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { model: 'claude-fable-5', label: 'Claude Fable 5' },
    { model: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  mistral: [
    { model: 'mistral-medium-3.5', label: 'Mistral Medium 3.5', isDefault: true },
    { model: 'mistral-large-2512', label: 'Mistral Large 3' },
    { model: 'mistral-small-2603', label: 'Mistral Small 4' },
  ],
  groq: [
    { model: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', isDefault: true },
    { model: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' },
    { model: 'moonshotai/kimi-k2-instruct', label: 'Kimi K2 Instruct' },
    { model: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
  ],
  openrouter: [
    { model: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra', isDefault: true },
    { model: 'anthropic/claude-opus-5', label: 'Claude Opus 5' },
    { model: 'google/gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
    { model: 'moonshotai/kimi-k3', label: 'Kimi K3' },
    { model: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  ],
  cloudflare: [
    { model: '@cf/openai/gpt-oss-120b', label: 'GPT-OSS 120B', isDefault: true },
    { model: '@cf/moonshotai/kimi-k2.7-code', label: 'Kimi K2.7 Code' },
    { model: '@cf/zai-org/glm-5.2', label: 'GLM-5.2' },
    { model: '@cf/zai-org/glm-4.7-flash', label: 'GLM-4.7 Flash' },
    { model: '@cf/nvidia/nemotron-3-120b-a12b', label: 'Nemotron 3 Super' },
  ],
};

/**
 * The small model each provider is asked for when a task profile does not need
 * the tutor's selection (see profiles.ts).
 *
 * Ids come from the curated list above and nowhere else: a made-up id fails at
 * turn time, while a missing one costs nothing — the caller falls back to the
 * selected model. Cloudflare is deliberately absent: its catalogue is already
 * open-weight throughout, so there is no cheaper tier to drop to.
 */
const BYOK_CHEAP_MODELS: Partial<Record<ByokProviderId, string>> = {
  openai: 'gpt-5.6-luna',
  google: 'gemini-3.5-flash-lite',
  anthropic: 'claude-haiku-4-5',
  mistral: 'mistral-small-2603',
  groq: 'openai/gpt-oss-20b',
  openrouter: 'google/gemini-3.7-flash',
};

/** Composite id for the provider's small model, or null when it has no cheaper tier. */
export function cheapModelFor(providerId: string): string | null {
  const model = BYOK_CHEAP_MODELS[providerId as ByokProviderId];
  return model === undefined ? null : `${providerId}:${model}`;
}

/** Composite ids so the picker value and the provider-registry lookup key are one string. */
export function byokModelRows(configured: readonly ByokProviderId[]): AgentModelInfo[] {
  return BYOK_PROVIDERS.filter((provider) => configured.includes(provider.id)).flatMap((provider) =>
    BYOK_MODELS[provider.id].map((entry) => ({
      id: `${provider.id}:${entry.model}`,
      label: `${provider.label} · ${entry.label}`,
      ...(entry.description === undefined ? {} : { description: entry.description }),
      ...(entry.isDefault === true ? { isDefault: true } : {}),
    })),
  );
}

export async function byokModels(keys: AgentKeyStore): Promise<AgentModelInfo[]> {
  return byokModelRows(await keys.configured());
}
