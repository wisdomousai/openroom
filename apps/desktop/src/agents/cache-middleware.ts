/**
 * Prompt-cache breakpoints for the API-key host.
 *
 * The tutor pays for these tokens directly, and the static prefix — the MCP tool
 * schemas plus the ~4k-token system prompt — is re-sent on every turn of a
 * conversation. Two ephemeral breakpoints turn that prefix into a cache read:
 * one after the system entry (closing tools + system), one on the last message
 * (closing the conversation so far).
 *
 * The cacheable prefix must contain **zero per-user, per-machine, or
 * per-conversation bytes**, or every tutor gets a private cache and a hosted
 * proxy could never share one. Two things keep that true and must stay true:
 * byok.ts orders the tool block deterministically, and the `read_file` schema
 * carries no roots.
 *
 * Attached unconditionally: `providerOptions` is namespaced, so a provider that
 * is not Anthropic ignores the `anthropic` key and one that is not OpenAI
 * ignores `openai`. No `ttl` field means Anthropic's default 5-minute window,
 * which is the one that is free to write.
 */
import { createHash } from 'node:crypto';
import type { LanguageModelMiddleware } from 'ai';

/** The middleware's own call-options type, so a provider-spec bump lands here. */
export type ByokCallOptions = Parameters<
  NonNullable<LanguageModelMiddleware['transformParams']>
>[0]['params'];

type PromptEntry = ByokCallOptions['prompt'][number];
type ProviderOptions = NonNullable<PromptEntry['providerOptions']>;

const EPHEMERAL = { type: 'ephemeral' } as const;
/** Namespaced so a shared OpenAI key could never collide with another product's prefix. */
const CACHE_KEY_PREFIX = 'openroom:';

/** Merges into one namespace, leaving every other provider's options untouched. */
function mergeNamespace(
  existing: ProviderOptions | undefined,
  namespace: string,
  values: Record<string, unknown>,
): ProviderOptions {
  return {
    ...existing,
    [namespace]: { ...existing?.[namespace], ...values },
  } as ProviderOptions;
}

function withBreakpoint(entry: PromptEntry): PromptEntry {
  return {
    ...entry,
    providerOptions: mergeNamespace(entry.providerOptions, 'anthropic', {
      cacheControl: EPHEMERAL,
    }),
  } as PromptEntry;
}

/**
 * Identity of the cacheable prefix, derived from params alone.
 *
 * Tool names are sorted here as well as in byok.ts: the hash must not change if
 * a provider ever hands the tools back in a different order, and OpenAI keys the
 * cache on this string rather than on the byte order of the request.
 */
export function byokPrefixHash(params: ByokCallOptions): string {
  const system = params.prompt
    .filter((entry) => entry.role === 'system')
    .map((entry) => entry.content)
    .join('\n');
  const tools = (params.tools ?? [])
    .map((item) => ({
      name: item.name,
      schema: item.type === 'function' ? item.inputSchema : item.args,
    }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return createHash('sha256').update(JSON.stringify({ system, tools })).digest('hex');
}

/**
 * Idempotent: the breakpoints are a fixed value and the cache key is derived, so
 * running this twice over the same params yields the same object graph.
 */
export function withCacheBreakpoints(params: ByokCallOptions): ByokCallOptions {
  const lastIndex = params.prompt.length - 1;
  const systemIndex = params.prompt.findIndex((entry) => entry.role === 'system');
  const prompt = params.prompt.map((entry, index) =>
    index === systemIndex || index === lastIndex ? withBreakpoint(entry) : entry,
  );
  return {
    ...params,
    prompt,
    providerOptions: mergeNamespace(params.providerOptions, 'openai', {
      promptCacheKey: `${CACHE_KEY_PREFIX}${byokPrefixHash(params)}`,
    }),
  };
}

export const cacheMiddleware: LanguageModelMiddleware = {
  transformParams: ({ params }) => Promise.resolve(withCacheBreakpoints(params)),
};
