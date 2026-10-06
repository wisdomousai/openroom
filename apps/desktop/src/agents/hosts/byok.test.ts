import { describe, expect, it, vi } from 'vitest';
import type { generateText as sdkGenerateText, streamText as sdkStreamText, ToolSet } from 'ai';

import { AGENT_TASK_PROFILES } from '../profiles.js';
import type { HostTurnInput } from '../runner.js';
import type { AgentEvent } from '../types.js';
import { createByokRunner, createByokWarmer, type ByokMcpSession } from './byok.js';

/** One tool set for both a real run and a warm-up: the prefix has to match byte for byte. */
const MCP_TOOLS: ToolSet = {
  outline_validate: { description: 'validate', inputSchema: { type: 'object' } },
  deck_get: { description: 'get', inputSchema: { type: 'object' } },
  deck_save_version: { description: 'save', inputSchema: { type: 'object' } },
} as unknown as ToolSet;

/** Wider than MCP_TOOLS so an allowlist has something to leave behind. */
const PROFILE_MCP_TOOLS: ToolSet = {
  outline_validate: { description: 'validate', inputSchema: { type: 'object' } },
  session_status: { description: 'status', inputSchema: { type: 'object' } },
  deck_get: { description: 'get', inputSchema: { type: 'object' } },
  deck_draft_put: { description: 'draft', inputSchema: { type: 'object' } },
  deck_save_version: { description: 'save', inputSchema: { type: 'object' } },
  picture_search: { description: 'pictures', inputSchema: { type: 'object' } },
} as unknown as ToolSet;

const ESCALATED = 'escalated to full agent';

type StreamPart = Record<string, unknown> & { type: string };

function turnInput(overrides: Partial<HostTurnInput> = {}): HostTurnInput {
  return {
    prompt: 'Prepare the deck',
    workdir: '/run/conv',
    mcpConfigPath: '/run/conv/mcp.json',
    mcp: { command: '/App/OpenRoom', args: ['/App/mcp-stdio.js', '--deny-tool', 'design_preview'], env: { ELECTRON_RUN_AS_NODE: '1' } },
    folders: ['/Users/t/School'],
    resume: null,
    model: 'google:gemini-3.7-flash',
    onEvent: () => undefined,
    ...overrides,
  };
}

function fakeStream(parts: StreamPart[]) {
  const options: Parameters<typeof sdkStreamText>[0][] = [];
  const streamText = ((given: Parameters<typeof sdkStreamText>[0]) => {
    options.push(given);
    return {
      fullStream: (async function* () {
        for (const part of parts) {
          await Promise.resolve();
          yield part;
        }
      })(),
    };
  }) as unknown as typeof sdkStreamText;
  return { streamText, options };
}

function fakeMcp(tools: ToolSet = {}): ByokMcpSession & { closed: number } {
  return {
    closed: 0,
    tools: () => Promise.resolve(tools),
    close(this: { closed: number }) {
      this.closed += 1;
      return Promise.resolve();
    },
  };
}

function runner(
  parts: StreamPart[],
  overrides: Partial<Parameters<typeof createByokRunner>[0]> = {},
  tools: ToolSet = {},
) {
  const stream = fakeStream(parts);
  const mcp = fakeMcp(tools);
  const events: AgentEvent[] = [];
  const host = createByokRunner({
    resolveModel: () => Promise.resolve({ modelId: 'fake' } as never),
    connectMcp: () => Promise.resolve(mcp),
    systemPrompt: () => Promise.resolve('SYSTEM'),
    streamText: stream.streamText,
    ...overrides,
  });
  return { host, mcp, events, options: stream.options };
}

describe('createByokRunner', () => {
  it('coalesces deltas and orders tool events against the text around them', async () => {
    const { host, events } = runner([
      { type: 'reasoning-delta', text: 'weighing ' },
      { type: 'reasoning-delta', text: 'options' },
      { type: 'tool-call', toolName: 'deck_get', toolCallId: '1', input: {} },
      { type: 'tool-input-delta', delta: '{' },
      { type: 'text-delta', text: 'Saved ' },
      { type: 'text-delta', text: 'the outline.' },
      { type: 'finish', finishReason: 'stop' },
    ]);

    const result = await host.runTurn(turnInput({ onEvent: (event) => events.push(event) })).done;

    expect(events).toEqual([
      { kind: 'thinking', text: 'weighing options' },
      { kind: 'tool', text: 'deck_get' },
      { kind: 'text', text: 'Saved the outline.' },
    ]);
    expect(result).toEqual({ ok: true, sessionId: null });
  });

  it('flushes the trailing buffer when the stream ends without a finish part', async () => {
    const { host, events } = runner([{ type: 'text-delta', text: 'Done.' }]);

    await host.runTurn(turnInput({ onEvent: (event) => events.push(event) })).done;

    expect(events).toEqual([{ kind: 'text', text: 'Done.' }]);
  });

  it('reports a tool failure as a status and still finishes the turn', async () => {
    const { host, events } = runner([
      { type: 'tool-call', toolName: 'outline_validate', toolCallId: '1', input: {} },
      { type: 'tool-error', toolCallId: '1', error: new Error('schema rejected') },
      { type: 'text-delta', text: 'Fixed it.' },
    ]);

    const result = await host.runTurn(turnInput({ onEvent: (event) => events.push(event) })).done;

    expect(events).toEqual([
      { kind: 'tool', text: 'outline_validate' },
      { kind: 'status', text: 'schema rejected' },
      { kind: 'text', text: 'Fixed it.' },
    ]);
    expect(result).toEqual({ ok: true, sessionId: null });
  });

  it('fails the turn on a stream error part', async () => {
    const { host } = runner([{ type: 'error', error: new Error('429 rate limited') }]);
    expect(await host.runTurn(turnInput()).done).toEqual({ ok: false, error: '429 rate limited' });
  });

  it('fails the turn when the model cannot be resolved, and opens no MCP client', async () => {
    const connectMcp = vi.fn();
    const { host } = runner([], {
      resolveModel: () => Promise.reject(new Error('Add an API key for Google in Agent settings.')),
      connectMcp,
    });

    expect(await host.runTurn(turnInput()).done).toEqual({
      ok: false,
      error: 'Add an API key for Google in Agent settings.',
    });
    expect(connectMcp).not.toHaveBeenCalled();
  });

  it('cancels with the same message the other hosts use', async () => {
    const { host, events } = runner([
      { type: 'text-delta', text: 'Partial ' },
      { type: 'text-delta', text: 'answer' },
    ]);

    const handle = host.runTurn(turnInput({ onEvent: (event) => events.push(event) }));
    handle.cancel();

    expect(await handle.done).toEqual({ ok: false, error: 'Cancelled.' });
    expect(events).toEqual([{ kind: 'text', text: 'Partial answer' }]);
  });

  it('closes the MCP client exactly once on success and on failure', async () => {
    const ok = runner([{ type: 'text-delta', text: 'Done.' }]);
    await ok.host.runTurn(turnInput()).done;
    expect(ok.mcp.closed).toBe(1);

    const failed = runner([], {
      streamText: (() => {
        throw new Error('transport closed');
      }) as never,
    });
    expect(await failed.host.runTurn(turnInput()).done).toEqual({
      ok: false,
      error: 'transport closed',
    });
    expect(failed.mcp.closed).toBe(1);
  });

  it('replays the prior transcript ahead of this turn and stops the tool loop', async () => {
    const { host, options } = runner([{ type: 'text-delta', text: 'Done.' }]);

    await host.runTurn(
      turnInput({
        transcript: [
          { role: 'tutor', text: 'Earlier ask', attachments: [], folders: [] },
          { role: 'agent', pending: false, parts: [{ kind: 'text', text: 'Earlier answer' }] },
        ],
      }),
    ).done;

    expect(options[0].messages).toEqual([
      { role: 'user', content: 'Earlier ask' },
      { role: 'assistant', content: 'Earlier answer' },
      { role: 'user', content: 'Prepare the deck' },
    ]);
    expect(options[0].system).toBe('SYSTEM');
    expect(options[0].stopWhen).toBeDefined();
    expect(Object.keys(options[0].tools ?? {})).toContain('read_file');
  });

  it('orders the tool block by name with read_file last, so the prefix is byte-stable', async () => {
    const { host, options } = runner([{ type: 'text-delta', text: 'Done.' }], {}, MCP_TOOLS);

    await host.runTurn(turnInput()).done;

    expect(Object.keys(options[0].tools ?? {})).toEqual([
      'deck_get',
      'deck_save_version',
      'outline_validate',
      'read_file',
    ]);
  });

  it('leaves the system param to the host and the breakpoints to the middleware', async () => {
    const { host, options } = runner([{ type: 'text-delta', text: 'Done.' }], {}, MCP_TOOLS);

    await host.runTurn(turnInput()).done;

    expect(options[0].system).toBe('SYSTEM');
    expect(options[0].providerOptions).toBeUndefined();
  });
});

/** A fresh part list per streamText call, so an escalation can be answered differently. */
function fakeStreams(runs: StreamPart[][]) {
  const options: Parameters<typeof sdkStreamText>[0][] = [];
  let call = 0;
  const streamText = ((given: Parameters<typeof sdkStreamText>[0]) => {
    const parts = runs[Math.min(call, runs.length - 1)];
    call += 1;
    options.push(given);
    return {
      fullStream: (async function* () {
        for (const part of parts) {
          await Promise.resolve();
          yield part;
        }
      })(),
    };
  }) as unknown as typeof sdkStreamText;
  return { streamText, options };
}

function stopsAt(options: Parameters<typeof sdkStreamText>[0]): (steps: number) => boolean {
  const stop = options.stopWhen as unknown as (given: { steps: unknown[] }) => boolean;
  return (steps) => stop({ steps: new Array(steps).fill(null) });
}

describe('task profiles', () => {
  it('keeps the allowlist, adds escalate, and still ends on read_file', async () => {
    const { host, options } = runner([{ type: 'text-delta', text: 'Done.' }], {}, PROFILE_MCP_TOOLS);

    await host.runTurn(turnInput({ profile: AGENT_TASK_PROFILES['add-image'] })).done;

    expect(Object.keys(options[0].tools ?? {})).toEqual([
      'deck_draft_put',
      'deck_get',
      'deck_save_version',
      'escalate',
      'picture_search',
      'read_file',
    ]);
    expect(options[0].system).toBe(AGENT_TASK_PROFILES['add-image'].systemPrompt);
  });

  it('gives the full agent every tool and no way out of it', async () => {
    const { host, options } = runner([{ type: 'text-delta', text: 'Done.' }], {}, PROFILE_MCP_TOOLS);

    await host.runTurn(turnInput({ profile: AGENT_TASK_PROFILES.full })).done;

    expect(Object.keys(options[0].tools ?? {})).not.toContain('escalate');
    expect(Object.keys(options[0].tools ?? {})).toContain('session_status');
    expect(options[0].system).toBe('SYSTEM');
  });

  it('caps the loop at the profile budget, not the host default', async () => {
    const profiled = runner([{ type: 'text-delta', text: 'Done.' }], {}, PROFILE_MCP_TOOLS);
    await profiled.host.runTurn(turnInput({ profile: AGENT_TASK_PROFILES['add-exercise'] })).done;
    const capped = stopsAt(profiled.options[0]);
    expect(capped(AGENT_TASK_PROFILES['add-exercise'].maxSteps)).toBe(true);
    expect(capped(AGENT_TASK_PROFILES['add-exercise'].maxSteps - 1)).toBe(false);

    const full = runner([{ type: 'text-delta', text: 'Done.' }], {}, PROFILE_MCP_TOOLS);
    await full.host.runTurn(turnInput()).done;
    expect(stopsAt(full.options[0])(AGENT_TASK_PROFILES.full.maxSteps)).toBe(true);
  });

  it('runs a cheap profile on the selected provider’s small model', async () => {
    const asked: (string | null)[] = [];
    const { host } = runner([{ type: 'text-delta', text: 'Done.' }], {
      resolveModel: (id: string | null) => {
        asked.push(id);
        return Promise.resolve({ modelId: 'fake' } as never);
      },
    });

    await host.runTurn(
      turnInput({ model: 'anthropic:claude-opus-5', profile: AGENT_TASK_PROFILES['add-image'] }),
    ).done;

    expect(asked).toEqual(['anthropic:claude-haiku-4-5']);
  });

  it('keeps the selected model when its provider has no cheaper tier', async () => {
    const asked: (string | null)[] = [];
    const { host } = runner([{ type: 'text-delta', text: 'Done.' }], {
      resolveModel: (id: string | null) => {
        asked.push(id);
        return Promise.resolve({ modelId: 'fake' } as never);
      },
    });

    await host.runTurn(
      turnInput({ model: 'cloudflare:@cf/zai-org/glm-5.2', profile: AGENT_TASK_PROFILES['add-image'] }),
    ).done;
    await host.runTurn(turnInput({ model: 'anthropic:claude-opus-5' })).done;

    expect(asked).toEqual(['cloudflare:@cf/zai-org/glm-5.2', 'anthropic:claude-opus-5']);
  });
});

function escalating(runs: StreamPart[][], onEvent: (event: AgentEvent) => void) {
  const stream = fakeStreams(runs);
  const mcp = fakeMcp(PROFILE_MCP_TOOLS);
  const host = createByokRunner({
    resolveModel: () => Promise.resolve({ modelId: 'fake' } as never),
    connectMcp: () => Promise.resolve(mcp),
    systemPrompt: () => Promise.resolve('SYSTEM'),
    streamText: stream.streamText,
  });
  return { host, mcp, options: stream.options, onEvent };
}

const ESCALATE_CALL: StreamPart = { type: 'tool-call', toolName: 'escalate', toolCallId: '1', input: {} };

describe('escalation', () => {
  it('reruns the same turn on the full agent, once, and names the switch', async () => {
    const events: AgentEvent[] = [];
    const { host, options, mcp } = escalating(
      [
        [ESCALATE_CALL, { type: 'text-delta', text: 'never streamed' }],
        [{ type: 'text-delta', text: 'Rewrote the outline.' }],
      ],
      (event) => events.push(event),
    );

    const result = await host.runTurn(
      turnInput({
        profile: AGENT_TASK_PROFILES['add-image'],
        onEvent: (event) => events.push(event),
      }),
    ).done;

    expect(result).toEqual({ ok: true, sessionId: null });
    expect(events).toEqual([
      { kind: 'status', text: ESCALATED },
      { kind: 'text', text: 'Rewrote the outline.' },
    ]);
    expect(options).toHaveLength(2);
    expect(options[1].system).toBe('SYSTEM');
    expect(Object.keys(options[1].tools ?? {})).not.toContain('escalate');
    // Each pass opens and closes its own sidecar.
    expect(mcp.closed).toBe(2);
  });

  it('cancels the rerun the same way it cancels a first pass', async () => {
    const events: AgentEvent[] = [];
    let handle: ReturnType<ReturnType<typeof createByokRunner>['runTurn']> | null = null;
    const { host, options } = escalating(
      [[ESCALATE_CALL], [{ type: 'text-delta', text: 'Partial' }]],
      () => undefined,
    );

    handle = host.runTurn(
      turnInput({
        profile: AGENT_TASK_PROFILES['add-image'],
        onEvent: (event) => {
          events.push(event);
          if (event.kind === 'status' && event.text === ESCALATED) handle?.cancel();
        },
      }),
    );

    expect(await handle.done).toEqual({ ok: false, error: 'Cancelled.' });
    expect(options).toHaveLength(2);
  });

  it('leaves a profile that never escalates on its own model and prompt', async () => {
    const events: AgentEvent[] = [];
    const { host, options } = escalating([[{ type: 'text-delta', text: 'Added the picture.' }]], () => undefined);

    const result = await host.runTurn(
      turnInput({
        profile: AGENT_TASK_PROFILES['add-image'],
        onEvent: (event) => events.push(event),
      }),
    ).done;

    expect(result).toEqual({ ok: true, sessionId: null });
    expect(options).toHaveLength(1);
    expect(events).toEqual([{ kind: 'text', text: 'Added the picture.' }]);
  });
});

function warmer(overrides: Partial<Parameters<typeof createByokWarmer>[0]> = {}) {
  const options: Parameters<typeof sdkGenerateText>[0][] = [];
  const mcp = fakeMcp(MCP_TOOLS);
  const warm = createByokWarmer({
    resolveModel: () => Promise.resolve({ modelId: 'fake' } as never),
    connectMcp: () => Promise.resolve(mcp),
    systemPrompt: () => Promise.resolve('SYSTEM'),
    generateText: ((given: Parameters<typeof sdkGenerateText>[0]) => {
      options.push(given);
      return Promise.resolve({ text: '' });
    }) as unknown as typeof sdkGenerateText,
    ...overrides,
  });
  return { warm, mcp, options };
}

describe('createByokWarmer', () => {
  it('builds the same tools and system a real run does', async () => {
    const run = runner([{ type: 'text-delta', text: 'Done.' }], {}, MCP_TOOLS);
    await run.host.runTurn(turnInput()).done;

    const warm = warmer();
    await warm.warm({ model: 'google:gemini-3.7-flash', workdir: '/run/conv', folders: ['/Users/t/School'], mcp: turnInput().mcp });

    expect(Object.keys(warm.options[0].tools ?? {})).toEqual(Object.keys(run.options[0].tools ?? {}));
    expect(warm.options[0].system).toBe(run.options[0].system);
    expect(warm.options[0].maxOutputTokens).toBe(1);
    expect(warm.options[0].messages).toHaveLength(1);
  });

  it('warms a model once per window and closes the sidecar each time', async () => {
    const { warm, mcp, options } = warmer();
    const input = { workdir: '/run/conv', folders: [], mcp: turnInput().mcp };

    await warm({ ...input, model: 'google:gemini-3.7-flash' });
    await warm({ ...input, model: 'google:gemini-3.7-flash' });
    expect(options).toHaveLength(1);

    // Caches are per-model, so a different selection is a different warm-up.
    await warm({ ...input, model: 'openai:gpt-5.6-terra' });
    expect(options).toHaveLength(2);
    expect(mcp.closed).toBe(2);
  });

  it('stays silent when the model or the sidecar fails', async () => {
    const failed = warmer({ resolveModel: () => Promise.reject(new Error('Add an API key.')) });
    await expect(failed.warm({ model: 'openai:x', workdir: '/run/conv', folders: [], mcp: turnInput().mcp })).resolves.toBeUndefined();
    expect(failed.options).toHaveLength(0);
  });
});
