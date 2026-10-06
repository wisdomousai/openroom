import { describe, expect, it } from 'vitest';

import type { HostTurnInput } from '../runner.js';
import type { AgentEvent } from '../types.js';
import { claudeTurnOptions, createClaudeRunner, sanitizedEnv } from './claude.js';

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

describe('claude runner', () => {
  it('never forwards ANTHROPIC_API_KEY — the subscription pays', () => {
    const env = sanitizedEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'sk-x' });
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(env['PATH']).toBe('/bin');
  });

  it('maps a turn onto SDK options: workdir cwd, MCP server, folders, project settings', () => {
    const options = claudeTurnOptions(turnInput(), new AbortController());
    expect(options.cwd).toBe('/run/conv');
    expect(options.resume).toBeUndefined();
    expect(options.additionalDirectories).toEqual(['/Users/t/School']);
    expect(options.permissionMode).toBe('acceptEdits');
    expect(options.settingSources).toEqual(['project']);
    expect(options.mcpServers).toEqual({
      openroom: { command: '/App/OpenRoom', args: ['/App/mcp-stdio.js'], env: { ELECTRON_RUN_AS_NODE: '1' } },
    });
  });

  it('passes the previous session id on follow-up turns', () => {
    const options = claudeTurnOptions(turnInput({ resume: 'sess-1' }), new AbortController());
    expect(options.resume).toBe('sess-1');
  });

  it('streams text and tool events and reports the session id', async () => {
    const events: AgentEvent[] = [];
    const runner = createClaudeRunner({
      // eslint-disable-next-line @typescript-eslint/require-await
      query: async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sess-9' };
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Drafting.' },
              { type: 'tool_use', name: 'mcp__openroom__outline_validate' },
            ],
          },
        };
        yield { type: 'result', subtype: 'success', result: 'Done.' };
      } as never,
    });
    const turn = runner.runTurn(turnInput({ onEvent: (event) => events.push(event) }));
    await expect(turn.done).resolves.toEqual({ ok: true, sessionId: 'sess-9' });
    expect(events).toEqual([
      { kind: 'thinking', text: 'Drafting.' },
      { kind: 'tool', text: 'mcp__openroom__outline_validate' },
      { kind: 'text', text: 'Done.' },
    ]);
  });

  it('surfaces an error result', async () => {
    const runner = createClaudeRunner({
      // eslint-disable-next-line @typescript-eslint/require-await
      query: async function* () {
        yield { type: 'result', subtype: 'error_during_execution', result: 'ran out of turns' };
      } as never,
    });
    await expect(runner.runTurn(turnInput()).done).resolves.toEqual({ ok: false, error: 'ran out of turns' });
  });
});
