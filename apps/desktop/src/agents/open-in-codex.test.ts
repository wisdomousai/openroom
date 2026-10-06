import { describe, expect, it } from 'vitest';

import { codexCliArgs, codexOpenScript, type CodexHandoff } from './open-in-codex.js';

function handoff(overrides: Partial<CodexHandoff> = {}): CodexHandoff {
  return {
    bin: '/usr/local/bin/codex',
    workdir: '/Users/t/Library/Application Support/OpenRoom/agent-workspaces/abc/work',
    resumeId: 't-1',
    model: 'gpt-5.6-luna',
    mcp: {
      command: '/Applications/OpenRoom.app/Contents/MacOS/OpenRoom',
      args: ['/App/mcp-stdio.js', '--socket', '/tmp/mcp.sock', '--deny-tool', 'deck_preview'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    },
    ...overrides,
  };
}

describe('open in codex', () => {
  it('resumes the recorded thread on the conversation model with the MCP sidecar wired in', () => {
    expect(codexCliArgs(handoff())).toEqual([
      'resume',
      't-1',
      '-m',
      'gpt-5.6-luna',
      '-c',
      'mcp_servers.openroom.command="/Applications/OpenRoom.app/Contents/MacOS/OpenRoom"',
      '-c',
      'mcp_servers.openroom.args=["/App/mcp-stdio.js", "--socket", "/tmp/mcp.sock", "--deny-tool", "deck_preview"]',
      '-c',
      'mcp_servers.openroom.env={ELECTRON_RUN_AS_NODE = "1"}',
    ]);
  });

  it('opens a fresh chat when no thread or model is recorded', () => {
    const args = codexCliArgs(handoff({ resumeId: null, model: null }));
    expect(args[0]).toBe('-c');
    expect(args).not.toContain('resume');
    expect(args).not.toContain('-m');
  });

  it('does not pass any approval or sandbox override — the terminal run asks', () => {
    const script = codexOpenScript(handoff());
    expect(script).not.toContain('approval');
    expect(script).not.toContain('sandbox');
  });

  it('quotes the workdir and every argument for the shell', () => {
    const script = codexOpenScript(handoff());
    expect(script.split('\n')[1]).toBe(
      "cd '/Users/t/Library/Application Support/OpenRoom/agent-workspaces/abc/work' || exit 1",
    );
    expect(script).toContain("exec '/usr/local/bin/codex' 'resume' 't-1'");
    expect(script.startsWith('#!/bin/zsh\n')).toBe(true);
  });
});
