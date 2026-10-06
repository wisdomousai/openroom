import { query as sdkQuery, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type { AgentHostRunner, AgentTurnHandle, HostTurnInput } from '../runner.js';

type QueryFn = (input: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

/** The subscription pays: a stray API key in the environment must never bill the API instead. */
export function sanitizedEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value;
  }
  delete out['ANTHROPIC_API_KEY'];
  return out;
}

export function claudeTurnOptions(input: HostTurnInput, abort: AbortController): Options {
  return {
    cwd: input.workdir,
    resume: input.resume ?? undefined,
    ...(input.model == null ? {} : { model: input.model }),
    mcpServers: {
      openroom: {
        command: input.mcp.command,
        args: input.mcp.args,
        env: input.mcp.env,
      },
    },
    strictMcpConfig: true,
    allowedTools: ['mcp__openroom__*', 'Read', 'Glob', 'Grep', 'Write', 'Edit', 'Skill'],
    permissionMode: 'acceptEdits',
    additionalDirectories: input.folders,
    settingSources: ['project'],
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    env: sanitizedEnv(),
    abortController: abort,
  };
}

export function createClaudeRunner(deps: { query?: QueryFn } = {}): AgentHostRunner {
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
          const stream = queryFn({ prompt: input.prompt, options: claudeTurnOptions(input, abort) });
          for await (const message of stream) {
            if (message.type === 'system' && message.subtype === 'init') {
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
              if (message.subtype === 'success') {
                const result = 'result' in message && typeof message.result === 'string' ? message.result : '';
                if (result.trim() !== '' && result !== pendingText) {
                  flushText('thinking');
                  pendingText = result;
                }
                flushText('text');
                return { ok: true, sessionId };
              }
              flushText('thinking');
              const detail = 'result' in message && typeof message.result === 'string' ? message.result : message.subtype;
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
