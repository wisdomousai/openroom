import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  query as sdkQuery,
  type HookCallback,
  type HookJSONOutput,
  type Options,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';

import type { AgentHostRunner, AgentTurnHandle, HostTurnInput } from '../runner.js';
import { canonical, contains } from './byok-read-file.js';

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

/**
 * Tools that reach past the file scope below: a shell, a script runtime, the
 * web. They are not in allowedTools either, but acceptEdits auto-approves some
 * shell file commands, so they are removed outright.
 */
export const CLAUDE_DENIED_TOOLS = ['Bash', 'PowerShell', 'REPL', 'Monitor', 'WebFetch', 'WebSearch', 'NotebookEdit'];

/**
 * Entries in the deck workspace that brief or configure the next run, for
 * either vendor. Desktop writes them; the agent never does.
 */
const WORKDIR_CONTROL = new Set(
  ['.claude', '.agents', '.codex', '.mcp.json', 'AGENTS.md', 'CLAUDE.md', 'mcp.json', 'open-in-codex.command'].map(
    (name) => name.toLowerCase(),
  ),
);

export interface ClaudeFileScope {
  workdir: string;
  folders: string[];
  attachmentsDir?: string;
  /** Claude Code's config directory; defaults to CLAUDE_CONFIG_DIR or ~/.claude. */
  configDir?: string;
}

/** Where Claude Code keeps this cwd's oversized tool results, which it reads back with Read. */
function claudeProjectDir(workdir: string, configDir: string): string {
  return join(configDir, 'projects', workdir.replace(/[^a-zA-Z0-9]/g, '-'));
}

const PARENT_SEGMENT = /(^|[\\/])\.\.([\\/]|$)/;
const GLOB_CHAR = /[*?[\]{}]/;

/** The fixed directory an absolute glob starts from: `/a/b/*.md` searches `/a/b`. */
function globBase(pattern: string): string {
  const wildcard = pattern.search(GLOB_CHAR);
  if (wildcard === -1) return pattern;
  const fixed = pattern.slice(0, wildcard);
  const slash = Math.max(fixed.lastIndexOf('/'), fixed.lastIndexOf(sep));
  return slash <= 0 ? '/' : fixed.slice(0, slash);
}

function deny(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  };
}

/**
 * The file boundary the API-key host enforces with read_file, applied to
 * Claude's own file tools: read the deck workspace, this conversation's
 * attachments and the tutor's folders; write only ordinary files in the deck
 * workspace. Paths resolve through realpath, so `..` and symlinks cannot
 * escape. A PreToolUse deny holds even for tools in allowedTools.
 */
export function claudeFileScopeHook(scope: ClaudeFileScope): HookCallback {
  const configDir = scope.configDir ?? process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');
  const readRoots = [
    scope.workdir,
    ...(scope.attachmentsDir === undefined ? [] : [scope.attachmentsDir]),
    ...scope.folders,
    claudeProjectDir(scope.workdir, configDir),
  ];
  const readable = async (target: string): Promise<boolean> => {
    const path = await canonical(target);
    const roots = await Promise.all(readRoots.map(canonical));
    return roots.some((root) => contains(root, path));
  };
  const writable = async (target: string): Promise<boolean> => {
    const path = await canonical(target);
    const root = await canonical(scope.workdir);
    if (path === root || !contains(root, path)) return false;
    const first = relative(root, path).split(sep)[0] ?? '';
    return !WORKDIR_CONTROL.has(first.toLowerCase());
  };
  const at = (value: unknown): string =>
    typeof value === 'string' && value !== '' ? resolve(scope.workdir, value) : scope.workdir;

  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const name = input.tool_name;
    if (CLAUDE_DENIED_TOOLS.includes(name)) return deny(`${name} is not available in OpenRoom Desktop.`);
    const args =
      typeof input.tool_input === 'object' && input.tool_input !== null
        ? (input.tool_input as Record<string, unknown>)
        : {};
    if (name === 'Write' || name === 'Edit') {
      return (await writable(at(args['file_path'])))
        ? {}
        : deny('Write only ordinary files in the deck workspace. Attached files and reference folders are read-only.');
    }
    if (name !== 'Read' && name !== 'Glob' && name !== 'Grep') return {};
    const targets = [at(name === 'Read' ? args['file_path'] : args['path'])];
    const pattern = name === 'Glob' ? args['pattern'] : args['glob'];
    if (typeof pattern === 'string') {
      if (PARENT_SEGMENT.test(pattern)) return deny('Search patterns may not climb out with "..".');
      if (isAbsolute(pattern)) targets.push(globBase(pattern));
    }
    for (const target of targets) {
      if (!(await readable(target))) {
        return deny('Read only the deck workspace, the attached files and the reference folders named in the turn.');
      }
    }
    return {};
  };
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
    disallowedTools: CLAUDE_DENIED_TOOLS,
    permissionMode: 'acceptEdits',
    hooks: {
      PreToolUse: [
        {
          hooks: [
            claudeFileScopeHook({
              workdir: input.workdir,
              folders: input.folders,
              ...(input.attachmentsDir === undefined ? {} : { attachmentsDir: input.attachmentsDir }),
            }),
          ],
        },
      ],
    },
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
