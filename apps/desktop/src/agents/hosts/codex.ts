import { Codex, type CodexOptions, type ThreadEvent, type ThreadOptions } from '@openai/codex-sdk';

import type { AgentHostRunner, AgentTurnHandle, HostTurnInput } from '../runner.js';

interface ThreadLike {
  id: string | null;
  runStreamed(input: string, turnOptions?: { signal?: AbortSignal }): Promise<{ events: AsyncGenerator<ThreadEvent> }>;
}

interface CodexLike {
  startThread(options?: ThreadOptions): ThreadLike;
  resumeThread(id: string, options?: ThreadOptions): ThreadLike;
}

export function codexConstructorOptions(input: HostTurnInput): CodexOptions {
  return {
    config: {
      // The embedded runner briefs the model through the workdir's AGENTS.md
      // (skills included), so Codex's automatic skills block would only inhale
      // every skill installed globally on this machine into each turn.
      skills: { include_instructions: false },
      mcp_servers: {
        openroom: {
          command: input.mcp.command,
          args: input.mcp.args,
          env: input.mcp.env,
          // Desktop owns this loopback sidecar and there is no interactive
          // approval surface in the embedded agent. Without an explicit
          // approval mode Codex treats unannotated write-capable MCP tools as
          // prompt-required, which `approvalPolicy: 'never'` then cancels.
          default_tools_approval_mode: 'approve',
        },
      },
    },
  };
}

export function codexThreadOptions(input: HostTurnInput): ThreadOptions {
  return {
    workingDirectory: input.workdir,
    skipGitRepoCheck: true,
    // Writes stay inside the deck workspace. Reference folders and attachments
    // are read in place, which the sandbox allows without --add-dir; passing
    // them as additionalDirectories would make them writable.
    sandboxMode: 'workspace-write',
    // The agent reads audience answers and co-author deck text, so its shell
    // gets no network to send local files anywhere.
    networkAccessEnabled: false,
    ...(input.model == null ? {} : { model: input.model }),
    // Headless run: an approval prompt has no one to answer it, so Codex
    // auto-cancels the tool call ("access was cancelled"). The sandbox is
    // the boundary; never prompt.
    approvalPolicy: 'never',
  };
}

export function createCodexRunner(
  deps: { makeCodex?: (options: CodexOptions) => CodexLike } = {},
): AgentHostRunner {
  const makeCodex = deps.makeCodex ?? ((options: CodexOptions) => new Codex(options) as unknown as CodexLike);
  return {
    runTurn(input): AgentTurnHandle {
      const abort = new AbortController();
      const done = (async (): Promise<
        { ok: true; sessionId: string | null } | { ok: false; error: string }
      > => {
        let threadId: string | null = input.resume;
        let pendingMessage: string | null = null;
        const flushMessage = (kind: 'text' | 'thinking') => {
          if (pendingMessage === null || pendingMessage.trim() === '') return;
          input.onEvent({ kind, text: pendingMessage });
          pendingMessage = null;
        };
        try {
          const codex = makeCodex(codexConstructorOptions(input));
          const options = codexThreadOptions(input);
          const thread = input.resume === null ? codex.startThread(options) : codex.resumeThread(input.resume, options);
          const { events } = await thread.runStreamed(input.prompt, { signal: abort.signal });
          for await (const event of events) {
            if (event.type === 'thread.started') {
              threadId = event.thread_id;
            } else if (event.type === 'item.completed' && event.item.type === 'agent_message') {
              flushMessage('thinking');
              pendingMessage = event.item.text;
            } else if (event.type === 'item.completed' && event.item.type === 'reasoning') {
              input.onEvent({ kind: 'thinking', text: event.item.text });
            } else if (event.type === 'item.started' && event.item.type === 'mcp_tool_call') {
              flushMessage('thinking');
              input.onEvent({ kind: 'tool', text: `${event.item.server}: ${event.item.tool}` });
            } else if (event.type === 'item.completed' && event.item.type === 'error') {
              // Mid-run notices (context trims, skill warnings) are not failures;
              // a failed turn still arrives as turn.failed below.
              input.onEvent({ kind: 'status', text: event.item.message });
            } else if (event.type === 'turn.failed') {
              flushMessage('thinking');
              return { ok: false, error: event.error.message.slice(0, 400) };
            } else if (event.type === 'error') {
              flushMessage('thinking');
              return { ok: false, error: event.message.slice(0, 400) };
            } else if (event.type === 'turn.completed') {
              flushMessage('text');
            }
          }
          flushMessage('text');
          return { ok: true, sessionId: threadId ?? thread.id };
        } catch (cause) {
          if (abort.signal.aborted) return { ok: false, error: 'Cancelled.' };
          return { ok: false, error: cause instanceof Error ? cause.message.slice(0, 400) : 'Codex run failed.' };
        }
      })();
      return {
        cancel: () => abort.abort(),
        done,
      };
    },
  };
}
