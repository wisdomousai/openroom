/**
 * The API-key host: an in-process agent loop on the Vercel AI SDK.
 *
 * Unlike Claude and Codex, no vendor process runs the loop, connects MCP, or
 * remembers the conversation — this file does all three. Every external edge is
 * a dep so the tests need no network, no real model, and no spawned sidecar.
 */
import { createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import {
  generateText as sdkGenerateText,
  isStepCount,
  jsonSchema,
  streamText as sdkStreamText,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';

import { createReadFile } from './byok-read-file.js';
import { byokHistory } from './byok-history.js';
import { cheapModelFor } from '../byok-models.js';
import { FULL_TASK_PROFILE, type AgentTaskProfile } from '../profiles.js';
import { splitModelId } from '../providers.js';
import type { AgentHostRunner, AgentTurnHandle, HostTurnInput } from '../runner.js';
import type { AgentEvent, AgentTextEvent, McpStdioCommand } from '../types.js';

/** Enough for read → validate → save, plus a re-read after a version conflict. */
const DEFAULT_MAX_STEPS = FULL_TASK_PROFILE.maxSteps;
/** Facts-only: the tutor sees which agent answered, not why the hop happened. */
const ESCALATED_STATUS = 'escalated to full agent';
/** streamText emits per token; session-store persists per event. Batch before crossing IPC. */
const FLUSH_CHARS = 256;
const FLUSH_MS = 40;
/** Shorter than Anthropic's 5-minute ephemeral window, so a warm cache is never re-paid for. */
const WARM_INTERVAL_MS = 4 * 60 * 1000;
/** Static: a per-tutor greeting here would be per-user bytes inside the warmed prefix. */
const WARM_PROMPT = 'ready';

export interface ByokMcpSession {
  tools(): Promise<ToolSet>;
  close(): Promise<void>;
}

export interface ByokRunnerDeps {
  resolveModel(modelId: string | null): Promise<LanguageModel>;
  connectMcp?(mcp: McpStdioCommand, cwd: string): Promise<ByokMcpSession>;
  systemPrompt(): Promise<string>;
  streamText?: typeof sdkStreamText;
  generateText?: typeof sdkGenerateText;
  maxSteps?: number;
}

/** Everything the cacheable prefix depends on, and nothing else. */
export interface ByokPrefixInput {
  workdir: string;
  folders: string[];
  mcp: McpStdioCommand;
  model?: string | null;
  /** Task profile; absent is the full agent. */
  profile?: AgentTaskProfile;
}

/**
 * The sidecar command is passed through untouched: it already carries
 * `--socket` and `--deny-tool deck_preview`, and mcp-stdio.ts strips the
 * denied tool from tools/list before the model ever sees it. Rebuilding the
 * command here would silently re-enable a denied tool.
 */
export async function connectByokMcp(mcp: McpStdioCommand, cwd: string): Promise<ByokMcpSession> {
  const client = await createMCPClient({
    transport: new Experimental_StdioMCPTransport({
      command: mcp.command,
      args: mcp.args,
      env: mcp.env,
      cwd,
      stderr: 'ignore',
    }),
  });
  return {
    tools: () => client.tools(),
    close: () => client.close(),
  };
}

/**
 * The roots live in the execute closure and never in the schema. That is
 * load-bearing for cache identity, not a style choice: the description and
 * inputSchema are what the provider serializes into the cacheable prefix, so
 * naming a workdir or a tutor's folder here would give every tutor — and every
 * conversation — a private cache. Keep this tool path-free.
 */
export function readFileTool(roots: string[]) {
  const read = createReadFile(roots);
  return tool({
    description:
      'Read a school file the tutor attached, or a file inside a folder the tutor referenced. ' +
      'Paths outside those folders are refused.',
    inputSchema: jsonSchema<{ path: string }>({
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path named in the turn.' } },
      required: ['path'],
      additionalProperties: false,
    }),
    execute: ({ path }) => read(path),
  });
}

/**
 * The profile's way out.
 *
 * A narrow profile that meets a request it was not scoped for has no good move:
 * refusing wastes the turn and improvising with four tools is worse. It calls
 * this instead and the runner reruns the same turn on the full agent. The schema
 * is static and path-free for the same cache reason read_file's is, and execute
 * returns without doing anything — the runner watches for the call, not for a
 * result.
 */
export const ESCALATE_TOOL_NAME = 'escalate';

function escalateTool() {
  return tool({
    description:
      'Hand this turn to the full agent, which has every tool and the complete instructions. ' +
      'Call it as soon as the request needs work outside this task; do not attempt the rest first.',
    inputSchema: jsonSchema<{ reason?: string }>({
      type: 'object',
      properties: { reason: { type: 'string', description: 'What the request needs beyond this task.' } },
      additionalProperties: false,
    }),
    execute: () => Promise.resolve({ escalated: true }),
  });
}

/**
 * A cheap-tier profile runs on the small model of the provider the tutor already
 * chose: a key for one provider is not a key for another, so switching vendors
 * to save tokens would just fail to resolve. A provider with no cheaper tier —
 * or a selection that is not a composite id — keeps the selected model.
 */
function profileModelId(profile: AgentTaskProfile, selected: string | null): string | null {
  if (profile.modelTier !== 'cheap' || selected === null) return selected;
  const split = splitModelId(selected);
  if (split === null) return selected;
  return cheapModelFor(split.providerId) ?? selected;
}

/**
 * The cacheable prefix, built the one way.
 *
 * A warm-up and a real turn must produce byte-identical tools and system text or
 * the warm-up pays for a cache entry the turn then misses, so both go through
 * here. MCP hands tools back in tools/list order, which is stable per sidecar
 * build but not something to rely on; sorting pins the serialized tool block,
 * with read_file appended last so adding an MCP tool cannot reshuffle it.
 *
 * A profile narrows the same prefix: its allowlist drops the tool schemas it
 * will never call and its own prompt replaces the full instructions, which is
 * where the saving is. Both are static, so the profile earns a cache entry of
 * its own rather than fragmenting the full agent's.
 */
async function byokPrefix(
  deps: ByokRunnerDeps,
  connect: (mcp: McpStdioCommand, cwd: string) => Promise<ByokMcpSession>,
  input: ByokPrefixInput,
): Promise<{ session: ByokMcpSession; model: LanguageModel; system: string; tools: ToolSet }> {
  const profile = input.profile ?? FULL_TASK_PROFILE;
  const model = await deps.resolveModel(profileModelId(profile, input.model ?? null));
  const system = profile.systemPrompt ?? (await deps.systemPrompt());
  const session = await connect(input.mcp, input.workdir);
  const mcpTools = await session.tools();
  const allowed =
    profile.tools === 'all'
      ? Object.entries(mcpTools)
      : Object.entries(mcpTools).filter(([name]) => profile.tools.includes(name));
  const named: [string, ToolSet[string]][] =
    profile.id === FULL_TASK_PROFILE.id ? allowed : [...allowed, [ESCALATE_TOOL_NAME, escalateTool()]];
  const tools: ToolSet = {};
  for (const [name, item] of named.sort(([left], [right]) => (left < right ? -1 : 1))) {
    tools[name] = item;
  }
  tools.read_file = readFileTool([input.workdir, ...input.folders]);
  return { session, model, system, tools };
}

/**
 * One trivial call that writes the prefix into the provider's cache before the
 * tutor's first real turn pays to write it.
 *
 * Silent throughout: a warm-up that fails costs nothing but the miss it was
 * meant to avoid, and the tutor never asked for it. Debounced per model id —
 * caches are per-model on every provider, so warming with a model other than the
 * selected one buys nothing and bills for it.
 */
export function createByokWarmer(deps: ByokRunnerDeps): (input: ByokPrefixInput) => Promise<void> {
  const connect = deps.connectMcp ?? connectByokMcp;
  const generateText = deps.generateText ?? sdkGenerateText;
  const warmed = new Map<string, number>();

  return async (input) => {
    const key = input.model ?? '';
    const last = warmed.get(key);
    const now = Date.now();
    if (last !== undefined && now - last < WARM_INTERVAL_MS) return;
    // Stamped before the first await so two mounts in a row cannot both warm.
    // Kept stamped on failure too: a provider that rejects would otherwise be
    // retried on every pane mount.
    warmed.set(key, now);
    let session: ByokMcpSession | null = null;
    try {
      const prefix = await byokPrefix(deps, connect, input);
      session = prefix.session;
      await generateText({
        model: prefix.model,
        system: prefix.system,
        tools: prefix.tools,
        messages: [{ role: 'user', content: WARM_PROMPT }],
        maxOutputTokens: 1,
      });
    } catch {
      // Silent by design.
    } finally {
      await session?.close().catch(() => undefined);
    }
  };
}

/**
 * Batches same-kind deltas into one event. A lost final flush is a silently
 * empty answer, so every exit path calls flush().
 */
function createEmitter(onEvent: (event: AgentEvent) => void) {
  let kind: AgentTextEvent['kind'] | null = null;
  let buffer = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (kind === null || buffer.trim() === '') {
      kind = null;
      buffer = '';
      return;
    }
    onEvent({ kind, text: buffer });
    kind = null;
    buffer = '';
  };

  return {
    flush,
    /** Buffered stream text. */
    push(next: AgentTextEvent['kind'], text: string): void {
      if (text === '') return;
      if (kind !== null && kind !== next) flush();
      kind = next;
      buffer += text;
      if (buffer.length >= FLUSH_CHARS) {
        flush();
        return;
      }
      if (timer === null) timer = setTimeout(flush, FLUSH_MS);
    },
    /** Discrete events (a tool call, a status) always land after the buffer. */
    emit(event: AgentEvent): void {
      flush();
      onEvent(event);
    },
  };
}

function short(cause: unknown, fallback: string): string {
  if (cause instanceof Error) return cause.message.slice(0, 400);
  if (typeof cause === 'string' && cause.trim() !== '') return cause.slice(0, 400);
  return fallback;
}

type TurnOutcome =
  | { ok: true; sessionId: string | null }
  | { ok: false; error: string }
  /** The profile bowed out; the caller reruns the turn on the full agent. */
  | { escalate: true };

export function createByokRunner(deps: ByokRunnerDeps): AgentHostRunner {
  const streamText = deps.streamText ?? sdkStreamText;
  const connect = deps.connectMcp ?? connectByokMcp;

  /** One pass of the loop under one profile. */
  function runProfile(
    input: HostTurnInput,
    profile: AgentTaskProfile,
  ): { cancel: () => void; done: Promise<TurnOutcome> } {
    const abort = new AbortController();
    const emitter = createEmitter(input.onEvent);
    // Only the full agent takes the deps override: a profile's cap is part of
    // what makes it cheap, so a host-wide budget must not raise it.
    const maxSteps =
      profile.id === FULL_TASK_PROFILE.id ? (deps.maxSteps ?? DEFAULT_MAX_STEPS) : profile.maxSteps;
    let escalated = false;

    const done = (async (): Promise<TurnOutcome> => {
      let mcp: ByokMcpSession | null = null;
      let failure: string | null = null;
      try {
        const prefix = await byokPrefix(deps, connect, { ...input, profile });
        mcp = prefix.session;
        const messages: ModelMessage[] = [
          ...byokHistory(input.transcript ?? []),
          { role: 'user', content: input.prompt },
        ];
        const result = streamText({
          model: prefix.model,
          system: prefix.system,
          messages,
          tools: prefix.tools,
          // Without a stop condition the loop ends after the first tool call
          // and the tutor sees a tool name and no answer.
          stopWhen: isStepCount(maxSteps),
          abortSignal: abort.signal,
        });

        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            emitter.push('text', part.text);
          } else if (part.type === 'reasoning-delta') {
            emitter.push('thinking', part.text);
          } else if (part.type === 'tool-call') {
            if (part.toolName === ESCALATE_TOOL_NAME) {
              // Nothing this profile has said so far is worth streaming on: the
              // full agent is about to answer the same turn from scratch.
              escalated = true;
              abort.abort();
              break;
            }
            emitter.emit({ kind: 'tool', text: part.toolName });
          } else if (part.type === 'tool-error') {
            // The loop feeds the failure back to the model; the turn continues.
            emitter.emit({ kind: 'status', text: short(part.error, 'Tool failed.') });
          } else if (part.type === 'error') {
            failure ??= short(part.error, 'API-key run failed.');
          }
        }
        emitter.flush();
        if (escalated) return { escalate: true };
        if (abort.signal.aborted) return { ok: false, error: 'Cancelled.' };
        // No vendor session to resume: session-store no-ops on a null resume id.
        return failure === null ? { ok: true, sessionId: null } : { ok: false, error: failure };
      } catch (cause) {
        emitter.flush();
        if (escalated) return { escalate: true };
        if (abort.signal.aborted) return { ok: false, error: 'Cancelled.' };
        return { ok: false, error: short(cause, 'API-key run failed.') };
      } finally {
        // A close failure must never mask the turn result.
        await mcp?.close().catch(() => undefined);
      }
    })();

    return {
      cancel: () => {
        abort.abort();
      },
      done,
    };
  }

  return {
    /**
     * At most one hop: the full profile carries no escalate tool, so the rerun
     * cannot escalate again. Cancel follows the run that is live, which is the
     * rerun once the hop has happened.
     */
    runTurn(input): AgentTurnHandle {
      const profile = input.profile ?? FULL_TASK_PROFILE;
      let cancelled = false;
      let active = runProfile(input, profile);

      const done = (async (): Promise<
        { ok: true; sessionId: string | null } | { ok: false; error: string }
      > => {
        const first = await active.done;
        if (!('escalate' in first)) return first;
        if (cancelled) return { ok: false, error: 'Cancelled.' };
        input.onEvent({ kind: 'status', text: ESCALATED_STATUS });
        active = runProfile(input, FULL_TASK_PROFILE);
        // A cancel that landed while the rerun was being created still applies.
        if (cancelled) active.cancel();
        const second = await active.done;
        // The full profile carries no escalate tool; this branch is structural only.
        return 'escalate' in second ? { ok: false, error: 'API-key run failed.' } : second;
      })();

      return {
        cancel: () => {
          cancelled = true;
          active.cancel();
        },
        done,
      };
    },
  };
}
