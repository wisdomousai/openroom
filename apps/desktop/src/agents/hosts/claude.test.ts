import { describe, expect, it } from 'vitest';

import type { HostTurnInput } from '../runner.js';
import type { AgentEvent } from '../types.js';
import { CLAUDE_NEEDS_KEY, claudeApiKeyEnv, claudeTurnOptions, createClaudeRunner } from './claude.js';

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

const KEY = 'sk-ant-api03-teacher';
const withKey = async () => KEY;

describe('claude runner', () => {
  it('authenticates with the teacher key alone: OAuth, bearer, provider and endpoint overrides are stripped', () => {
    const env = claudeApiKeyEnv(KEY, {
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'sk-stray',
      ANTHROPIC_AUTH_TOKEN: 'bearer',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
      CLAUDE_CODE_USE_BEDROCK: '1',
      ANTHROPIC_BASE_URL: 'https://proxy.example',
      OPENROOM_BYOK_OPENAI_API_KEY: 'sk-openai',
    });
    expect(env).toEqual({ PATH: '/bin', ANTHROPIC_API_KEY: KEY });
  });

  it('maps a turn onto SDK options and keeps the key out of the MCP sidecar', () => {
    const options = claudeTurnOptions(turnInput(), new AbortController(), KEY);
    expect(options.cwd).toBe('/run/conv');
    expect(options.resume).toBeUndefined();
    expect(options.additionalDirectories).toEqual(['/Users/t/School']);
    expect(options.permissionMode).toBe('acceptEdits');
    expect(options.settingSources).toEqual(['project']);
    expect(options.env?.['ANTHROPIC_API_KEY']).toBe(KEY);
    expect(options.mcpServers).toEqual({
      openroom: {
        command: '/App/OpenRoom',
        args: ['/App/mcp-stdio.js'],
        env: { ELECTRON_RUN_AS_NODE: '1', ANTHROPIC_API_KEY: '' },
      },
    });
  });

  it('passes the previous session id on follow-up turns', () => {
    const options = claudeTurnOptions(turnInput({ resume: 'sess-1' }), new AbortController(), KEY);
    expect(options.resume).toBe('sess-1');
  });

  it('does not start the runtime without an Anthropic key', async () => {
    let started = false;
    const runner = createClaudeRunner({
      apiKey: async () => null,
      // eslint-disable-next-line @typescript-eslint/require-await
      query: async function* () {
        started = true;
      } as never,
    });
    await expect(runner.runTurn(turnInput()).done).resolves.toEqual({ ok: false, error: CLAUDE_NEEDS_KEY });
    expect(started).toBe(false);
  });

  it('ends the turn when the runtime reports a credential other than the key', async () => {
    const runner = createClaudeRunner({
      apiKey: withKey,
      // eslint-disable-next-line @typescript-eslint/require-await
      query: async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sess-1', apiKeySource: 'none' };
        yield { type: 'result', subtype: 'success', is_error: false, result: 'Done.' };
      } as never,
    });
    const result = await runner.runTurn(turnInput()).done;
    expect(result.ok).toBe(false);
  });

  it('streams text and tool events and reports the session id', async () => {
    const events: AgentEvent[] = [];
    const runner = createClaudeRunner({
      apiKey: withKey,
      // eslint-disable-next-line @typescript-eslint/require-await
      query: async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sess-9', apiKeySource: 'ANTHROPIC_API_KEY' };
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Drafting.' },
              { type: 'tool_use', name: 'mcp__openroom__outline_validate' },
            ],
          },
        };
        yield { type: 'result', subtype: 'success', is_error: false, result: 'Done.' };
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

  it('returns an API failure such as an exhausted credit balance as the turn error, verbatim', async () => {
    const message =
      'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.';
    const runner = createClaudeRunner({
      apiKey: withKey,
      // eslint-disable-next-line @typescript-eslint/require-await
      query: async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sess-2', apiKeySource: 'ANTHROPIC_API_KEY' };
        yield { type: 'assistant', error: 'billing_error', message: { content: [{ type: 'text', text: message }] } };
        yield { type: 'result', subtype: 'success', is_error: true, result: message };
      } as never,
    });
    await expect(runner.runTurn(turnInput()).done).resolves.toEqual({ ok: false, error: message });
  });

  it('surfaces an error result', async () => {
    const runner = createClaudeRunner({
      apiKey: withKey,
      // eslint-disable-next-line @typescript-eslint/require-await
      query: async function* () {
        yield { type: 'result', subtype: 'error_during_execution', result: 'ran out of turns' };
      } as never,
    });
    await expect(runner.runTurn(turnInput()).done).resolves.toEqual({ ok: false, error: 'ran out of turns' });
  });
});
