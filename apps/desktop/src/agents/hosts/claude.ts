import { query as sdkQuery, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type { AgentHostRunner, AgentTurnHandle, HostTurnInput } from '../runner.js';

type QueryFn = (input: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

/**
 * Variables that would make the Claude runtime authenticate with something other
 * than the teacher's Anthropic API key, or send that key somewhere other than the
 * Anthropic API: a cloud or gateway provider, a bearer token, a claude.ai OAuth
 * token, an Anthropic profile or federation, a custom endpoint. Claude Code's
 * authentication precedence ranks providers and ANTHROPIC_AUTH_TOKEN above
 * ANTHROPIC_API_KEY and the OAuth and profile sources below it; all of them go.
 */
const FOREIGN_ANTHROPIC_AUTH_ENV = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_OAUTH_TOKEN',
  'ANTHROPIC_OAUTH_REFRESH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
  'ANTHROPIC_PROFILE',
  'ANTHROPIC_FEDERATION_RULE_ID',
  'ANTHROPIC_ORGANIZATION_ID',
  'ANTHROPIC_BASE_URL',
];

/**
 * The Claude runtime's environment: this process's environment with the
 * teacher's Anthropic API key as its only Anthropic credential. Provider keys
 * supplied through the environment (`OPENROOM_BYOK_*`) stay out as well.
 */
export function claudeApiKeyEnv(apiKey: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || key.startsWith('OPENROOM_BYOK_')) continue;
    out[key] = value;
  }
  for (const key of FOREIGN_ANTHROPIC_AUTH_ENV) delete out[key];
  out['ANTHROPIC_API_KEY'] = apiKey;
  return out;
}

export const CLAUDE_NEEDS_KEY = 'Add an Anthropic API key in Agent settings.';

export function claudeTurnOptions(input: HostTurnInput, abort: AbortController, apiKey: string): Options {
  return {
    cwd: input.workdir,
    resume: input.resume ?? undefined,
    ...(input.model == null ? {} : { model: input.model }),
    mcpServers: {
      openroom: {
        command: input.mcp.command,
        args: input.mcp.args,
        // A stdio server can inherit the runtime's environment; the blank value
        // keeps the key out of the sidecar.
        env: { ...input.mcp.env, ANTHROPIC_API_KEY: '' },
      },
    },
    strictMcpConfig: true,
    allowedTools: ['mcp__openroom__*', 'Read', 'Glob', 'Grep', 'Write', 'Edit', 'Skill'],
    permissionMode: 'acceptEdits',
    additionalDirectories: input.folders,
    settingSources: ['project'],
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    env: claudeApiKeyEnv(apiKey),
    abortController: abort,
  };
}

export interface ClaudeRunnerDeps {
  /** The teacher's Anthropic API key, shared with the API-key host; null when none is stored. */
  apiKey: () => Promise<string | null>;
  query?: QueryFn;
}

export function createClaudeRunner(deps: ClaudeRunnerDeps): AgentHostRunner {
  const queryFn = deps.query ?? (sdkQuery as unknown as QueryFn);
  return {
    runTurn(input): AgentTurnHandle {
      const abort = new AbortController();
      const done = (async (): Promise<
        { ok: true; sessionId: string | null } | { ok: false; error: string }
      > => {
        let sessionId: string | null = input.resume;
        let pendingText: string | null = null;
        const flushText = (kind: 'text' | 'thinking') => {
          if (pendingText === null || pendingText.trim() === '') return;
          input.onEvent({ kind, text: pendingText });
          pendingText = null;
        };
        try {
          const apiKey = await deps.apiKey();
          if (apiKey === null) return { ok: false, error: CLAUDE_NEEDS_KEY };
          const stream = queryFn({ prompt: input.prompt, options: claudeTurnOptions(input, abort, apiKey) });
          for await (const message of stream) {
            if (message.type === 'system' && message.subtype === 'init') {
              // The runtime reports the credential it chose. Anything but the key
              // (a managed gateway policy, say) ends the turn before a model request.
              if (String(message.apiKeySource) !== 'ANTHROPIC_API_KEY') {
                abort.abort();
                return { ok: false, error: 'The Claude runtime did not use the Anthropic API key.' };
              }
              sessionId = message.session_id;
              continue;
            }
            if (message.type === 'assistant') {
              if (pendingText !== null) flushText('thinking');
              for (const block of message.message.content) {
                if (block.type === 'text' && block.text.trim() !== '') {
                  pendingText = pendingText === null ? block.text : `${pendingText}${block.text}`;
                } else if (block.type === 'thinking' && block.thinking.trim() !== '') {
                  input.onEvent({ kind: 'thinking', text: block.thinking });
                } else if (block.type === 'tool_use') {
                  flushText('thinking');
                  input.onEvent({ kind: 'tool', text: block.name });
                }
              }
              continue;
            }
            if (message.type === 'result') {
              // An API failure (an exhausted credit balance, a revoked key) arrives
              // as a "success" result flagged is_error, carrying the API's message.
              if (message.subtype === 'success' && !message.is_error) {
                const result = 'result' in message && typeof message.result === 'string' ? message.result : '';
                if (result.trim() !== '' && result !== pendingText) {
                  flushText('thinking');
                  pendingText = result;
                }
                flushText('text');
                return { ok: true, sessionId };
              }
              const detail =
                'result' in message && typeof message.result === 'string' && message.result.trim() !== ''
                  ? message.result
                  : message.subtype;
              if (pendingText !== detail) flushText('thinking');
              return { ok: false, error: detail.slice(0, 400) };
            }
          }
          flushText('text');
          return { ok: true, sessionId };
        } catch (cause) {
          if (abort.signal.aborted) return { ok: false, error: 'Cancelled.' };
          return { ok: false, error: cause instanceof Error ? cause.message.slice(0, 400) : 'Claude run failed.' };
        }
      })();
      return {
        cancel: () => abort.abort(),
        done,
      };
    },
  };
}
