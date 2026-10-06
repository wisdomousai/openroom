import type { McpStdioCommand } from './types.js';

/**
 * Hand a deck conversation to the Codex CLI in a real terminal.
 *
 * The embedded pane runs Codex headless: sandboxed, approval-free, MCP writes
 * auto-approved. The terminal is the opposite posture — the tutor watches every
 * step and Codex asks before it acts, because no approval mode is overridden
 * here. Same workdir, same MCP sidecar to the open deck, same thread when one
 * exists (`codex resume`), so the conversation continues rather than restarts.
 */
export interface CodexHandoff {
  bin: string;
  workdir: string;
  /** Codex thread id recorded by the embedded runner; null opens a fresh chat. */
  resumeId: string | null;
  /** Vendor model id the conversation runs on; null uses the CLI's default. */
  model: string | null;
  mcp: McpStdioCommand;
}

/**
 * TOML basic string. JSON escaping is a subset of TOML's for everything a
 * path or env value can contain, so JSON.stringify is the encoder.
 */
function toml(value: string): string {
  return JSON.stringify(value);
}

/** The `-c` overrides that wire the OpenRoom MCP sidecar into the CLI run. */
export function codexMcpOverrides(mcp: McpStdioCommand): string[] {
  return [
    `mcp_servers.openroom.command=${toml(mcp.command)}`,
    `mcp_servers.openroom.args=[${mcp.args.map(toml).join(', ')}]`,
    `mcp_servers.openroom.env={${Object.entries(mcp.env)
      .map(([key, value]) => `${key} = ${toml(value)}`)
      .join(', ')}}`,
  ];
}

export function codexCliArgs(handoff: CodexHandoff): string[] {
  return [
    ...(handoff.resumeId === null ? [] : ['resume', handoff.resumeId]),
    ...(handoff.model === null ? [] : ['-m', handoff.model]),
    ...codexMcpOverrides(handoff.mcp).flatMap((override) => ['-c', override]),
  ];
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * A `.command` file: the one thing macOS opens straight into Terminal. `exec`
 * hands the tab to Codex so closing it ends the run and nothing lingers.
 */
export function codexOpenScript(handoff: CodexHandoff): string {
  return [
    '#!/bin/zsh',
    `cd ${shellQuote(handoff.workdir)} || exit 1`,
    `exec ${[handoff.bin, ...codexCliArgs(handoff)].map(shellQuote).join(' ')}`,
    '',
  ].join('\n');
}
