import type { AgentTaskProfile } from './profiles.js';
import type { AgentChatMessage, AgentEvent, AgentHostId, McpStdioCommand } from './types.js';

export interface HostTurnInput {
  prompt: string;
  /** Persistent deck workspace; the turn's cwd and shared across that deck's chats. */
  workdir: string;
  mcpConfigPath: string;
  mcp: McpStdioCommand;
  /** Folders the tutor referenced; read in place via the host's add-dir mechanism. */
  folders: string[];
  /** Claude session_id / Codex thread id from the previous turn, or null on the first. */
  resume: string | null;
  /** Prior turns, replayed by hosts with no vendor session. Claude and Codex ignore it. */
  transcript?: AgentChatMessage[];
  /** Vendor model id chosen in the picker; absent/null uses the host's default. */
  model?: string | null;
  /** Task profile. Absent is the full agent; the CLI hosts ignore it. */
  profile?: AgentTaskProfile;
  onEvent(event: AgentEvent): void;
}

export interface AgentTurnHandle {
  cancel(): void;
  done: Promise<{ ok: true; sessionId: string | null } | { ok: false; error: string }>;
}

export interface AgentHostRunner {
  runTurn(input: HostTurnInput): AgentTurnHandle;
}

export type AgentRunnerMap = Record<AgentHostId, AgentHostRunner>;
