import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { HostTurnInput } from '../runner.js';
import type { AgentEvent } from '../types.js';
import { claudeFileScopeHook, claudeTurnOptions, createClaudeRunner, sanitizedEnv } from './claude.js';

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

describe('claude file scope', () => {
  const temporary: string[] = [];
  afterEach(async () => {
    await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function scope() {
    const root = await mkdtemp(join(tmpdir(), 'or-claude-scope-'));
    temporary.push(root);
    const workdir = join(root, 'work');
    const folder = join(root, 'School');
    const attachmentsDir = join(root, 'run', 'attachments');
    const outside = join(root, 'outside');
    for (const dir of [workdir, folder, attachmentsDir, outside]) await mkdir(dir, { recursive: true });
    await writeFile(join(outside, 'secret.txt'), 'dummy');
    await symlink(outside, join(workdir, 'escape'));
    const hook = claudeFileScopeHook({ workdir, folders: [folder], attachmentsDir, configDir: join(root, 'config') });
    const decide = async (tool_name: string, tool_input: Record<string, unknown>) => {
      const output = await hook(
        { hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: 't', session_id: 's', transcript_path: '', cwd: workdir } as never,
        't',
        { signal: new AbortController().signal },
      );
      return (output as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision ?? 'pass';
    };
    return { workdir, folder, attachmentsDir, outside, decide };
  }

  it('reads the workspace, attachments and named folders, and nothing outside them', async () => {
    const { workdir, folder, attachmentsDir, outside, decide } = await scope();
    expect(await decide('Read', { file_path: join(folder, 'plan.md') })).toBe('pass');
    expect(await decide('Read', { file_path: join(attachmentsDir, 'sheet.pdf') })).toBe('pass');
    expect(await decide('Grep', { pattern: 'x' })).toBe('pass');
    expect(await decide('Read', { file_path: join(outside, 'secret.txt') })).toBe('deny');
    expect(await decide('Read', { file_path: join(workdir, 'escape', 'secret.txt') })).toBe('deny');
    expect(await decide('Glob', { pattern: `${outside}/**/*` })).toBe('deny');
    expect(await decide('Grep', { pattern: 'x', path: folder, glob: '../../**' })).toBe('deny');
    expect(await decide('Bash', { command: 'cat ~/.ssh/id_ed25519' })).toBe('deny');
  });

  it('writes only ordinary files in the workspace, never run config or reference folders', async () => {
    const { workdir, folder, decide } = await scope();
    expect(await decide('Write', { file_path: join(workdir, 'draft.md') })).toBe('pass');
    expect(await decide('Write', { file_path: join(workdir, '.claude', 'settings.json') })).toBe('deny');
    expect(await decide('Edit', { file_path: join(workdir, 'claude.md') })).toBe('deny');
    expect(await decide('Write', { file_path: join(folder, 'plan.md') })).toBe('deny');
    expect(await decide('Write', { file_path: join(workdir, 'escape', 'planted.txt') })).toBe('deny');
  });

  it('wires the scope hook and removes shell and web tools from every turn', () => {
    const options = claudeTurnOptions(turnInput(), new AbortController());
    expect(options.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'WebFetch', 'WebSearch']));
    expect(options.hooks?.PreToolUse?.[0]?.hooks).toHaveLength(1);
  });
});
