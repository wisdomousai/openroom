import { describe, expect, it } from 'vitest';
import type { ThreadEvent, ThreadOptions } from '@openai/codex-sdk';

import type { HostTurnInput } from '../runner.js';
import type { AgentEvent } from '../types.js';
import { codexConstructorOptions, codexThreadOptions, createCodexRunner } from './codex.js';

function turnInput(overrides: Partial<HostTurnInput> = {}): HostTurnInput {
  return {
    prompt: 'Prepare the deck',
    workdir: '/run/conv',
    mcpConfigPath: '/run/conv/mcp.json',
    mcp: { command: '/App/OpenRoom', args: ['/App/mcp-stdio.js'], env: { ELECTRON_RUN_AS_NODE: '1' } },
    folders: ['/Users/t/School'],
    resume: null,
    onEvent: () => undefined,
    ...overrides,
  };
}

function fakeCodex(events: ThreadEvent[]) {
  const calls: { started: ThreadOptions[]; resumed: Array<{ id: string; options: ThreadOptions | undefined }> } = {
    started: [],
    resumed: [],
  };
  const thread = {
    id: null,
    // eslint-disable-next-line @typescript-eslint/require-await
    runStreamed: async () => ({
      // eslint-disable-next-line @typescript-eslint/require-await
      events: (async function* () {
        for (const event of events) yield event;
      })(),
    }),
  };
  const codex = {
    startThread: (options?: ThreadOptions) => {
      calls.started.push(options ?? {});
      return thread;
    },
    resumeThread: (id: string, options?: ThreadOptions) => {
      calls.resumed.push({ id, options });
      return thread;
    },
  };
  return { codex, calls };
}

describe('codex runner', () => {
  it('feeds the MCP server through the constructor config', () => {
    expect(codexConstructorOptions(turnInput())).toEqual({
      config: {
        // The workdir AGENTS.md carries OpenRoom's skills; the global ones stay out.
        skills: { include_instructions: false },
        mcp_servers: {
          openroom: {
            command: '/App/OpenRoom',
            args: ['/App/mcp-stdio.js'],
            env: { ELECTRON_RUN_AS_NODE: '1' },
            default_tools_approval_mode: 'approve',
          },
        },
      },
    });
  });

  it('scopes the thread to the conversation workdir plus referenced folders', () => {
    expect(codexThreadOptions(turnInput())).toEqual({
      workingDirectory: '/run/conv',
      skipGitRepoCheck: true,
      sandboxMode: 'workspace-write',
      networkAccessEnabled: true,
      // Headless: an approval prompt could only be auto-cancelled.
      approvalPolicy: 'never',
      additionalDirectories: ['/Users/t/School'],
    });
  });

  it('starts a thread on the first turn and resumes it afterwards', async () => {
    const first = fakeCodex([
      { type: 'thread.started', thread_id: 't-1' },
      { type: 'turn.completed', usage: { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } },
    ]);
    const runner = createCodexRunner({ makeCodex: () => first.codex });
    await expect(runner.runTurn(turnInput()).done).resolves.toEqual({ ok: true, sessionId: 't-1' });
    expect(first.calls.started).toHaveLength(1);

    await runner.runTurn(turnInput({ resume: 't-1' })).done;
    expect(first.calls.resumed).toEqual([{ id: 't-1', options: codexThreadOptions(turnInput()) }]);
  });

  it('maps agent messages and MCP tool calls to chat events', async () => {
    const { codex } = fakeCodex([
      { type: 'thread.started', thread_id: 't-2' },
      { type: 'item.started', item: { id: '1', type: 'mcp_tool_call', server: 'openroom', tool: 'deck_save_version', arguments: {}, status: 'in_progress' } },
      { type: 'item.completed', item: { id: '2', type: 'agent_message', text: 'Saved the outline.' } },
    ]);
    const events: AgentEvent[] = [];
    const runner = createCodexRunner({ makeCodex: () => codex });
    await runner.runTurn(turnInput({ onEvent: (event) => events.push(event) })).done;
    expect(events).toEqual([
      { kind: 'tool', text: 'openroom: deck_save_version' },
      { kind: 'text', text: 'Saved the outline.' },
    ]);
  });

  it('collapses pre-tool narration as thinking and leaves the final answer visible', async () => {
    const { codex } = fakeCodex([
      { type: 'thread.started', thread_id: 't-3' },
      { type: 'item.completed', item: { id: '1', type: 'agent_message', text: 'I will inspect the deck first.' } },
      { type: 'item.started', item: { id: '2', type: 'mcp_tool_call', server: 'openroom', tool: 'deck_get', arguments: {}, status: 'in_progress' } },
      { type: 'item.completed', item: { id: '3', type: 'agent_message', text: 'Added the image.' } },
      { type: 'turn.completed', usage: { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } },
    ]);
    const events: AgentEvent[] = [];
    const runner = createCodexRunner({ makeCodex: () => codex });
    await runner.runTurn(turnInput({ onEvent: (event) => events.push(event) })).done;
    expect(events).toEqual([
      { kind: 'thinking', text: 'I will inspect the deck first.' },
      { kind: 'tool', text: 'openroom: deck_get' },
      { kind: 'text', text: 'Added the image.' },
    ]);
  });

  it('surfaces turn failures', async () => {
    const { codex } = fakeCodex([{ type: 'turn.failed', error: { message: 'rate limited' } }]);
    const runner = createCodexRunner({ makeCodex: () => codex });
    await expect(runner.runTurn(turnInput()).done).resolves.toEqual({ ok: false, error: 'rate limited' });
  });
});
